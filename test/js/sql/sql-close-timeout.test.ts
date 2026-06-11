// close({ timeout }) option handling: a provided timeout of 0 means "force
// close now", so the numeric and string spellings of the same value must
// behave identically, while null/undefined mean "no timeout, wait for
// pending queries". https://github.com/oven-sh/bun/issues/32091
//
// Uses minimal fake postgres/mysql servers (plain TCP, no Docker) that
// complete the handshake and answer queries only when the test tells them
// to, so a query can be held in flight while close() runs.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "node:net";

const INVALID_TIMEOUT_MESSAGE =
  "The property 'options.timeout' must be a non-negative integer less than 2^31. Received NaN";

interface FakeServer {
  port: number;
  /** resolves when the server has received a SELECT it is holding open */
  heldQuery: Promise<void>;
  /** answer the held SELECT with a one-row result set */
  respondHeld(): void;
  close(): void;
}

// ---------- fake postgres server (simple query protocol) ----------

function pgMessage(type: string, body: Buffer): Buffer {
  const buf = Buffer.alloc(1 + 4 + body.length);
  buf.write(type, 0);
  buf.writeInt32BE(4 + body.length, 1);
  body.copy(buf, 5);
  return buf;
}

function pgCommandComplete(tag: string): Buffer {
  return Buffer.concat([pgMessage("C", Buffer.from(`${tag}\0`)), pgMessage("Z", Buffer.from("I"))]);
}

// result set for `SELECT 1`: one int4 column "?column?" with the text value "1"
function pgSelect1Result(): Buffer {
  const name = Buffer.from("?column?\0");
  const rowDesc = Buffer.alloc(2 + name.length + 18);
  rowDesc.writeInt16BE(1, 0); // field count
  name.copy(rowDesc, 2);
  let o = 2 + name.length;
  rowDesc.writeInt32BE(0, o); // table oid
  o += 4;
  rowDesc.writeInt16BE(0, o); // column attribute number
  o += 2;
  rowDesc.writeInt32BE(23, o); // type oid (int4)
  o += 4;
  rowDesc.writeInt16BE(4, o); // type size
  o += 2;
  rowDesc.writeInt32BE(-1, o); // type modifier
  o += 4;
  rowDesc.writeInt16BE(0, o); // format (text)
  const dataRow = Buffer.alloc(2 + 4 + 1);
  dataRow.writeInt16BE(1, 0); // column count
  dataRow.writeInt32BE(1, 2); // value length
  dataRow.write("1", 6);
  return Buffer.concat([pgMessage("T", rowDesc), pgMessage("D", dataRow), pgCommandComplete("SELECT 1")]);
}

