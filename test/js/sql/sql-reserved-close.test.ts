// https://github.com/oven-sh/bun/issues/32099
// reserved.close() closed the underlying connection without returning the
// reservation's pool slot (queryCount/totalQueries), so a later graceful
// sql.close() waited forever. The same leak happened when the server dropped
// a reserved connection, and reserved.close({ timeout }) never closed the
// connection at all when the pending queries finished before the timeout.
//
// Uses minimal mock postgres/mysql servers so it can run without Docker.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import net from "net";

// ---------------------------------------------------------------------------
// postgres mock
// ---------------------------------------------------------------------------

function pkt(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

function int16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s), Buffer.from([0])]);
}

function rowDescription(names: string[]): Buffer {
  const fields = Buffer.concat(
    names.map(name =>
      Buffer.concat([
        cstr(name), // column name
        int32(0), // table oid
        int16(0), // column attr number
        int32(25), // type oid: text
        int16(-1), // type size
        int32(-1), // type modifier
        int16(0), // format: text
      ]),
    ),
  );
  return pkt("T", Buffer.concat([int16(names.length), fields]));
}

function dataRow(values: string[]): Buffer {
  const cols = Buffer.concat(
    values.map(v => {
      const bytes = Buffer.from(v);
      return Buffer.concat([int32(bytes.length), bytes]);
    }),
  );
  return pkt("D", Buffer.concat([int16(values.length), cols]));
}

const authenticationOk = pkt("R", int32(0));
const readyForQuery = pkt("Z", Buffer.from("I"));
const selectXResponse = Buffer.concat([
  rowDescription(["x"]),
  dataRow(["1"]),
  pkt("C", cstr("SELECT 1")),
  readyForQuery,
]);

function errorResponse(message: string): Buffer {
  return pkt(
    "E",
    Buffer.concat([
      Buffer.from("S"),
      cstr("ERROR"),
      Buffer.from("C"),
      cstr("XX000"),
      Buffer.from("M"),
      cstr(message),
      Buffer.from([0]),
    ]),
  );
}

