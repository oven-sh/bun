// Per-stream receive-window backpressure for the fetch() HTTP/2 client.
//
// A streaming consumer that never reads must not let the server refill the
// per-stream window; one that does read must. `local_initial_window_size`
// is 16 MiB with an 8 MiB replenish threshold. Connection-level credit
// (stream id 0) is intentionally receipt-based so a stalled reader doesn't
// starve siblings, and is filtered out of the assertions here.
//
// Kept in its own file rather than `fetch-http2-client.test.ts` because
// each test pushes 12 MiB through a debug-build subprocess over TLS and
// that file's `describe.concurrent` block already sits near the 5s timeout
// on constrained debug/ASAN hosts; piling these on top turns unrelated
// siblings flaky.

import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { once } from "node:events";
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

function spawnFetch(script: string) {
  return Bun.spawn({
    cmd: [bunExe(), "--no-warnings", "-e", script],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
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
});
