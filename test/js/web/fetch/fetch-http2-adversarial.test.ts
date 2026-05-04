import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import nodetls from "node:tls";

// ─── frame helpers (copied from fetch-http2-client.test.ts; not exported) ────

function frame(type: number, flags: number, streamId: number, payload: Uint8Array | Buffer = Buffer.alloc(0)) {
  const buf = Buffer.alloc(9 + payload.length);
  buf.writeUIntBE(payload.length, 0, 3);
  buf[3] = type;
  buf[4] = flags;
  buf.writeUInt32BE(streamId & 0x7fffffff, 5);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(buf, 9);
  return buf;
}
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const setting = (id: number, value: number) => {
  const b = Buffer.alloc(6);
  b.writeUInt16BE(id, 0);
  b.writeUInt32BE(value >>> 0, 2);
  return b;
};
const hpackStatus200 = Buffer.from([0x80 | 8]);
const hpackLit = (name: string, value: string) =>
  Buffer.concat([Buffer.from([0x10, name.length]), Buffer.from(name), Buffer.from([value.length]), Buffer.from(value)]);

// ─── raw server with full preface control ────────────────────────────────────

type RawSock = nodetls.TLSSocket;
type StreamCb = (socket: RawSock, streamId: number, connIndex: number) => void;
type PrefaceCb = (socket: RawSock, connIndex: number) => void;

async function withAdversarialServer(
  opts: { onPreface?: PrefaceCb; onStream?: StreamCb; settingsPayload?: Buffer | null },
  fn: (url: string, state: { connections: number; rst: Array<{ id: number; code: number }> }) => Promise<void>,
) {
  const state = { connections: 0, rst: [] as Array<{ id: number; code: number }> };
  const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2"] }, socket => {
    const connIndex = state.connections++;
    let buf = Buffer.alloc(0);
    let prefaceSeen = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceSeen) {
        if (buf.length < 24) return;
        buf = buf.subarray(24);
        prefaceSeen = true;
        // settingsPayload === null → send nothing (test 4)
        // settingsPayload === undefined → default empty SETTINGS
        if (opts.settingsPayload === null) {
          // skip
        } else {
          socket.write(frame(4, 0, 0, opts.settingsPayload ?? Buffer.alloc(0)));
        }
        opts.onPreface?.(socket, connIndex);
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) return;
        const type = buf[3],
          flags = buf[4],
          id = buf.readUInt32BE(5) & 0x7fffffff;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (type === 4 && !(flags & 1) && opts.settingsPayload !== null) socket.write(frame(4, 1, 0));
        if (type === 1) opts.onStream?.(socket, id, connIndex);
        if (type === 3) state.rst.push({ id, code: payload.readUInt32BE(0) });
      }
    });
    socket.on("error", () => {});
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`https://localhost:${port}`, state);
  } finally {
    server.close();
  }
}

