import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import nodetls from "node:tls";

// Bun.serve({ h2: true }) attaches to the HTTP/1 TLS listener via ALPN:
// the server offers "h2,http/1.1" and adopts sockets that negotiate "h2"
// into the HTTP/2 child context. Every fetch here forces protocol: "h2"
// so a silent fallback to HTTP/1.1 surfaces as a protocol mismatch (the
// response's Via-like assertion on the server side checks req.url,
// headers, and body framing work end-to-end over the H2 path).
//
// Uses Bun's own HTTP/2 fetch client so both sides exercise lshpack.

const fetchH2 = (port: number, path: string, init: RequestInit = {}) =>
  fetch(`https://127.0.0.1:${port}${path}`, {
    ...init,
    // @ts-expect-error protocol is a Bun extension
    protocol: "h2",
    tls: { rejectUnauthorized: false },
  } as RequestInit);

const fixture = `
import { serve } from "bun";

const big = Buffer.alloc(256 * 1024, "abcdefghijklmnop");
const deferred = Promise.withResolvers();

const server = serve({
  port: 0,
  tls: ${JSON.stringify(tls)},
  h2: true,
  routes: {
    "/api/:id": req => new Response("id=" + req.params.id, {
      headers: { "x-route": "api" },
    }),
    "/static": new Response("from-static-route", {
      headers: { "content-type": "text/plain", etag: '"v1"' },
    }),
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ip") {
      return Response.json(server.requestIP(req));
    }
    if (url.pathname === "/hello") {
      return new Response("hello over h2", {
        headers: { "x-proto": "h2", "content-type": "text/plain" },
      });
    }
    if (url.pathname === "/echo") {
      const body = await req.text();
      return new Response(body, {
        status: 201,
        headers: {
          "x-method": req.method,
          "x-echo": req.headers.get("x-echo") ?? "",
          "x-host": req.headers.get("host") ?? "",
          "x-len": String(body.length),
        },
      });
    }
    if (url.pathname === "/big") {
      return new Response(big, { headers: { "content-type": "application/octet-stream" } });
    }
    if (url.pathname === "/headers") {
      return Response.json(Object.fromEntries(req.headers));
    }
    if (url.pathname === "/hold") {
      await req.text();
      await new Promise(() => {});
    }
    if (url.pathname === "/deferred") {
      await deferred.promise;
      return new Response("late");
    }
    if (url.pathname === "/stream") {
      return new Response(new ReadableStream({
        async start(ctrl) {
          for (let i = 0; i < 4; i++) {
            ctrl.enqueue(new TextEncoder().encode("chunk" + i + ";"));
            await Bun.sleep(1);
          }
          ctrl.close();
        },
      }));
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(server.port);
for await (const line of console) {
  if (line === "graceful") { server.stop(false); console.log("ack"); continue; }
  if (line === "abrupt")   { server.stop(true);  console.log("ack"); continue; }
  if (line === "release")  { deferred.resolve(); console.log("ack"); continue; }
  if (line === "stop")     { server.stop(true);  break; }
}
`;

async function withServer(body: (port: number, send: (cmd: string) => Promise<void>) => Promise<void>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  let buf = "";
  const readLine = async (): Promise<string> => {
    while (!buf.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("server exited before printing a line");
      buf += new TextDecoder().decode(value);
    }
    const nl = buf.indexOf("\n");
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    return line;
  };
  const port = parseInt(await readLine(), 10);
  if (!Number.isFinite(port)) throw new Error("bad port");
  // Send a control command and wait for the server's "ack" so the
  // caller knows the effect (GOAWAY written, deferred resolved, …)
  // has happened before it proceeds.
  const send = async (cmd: string) => {
    proc.stdin.write(cmd + "\n");
    proc.stdin.flush();
    const ack = await readLine();
    if (ack !== "ack") throw new Error("expected ack, got " + JSON.stringify(ack));
  };
  let bodyErr: unknown;
  try {
    await body(port, send);
  } catch (e) {
    bodyErr = e;
  }
  reader.releaseLock();
  proc.stdin.write("stop\n");
  proc.stdin.end();
  const exitCode = await proc.exited;
  // Surface the fetch error first (it's the symptom the test cares
  // about); the server's exit code is the root cause and stderr is
  // already inherited so the crash is visible either way.
  if (bodyErr) throw bodyErr;
  expect(exitCode).toBe(0);
}

