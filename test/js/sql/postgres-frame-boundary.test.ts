// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Every PostgreSQL v3 backend message is framed by a Byte1 type + Int32 length.
// A decoder that treats that length as advisory and either scans a C-string
// past it or returns before consuming all of it leaves the cursor inside what
// should be the next message's header. The next dispatch then reads garbage
// (type byte, or a length in the billions) and returns ShortRead, which the
// outer loop treats as "wait for more socket data": the query never settles
// and every later query queues behind it forever (libpq: "message contents do
// not agree with length in message" and drops the connection). The dispatch
// loop must enforce the frame boundary on every message.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgCString,
  pgDataRow,
  pgErrorResponse,
  pgInt32,
  pgNotificationResponse,
  pgParameterStatus,
  pgRaw,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// One mock server for the file; each test sets `current` before connecting and
// the accept handler latches it per connection. Each simple-Query ('Q') read
// shifts the next reply off `atQuery`, so a test can script a different
// response per query on the same connection.
let current!: { atStartup: Buffer[]; atQuery?: Buffer[][] };
const { port, server } = await listeningServer(socket => {
  const { atStartup, atQuery } = current;
  let startup = true;
  socket.on("data", data => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), ...atStartup]));
      return;
    }
    if (atQuery && data[0] === 0x51 /* 'Q' */) {
      const reply = atQuery.shift();
      if (reply) socket.write(Buffer.concat(reply));
    }
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const okRow = (value: string) => [
  pgRowDescription([{ name: "n", typeOid: 25 }]),
  pgDataRow([Buffer.from(value)]),
  pgCommandComplete("SELECT 1"),
  pgReadyForQuery(),
];

/** Complete the handshake, then answer the first simple query with `frames`; returns the query's rejection. */
async function queryError(frames: Buffer[]): Promise<any> {
  current = { atStartup: [pgReadyForQuery()], atQuery: [frames] };
  const db = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 1, idleTimeout: 1 });
  try {
    await db`select x`.simple();
    throw new Error("expected the query to reject");
  } catch (err) {
    return err;
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
}

// An ErrorResponse/NoticeResponse field may carry an empty value (the empty
// string followed by its NUL): https://www.postgresql.org/docs/current/protocol-error-fields.html
// places no lower bound on a value's length. A field decoder that treats an
// empty value as the list terminator stops short; the un-consumed tail (the
// real M field and the terminating NUL) is then parsed as the next message's
// type byte and length.
test("postgres: ErrorResponse field with an empty value does not wedge the connection", async () => {
  // S=ERROR C=42P01 W="" (empty, protocol-legal) M=<real message>
  current = {
    atStartup: [pgReadyForQuery()],
    atQuery: [
      [pgErrorResponse({ S: "ERROR", C: "42P01", W: "", M: "relation t does not exist" }), pgReadyForQuery()],
      okRow("second"),
    ],
  };
  const db = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 1, idleTimeout: 1 });
  try {
    let err: any;
    try {
      await db`select x`.simple();
      err = new Error("expected the query to reject");
    } catch (e) {
      err = e;
    }
    // Before the fix the W field's empty value broke decode_list early, losing
    // the M field (err.message === "") and leaving the M bytes as the next
    // dispatch's header; the following ReadyForQuery was never seen.
    expect({ code: err.code, errno: err.errno, message: err.message }).toEqual({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "42P01",
      message: "relation t does not exist",
    });
    // With the whole body consumed the connection is back at ReadyForQuery, so
    // a second query on it runs instead of waiting forever.
    const rows: any = await db`select n`.simple();
    expect(rows[0]).toEqual({ n: "second" });
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
});