function spawnFetch(script: string, extraEnv: Record<string, string> = {}) {
  return Bun.spawn({
    cmd: [bunExe(), "--no-warnings", "-e", script],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function collect(proc: ReturnType<typeof spawnFetch>) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// ─────────────────────────────────────────────────────────────────────────────

describe.concurrent("fetch() HTTP/2 adversarial", () => {
  const h2 = { protocol: "http2" as const, tls: { rejectUnauthorized: false } };
  const errcode = (e: any) => e.code || e.name;

  // 1. CONTINUATION flood: server sends HEADERS without END_HEADERS, then many
  //    CONTINUATION frames. Client should bound memory and error. Runs in a
  //    subprocess so the RSS measurement is isolated from the test runner.
  test("CONTINUATION flood is bounded", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          // HEADERS with valid :status, no END_HEADERS, no END_STREAM.
          socket.write(frame(1, 0, id, hpackStatus200));
          // 5000 × 16 KiB of literal header garbage (well-formed HPACK literals
          // so the decoder doesn't bail early).
          const junk = hpackLit("x-junk", Buffer.alloc(120, "a").toString());
          // pack a single CONTINUATION payload close to 16 KiB
          const reps = Math.floor(16000 / junk.length);
          const cont = Buffer.concat(Array.from({ length: reps }, () => junk));
          let sent = 0;
          const pump = () => {
            while (sent < 5000) {
              if (!socket.write(frame(9, 0, id, cont))) {
                sent++;
                return socket.once("drain", pump);
              }
              sent++;
            }
          };
          pump();
        },
      },
      async url => {
        await using proc = spawnFetch(`
          const baseline = process.memoryUsage().rss;
          let peak = baseline;
          const t = setInterval(() => {
            const rss = process.memoryUsage().rss;
            if (rss > peak) peak = rss;
          }, 50);
          const r = await fetch(${JSON.stringify(url)}, {
            protocol: "http2",
            signal: AbortSignal.timeout(8000),
            tls: { rejectUnauthorized: false },
          }).catch(e => ({ err: e.code || e.name || String(e) }));
          clearInterval(t);
          console.log(JSON.stringify({ growth: peak - baseline, result: r.err ?? r.status }));
        `);
        const { stdout, exitCode } = await collect(proc);
        const out = JSON.parse(stdout.trim());
        // Connection should error well before the ~80 MB of CONTINUATION payload
        // accumulates. Allow generous slack for TLS/allocator overhead.
        expect(out.result).toBe("HTTP2HeaderListTooLarge");
        expect(out.growth).toBeLessThan(64 * 1024 * 1024);
        expect(exitCode).toBe(0);
      },
    );
  });

  // 2. MAX_CONCURRENT_STREAMS=0: server allows zero streams.
  test("MAX_CONCURRENT_STREAMS=0 does not hang", async () => {
    await withAdversarialServer(
      {
        settingsPayload: setting(0x3, 0),
        onStream: (socket, id) => {
          // The leader stream attaches before SETTINGS arrive — answer it so
          // it can complete. Subsequent streams are the interesting case.
          socket.write(frame(1, 5, id, hpackStatus200)); // END_STREAM|END_HEADERS
        },
      },
      async url => {
        const results = await Promise.allSettled([
          fetch(url, h2).then(r => r.status),
          fetch(url, h2).then(r => r.status),
          fetch(url, h2).then(r => r.status),
        ]);
        // The exact outcome (all succeed, some fail, or new connections are
        // opened) is acceptable; the test is that allSettled resolves at all.
        expect(results.length).toBe(3);
        for (const r of results) expect(r.status).toMatch(/fulfilled|rejected/);
      },
    );
  });

  // 3. Stream-level WINDOW_UPDATE overflow: 3× 2^31-1 increments.
  test("repeated WINDOW_UPDATE(2^31-1) on a stream is a stream error, not a crash", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(frame(8, 0, id, u32be(0x7fffffff)));
          socket.write(frame(8, 0, id, u32be(0x7fffffff)));
          socket.write(frame(8, 0, id, u32be(0x7fffffff)));
          socket.write(frame(1, 5, id, hpackStatus200));
        },
      },
      async (url, state) => {
        const result = await fetch(url, h2).then(r => r.status, errcode);
        // Either the request errors with a flow-control code, or the server
        // saw an RST_STREAM(FLOW_CONTROL_ERROR=3).
        const fc = state.rst.some(r => r.code === 3);
        expect(fc || /FlowControl|HTTP2/.test(String(result))).toBe(true);
      },
    );
  });

  // 4. Server never sends initial SETTINGS, then closes. The leader stream is
  //    attached before SETTINGS arrive; verify the close propagates as a clean
  //    error rather than parking the request.
  test("server that closes without sending SETTINGS fails the request cleanly", async () => {
    await withAdversarialServer({ settingsPayload: null, onPreface: socket => socket.end() }, async url => {
      const code = await fetch(url, h2).then(r => r.status, errcode);
      expect(String(code)).toMatch(/Connection|ECONNRESET|HTTP2|SocketClosed/i);
    });
  });

  // 5. DATA after END_STREAM on HEADERS.
  test("DATA after HEADERS(END_STREAM) is rejected/ignored without corruption", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(frame(1, 5, id, Buffer.concat([hpackStatus200, hpackLit("content-length", "0")])));
          socket.write(frame(0, 1, id, Buffer.from("SHOULD-NOT-APPEAR")));
        },
      },
      async url => {
        // The two server writes may coalesce into one TCP segment (DATA-after-
        // END_STREAM rejected as a stream error before headers deliver) or
        // arrive separately (response delivers, late DATA discarded). Either
        // is correct; what must NOT happen is the extra bytes reaching the body.
        const out = await fetch(url, h2).then(
          r => r.text().then(body => ({ status: r.status, body })),
          e => ({ err: errcode(e) }),
        );
        if ("err" in out) {
          expect(out.err).toBe("HTTP2ProtocolError");
        } else {
          expect(out.status).toBe(200);
          expect(out.body).not.toContain("SHOULD-NOT-APPEAR");
        }
      },
    );
  });

  // 6. Tiny-DATA flood: 50 000 × 1-byte DATA frames.
  test("50k single-byte DATA frames are reassembled correctly", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(frame(1, 4, id, hpackStatus200));
          const N = 50_000;
          // Batch into ~512-frame writes so the kernel doesn't choke.
          const oneByte = (last: boolean) => frame(0, last ? 1 : 0, id, Buffer.from("x"));
          let sent = 0;
          const batch = Buffer.concat(Array.from({ length: 512 }, () => oneByte(false)));
          const pump = () => {
            while (sent + 512 < N) {
              if (!socket.write(batch)) {
                sent += 512;
                return socket.once("drain", pump);
              }
              sent += 512;
            }
            while (sent < N - 1) {
              socket.write(oneByte(false));
              sent++;
            }
            socket.write(oneByte(true));
          };
          pump();
        },
      },
      async url => {
        const body = await fetch(url, h2).then(r => r.text());
        expect(body.length).toBe(50_000);
        expect(body).toBe(Buffer.alloc(50_000, "x").toString());
      },
    );
  });

  // 7. Unknown frame type with near-max payload.
  test("unknown frame type 0xFF with 16 KiB payload is ignored", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(frame(0xff, 0, id, Buffer.alloc(16383, 0xaa)));
          socket.write(frame(0xff, 0, 0, Buffer.alloc(16383, 0xbb)));
          socket.write(frame(1, 4, id, hpackStatus200));
          socket.write(frame(0, 1, id, Buffer.from("ok")));
        },
      },
      async url => {
        const r = await fetch(url, h2);
        expect(r.status).toBe(200);
        expect(await r.text()).toBe("ok");
      },
    );
  });

  // 8. Padded DATA with pad length ≥ payload length → PROTOCOL_ERROR.
  test("DATA with pad length ≥ payload length is a protocol error", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(frame(1, 4, id, hpackStatus200));
          // PADDED flag (0x8), payload = [padLen=6, 5×0x00] → padLen >= payload.len.
          socket.write(frame(0, 0x8, id, Buffer.from([6, 0, 0, 0, 0, 0])));
        },
      },
      async url => {
        // Either fetch() or text() should surface the protocol error; the bad
        // padding must never produce a successful body.
        const result = await fetch(url, h2)
          .then(r => r.text(), errcode)
          .catch(errcode);
        expect(String(result)).toMatch(/HTTP2|ProtocolError|ConnectionClosed/);
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Regressions for the H2Client.zig hardening pass.
  // ───────────────────────────────────────────────────────────────────────────

  test("DATA after END_STREAM in same packet is rejected", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          // One write so both DATA frames land in the same parseFrames pass.
          socket.write(
            Buffer.concat([
              frame(1, 0x4, id, hpackStatus200),
              frame(0, 0x1, id, Buffer.from("hello")),
              frame(0, 0, id, Buffer.from("EXTRA")),
            ]),
          );
        },
      },
      async url => {
        const out = await fetch(url, h2).then(
          r => r.text().then(body => ({ status: r.status, body })),
          e => ({ err: errcode(e) }),
        );
        expect("body" in out ? out.body : undefined).not.toBe("helloEXTRA");
        expect("err" in out && out.err).toBe("HTTP2ProtocolError");
      },
    );
  });

  test("RST_STREAM(NO_ERROR) mid-body without Content-Length fails", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(
            Buffer.concat([
              frame(1, 0x4, id, hpackStatus200),
              frame(0, 0, id, Buffer.from("partial")),
              frame(3, 0, id, u32be(0)),
            ]),
          );
        },
      },
      async url => {
        const out = await fetch(url, h2).then(
          r => r.text().then(body => ({ status: r.status, body })),
          e => ({ err: errcode(e) }),
        );
        expect(out).not.toEqual({ status: 200, body: "partial" });
        expect("err" in out && out.err).toBe("HTTP2StreamReset");
      },
    );
  });

  test("trailers without END_STREAM are rejected", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(
            Buffer.concat([
              frame(1, 0x4, id, hpackStatus200),
              frame(0, 0, id, Buffer.from("a")),
              frame(1, 0x4, id, hpackLit("x-t", "1")),
              frame(0, 0x1, id, Buffer.from("b")),
            ]),
          );
        },
      },
      async url => {
        const out = await fetch(url, h2).then(
          r => r.text().then(body => ({ status: r.status, body })),
          e => ({ err: errcode(e) }),
        );
        expect("body" in out ? out.body : undefined).not.toBe("ab");
        expect("err" in out && out.err).toBe("HTTP2ProtocolError");
      },
    );
  });

  test("non-graceful GOAWAY does not discard completed stream", async () => {
    await withAdversarialServer(
      {
        onStream: (socket, id) => {
          socket.write(
            Buffer.concat([
              frame(1, 0x4, id, hpackStatus200),
              frame(0, 0x1, id, Buffer.from("ok")),
              frame(7, 0, 0, Buffer.concat([u32be(id), u32be(2)])),
            ]),
          );
        },
      },
      async url => {
        const r = await fetch(url, h2);
        expect(r.status).toBe(200);
        expect(await r.text()).toBe("ok");
      },
    );
  });

  test("GOAWAY before SETTINGS fails fast", async () => {
    await withAdversarialServer(
      {
        settingsPayload: null,
        onPreface: socket => socket.write(frame(7, 0, 0, Buffer.concat([u32be(0), u32be(0)]))),
      },
      async url => {
        const code = await fetch(url, h2).then(r => r.status, errcode);
        expect(code).toBe("HTTP2ProtocolError");
      },
    );
  });
});
