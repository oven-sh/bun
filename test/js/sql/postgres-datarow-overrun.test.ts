// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// DataRow, RowDescription and ParameterDescription each carry an Int32 message
// length that frames an Int16 count and a variable-length body driven by that
// count. A count (or per-column Int32 cell length) that overruns the enclosing
// message is a protocol error (libpq: "insufficient data left in message"); a
// decoder that trusts the inner counts over the outer length reads the
// following CommandComplete / ReadyForQuery bytes as payload, still comes up
// short, and returns ShortRead. The dispatch loop treats ShortRead as "wait
// for more socket data", so the query never settles and every later query
// queues behind it forever. All three must reject with
// ERR_POSTGRES_INVALID_MESSAGE instead.
import { SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgInt32,
  pgParameterDescription,
  pgParseComplete,
  pgRaw,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// --- DataRow / RowDescription (simple-query path) --------------------------

const oneField = pgRowDescription([{ name: "n", typeOid: 25 /* text */ }]).subarray(7);

const simpleCases: { name: string; reply: Buffer[]; code: string }[] = [
  {
    // DataRow: Int16 field_count=1, Int32 cell_len=100, then 2 bytes of payload.
    name: "DataRow cell length exceeds the enclosing message",
    reply: [
      pgRowDescription([{ name: "n", typeOid: 25 }]),
      pgRaw("D", Buffer.concat([Buffer.from([0, 1]), pgInt32(100), Buffer.from("ab")])),
      pgCommandComplete("SELECT 1"),
      pgReadyForQuery(),
    ],
    code: "ERR_POSTGRES_INVALID_MESSAGE",
  },
  {
    // DataRow: Int16 field_count=3 but only one cell's worth of bytes follows.
    name: "DataRow field count exceeds the enclosing message",
    reply: [
      pgRowDescription([{ name: "n", typeOid: 25 }]),
      pgRaw("D", Buffer.concat([Buffer.from([0, 3]), pgInt32(2), Buffer.from("ab")])),
      pgCommandComplete("SELECT 1"),
      pgReadyForQuery(),
    ],
    code: "ERR_POSTGRES_INVALID_MESSAGE",
  },
  {
    // DataRow: a negative cell length other than -1 (NULL) would read ~4 GiB.
    name: "DataRow negative cell length other than -1",
    reply: [
      pgRowDescription([{ name: "n", typeOid: 25 }]),
      pgRaw("D", Buffer.concat([Buffer.from([0, 1]), pgInt32(-2), Buffer.from("ab")])),
      pgCommandComplete("SELECT 1"),
      pgReadyForQuery(),
    ],
    code: "ERR_POSTGRES_INVALID_MESSAGE",
  },
  {
    // DataRow: declared message length 5, room for the Int32 length + one
    // stray byte, not even the Int16 field count.
    name: "DataRow message too short for the field count",
    reply: [
      pgRowDescription([{ name: "n", typeOid: 25 }]),
      pgRaw("D", Buffer.from([0]), 5),
      pgCommandComplete("SELECT 1"),
      pgReadyForQuery(),
    ],
    code: "ERR_POSTGRES_INVALID_MESSAGE",
  },
  {
    // RowDescription: Int16 field_count=2, body carries exactly one field.
    // Only ReadyForQuery follows so the second field's reads exhaust the
    // buffer instead of tripping the format-code check on garbage bytes.
    name: "RowDescription field count exceeds the enclosing message",
    reply: [pgRaw("T", Buffer.concat([Buffer.from([0, 2]), oneField])), pgReadyForQuery()],
    code: "ERR_POSTGRES_INVALID_MESSAGE",
  },
];

// One mock server for the file; each test sets `simpleReply` before connecting
// and the accept handler latches it per connection.
let simpleReply!: Buffer[];
const simple = await listeningServer(socket => {
  const frames = simpleReply;
  let startup = true;
  socket.on("data", data => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      return;
    }
    if (data[0] !== 0x51 /* 'Q' */) return;
    socket.write(Buffer.concat(frames));
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => simple.server.close(() => r())));

test.each(simpleCases)("postgres: $name fails the query", async ({ reply, code }) => {
  simpleReply = reply;
  const db = new SQL({ url: `postgres://u@127.0.0.1:${simple.port}/db`, max: 1, connectionTimeout: 1 });
  let err: any;
  try {
    await db`select n`.simple();
    err = new Error("expected the query to reject");
  } catch (e) {
    err = e;
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
  expect({ code: err.code, name: err.name }).toEqual({ code, name: "PostgresError" });
});

// Boundary: a cell that exactly fills the declared message length still decodes.
test("postgres: DataRow whose cell exactly fills the message still decodes", async () => {
  simpleReply = [
    pgRowDescription([{ name: "n", typeOid: 25 }]),
    pgDataRow([Buffer.from("ab")]),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery(),
  ];
  const db = new SQL({ url: `postgres://u@127.0.0.1:${simple.port}/db`, max: 1, connectionTimeout: 1 });
  try {
    const rows: any = await db`select n`.simple();
    expect(rows[0]).toEqual({ n: "ab" });
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
});

// --- ParameterDescription (extended-protocol path) -------------------------

describe("postgres: ParameterDescription body overrun", () => {
  // Mock backend that answers Parse with the four-message prepare response,
  // replacing ParameterDescription with `pd`, and answers Bind with one row.
  let pd!: Buffer;
  let extended: { port: number; server: import("node:net").Server };
  const makeExtended = async () =>
    listeningServer(socket => {
      const frame = pd;
      let pending = Buffer.alloc(0);
      let sawStartup = false;
      socket.on("data", chunk => {
        pending = Buffer.concat([pending, chunk]);
        if (!sawStartup) {
          if (pending.length < 4) return;
          const len = pending.readInt32BE(0);
          if (pending.length < len) return;
          pending = pending.subarray(len);
          sawStartup = true;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        }
        pending = pgReadFrontendMessages(pending, type => {
          if (type === 0x50 /* Parse */) {
            socket.write(
              Buffer.concat([
                pgParseComplete(),
                frame,
                pgRowDescription([{ name: "v", typeOid: 25 }]),
                pgReadyForQuery(),
              ]),
            );
          } else if (type === 0x42 /* Bind */) {
            socket.write(
              Buffer.concat([
                pgBindComplete(),
                pgDataRow([Buffer.from("x")]),
                pgCommandComplete("SELECT 1"),
                pgReadyForQuery(),
              ]),
            );
          }
        });
      });
      socket.on("error", () => {});
    });

  async function prepared(): Promise<any> {
    extended = await makeExtended();
    const db = new SQL({
      adapter: "postgres",
      hostname: "127.0.0.1",
      port: extended.port,
      username: "u",
      database: "db",
      tls: false,
      max: 1,
      prepare: true,
      connectionTimeout: 1,
    });
    try {
      return await db`select ${"x"} as v`;
    } finally {
      await db.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => extended.server.close(() => r()));
    }
  }

  test("parameter count exceeding the message fails the query", async () => {
    // Int16 count=1000 but no Int32[n] body follows.
    pd = pgRaw("t", Buffer.from([0x03, 0xe8]));
    let err: any;
    try {
      await prepared();
      err = new Error("expected the query to reject");
    } catch (e) {
      err = e;
    }
    expect({ code: err.code, name: err.name }).toEqual({
      code: "ERR_POSTGRES_INVALID_MESSAGE",
      name: "PostgresError",
    });
  });

  test("well-formed ParameterDescription still decodes", async () => {
    pd = pgParameterDescription([25]);
    const rows: any = await prepared();
    expect(rows[0]).toEqual({ v: "x" });
  });
});
