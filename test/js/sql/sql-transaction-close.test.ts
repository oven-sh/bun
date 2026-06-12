// https://github.com/oven-sh/bun/issues/32148
// transaction.close({ timeout }) resolved without issuing ROLLBACK and
// without marking the transaction closed when the pending queries settled
// before the timeout, so the COMMIT issued after the begin() callback
// returned persisted writes the user explicitly closed. The internal
// Promise.all bookkeeping was also dropped, turning a rejecting pending
// query into an unhandledRejection even when the user handled it.
//
// Uses minimal mock postgres/mysql servers so it can run without Docker.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import net from "net";

// a handler can claim a query by returning true; it is then responsible for
// answering on the socket. Everything else gets a canned response.
type QueryHandler = (query: string, socket: net.Socket) => boolean | void;

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

function selectResponse(value: string): Buffer {
  return Buffer.concat([rowDescription(["x"]), dataRow([value]), pkt("C", cstr("SELECT 1")), readyForQuery]);
}

function commandResponse(query: string): Buffer {
  // the command tag is the statement's first word: BEGIN, ROLLBACK, ...
  return Buffer.concat([pkt("C", cstr(query.split(" ")[0].toUpperCase())), readyForQuery]);
}

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

async function startPostgresServer(onQuery: QueryHandler = () => {}) {
  const sockets = new Set<net.Socket>();
  const commands: string[] = [];
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
        const payload = buffered.subarray(5, 1 + len);
        buffered = buffered.subarray(1 + len);
        if (type === 0x51 /* 'Q' simple query */) {
          const query = payload.toString("utf8").replace(/\0$/, "");
          commands.push(query);
          if (!onQuery(query, socket)) {
            socket.write(/^select/i.test(query) ? selectResponse("1") : commandResponse(query));
          }
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
    commands,
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

// Text-protocol result set for a single-row `select ... as x` (COM_QUERY)
function textResultSet(startSeq: number, value: string): Buffer {
  let seq = startSeq;
  return Buffer.concat([
    packet(seq++, Buffer.from([1])), // column count
    packet(seq++, varcharColumn()),
    packet(seq++, lenencStr(value)), // row
    okPacket(seq++, 0xfe), // DEPRECATE_EOF terminator
  ]);
}

async function startMysqlServer(onQuery: QueryHandler = () => {}) {
  const sockets = new Set<net.Socket>();
  const commands: string[] = [];
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
          const query = payload.subarray(1).toString("utf8");
          commands.push(query);
          if (!onQuery(query, socket)) {
            socket.write(/^select/i.test(query) ? textResultSet(seq + 1, "1") : okPacket(seq + 1));
          }
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
    commands,
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test("postgres: transaction.close({ timeout }) rolls back when pending queries drain before the timeout", async () => {
  const slowQuery = Promise.withResolvers<net.Socket>();
  await using pg = await startPostgresServer((query, socket) => {
    if (query.includes("hold")) {
      slowQuery.resolve(socket);
      return true; // response withheld until the test releases it
    }
  });
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  let pendingResult: unknown;
  let queryAfterClose: unknown;
  const begin = sql.begin(async tx => {
    const pending = tx`select 'hold' as x`.simple().execute();
    const socket = await slowQuery.promise; // the query is now in flight
    const closed = tx.close({ timeout: 5 });
    // let the pending query finish long before the 5s timeout
    socket.write(selectResponse("hold"));
    pendingResult = await pending;
    await closed;
    // the transaction no longer accepts queries (a closed transaction hands
    // back a plain rejected promise, not a Query)
    queryAfterClose = await (tx`select 1 as x` as Promise<unknown>).then(
      () => "resolved",
      (err: any) => err.code,
    );
    // close is idempotent
    await tx.close();
  });

  // close() rolled back, so the COMMIT attempt after the callback must fail
  await expect(begin).rejects.toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
  expect(pendingResult).toEqual([{ x: "hold" }]);
  expect(queryAfterClose).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  expect(pg.commands).toContain("ROLLBACK");
  expect(pg.commands).not.toContain("COMMIT");
});

test("postgres: transaction.close({ timeout }) does not leak an unhandledRejection when a pending query fails", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const failingQuery = Promise.withResolvers<net.Socket>();
    await using pg = await startPostgresServer((query, socket) => {
      if (query.includes("boom")) {
        failingQuery.resolve(socket);
        return true;
      }
    });
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

    let handledAs: unknown;
    const begin = sql.begin(async tx => {
      const failing = tx`select 'boom' as x`.simple().execute();
      const handled = failing.then(
        () => "resolved",
        () => "handled",
      );
      const socket = await failingQuery.promise;
      const closed = tx.close({ timeout: 5 });
      // fail the pending query during the grace period
      socket.write(Buffer.concat([errorResponse("boom"), readyForQuery]));
      handledAs = await handled;
      await closed;
    });

    await expect(begin).rejects.toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
    expect(handledAs).toBe("handled");
    expect(pg.commands).toContain("ROLLBACK");
    expect(pg.commands).not.toContain("COMMIT");
    // tear the pool down now, while the unhandledRejection listener is still
    // attached (the await using dispose after the finally would be too late);
    // close is idempotent so the second dispose at scope exit is a no-op
    await sql.close();

    // the query rejection was handled by the user; close()'s internal
    // bookkeeping must not surface it again (one macrotask turn so a report
    // queued by the teardown above still lands while the listener is attached)
    await Bun.sleep(0);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("postgres: transaction.close({ timeout }) waits for pending savepoints and still rolls back", async () => {
  const slowQuery = Promise.withResolvers<net.Socket>();
  await using pg = await startPostgresServer((query, socket) => {
    if (query.includes("hold")) {
      slowQuery.resolve(socket);
      return true;
    }
  });
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  let savepointResult: unknown;
  const begin = sql.begin(async tx => {
    const savepoint = tx.savepoint(async sp => {
      return await sp`select 'hold' as x`.simple().execute();
    });
    const socket = await slowQuery.promise;
    const closed = tx.close({ timeout: 5 });
    // the savepoint finishes (including RELEASE SAVEPOINT) before the timeout
    socket.write(selectResponse("hold"));
    savepointResult = await savepoint;
    await closed;
  });

  await expect(begin).rejects.toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
  expect(savepointResult).toEqual([{ x: "hold" }]);
  expect(pg.commands).toContain("SAVEPOINT s0");
  expect(pg.commands).toContain("RELEASE SAVEPOINT s0");
  expect(pg.commands).toContain("ROLLBACK");
  expect(pg.commands).not.toContain("COMMIT");
});

test("postgres: transaction.close({ timeout }) still rolls back when the timeout fires first", async () => {
  const slowQuery = Promise.withResolvers<net.Socket>();
  await using pg = await startPostgresServer((query, socket) => {
    if (query.includes("hold")) {
      slowQuery.resolve(socket);
      return true;
    }
  });
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${pg.port}/db`, max: 1, connectionTimeout: 5 });

  const begin = sql.begin(async tx => {
    const pending = tx`select 'hold' as x`.simple().execute();
    const socket = await slowQuery.promise;
    const closed = tx.close({ timeout: 1 });
    // the timer fired once close() cancelled the pending queries
    while (!pending.cancelled) {
      await Bun.sleep(5);
    }
    // ROLLBACK can only go out on the wire after the in-flight query
    // completes, so answer it now (settlement of a cancelled in-flight
    // query is not the subject here)
    socket.write(selectResponse("hold"));
    await (pending as Promise<unknown>).catch(() => {});
    await closed;
  });

  await expect(begin).rejects.toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
  expect(pg.commands).toContain("ROLLBACK");
  expect(pg.commands).not.toContain("COMMIT");
});

test("mysql: transaction.close({ timeout }) rolls back when pending queries drain before the timeout", async () => {
  const slowQuery = Promise.withResolvers<net.Socket>();
  await using my = await startMysqlServer((query, socket) => {
    if (query.includes("hold")) {
      slowQuery.resolve(socket);
      return true;
    }
  });
  await using sql = new SQL({ url: `mysql://root@127.0.0.1:${my.port}/db`, max: 1, connectionTimeout: 5 });

  let pendingResult: unknown;
  const begin = sql.begin(async tx => {
    const pending = tx`select 'hold' as x`.simple().execute();
    const socket = await slowQuery.promise;
    const closed = tx.close({ timeout: 5 });
    socket.write(textResultSet(1, "hold"));
    pendingResult = await pending;
    await closed;
  });

  await expect(begin).rejects.toMatchObject({ code: "ERR_MYSQL_CONNECTION_CLOSED" });
  expect(pendingResult).toEqual([{ x: "hold" }]);
  expect(my.commands).toContain("ROLLBACK");
  expect(my.commands).not.toContain("COMMIT");
});
