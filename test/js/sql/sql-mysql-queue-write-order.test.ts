// https://github.com/oven-sh/bun/issues/32005
//
// The MySQL native request queue matches server responses to requests in FIFO
// queue order, so query packets must reach the wire in that same order.
// JSMySQLQuery::do_run used to write optimistically before enqueueing, which
// could put a query's packets ahead of an earlier queued-but-unwritten
// request; all writes now go through the queue's advance() walk.
//
// The optimistic write path also had a concrete user-visible bug: when run()
// failed for a query that was already queued (e.g. it was queued behind an
// in-flight COM_STMT_PREPARE of the same statement and that prepare failed),
// run() pre-marked the query as failed, so the reject path's settle-once gate
// concluded the query was already settled and the promise never rejected.
//
// Uses a minimal mock MySQL server so it can run without Docker.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import net from "net";

function u16le(n: number) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function u24le(n: number) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}
function u32le(n: number) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function packet(seq: number, payload: Buffer) {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}

// Server capability flags (subset sufficient for these paths).
const CLIENT_PROTOCOL_41 = 1 << 9;
const CLIENT_SECURE_CONNECTION = 1 << 15;
const CLIENT_PLUGIN_AUTH = 1 << 19;
const CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 1 << 21;
const CLIENT_DEPRECATE_EOF = 1 << 24;
const SERVER_CAPS =
  CLIENT_PROTOCOL_41 |
  CLIENT_SECURE_CONNECTION |
  CLIENT_PLUGIN_AUTH |
  CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA |
  CLIENT_DEPRECATE_EOF;

function handshakeV10() {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62); // includes trailing NUL as part of 13 bytes
  authData2[12] = 0;
  const payload = Buffer.concat([
    Buffer.from([10]), // protocol version
    Buffer.from("mock-5.7.0\0"), // server version NUL-terminated
    u32le(1), // connection id
    authData1, // auth-plugin-data-part-1 (8)
    Buffer.from([0]), // filler
    u16le(SERVER_CAPS & 0xffff), // capability flags lower
    Buffer.from([0x2d]), // character set (utf8mb4_general_ci)
    u16le(0x0002), // status flags (SERVER_STATUS_AUTOCOMMIT)
    u16le((SERVER_CAPS >>> 16) & 0xffff), // capability flags upper
    Buffer.from([21]), // length of auth-plugin-data
    Buffer.alloc(10, 0), // reserved
    authData2, // auth-plugin-data-part-2 (13 bytes)
    Buffer.from("mysql_native_password\0"),
  ]);
  return packet(0, payload);
}

function okPacket(seq: number) {
  // header, affected_rows (lenenc 0), last_insert_id (lenenc 0), status flags, warnings
  return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function errorPacket(seq: number, errno: number, message: string) {
  const payload = Buffer.concat([Buffer.from([0xff]), u16le(errno), Buffer.from("#42000"), Buffer.from(message)]);
  return packet(seq, payload);
}

const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;

// Mock server: OK to every COM_QUERY, ERROR to every COM_STMT_PREPARE, and a
// wire-order log of the commands it received. With `holdPrepare`, the first
// prepare's ERROR response is held until the test calls the release function
// resolved through `heldPrepare`, keeping that request in flight on the wire.
function mockServer(opts: { holdPrepare?: boolean } = {}) {
  const wireLog: string[] = [];
  const {
    promise: heldPrepare,
    resolve: onPrepareHeld,
    reject: rejectHeldPrepare,
  } = Promise.withResolvers<() => void>();
  let held = false;
  const server = net.createServer(socket => {
    if (opts.holdPrepare) {
      // Fail the awaiting test fast with a message if the connection dies
      // before the prepare is held; no-ops once heldPrepare has resolved.
      socket.once("error", rejectHeldPrepare);
      socket.once("close", () => {
        rejectHeldPrepare(new Error("mock connection closed before COM_STMT_PREPARE was observed"));
      });
    }

    let buffered = Buffer.alloc(0);
    let authed = false;

    socket.write(handshakeV10());

    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
        if (buffered.length < 4 + len) break;
        const seq = buffered[3];
        const payload = buffered.subarray(4, 4 + len);
        buffered = buffered.subarray(4 + len);

        if (!authed) {
          // HandshakeResponse41 from client -> accept unconditionally.
          authed = true;
          socket.write(okPacket(seq + 1));
          continue;
        }

        const cmd = payload[0];
        if (cmd === COM_STMT_PREPARE) {
          wireLog.push(`prepare:${payload.subarray(1).toString()}`);
          if (opts.holdPrepare && !held) {
            held = true;
            const respond = () => {
              wireLog.push("release");
              socket.write(errorPacket(seq + 1, 1064, "mock prepare failure"));
            };
            onPrepareHeld(respond);
            continue;
          }
          socket.write(errorPacket(seq + 1, 1064, "mock prepare failure"));
        } else if (cmd === COM_QUERY) {
          wireLog.push(`query:${payload.subarray(1).toString()}`);
          socket.write(okPacket(seq + 1));
        } else {
          // COM_QUIT or anything else -> close.
          socket.end();
        }
      }
    });
  });
  return { server, wireLog, heldPrepare };
}

