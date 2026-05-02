// Response-body receive backpressure for the fetch() client across all
// three transports. A `res.body.getReader()` that stalls must stop the
// server from filling memory; one that drains must let it continue;
// `reader.cancel()` / body abandonment must fall back so the transfer
// completes for keep-alive / stream reuse.
//
// - HTTP/2: per-stream WINDOW_UPDATE gated on `scheduleResponseBodyConsumed`
//   reports. `local_initial_window_size` = 16 MiB, 8 MiB replenish
//   threshold. Connection-level credit stays receipt-based (asserted).
// - HTTP/1.1: `us_socket_pause` once outstanding > `receive_body_high_water`
//   (1 MiB), resumed below `receive_body_low_water` (256 KiB). TCP rwnd
//   does the rest.
// - HTTP/3: `lsquic_stream_wantread(0)` at the same thresholds; lsquic
//   withholds `MAX_STREAM_DATA`.
//
// Kept in its own file because each test pushes several MiB through a
// debug-build subprocess and the existing protocol-specific suites run
// under `describe.concurrent` with tight timeouts.

import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
import net from "node:net";
import nodetls from "node:tls";

// --- Raw HTTP/2 frame server ------------------------------------------------
// Minimal TLS+ALPN(h2) server that speaks the wire format directly so the
// test can observe the exact WINDOW_UPDATE frames the client emits.

function frame(type: number, flags: number, streamId: number, payload: Uint8Array | Buffer = Buffer.alloc(0)) {
  const buf = Buffer.alloc(9 + payload.length);
  buf.writeUIntBE(payload.length, 0, 3);
  buf[3] = type;
  buf[4] = flags;
  buf.writeUInt32BE(streamId & 0x7fffffff, 5);
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(buf, 9);
  return buf;
}

// HPACK static-table index 8 = `:status: 200`.
const hpackStatus200 = Buffer.from([0x80 | 8]);

type RawConn = {
  socket: nodetls.TLSSocket;
  headers(streamId: number, block: Buffer): void;
  /** Send a PING and resolve once the matching ACK arrives — a barrier: by
   *  the time the client ACKs, it has parsed every frame written before. */
  ping(): Promise<void>;
};

type RawState = {
  windowUpdates: Array<{ id: number; increment: number }>;
};