async function startPostgresServer(onQuery: (socket: net.Socket) => void = socket => socket.write(selectXResponse)) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let startup = true;
    let buffered = Buffer.alloc(0);
    socket.on("data", data => {
      buffered = Buffer.concat([buffered, data]);
      if (startup) {
        // the startup message has no type byte: int32 length + payload
        if (buffered.length < 4) return;
        const len = buffered.readInt32BE(0);
        if (buffered.length < len) return;
        buffered = buffered.subarray(len);
        startup = false;
        socket.write(Buffer.concat([authenticationOk, readyForQuery]));
      }
      // regular messages: type byte + int32 length (which includes itself)
      while (buffered.length >= 5) {
        const len = buffered.readInt32BE(1);
        if (buffered.length < 1 + len) break;
        const type = buffered[0];
        buffered = buffered.subarray(1 + len);
        if (type === 0x51 /* 'Q' simple query */) {
          onQuery(socket);
        }
        // anything else ('X' Terminate, ...) needs no reply
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    sockets,
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

// ---------------------------------------------------------------------------
// mysql mock
// ---------------------------------------------------------------------------

function u16le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function u24le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}
function u32le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function packet(seq: number, payload: Buffer): Buffer {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}
function lenencStr(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  return Buffer.concat([Buffer.from([buf.length]), buf]);
}

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

function handshakeV10(): Buffer {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  return packet(
    0,
    Buffer.concat([
      Buffer.from([10]), // protocol version
      Buffer.from("mock-5.7.0\0"), // server version
      u32le(1), // connection id
      authData1, // auth-plugin-data-part-1
      Buffer.from([0]), // filler
      u16le(SERVER_CAPS & 0xffff), // capability flags lower
      Buffer.from([0x2d]), // character set (utf8mb4_general_ci)
      u16le(0x0002), // status flags (SERVER_STATUS_AUTOCOMMIT)
      u16le((SERVER_CAPS >>> 16) & 0xffff), // capability flags upper
      Buffer.from([21]), // length of auth-plugin-data
      Buffer.alloc(10, 0), // reserved
      authData2, // auth-plugin-data-part-2
      Buffer.from("mysql_native_password\0"),
    ]),
  );
}

function okPacket(seq: number, header = 0x00): Buffer {
  return packet(seq, Buffer.from([header, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

// VARCHAR column named "x" (utf8mb4, no flags)
function varcharColumn(): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr("x"),
    lenencStr("x"),
    Buffer.from([0x0c]), // length of fixed fields
    u16le(0x2d), // charset utf8mb4_general_ci
    u32le(1024), // column length
    Buffer.from([0xfd]), // type: VAR_STRING
    u16le(0), // flags
    Buffer.from([0]), // decimals
    Buffer.from([0, 0]), // filler
  ]);
}

// Text-protocol result set for `select 1 as x` (COM_QUERY)
function textResultSet(startSeq: number): Buffer {
  let seq = startSeq;
  return Buffer.concat([
    packet(seq++, Buffer.from([1])), // column count
    packet(seq++, varcharColumn()),
    packet(seq++, lenencStr("1")), // row
    okPacket(seq++, 0xfe), // DEPRECATE_EOF terminator
  ]);
}

async function startMysqlServer() {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
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
          // HandshakeResponse41 from client → accept unconditionally
          authed = true;
          socket.write(okPacket(seq + 1));
          continue;
        }
        const cmd = payload[0];
        if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(textResultSet(seq + 1));
        } else if (cmd === 0x19 /* COM_STMT_CLOSE */) {
          // no response expected
        } else {
          // COM_QUIT or anything else → close
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    sockets,
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test("postgres: sql.close() resolves after reserved.close()", async () => {
  await using pg = await startPostgresServer();
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 2, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  expect(await reserved`select 1 as x`.simple()).toEqual([{ x: "1" }]);

  await reserved.close();
  // close is idempotent
  await reserved.close();
  // the wrapper no longer accepts queries
  await expect(reserved`select 1 as x`).rejects.toMatchObject({
    code: "ERR_POSTGRES_CONNECTION_CLOSED",
  });

  // hung forever before the fix
  await sql.close();
});

test("postgres: sql.close() resolves after the server drops a reserved connection", async () => {
  await using pg = await startPostgresServer();
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  expect(await reserved`select 1 as x`.simple()).toEqual([{ x: "1" }]);

  // server kills the reserved connection's socket
  for (const socket of pg.sockets) socket.destroy();

  // hung forever before the fix
  await sql.close();
});

test("postgres: reserved.close({ timeout }) closes the connection once pending queries finish", async () => {
  const queryReceived = Promise.withResolvers<net.Socket>();
  await using pg = await startPostgresServer(socket => queryReceived.resolve(socket));
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  // queries are lazy; execute() dispatches without awaiting
  const pending = reserved`select 1 as x`.simple().execute();
  const socket = await queryReceived.promise; // the query is now in flight

  // takes the wait-for-pending-queries branch
  const closed = reserved.close({ timeout: 5 });
  const socketClosed = once(socket, "close");

  // let the query finish before the timeout
  socket.write(selectXResponse);
  expect(await pending).toEqual([{ x: "1" }]);
  await closed;

  // before the fix this branch resolved without ever closing the connection
  await socketClosed;
  await sql.close();
});

test("postgres: reserved.close({ timeout }) keeps waiting for remaining queries when one fails", async () => {
  let queries = 0;
  const firstQueryReceived = Promise.withResolvers<net.Socket>();
  const respondToSecondQuery = Promise.withResolvers<void>();
  await using pg = await startPostgresServer(socket => {
    queries++;
    if (queries === 1) {
      firstQueryReceived.resolve(socket);
    } else {
      // held until the first query has failed
      respondToSecondQuery.promise.then(() => socket.write(selectXResponse));
    }
  });
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  const failing = reserved`select 1 as x`.simple().execute();
  const pending = reserved`select 1 as x`.simple().execute();
  const socket = await firstQueryReceived.promise;
  const socketClosed = once(socket, "close");

  const closed = reserved.close({ timeout: 5 });

  // fail the first query; the grace period must keep waiting for the second
  // instead of closing the connection at the first rejection
  socket.write(Buffer.concat([errorResponse("boom"), readyForQuery]));
  await expect(failing).rejects.toMatchObject({ message: "boom" });

  respondToSecondQuery.resolve();
  expect(await pending).toEqual([{ x: "1" }]);

  await closed;
  await socketClosed;
  await sql.close();
});

test("postgres: reserved.close({ timeout }) cancels in-flight queries when the timeout fires", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const queryReceived = Promise.withResolvers<net.Socket>();
    // never answers queries, so the timeout always fires
    await using pg = await startPostgresServer(socket => queryReceived.resolve(socket));
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

    const reserved = await sql.reserve();
    const pending = reserved`select 1 as x`.simple().execute();
    const socket = await queryReceived.promise; // the query is now in flight
    const socketClosed = once(socket, "close");

    await reserved.close({ timeout: 1 });
    await expect(pending).rejects.toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
    await socketClosed;

    // hung forever before the fix
    await sql.close();

    // the cancelled query must not surface as an unhandled rejection through
    // reserved.close()'s internal bookkeeping (one macrotask turn so a report
    // queued by the teardown above still lands while the listener is attached)
    await Bun.sleep(0);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("postgres: an invalid reserved.close() timeout does not strand the reservation", async () => {
  await using pg = await startPostgresServer();
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  expect(await reserved`select 1 as x`.simple()).toEqual([{ x: "1" }]);

  // rejects without mutating the reservation's state
  await expect(reserved.close({ timeout: -1 })).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });

  // the reservation still accepts queries and can still be closed
  expect(await reserved`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  await reserved.close();

  // hung forever when the rejected close stranded the slot
  await sql.close();
});

test("postgres: pool stays usable after reserved.close()", async () => {
  await using pg = await startPostgresServer();
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  const first = await sql.reserve();
  expect(await first`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  await first.close();

  // the closed slot reconnects for a regular query
  expect(await sql`select 1 as x`.simple()).toEqual([{ x: "1" }]);

  // the connection can be reserved and released again
  const second = await sql.reserve();
  expect(await second`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  await second.release();

  // and reserved once more after a release
  const third = await sql.reserve();
  expect(await third`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  await third.close();

  // hung forever before the fix
  await sql.close();
});

test("mysql: sql.close() resolves after reserved.close()", async () => {
  await using my = await startMysqlServer();
  await using sql = new SQL({ url: `mysql://root@127.0.0.1:${my.port}/db`, max: 2, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  expect(await reserved`select 1 as x`.simple()).toEqual([{ x: "1" }]);

  await reserved.close();

  // hung forever before the fix
  await sql.close();
});

test("mysql: sql.close() resolves after the server drops a reserved connection", async () => {
  await using my = await startMysqlServer();
  await using sql = new SQL({ url: `mysql://root@127.0.0.1:${my.port}/db`, max: 1, connectionTimeout: 5 });

  const reserved = await sql.reserve();
  expect(await reserved`select 1 as x`.simple()).toEqual([{ x: "1" }]);

  // server kills the reserved connection's socket
  for (const socket of my.sockets) socket.destroy();

  // hung forever before the fix
  await sql.close();
});

test("mysql: pool stays usable after reserved.close()", async () => {
  await using my = await startMysqlServer();
  await using sql = new SQL({ url: `mysql://root@127.0.0.1:${my.port}/db`, max: 1, connectionTimeout: 5 });

  const first = await sql.reserve();
  expect(await first`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  await first.close();

  expect(await sql`select 1 as x`.simple()).toEqual([{ x: "1" }]);

  const second = await sql.reserve();
  expect(await second`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  await second.release();

  const third = await sql.reserve();
  expect(await third`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  await third.close();

  // hung forever before the fix
  await sql.close();
});