// Completes the handshake (AuthenticationOk + ReadyForQuery), answers
// BEGIN/COMMIT/ROLLBACK-style commands immediately, and holds SELECTs open
// until respondHeld() is called.
async function fakePostgresServer(): Promise<FakeServer> {
  const sockets: net.Socket[] = [];
  const held = Promise.withResolvers<void>();
  let heldSocket: net.Socket | null = null;
  const server = net.createServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let established = false;
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (true) {
        if (!established) {
          // startup message: Int32 length (includes itself), no type byte
          if (buffered.length < 4) break;
          const len = buffered.readInt32BE(0);
          if (buffered.length < len) break;
          buffered = buffered.subarray(len);
          established = true;
          socket.write(Buffer.concat([pgMessage("R", Buffer.from([0, 0, 0, 0])), pgMessage("Z", Buffer.from("I"))]));
          continue;
        }
        // typed message: Byte1 type + Int32 length (includes itself)
        if (buffered.length < 5) break;
        const type = String.fromCharCode(buffered[0]);
        const len = buffered.readInt32BE(1);
        if (buffered.length < 1 + len) break;
        const payload = buffered.subarray(5, 1 + len);
        buffered = buffered.subarray(1 + len);
        if (type !== "Q") continue;
        const query = payload.toString("utf-8").replace(/\0.*$/, "");
        if (query.startsWith("SELECT")) {
          heldSocket = socket;
          held.resolve();
        } else {
          // BEGIN / COMMIT / ROLLBACK / SAVEPOINT ...
          socket.write(pgCommandComplete(query.split(" ")[0]));
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    heldQuery: held.promise,
    respondHeld() {
      heldSocket!.write(pgSelect1Result());
    },
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

// ---------- fake mysql server (text protocol) ----------

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

function mysqlHandshakeV10(): Buffer {
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

function mysqlOkPacket(seq: number): Buffer {
  return mysqlPacket(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

// result set for `SELECT 1`: one column "one" with the text value "1"
function mysqlSelect1Result(startSeq: number): Buffer {
  let seq = startSeq;
  const columnDef = Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr("one"),
    lenencStr("one"),
    Buffer.from([0x0c]), // fixed-length-fields length
    u16le(33), // utf8_general_ci
    u32le(32), // column_length
    Buffer.from([0x03]), // MYSQL_TYPE_LONG
    u16le(0), // flags
    Buffer.from([0]), // decimals
    Buffer.from([0, 0]), // reserved
  ]);
  return Buffer.concat([
    mysqlPacket(seq++, Buffer.from([1])), // column count
    mysqlPacket(seq++, columnDef),
    mysqlPacket(seq++, lenencStr("1")), // row
    mysqlPacket(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])), // EOF-style OK
  ]);
}

async function fakeMysqlServer(): Promise<FakeServer> {
  const sockets: net.Socket[] = [];
  const held = Promise.withResolvers<void>();
  let heldSocket: net.Socket | null = null;
  let heldSeq = 0;
  const server = net.createServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
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
          socket.write(mysqlOkPacket(seq + 1));
          continue;
        }
        if (payload[0] !== 0x03 /* COM_QUERY */) continue;
        const query = payload.subarray(1).toString("utf-8");
        if (query.startsWith("SELECT")) {
          heldSocket = socket;
          heldSeq = seq;
          held.resolve();
        } else {
          // BEGIN / COMMIT / ROLLBACK ...
          socket.write(mysqlOkPacket(seq + 1));
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    heldQuery: held.promise,
    respondHeld() {
      heldSocket!.write(mysqlSelect1Result(heldSeq + 1));
    },
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

// ---------- tests ----------

const adapters = [
  {
    name: "postgres",
    fakeServer: fakePostgresServer,
    url: (port: number) => `postgres://postgres@127.0.0.1:${port}/postgres`,
    closedCode: "ERR_POSTGRES_CONNECTION_CLOSED",
    selectResult: [{ "?column?": 1 }],
  },
  {
    name: "mysql",
    fakeServer: fakeMysqlServer,
    url: (port: number) => `mysql://root@127.0.0.1:${port}/mysql`,
    closedCode: "ERR_MYSQL_CONNECTION_CLOSED",
    selectResult: [{ one: 1 }],
  },
] as const;

for (const { name, fakeServer, url, closedCode, selectResult } of adapters) {
  // 0 and "0" are the same value and must both force close immediately,
  // cancelling the in-flight query
  for (const spelling of [0, "0"] as const) {
    test(`${name}: close({ timeout: ${JSON.stringify(spelling)} }) force-closes with a query in flight`, async () => {
      const server = await fakeServer();
      try {
        const db = new SQL({ url: url(server.port), max: 1 });
        const query = db`SELECT 1`
          .simple()
          .execute()
          .catch(err => err);
        await server.heldQuery;
        await db.close({ timeout: spelling as any });
        const err = await query;
        expect(err.code).toBe(closedCode);
      } finally {
        server.close();
      }
    });
  }

  // null and undefined mean "no timeout": close() waits for the in-flight
  // query, which must complete successfully instead of being cancelled
  for (const spelling of [null, undefined] as const) {
    test(`${name}: close({ timeout: ${spelling} }) waits for a query in flight`, async () => {
      const server = await fakeServer();
      try {
        const db = new SQL({ url: url(server.port), max: 1 });
        const query = db`SELECT 1`.simple().execute();
        await server.heldQuery;
        const closePromise = db.close({ timeout: spelling as any });
        server.respondHeld();
        expect((await query) as unknown[]).toEqual(selectResult as unknown as unknown[]);
        await closePromise;
      } finally {
        server.close();
      }
    });
  }

  // validation must run for every provided value, including falsy ones
  test(`${name}: close({ timeout: NaN }) rejects with ERR_INVALID_ARG_VALUE`, async () => {
    const server = await fakeServer();
    try {
      const db = new SQL({ url: url(server.port), max: 1 });
      const err = await db.close({ timeout: NaN }).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
      expect(err.message).toBe(INVALID_TIMEOUT_MESSAGE);
      await db.close({ timeout: 0 });
    } finally {
      server.close();
    }
  });
}

// the reserved-connection and transaction close() paths share the same
// timeout validation and must also run it for falsy values

test("reserved connection: close({ timeout: NaN }) rejects with ERR_INVALID_ARG_VALUE", async () => {
  const server = await fakePostgresServer();
  try {
    const db = new SQL({ url: `postgres://postgres@127.0.0.1:${server.port}/postgres`, max: 1 });
    const reserved = await db.reserve();
    const err = await reserved.close({ timeout: NaN }).then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err.message).toBe(INVALID_TIMEOUT_MESSAGE);
    await reserved.close({ timeout: 0 });
    await db.close({ timeout: 0 });
  } finally {
    server.close();
  }
});

test("transaction: close({ timeout: NaN }) rejects with ERR_INVALID_ARG_VALUE", async () => {
  const server = await fakePostgresServer();
  try {
    const db = new SQL({ url: `postgres://postgres@127.0.0.1:${server.port}/postgres`, max: 1 });
    let err: any;
    await db
      .begin(async tx => {
        err = await (tx as any).close({ timeout: NaN }).then(
          () => null,
          (e: any) => e,
        );
      })
      .catch(() => {});
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err.message).toBe(INVALID_TIMEOUT_MESSAGE);
    await db.close({ timeout: 0 });
  } finally {
    server.close();
  }
});