async function withRawH2Server(
  onStream: (conn: RawConn, streamId: number) => void,
  fn: (url: string, state: RawState) => Promise<void>,
) {
  const state: RawState = { windowUpdates: [] };
  const server = nodetls.createServer({ ...tls, ALPNProtocols: ["h2"] }, socket => {
    const pingWaiters: Array<() => void> = [];
    const conn: RawConn = {
      socket,
      headers: (id, block) => socket.write(frame(1, 4, id, block)),
      ping: () => {
        socket.write(frame(6, 0, 0, Buffer.alloc(8)));
        return new Promise(resolve => pingWaiters.push(resolve));
      },
    };
    let buf = Buffer.alloc(0);
    let prefaceSeen = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceSeen) {
        if (buf.length < 24) return;
        buf = buf.subarray(24);
        prefaceSeen = true;
        socket.write(frame(4, 0, 0)); // server preface: empty SETTINGS
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) return;
        const type = buf[3],
          flags = buf[4],
          id = buf.readUInt32BE(5) & 0x7fffffff;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (type === 4 && !(flags & 1)) socket.write(frame(4, 1, 0)); // ack their SETTINGS
        if (type === 1) onStream(conn, id);
        if (type === 6 && flags & 1) pingWaiters.shift()?.();
        if (type === 8) state.windowUpdates.push({ id, increment: payload.readUInt32BE(0) & 0x7fffffff });
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
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

function lineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let acc = "";
  return async function waitFor(prefix: string) {
    while (true) {
      const nl = acc.indexOf("\n");
      if (nl >= 0) {
        const line = acc.slice(0, nl);
        acc = acc.slice(nl + 1);
        if (line.startsWith(prefix)) return line;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`subprocess closed stdout without ${JSON.stringify(prefix)}; buffered: ${acc}`);
      acc += Buffer.from(value).toString();
    }
  };
}

// Push 12 MiB of DATA to `streamId` in 384 KiB batches, round-tripping a
// PING after each so the client has fully parsed (and flushed any
// WINDOW_UPDATE reply) before the next batch lands. Dumping the whole body
// in one burst tickles a pre-existing uSockets-TLS quirk: the h2 client's
// `onData` calls `socket.write()` mid-callback, and
// `us_internal_ssl_socket_write` zeroes `ssl_read_input_length`
// (bun-usockets openssl.c:1815 — the comment there acknowledges it). When
// SSL_read then hits WANT_WRITE with input still queued, `ssl_on_data`
// closes the socket with code 0 (openssl.c:562). Pacing keeps each
// `ssl_on_data` invocation below that threshold.
async function floodData(conn: RawConn, streamId: number) {
  const dataFrame = frame(0, 0, streamId, Buffer.alloc(16 * 1024, 0x62));
  const batch = Buffer.concat(Array.from({ length: 24 }, () => dataFrame));
  for (let i = 0; i < 32; i++) {
    conn.socket.write(batch);
    await conn.ping();
  }
}

// Both tests send only HEADERS from `onStream`, then wait for the child to
// confirm `getReader()` has run before flooding DATA. That ordering is the
// point: `response_body_streaming` must be true on the HTTP thread before
// any DATA is parsed, otherwise receipt-based crediting would fire and the
// stalled-reader assertion becomes timing-dependent.

describe("fetch() over HTTP/2 — per-stream receive-window backpressure", () => {
  test("stalled getReader() withholds per-stream WINDOW_UPDATE", async () => {
    let conn!: RawConn;
    const { promise: opened, resolve: markOpened } = Promise.withResolvers<void>();
    await withRawH2Server(
      (c, id) => {
        conn = c;
        c.headers(id, hpackStatus200);
        markOpened();
      },
      async (url, state) => {
        await using proc = spawnFetch(`
          const res = await fetch("${url}", { tls: { rejectUnauthorized: false } });
          const reader = res.body.getReader();
          process.stdout.write("reader\\n");
          await new Promise(() => {}); // hold the reader; test kills us
        `);
        const waitFor = lineReader(proc.stdout);
        await waitFor("reader");
        await opened;
        // 12 MiB crosses the 8 MiB replenish threshold under receipt-based
        // accounting. The final PING in floodData() is the barrier: once
        // the client ACKs it, it has parsed every DATA frame and run
        // replenishWindow() from onData.
        await floodData(conn, 1);
        const perStream = state.windowUpdates.filter(w => w.id === 1);
        const connLevel = state.windowUpdates.filter(w => w.id === 0);
        // Conn-level credit is receipt-based and should have fired
        // (12 MiB received >= 8 MiB threshold, plus the preface bump).
        expect(connLevel.length).toBeGreaterThan(0);
        // Per-stream credit is coupled to JS consumption; reader never
        // called read(), so no credit.
        expect(perStream).toEqual([]);
        conn.socket.destroy();
        proc.kill();
        await proc.exited;
      },
    );
  }, 30_000);

  test("getReader() that drains releases per-stream WINDOW_UPDATE", async () => {
    let conn!: RawConn;
    const { promise: opened, resolve: markOpened } = Promise.withResolvers<void>();
    await withRawH2Server(
      (c, id) => {
        conn = c;
        c.headers(id, hpackStatus200);
        markOpened();
      },
      async (url, state) => {
        await using proc = spawnFetch(`
          const res = await fetch("${url}", { tls: { rejectUnauthorized: false } });
          const reader = res.body.getReader();
          process.stdout.write("reader\\n");
          let total = 0;
          while (total < 10 * 1024 * 1024) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
          }
          process.stdout.write("read:" + total + "\\n");
          await new Promise(() => {});
        `);
        const waitFor = lineReader(proc.stdout);
        await waitFor("reader");
        await opened;
        // 12 MiB, no END_STREAM: the h2 Stream must stay in the session
        // map while the consume messages arrive, otherwise the credit is
        // dropped as a lookup miss.
        await floodData(conn, 1);
        const read = await waitFor("read:");
        expect(Number(read.slice(5))).toBeGreaterThanOrEqual(10 * 1024 * 1024);
        // PING barrier *after* JS has posted its consume messages: the
        // HTTP thread's drainEvents() processes the consume queue before
        // the socket tick that answers this PING, so any remaining
        // WINDOW_UPDATE is on the wire by the time the ACK comes back.
        await conn.ping();
        const perStream = state.windowUpdates.filter(w => w.id === 1);
        expect(perStream.length).toBeGreaterThanOrEqual(1);
        const credited = perStream.reduce((a, w) => a + w.increment, 0);
        // At least the 8 MiB threshold, and never more than wire bytes received.
        expect(credited).toBeGreaterThanOrEqual(8 * 1024 * 1024);
        expect(credited).toBeLessThanOrEqual(12 * 1024 * 1024);
        conn.socket.destroy();
        proc.kill();
        await proc.exited;
      },
    );
  }, 30_000);

  test("reader.cancel() falls back to receipt-based per-stream WINDOW_UPDATE", async () => {
    // `ignoreRemainingResponseBody()` (reader.cancel / Response GC) flips
    // `response_body_streaming` on so the HTTP thread stops buffering,
    // then clears the ByteStream's drain_handler. If the consumption gate
    // keyed off `response_body_streaming`, `consumed_bytes` would stay 0
    // forever and the abandoned body would wedge the stream at the
    // initial window. It keys off `body_consumption_tracked` instead,
    // which `ignoreRemainingResponseBody` disarms — so the per-stream
    // credit reverts to receipt-based and the body keeps draining.
    let conn!: RawConn;
    const { promise: opened, resolve: markOpened } = Promise.withResolvers<void>();
    await withRawH2Server(
      (c, id) => {
        conn = c;
        c.headers(id, hpackStatus200);
        markOpened();
      },
      async (url, state) => {
        await using proc = spawnFetch(`
          const res = await fetch("${url}", { tls: { rejectUnauthorized: false } });
          const reader = res.body.getReader();
          await reader.cancel();
          process.stdout.write("cancelled\\n");
          await new Promise(() => {});
        `);
        const waitFor = lineReader(proc.stdout);
        await waitFor("cancelled");
        await opened;
        await floodData(conn, 1);
        const perStream = state.windowUpdates.filter(w => w.id === 1);
        // Receipt-based: 12 MiB received crosses the 8 MiB threshold.
        expect(perStream.length).toBeGreaterThanOrEqual(1);
        conn.socket.destroy();
        proc.kill();
        await proc.exited;
      },
    );
  }, 30_000);
});

// --- HTTP/1.1 ----------------------------------------------------------------
// A raw TCP server pumps response body bytes until `socket.write()` returns
// false and `drain` stops firing — that point is where TCP rwnd has closed.
// The client controls rwnd by reading (or not) from the socket; the fetch
// h1 client pauses reads once 1 MiB is buffered for a stalled JS reader, so
// the server stalls at 1 MiB + kernel send/recv buffers. Without the pause
// the client drains the socket into ByteStream's internal buffer forever
// and the server never stalls.

describe("fetch() over HTTP/1.1 — socket-read backpressure", () => {
  /** Pump 64 KiB chunks, respecting `drain`, until `drain` doesn't fire
   *  within `stallMs` (= client stopped reading) or `cap` bytes sent.
   *  Returns `{ written, stalled }`. */
  async function pumpUntilStall(socket: net.Socket, cap: number, stallMs: number) {
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let written = 0;
    while (written < cap) {
      if (!socket.write(chunk)) {
        const drained = await Promise.race([
          once(socket, "drain").then(() => true),
          Bun.sleep(stallMs).then(() => false),
        ]);
        if (!drained) return { written, stalled: true };
      }
      written += chunk.length;
    }
    return { written, stalled: false };
  }

  async function withH1Server(fn: (url: string, onReq: (h: (s: net.Socket) => void) => void) => Promise<void>) {
    let handler: ((s: net.Socket) => void) | undefined;
    const server = net.createServer(socket => {
      socket.once("data", () => {
        // Don't parse; just respond. No Content-Length so the client
        // reads until close (body_out_str path, not the single-packet
        // fast path).
        socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
        handler?.(socket);
      });
      socket.on("error", () => {});
    });
    server.listen(0);
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      await fn(`http://127.0.0.1:${port}`, h => (handler = h));
    } finally {
      server.close();
    }
  }

  test("stalled getReader() pauses the socket read", async () => {
    await withH1Server(async (url, onReq) => {
      const { promise: gotSocket, resolve } = Promise.withResolvers<net.Socket>();
      onReq(resolve);
      await using proc = spawnFetch(`
        const res = await fetch("${url}");
        const reader = res.body.getReader();
        process.stdout.write("reader\\n");
        await new Promise(() => {});
      `);
      const waitFor = lineReader(proc.stdout);
      await waitFor("reader");
      const socket = await gotSocket;
      // 16 MiB cap: without the fix, the client's socket read never
      // pauses so the server reaches this and stalled=false. With the
      // fix, the client pauses at ~1 MiB and the server stalls well
      // before the cap. 400 ms stall window is generous for a paused
      // socket but short enough to not dominate the test.
      const { written, stalled } = await pumpUntilStall(socket, 16 * 1024 * 1024, 400);
      expect(stalled).toBe(true);
      // 1 MiB high-water + both kernel send/recv buffers (loopback
      // defaults can be several MiB on Linux) + LIBUS_RECV_BUFFER_LENGTH
      // (512 KiB) of in-flight before the pause is observed. The
      // primary signal is `stalled == true`; the byte bound is a loose
      // sanity check that we didn't reach the cap.
      expect(written).toBeLessThan(16 * 1024 * 1024);
      socket.destroy();
      proc.kill();
      await proc.exited;
    });
  }, 30_000);

  test("draining getReader() keeps the socket readable", async () => {
    await withH1Server(async (url, onReq) => {
      const { promise: gotSocket, resolve } = Promise.withResolvers<net.Socket>();
      onReq(resolve);
      await using proc = spawnFetch(`
        const res = await fetch("${url}");
        const reader = res.body.getReader();
        process.stdout.write("reader\\n");
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total >= 6 * 1024 * 1024) { process.stdout.write("read:" + total + "\\n"); break; }
        }
        await new Promise(() => {});
      `);
      const waitFor = lineReader(proc.stdout);
      await waitFor("reader");
      const socket = await gotSocket;
      // The reader is actively draining, so every drain-wait should
      // resolve and we reach the cap.
      const { written, stalled } = await pumpUntilStall(socket, 8 * 1024 * 1024, 2000);
      expect(stalled).toBe(false);
      expect(written).toBe(8 * 1024 * 1024);
      const read = await waitFor("read:");
      expect(Number(read.slice(5))).toBeGreaterThanOrEqual(6 * 1024 * 1024);
      socket.destroy();
      proc.kill();
      await proc.exited;
    });
  }, 30_000);

  test("reader.cancel() resumes a paused socket", async () => {
    await withH1Server(async (url, onReq) => {
      const { promise: gotSocket, resolve } = Promise.withResolvers<net.Socket>();
      onReq(resolve);
      await using proc = spawnFetch(`
        const res = await fetch("${url}");
        const reader = res.body.getReader();
        process.stdout.write("reader\\n");
        // Wait for the test to confirm the server is stalled, then cancel.
        await new Promise(r => process.stdin.once("data", r));
        await reader.cancel();
        process.stdout.write("cancelled\\n");
        await new Promise(() => {});
      `);
      const waitFor = lineReader(proc.stdout);
      await waitFor("reader");
      const socket = await gotSocket;
      const first = await pumpUntilStall(socket, 8 * 1024 * 1024, 400);
      expect(first.stalled).toBe(true);
      // Tell the child to cancel; `ignoreRemainingResponseBody` disarms
      // `body_consumption_tracked` and posts the sentinel consume
      // message, which resumes the paused socket on the HTTP thread.
      proc.stdin!.write("go\n");
      await waitFor("cancelled");
      // Server should now be able to keep writing.
      const second = await pumpUntilStall(socket, 4 * 1024 * 1024, 2000);
      expect(second.stalled).toBe(false);
      socket.destroy();
      proc.kill();
      await proc.exited;
    });
  }, 30_000);
});

