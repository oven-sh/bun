// close({ timeout: 0 }) must force-close the pool immediately even when
// queries are in flight. It used to be gated on truthiness, so 0 fell into
// the graceful-drain branch and close() waited for pending queries forever.
// https://github.com/oven-sh/bun/issues/32038
//
// Mock servers complete the handshake and then never answer the query, so
// the query stays in flight until the pool force-closes the connection.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

function listen(server: net.Server): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.removeListener("error", reject);
    resolve();
  });
  return promise;
}

// --- Postgres wire helpers (mirrors postgres-multi-statement-fields.test.ts) ---

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

const authenticationOk = pkt("R", int32(0));
const readyForQuery = pkt("Z", Buffer.from("I"));

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

interface Mock {
  port: number;
  server: net.Server;
  sockets: Set<net.Socket>;
  queryReceived: Promise<void>;
}

// Completes the startup handshake, then hands every post-startup chunk to
// onQuery (default: swallow it, leaving the query in flight forever).
async function postgresMock(onQuery?: (socket: net.Socket, data: Buffer) => void): Promise<Mock> {
  const queryReceived = Promise.withResolvers<void>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([authenticationOk, readyForQuery]));
        return;
      }
      onQuery?.(socket, data);
      queryReceived.resolve();
    });
  });
  await listen(server);
  const { port } = server.address() as net.AddressInfo;
  return { port, server, sockets, queryReceived: queryReceived.promise };
}

// --- MySQL wire helpers (mirrors sql-mysql-datetime-text-mock-fixture.ts) ---

function u16le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function u24le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}
function u32le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function mysqlPacket(seq: number, payload: Buffer): Buffer {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}
function lenencStr(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  if (buf.length >= 0xfb) throw new Error("lenencStr: only the 1-byte form is needed here");
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
  const payload = Buffer.concat([
    Buffer.from([10]), // protocol version
    Buffer.from("mock-5.7.0\0"),
    u32le(1), // connection id
    authData1,
    Buffer.from([0]), // filler
    u16le(SERVER_CAPS & 0xffff),
    Buffer.from([0x2d]), // utf8mb4_general_ci
    u16le(0x0002), // SERVER_STATUS_AUTOCOMMIT
    u16le((SERVER_CAPS >>> 16) & 0xffff),
    Buffer.from([21]), // length of auth-plugin-data
    Buffer.alloc(10, 0), // reserved
    authData2,
    Buffer.from("mysql_native_password\0"),
  ]);
  return mysqlPacket(0, payload);
}

function okPacket(seq: number): Buffer {
  return mysqlPacket(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function mysqlColumnDefinition(name: string): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]), // fixed-length-fields length = 12
    u16le(33), // utf8_general_ci
    u32le(32), // column_length (display width)
    Buffer.from([0xfd]), // MYSQL_TYPE_VAR_STRING
    u16le(0), // flags
    Buffer.from([0]), // decimals
    Buffer.from([0, 0]), // reserved
  ]);
}

// Text-protocol result set: one column, one row.
function mysqlTextResultSet(startSeq: number, column: string, value: string): Buffer {
  let seq = startSeq;
  return Buffer.concat([
    mysqlPacket(seq++, Buffer.from([1])), // column count
    mysqlPacket(seq++, mysqlColumnDefinition(column)),
    mysqlPacket(seq++, lenencStr(value)), // row
    // OK packet closing the result set (CLIENT_DEPRECATE_EOF, header 0xfe).
    mysqlPacket(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])),
  ]);
}

// Sends the handshake, OKs the auth response, then hands every post-auth
// packet to onCommand (default: swallow it, leaving the query in flight
// forever).
async function mysqlMock(onCommand?: (socket: net.Socket, seq: number, payload: Buffer) => void): Promise<Mock> {
  const queryReceived = Promise.withResolvers<void>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
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
          authed = true;
          socket.write(okPacket(seq + 1));
          continue;
        }

        onCommand?.(socket, seq, payload);
        queryReceived.resolve();
      }
    });
  });
  await listen(server);
  const { port } = server.address() as net.AddressInfo;
  return { port, server, sockets, queryReceived: queryReceived.promise };
}

test("postgres: close({ timeout: 0 }) settles immediately with a query in flight", async () => {
  const mock = await postgresMock();
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });

  try {
    // .catch() starts execution; the mock never answers, so the query stays
    // in flight until the pool force-closes the connection.
    const pending = sql`select 1`.catch(e => e.code);
    await mock.queryReceived;

    // Without the fix this waits for the in-flight query forever and the
    // test times out.
    await sql.close({ timeout: 0 });

    expect(await pending).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  } finally {
    for (const socket of mock.sockets) socket.destroy();
    mock.server.close();
  }
});

test("postgres: close({ timeout: null }) still drains gracefully", async () => {
  // Guards the presence check: null (like undefined) means "no timeout",
  // not "timeout of 0", so pending queries finish instead of being killed.
  let respond: (() => void) | undefined;
  const mock = await postgresMock((socket, data) => {
    if (data[0] !== 0x51 /* 'Q' */) return;
    respond = () => {
      socket.write(Buffer.concat([rowDescription(["x"]), dataRow(["1"]), pkt("C", cstr("SELECT 1")), readyForQuery]));
    };
  });
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });

  try {
    const query = sql`select 1 as x`.simple();
    const result = query.then(r => r);
    await mock.queryReceived;

    // Enters the graceful-drain branch synchronously (the query is still in
    // flight), then the server releases the response.
    const closing = sql.close({ timeout: null });
    respond!();

    expect(await result).toEqual([{ x: "1" }]);
    await closing;
  } finally {
    for (const socket of mock.sockets) socket.destroy();
    mock.server.close();
  }
});

test("mysql: close({ timeout: 0 }) settles immediately with a query in flight", async () => {
  const mock = await mysqlMock();
  const sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });

  try {
    const pending = sql`select 1`.catch(e => e.code);
    await mock.queryReceived;

    await sql.close({ timeout: 0 });

    expect(await pending).toBe("ERR_MYSQL_CONNECTION_CLOSED");
  } finally {
    for (const socket of mock.sockets) socket.destroy();
    mock.server.close();
  }
});

test("mysql: close({ timeout: null }) still drains gracefully", async () => {
  let respond: (() => void) | undefined;
  const mock = await mysqlMock((socket, seq, payload) => {
    if (payload[0] !== 0x03 /* COM_QUERY */) return;
    respond = () => {
      socket.write(mysqlTextResultSet(seq + 1, "x", "1"));
    };
  });
  const sql = new SQL({ url: `mysql://root@127.0.0.1:${mock.port}/db`, max: 1 });

  try {
    // .simple() forces the text protocol (COM_QUERY).
    const query = sql`select 1 as x`.simple();
    const result = query.then(r => r);
    await mock.queryReceived;

    const closing = sql.close({ timeout: null });
    respond!();

    expect(await result).toEqual([{ x: "1" }]);
    await closing;
  } finally {
    for (const socket of mock.sockets) socket.destroy();
    mock.server.close();
  }
});