test("query queued behind a failing prepare of the same statement rejects instead of hanging", async () => {
  const { server, wireLog } = mockServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // Same query text and parameter shape -> same statement signature. q2 is
    // issued while q1's COM_STMT_PREPARE is still in flight, so it joins q1's
    // statement and waits in the queue. When the prepare fails, q1 rejects
    // and q2 must reject too (with the cached statement error); before the
    // fix q2's promise never settled.
    const q1 = sql`wat ${1}`;
    const q2 = sql`wat ${1}`;
    (q1 as any).execute();
    (q2 as any).execute();

    const settle = (q: Promise<unknown>) =>
      q.then(
        () => ({ ok: true }) as const,
        (err: any) => ({ ok: false, errno: err?.errno, message: String(err?.message ?? err) }) as const,
      );
    const [r1, r2] = await Promise.all([settle(q1), settle(q2)]);

    expect(r1).toEqual({ ok: false, errno: 1064, message: "mock prepare failure" });
    expect(r2).toEqual({ ok: false, errno: 1064, message: "mock prepare failure" });

    // Only q1's prepare may reach the wire; q2 hits the cached failed
    // statement without writing anything.
    expect(wireLog).toEqual(["prepare:wat ? "]);

    // The connection must still be usable afterwards.
    await sql.unsafe("do 1");
    expect(wireLog).toEqual(["prepare:wat ? ", "query:do 1"]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("queries reach the wire in issuance order and all settle", async () => {
  const { server, wireLog } = mockServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // Simple-protocol queries (no params) issued in one tick: responses are
    // matched to requests in FIFO queue order, so the server must receive
    // them in exactly the order they were issued.
    const queries = Array.from({ length: 4 }, (_, i) => sql.unsafe(`do ${i}`));
    for (const q of queries) (q as any).execute();
    await Promise.all(queries);

    expect(wireLog).toEqual(["query:do 0", "query:do 1", "query:do 2", "query:do 3"]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("queries issued while a request is in flight stay parked behind it and drain in FIFO order", async () => {
  const { server, wireLog, heldPrepare } = mockServer({ holdPrepare: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // Prepared query whose COM_STMT_PREPARE the server holds in flight.
    const q0 = sql`hold ${1}`;
    (q0 as any).execute();
    const release = await heldPrepare; // the server has received the prepare

    // Issued while that prepare is in flight: these park in the native queue
    // behind it. None of them may reach the wire before the server answers
    // the prepare (the "release" marker); afterwards they drain in issuance
    // order. The client only processes the release bytes on a later I/O
    // event, after all pending microtasks (including these dispatches) ran.
    const queries = Array.from({ length: 3 }, (_, i) => sql.unsafe(`do ${i}`));
    for (const q of queries) (q as any).execute();

    release();

    const q0errno = await q0.then(
      () => null,
      (err: any) => err?.errno,
    );
    await Promise.all(queries);

    expect(q0errno).toBe(1064);
    expect(wireLog).toEqual(["prepare:hold ? ", "release", "query:do 0", "query:do 1", "query:do 2"]);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