// --- HTTP/3 ------------------------------------------------------------------
// `Bun.serve({ h3: true })` runs in the test process; the fetch client
// runs in a subprocess (lsquic's client and server engines can't share
// the same event loop). Bun.serve's response sink buffers ahead of
// QUIC flow control, and `reader.read()` itself triggers a consume
// report that resumes the stream, so neither server-side pull count
// nor a JS-side drain loop can observe the pause directly. Instead the
// client reads the process-wide `onStreamData` byte counter via
// `fetchH3Internals.liveCounts().bodyBytesReceived`: with the
// `wantRead(false)` gate that counter stops near `receive_body_high_water`;
// without it it tracks whatever the server pushed.

describe("fetch() over HTTP/3 — lsquic wantRead backpressure", () => {
  async function withH3Server(bodyBytes: number, fn: (url: string) => Promise<void>) {
    const chunk = Buffer.alloc(64 * 1024, 0x62);
    await using server = Bun.serve({
      port: 0,
      tls,
      h3: true,
      h1: false,
      fetch() {
        let sent = 0;
        return new Response(
          new ReadableStream({
            type: "bytes",
            async pull(ctrl) {
              if (sent >= bodyBytes) return ctrl.close();
              ctrl.enqueue(chunk.slice());
              sent += chunk.length;
            },
          }),
        );
      },
    });
    await fn(`https://127.0.0.1:${server.port}`);
  }

  const h3Client = (url: string, body: string) => `
    const { fetchH3Internals } = require("bun:internal-for-testing");
    const received = () => fetchH3Internals.liveCounts().bodyBytesReceived;
    // Poll the onStreamData counter until it stops growing for two
    // consecutive 100 ms samples — that's the point wantRead(false)
    // took effect (or the body finished).
    async function settle() {
      let last = -1;
      while (received() !== last) { last = received(); await Bun.sleep(100); }
      return last;
    }
    const res = await fetch("${url}/", {
      protocol: "http3",
      tls: { rejectUnauthorized: false },
    });
    const reader = res.body.getReader();
    process.stdout.write("reader\\n");
    ${body}
    await new Promise(() => {});
  `;

  test("stalled getReader() bounds bytes delivered to the client", async () => {
    await withH3Server(16 * 1024 * 1024, async url => {
      await using proc = spawnFetch(
        h3Client(
          url,
          `
          process.stdout.write("settled:" + (await settle()) + "\\n");
        `,
        ),
        { BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" },
      );
      const stderrP = proc.stderr.text();
      const waitFor = lineReader(proc.stdout);
      await waitFor("reader").catch(async e => {
        throw new Error(`${e.message}\nstderr: ${await stderrP}`);
      });
      const settled = Number((await waitFor("settled:")).slice(8));
      // ~1 MiB high-water plus whatever lsquic's on_read loop delivered
      // in the batch that crossed it (≤ one US_QUIC_READ_BUF pass).
      // Without the gate this climbs to the full 16 MiB body.
      expect(settled).toBeGreaterThan(512 * 1024);
      expect(settled).toBeLessThan(4 * 1024 * 1024);
      proc.kill();
      await proc.exited;
    });
  }, 30_000);

  test("draining getReader() reads the full body", async () => {
    await withH3Server(8 * 1024 * 1024, async url => {
      await using proc = spawnFetch(
        h3Client(
          url,
          `
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
          }
          process.stdout.write("read:" + total + ":" + received() + "\\n");
        `,
        ),
        { BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" },
      );
      const stderrP = proc.stderr.text();
      const waitFor = lineReader(proc.stdout);
      await waitFor("reader").catch(async e => {
        throw new Error(`${e.message}\nstderr: ${await stderrP}`);
      });
      const [, read, recv] = (await waitFor("read:")).split(":").map(Number);
      // Actively draining: the pause/resume cycle must let the full
      // body through, and every byte delivered by onStreamData is
      // eventually read by JS.
      expect(read).toBe(8 * 1024 * 1024);
      expect(recv).toBe(8 * 1024 * 1024);
      proc.kill();
      await proc.exited;
    });
  }, 30_000);

  test("reader.cancel() resumes a paused lsquic stream", async () => {
    await withH3Server(16 * 1024 * 1024, async url => {
      await using proc = spawnFetch(
        h3Client(
          url,
          `
          const stalledAt = await settle();
          await reader.cancel();
          // ignoreRemainingResponseBody disarms body_consumption_tracked
          // and posts the sentinel consume → consumeResponseBodyByHttpId
          // → wantRead(true). onStreamData resumes and the counter
          // moves past the stall point.
          let moved = false;
          for (let i = 0; i < 50 && !moved; i++) {
            await Bun.sleep(50);
            if (received() > stalledAt) moved = true;
          }
          process.stdout.write("resumed:" + stalledAt + ":" + (moved ? 1 : 0) + "\\n");
        `,
        ),
        { BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" },
      );
      const stderrP = proc.stderr.text();
      const waitFor = lineReader(proc.stdout);
      await waitFor("reader").catch(async e => {
        throw new Error(`${e.message}\nstderr: ${await stderrP}`);
      });
      const [, stalledAt, moved] = (await waitFor("resumed:")).split(":").map(Number);
      expect(stalledAt).toBeGreaterThan(0);
      expect(stalledAt).toBeLessThan(4 * 1024 * 1024);
      expect(moved).toBe(1);
      proc.kill();
      await proc.exited;
    });
  }, 30_000);
});
