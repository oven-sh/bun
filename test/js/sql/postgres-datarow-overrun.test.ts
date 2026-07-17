// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A DataRow's Int32 message length frames the field count and every per-column
// Int32 cell length inside it. A cell length (or field count) that overruns the
// enclosing message is a protocol error (libpq: "insufficient data left in
// message"); a decoder that trusts the inner lengths over the outer one reads
// the following CommandComplete/ReadyForQuery bytes as cell payload, still
// comes up short, and waits for socket data that never arrives. The query must
// reject with ERR_POSTGRES_INVALID_MESSAGE, not hang.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgInt32,
  pgRaw,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const rowDesc = pgRowDescription([{ name: "n", typeOid: 25 /* text */ }]);

// Each case is a DataRow body whose declared message length is truthful but
// whose inner field/cell accounting cannot fit inside it. A valid
// CommandComplete + ReadyForQuery follows so an unbounded reader wedges.
const malformed: { name: string; row: Buffer }[] = [
  {
    // Int16 field_count=1, Int32 cell_len=100, then 2 bytes of payload.
    name: "cell length exceeds the enclosing message",
    row: pgRaw("D", Buffer.concat([Buffer.from([0, 1]), pgInt32(100), Buffer.from("ab")])),
  },
  {
    // Int16 field_count=3 but only one cell's worth of bytes follows.
    name: "field count exceeds the enclosing message",
    row: pgRaw("D", Buffer.concat([Buffer.from([0, 3]), pgInt32(2), Buffer.from("ab")])),
  },
  {
    // A negative cell length other than -1 (NULL) would read ~4 GiB.
    name: "negative cell length other than -1",
    row: pgRaw("D", Buffer.concat([Buffer.from([0, 1]), pgInt32(-2), Buffer.from("ab")])),
  },
  {
    // Declared message length 5: room for the Int32 length + one stray byte,
    // not even the Int16 field count.
    name: "message too short for the field count",
    row: pgRaw("D", Buffer.from([0]), 5),
  },
];

// One mock server for the file; each test sets `current` before connecting and
// the accept handler latches it per connection.
let current!: Buffer;
const { port, server } = await listeningServer(socket => {
  const row = current;
  let startup = true;
  socket.on("data", data => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      return;
    }
    if (data[0] !== 0x51 /* 'Q' */) return;
    socket.write(Buffer.concat([rowDesc, row, pgCommandComplete("SELECT 1"), pgReadyForQuery()]));
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

test.each(malformed)("postgres: DataRow with $name fails the query", async ({ row }) => {
  current = row;
  const db = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 1 });
  let err: any;
  try {
    await db`select n`.simple();
    err = new Error("expected the query to reject");
  } catch (e) {
    err = e;
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
  expect({ code: err.code, name: err.name }).toEqual({
    code: "ERR_POSTGRES_INVALID_MESSAGE",
    name: "PostgresError",
  });
});

// Boundary: a cell that exactly fills the declared message length still decodes.
test("postgres: DataRow whose cell exactly fills the message still decodes", async () => {
  current = pgDataRow([Buffer.from("ab")]);
  const db = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 1 });
  try {
    const rows: any = await db`select n`.simple();
    expect(rows[0]).toEqual({ n: "ab" });
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
});