describe("Bun.serve h2: true", () => {
  test("simple GET over ALPN h2", async () => {
    await withServer(async port => {
      const res = await fetchH2(port, "/hello");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-proto")).toBe("h2");
      expect(res.headers.get("content-type")).toBe("text/plain");
      expect(await res.text()).toBe("hello over h2");
    });
  });

  test("POST body + response headers echoed", async () => {
    await withServer(async port => {
      const payload = Buffer.alloc(9000, "Z").toString();
      const res = await fetchH2(port, "/echo", {
        method: "POST",
        headers: { "x-echo": "roundtrip", "content-type": "text/plain" },
        body: payload,
      });
      expect(res.status).toBe(201);
      expect(res.headers.get("x-method")).toBe("POST");
      expect(res.headers.get("x-echo")).toBe("roundtrip");
      // :authority → host synthesis on the server side
      expect(res.headers.get("x-host")).toContain("127.0.0.1");
      expect(res.headers.get("x-len")).toBe(String(payload.length));
      expect(await res.text()).toBe(payload);
    });
  });

  test("request headers decode via HPACK and reach the handler", async () => {
    await withServer(async port => {
      const res = await fetchH2(port, "/headers", {
        headers: {
          "x-a": "1",
          "x-b": "two",
          "accept": "application/json",
        },
      });
      expect(res.status).toBe(200);
      const got = (await res.json()) as Record<string, string>;
      expect(got["x-a"]).toBe("1");
      expect(got["x-b"]).toBe("two");
      expect(got["accept"]).toBe("application/json");
      expect(got["host"]).toContain("127.0.0.1");
    });
  });

  test("user routes and static routes are mirrored onto the H2 router", async () => {
    await withServer(async port => {
      const r1 = await fetchH2(port, "/api/bun");
      expect(r1.headers.get("x-route")).toBe("api");
      expect(await r1.text()).toBe("id=bun");

      const r2 = await fetchH2(port, "/static");
      expect(r2.status).toBe(200);
      expect(r2.headers.get("etag")).toBe('"v1"');
      expect(await r2.text()).toBe("from-static-route");
    });
  });

  test("multi-frame response body (>16KiB) with flow control", async () => {
    await withServer(async port => {
      const res = await fetchH2(port, "/big");
      expect(res.status).toBe(200);
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(buf.length).toBe(256 * 1024);
      // verify content integrity — 16-byte repeating pattern
      const want = createHash("sha1")
        .update(Buffer.alloc(256 * 1024, "abcdefghijklmnop"))
        .digest("hex");
      const got = createHash("sha1").update(buf).digest("hex");
      expect(got).toBe(want);
    });
  });

  test("streamed ReadableStream response arrives intact", async () => {
    await withServer(async port => {
      const res = await fetchH2(port, "/stream");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("chunk0;chunk1;chunk2;chunk3;");
    });
  });

  test("multiple requests multiplex on one TLS connection", async () => {
    await withServer(async port => {
      // Bun's H2 fetch client pools connections per origin; firing these
      // concurrently exercises multiplexing + HPACK dynamic-table reuse.
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => fetchH2(port, "/api/" + i).then(r => r.text())),
      );
      expect(results).toEqual(Array.from({ length: 8 }, (_, i) => "id=" + i));
    });
  });

  test("server.requestIP(req) returns the peer's textual address", async () => {
    await withServer(async port => {
      const res = await fetchH2(port, "/ip");
      expect(res.status).toBe(200);
      const info = (await res.json()) as { address: string; port: number; family: string };
      // Loopback over either stack; what matters is a well-formed text
      // address (not raw in_addr bytes) and a real ephemeral port.
      expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).toContain(info.address);
      expect(info.family === "IPv4" || info.family === "IPv6").toBe(true);
      expect(info.port).toBeGreaterThan(0);
    });
  });

  test("HTTP/1.1 still works on the same listener when h2 is enabled", async () => {
    await withServer(async port => {
      // Force http/1.1 so the assertion stays meaningful once fetch's
      // default starts offering h2: proves the ALPN cb falls through to
      // http/1.1 and the H1 parser on the same TLS port still works.
      const res = await fetch(`https://127.0.0.1:${port}/hello`, {
        // @ts-expect-error protocol/tls are Bun extensions
        protocol: "http1.1",
        tls: { rejectUnauthorized: false },
      } as RequestInit);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello over h2");
    });
  });

  // Raw TLS+H2 client for wire-level / lifecycle assertions. Speaks just
  // enough HPACK (static-table literals) to issue a single request and
  // parses inbound frames into {type, flags, sid, payload}. `pong()`
  // writes a PING and resolves on the ACK — a deterministic barrier
  // proving the server processed everything written before it.
  type RawFrame = { type: number; flags: number; sid: number; payload: Buffer };
  async function rawH2(port: number) {
    const frame = (type: number, flags: number, sid: number, payload: Buffer = Buffer.alloc(0)) => {
      const hdr = Buffer.alloc(9);
      hdr.writeUIntBE(payload.length, 0, 3);
      hdr[3] = type;
      hdr[4] = flags;
      hdr.writeUInt32BE(sid, 5);
      return Buffer.concat([hdr, payload]);
    };
    const request = (sid: number, method: "GET" | "POST", path: string, endStream: boolean) => {
      const authority = `127.0.0.1:${port}`;
      const hpack = Buffer.concat([
        Buffer.from([method === "GET" ? 0x82 : 0x83, 0x87]), // :method idx, :scheme https idx7
        Buffer.from([0x44, path.length]), // :path literal, name idx 4
        Buffer.from(path),
        Buffer.from([0x41, authority.length]), // :authority literal, name idx 1
        Buffer.from(authority),
      ]);
      sock.write(frame(0x01, 0x04 | (endStream ? 0x01 : 0), sid, hpack));
    };
    const sock = nodetls.connect({ host: "127.0.0.1", port, ALPNProtocols: ["h2"], rejectUnauthorized: false });
    await once(sock, "secureConnect");
    expect(sock.alpnProtocol).toBe("h2");
    sock.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"));
    sock.write(frame(0x04, 0, 0)); // empty client SETTINGS

    const frames: RawFrame[] = [];
    const waiters: { pred: (f: RawFrame) => boolean; resolve: (f: RawFrame) => void }[] = [];
    let rx = Buffer.alloc(0);
    let off = 0;
    sock.on("data", chunk => {
      rx = Buffer.concat([rx, chunk]);
      while (off + 9 <= rx.length) {
        const len = rx.readUIntBE(off, 3);
        if (off + 9 + len > rx.length) break;
        const f: RawFrame = {
          type: rx[off + 3],
          flags: rx[off + 4],
          sid: rx.readUInt32BE(off + 5) & 0x7fffffff,
          payload: Buffer.from(rx.subarray(off + 9, off + 9 + len)),
        };
        frames.push(f);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].pred(f)) waiters.splice(i, 1)[0].resolve(f);
        }
        off += 9 + len;
      }
    });
    const waitFor = (pred: (f: RawFrame) => boolean): Promise<RawFrame> => {
      const hit = frames.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise(resolve => waiters.push({ pred, resolve }));
    };
    const pong = async () => {
      sock.write(frame(0x06, 0, 0, Buffer.alloc(8)));
      await waitFor(f => f.type === 0x06 && !!(f.flags & 0x01));
    };
    return { sock, frame, request, frames, waitFor, pong };
  }

  test("request terminated by a trailer section delivers body to the handler", async () => {
    // RFC 9113 §8.1: HEADERS → DATA (no END_STREAM) → HEADERS(trailers,
    // END_STREAM). gRPC clients, Node http2 with the trailers option,
    // and `curl --trailer` all terminate this way. The server must
    // dispatch last=true to the body callback from the trailers
    // branch, not only from DATA(END_STREAM), or `await req.text()`
    // never resolves.
    await withServer(async port => {
      const h2 = await rawH2(port);
      h2.request(1, "POST", "/echo", false);
      h2.sock.write(h2.frame(0x00, 0x00, 1, Buffer.from("trailed-body"))); // DATA, no END_STREAM
      // Trailer HEADERS carrying END_STREAM. HPACK literal-without-
      // indexing (0x00 prefix): name len, name, value len, value.
      const trailer = Buffer.concat([
        Buffer.from([0x00, "x-trailer".length]),
        Buffer.from("x-trailer"),
        Buffer.from(["t".length]),
        Buffer.from("t"),
      ]);
      h2.sock.write(h2.frame(0x01, 0x04 | 0x01, 1, trailer)); // HEADERS, END_HEADERS|END_STREAM

      // /echo returns the body it read; getting a DATA(END_STREAM)
      // back proves req.text() resolved with what we sent.
      await h2.waitFor(f => f.type === 0x00 && f.sid === 1 && !!(f.flags & 0x01));
      const body = Buffer.concat(h2.frames.filter(f => f.type === 0x00 && f.sid === 1).map(f => f.payload));
      expect(body.toString()).toBe("trailed-body");
      h2.sock.destroy();
    });
  });

  test("SETTINGS_INITIAL_WINDOW_SIZE delta that overflows a stream window → GOAWAY(FLOW_CONTROL_ERROR)", async () => {
    // RFC 9113 §6.9.2: a change to SETTINGS_INITIAL_WINDOW_SIZE that
    // causes any flow-control window to exceed 2³¹-1 MUST be treated
    // as a connection FLOW_CONTROL_ERROR. Without the int64 widening
    // guard the int32 add hits UB (UBSan trap on ASAN builds).
    await withServer(async port => {
      const h2 = await rawH2(port);
      const setting = (id: number, v: number) => {
        const b = Buffer.alloc(6);
        b.writeUInt16BE(id, 0);
        b.writeUInt32BE(v, 2);
        return b;
      };
      // 1. INITIAL_WINDOW_SIZE = 0 so new streams start at 0.
      h2.sock.write(h2.frame(0x04, 0, 0, setting(4, 0)));
      // 2. Open stream 1 on /hold (handler parks; stream stays open).
      h2.request(1, "POST", "/hold", false);
      // 3. WINDOW_UPDATE stream 1 by 2³¹-1 → sendWindow = INT32_MAX.
      const inc = Buffer.alloc(4);
      inc.writeUInt32BE(0x7fffffff, 0);
      h2.sock.write(h2.frame(0x08, 0, 1, inc));
      // 4. INITIAL_WINDOW_SIZE = 2³¹-1 → delta = 2³¹-1, would overflow.
      h2.sock.write(h2.frame(0x04, 0, 0, setting(4, 0x7fffffff)));

      const goaway = await h2.waitFor(f => f.type === 0x07);
      expect(goaway.payload.readUInt32BE(4)).toBe(3); // FLOW_CONTROL_ERROR
      h2.sock.on("error", () => {}); // RST after GOAWAY is expected
      h2.sock.destroy();
    });
  });

  test("raising SETTINGS_INITIAL_WINDOW_SIZE drains backpressured streams", async () => {
    // RFC 9113 §6.9.2: a change to INITIAL_WINDOW_SIZE adjusts every
    // open stream's send window — equivalent to a per-stream
    // WINDOW_UPDATE. Clients that BDP-autotune (nghttp2, Chrome) open
    // windows this way. handleSettings must drain after applying the
    // delta, like handleWindowUpdate does, or a stream parked on
    // flow-control backpressure never resumes.
    await withServer(async port => {
      const h2 = await rawH2(port);
      const setting = (id: number, v: number) => {
        const b = Buffer.alloc(6);
        b.writeUInt16BE(id, 0);
        b.writeUInt32BE(v, 2);
        return b;
      };
      // INITIAL_WINDOW_SIZE=0 so stream 1 starts with sendWindow=0;
      // open the connection window so only the per-stream window
      // blocks the response body.
      h2.sock.write(h2.frame(0x04, 0, 0, setting(4, 0)));
      const connInc = Buffer.alloc(4);
      connInc.writeUInt32BE(1 << 20, 0);
      h2.sock.write(h2.frame(0x08, 0, 0, connInc)); // WINDOW_UPDATE stream 0
      h2.request(1, "GET", "/hello", true);
      // Response HEADERS proves the handler ran; the body is parked
      // in backpressure because sendWindow=0.
      await h2.waitFor(f => f.type === 0x01 && f.sid === 1);
      await h2.pong();
      expect(h2.frames.some(f => f.type === 0x00 && f.sid === 1 && f.payload.length > 0)).toBe(false);

      // Raise the per-stream window via SETTINGS — not WINDOW_UPDATE.
      h2.sock.write(h2.frame(0x04, 0, 0, setting(4, 65535)));
      await h2.waitFor(f => f.type === 0x00 && f.sid === 1 && !!(f.flags & 0x01));
      const body = Buffer.concat(h2.frames.filter(f => f.type === 0x00 && f.sid === 1).map(f => f.payload));
      expect(body.toString()).toBe("hello over h2");
      h2.sock.destroy();
    });
  });

  test("DATA after END_STREAM is rejected with RST_STREAM(STREAM_CLOSED)", async () => {
    // RFC 9113 §5.1: DATA in half-closed(remote) MUST be a STREAM_CLOSED
    // stream error. The server's async handler keeps the stream open
    // (server side hasn't responded yet), so without this guard a
    // malicious client could re-invoke the body callback after the
    // handler already finalised it on the first END_STREAM.
    await withServer(async port => {
      const h2 = await rawH2(port);
      // /hold reads the body then blocks forever so the stream stays in
      // the server's map (half-closed remote, open local) when the
      // violating DATA arrives.
      h2.request(1, "POST", "/hold", false);
      h2.sock.write(h2.frame(0x00, 0x01, 1, Buffer.from("hello"))); // DATA, END_STREAM
      await h2.pong();
      // No spurious RST(NO_ERROR) on a cleanly-ended body.
      expect(h2.frames.filter(f => f.type === 0x03 && f.sid === 1)).toEqual([]);

      // Violate §5.1: DATA on a half-closed(remote) stream.
      h2.sock.write(h2.frame(0x00, 0x01, 1, Buffer.from("evil")));
      const rst = await h2.waitFor(f => f.type === 0x03 && f.sid === 1);
      expect(rst.payload.readUInt32BE(0)).toBe(5); // STREAM_CLOSED
      h2.sock.destroy();
    });
  });

  test("server.stop(true) force-closes live H2 connections", async () => {
    // H2 sockets are adopted out of the H1 context into a child context
    // via us_socket_context_adopt_socket, so closing the H1 context
    // alone (TemplatedApp::close) would miss them. The abrupt path must
    // walk h2ChildContext the same way it walks webSocketContexts[].
    await withServer(async (port, send) => {
      const h2 = await rawH2(port);
      h2.request(1, "POST", "/hold", false);
      h2.sock.write(h2.frame(0x00, 0x01, 1, Buffer.from("x")));
      await h2.pong(); // server has the stream open, handler is parked
      h2.sock.on("error", () => {}); // RST is expected

      const closed = once(h2.sock, "close");
      await send("abrupt");
      // Without the h2ChildContext walk the socket would sit open until
      // the 10s idle timeout; the test's default 5s timeout makes that
      // an observable failure.
      await closed;
    });
  });

  test("graceful stop: in-flight H2 response completes and connection FINs", async () => {
    // After server.stop() sends GOAWAY, an async handler's response
    // completes via cork() outside any uSockets event — there is no
    // on_data/on_writable epilogue to run sweep(), so cork() must
    // shutdown the write side itself once the last stream drains,
    // otherwise the connection idles open until the 10s timeout.
    await withServer(async (port, send) => {
      const h2 = await rawH2(port);
      h2.request(1, "GET", "/deferred", true);
      await h2.pong(); // handler is awaiting `deferred`

      await send("graceful");
      const goaway = await h2.waitFor(f => f.type === 0x07);
      expect(goaway.payload.readUInt32BE(4)).toBe(0); // NO_ERROR

      const ended = once(h2.sock, "end"); // server FIN
      await send("release");
      // Response completes over the still-open connection. The server
      // may split body + END_STREAM across two DATA frames, so wait
      // for the terminator and concatenate all stream-1 DATA payloads.
      await h2.waitFor(f => f.type === 0x00 && f.sid === 1 && !!(f.flags & 0x01));
      const body = Buffer.concat(h2.frames.filter(f => f.type === 0x00 && f.sid === 1).map(f => f.payload));
      expect(body.toString()).toBe("late");
      // … and the server shuts its write side promptly (no 10s idle wait).
      await ended;
      h2.sock.destroy();
    });
  });

  test("ALPN offers h2 on per-SNI SSL_CTX (tls.serverName)", async () => {
    // With tls.serverName set, addServerName() creates a fresh per-SNI
    // SSL_CTX. BoringSSL's sni_cb swaps ssl->ctx to it *before*
    // ssl_negotiate_alpn reads alpn_select_cb, so the ALPN callback
    // must be installed on that per-SNI ctx too — otherwise an SNI-
    // routed connection silently falls back to http/1.1 and h2: true
    // is a no-op. H3 already does this (us_quic_prepare_ssl_ctx on
    // each SNI entry).
    const sniFixture = `
      import { serve } from "bun";
      const server = serve({
        port: 0,
        tls: { ...${JSON.stringify(tls)}, serverName: "localhost" },
        h2: true,
        fetch: () => new Response("sni-ok"),
      });
      console.log(server.port);
      for await (const line of console) if (line === "stop") { server.stop(true); break; }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", sniFixture],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let buf = "";
    while (!buf.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("server exited before printing port");
      buf += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    const port = parseInt(buf.trim(), 10);

    // Connect with SNI "localhost" so sni_cb swaps to the per-SNI ctx.
    const sock = nodetls.connect({
      host: "127.0.0.1",
      port,
      servername: "localhost",
      ALPNProtocols: ["h2", "http/1.1"],
      rejectUnauthorized: false,
    });
    await once(sock, "secureConnect");
    expect(sock.alpnProtocol).toBe("h2");
    sock.destroy();

    proc.stdin.write("stop\n");
    proc.stdin.end();
    expect(await proc.exited).toBe(0);
  });

  test("h2: true without tls throws", () => {
    expect(() =>
      Bun.serve({
        port: 0,
        // @ts-expect-error h2 is new
        h2: true,
        fetch: () => new Response("x"),
      }),
    ).toThrow(/HTTP\/2 requires 'tls'/);
  });

  test("h2: true with h1: false throws", () => {
    // Without h3 the generic "Cannot disable h1 without enabling h3"
    // fires first; with h3 we reach the h2-specific guard.
    expect(() =>
      Bun.serve({
        port: 0,
        tls,
        // @ts-expect-error h2 is new
        h2: true,
        h3: true,
        h1: false,
        fetch: () => new Response("x"),
      }),
    ).toThrow(/h2 requires h1/);
  });
});