test("postgres: NoticeResponse field with an empty value does not wedge the connection", async () => {
  // NoticeResponse has the same body as ErrorResponse but is advisory: the
  // query continues afterwards. The empty D field must not leave tail bytes.
  const notice = pgErrorResponse({ S: "NOTICE", C: "00000", D: "", M: "notice text" });
  notice[0] = 0x4e; // 'N'
  current = {
    atStartup: [pgReadyForQuery()],
    atQuery: [[notice, ...okRow("first")], okRow("second")],
  };
  const db = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 1, idleTimeout: 1 });
  try {
    const first: any = await db`select n`.simple();
    expect(first[0]).toEqual({ n: "first" });
    const second: any = await db`select n`.simple();
    expect(second[0]).toEqual({ n: "second" });
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
});

// The remaining faces are all under-/over-reads the frame length catches.
// libpq fails the connection ("message contents do not agree with length in
// message") on every one; the decoder must do the same rather than misparse
// the following ReadyForQuery's bytes.
const disagree = "ERR_POSTGRES_INVALID_MESSAGE";
const malformed: { name: string; frame: Buffer }[] = [
  {
    // CommandComplete body is a single C-string; drop the NUL so the scan
    // would walk into the next message.
    name: "CommandComplete whose tag has no NUL terminator",
    frame: pgRaw("C", Buffer.from("SELECT 1")),
  },
  {
    // ParameterStatus: name is terminated, value is not.
    name: "ParameterStatus whose value has no NUL terminator",
    frame: pgRaw("S", Buffer.concat([pgCString("TimeZone"), Buffer.from("UTC")])),
  },
  {
    // ParameterStatus: name has an embedded NUL; the first NUL ends the name,
    // so the second C-string read starts at 'Zone\0' and the trailing value
    // string is never consumed, leaving tail bytes.
    name: "ParameterStatus with tail bytes after the value",
    frame: pgRaw("S", Buffer.concat([pgCString("Time"), pgCString("Zone"), pgCString("UTC")])),
  },
  {
    // NotificationResponse: payload has no terminator.
    name: "NotificationResponse whose payload has no NUL terminator",
    frame: pgRaw("A", Buffer.concat([pgInt32(1), pgCString("ch"), Buffer.from("payload")])),
  },
  {
    // ErrorResponse whose last field value has no NUL (so the list terminator
    // is missing too); the value scan must not spill into CommandComplete.
    name: "ErrorResponse whose last field value has no NUL terminator",
    frame: pgRaw("E", Buffer.concat([Buffer.from("S"), pgCString("ERROR"), Buffer.from("M"), Buffer.from("msg")])),
  },
  {
    // DataRow whose declared frame is longer than its body: the decoder reads
    // the one cell and returns, leaving the 8 padding bytes for the next
    // dispatch to misparse.
    name: "DataRow body shorter than its declared frame",
    frame: Buffer.concat([
      pgRowDescription([{ name: "n", typeOid: 25 }]),
      pgRaw("D", Buffer.concat([Buffer.from([0, 1]), pgInt32(2), Buffer.from("ab"), Buffer.alloc(8)])),
    ]),
  },
];

test.each(malformed)("postgres: $name fails the connection", async ({ frame }) => {
  const err = await queryError([frame, pgCommandComplete("SELECT 1"), pgReadyForQuery()]);
  expect({ code: err.code, name: err.name }).toEqual({ code: disagree, name: "PostgresError" });
});

// Boundary: well-formed messages whose decoders read exactly length-4 bytes
// are still accepted; the connection reaches ReadyForQuery and the next query
// runs.
test("postgres: well-formed ParameterStatus and NotificationResponse during startup are accepted", async () => {
  current = {
    atStartup: [
      pgParameterStatus("TimeZone", "UTC"),
      pgParameterStatus("server_version", "17.0"),
      pgNotificationResponse(42, "ch", ""),
      pgReadyForQuery(),
    ],
    atQuery: [okRow("after")],
  };
  const db = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 1, idleTimeout: 1 });
  try {
    const rows: any = await db`select n`.simple();
    expect(rows[0]).toEqual({ n: "after" });
  } finally {
    await db.close({ timeout: 0 }).catch(() => {});
  }
});
