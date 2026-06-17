// When a simple-mode query contains multiple SQL statements separated by ';',
// Postgres sends one RowDescription per result set while the same request
// stays current until ReadyForQuery. Each RowDescription must free the
// previous statement.fields allocation and invalidate derived state
// (cached_structure / needs_duplicate_check / fields_flags) so later result
// sets use the correct column names and the previous []FieldDescription is
// not leaked.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgCString,
  pgDataRow,
  pgInt32,
  pgRaw,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test("simple query with multiple statements uses each RowDescription's column names", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });

    // ::text mirrors the original wire fixture (type oid 25) so the decoded
    // values stay strings and the assertion below is byte-identical to the
    // pre-conversion mock-server test.
    const result =
      await sql`select '1'::text as x; select '2'::text as y; select '3'::text as a, '4'::text as b, '5'::text as c`.simple();
    expect(result).toEqual([[{ x: "1" }], [{ y: "2" }], [{ a: "3", b: "4", c: "5" }]]);
  });

  // NoticeResponse ('N') can arrive between result sets — RAISE NOTICE inside a
  // DO block makes a real server emit one mid-stream. The protocol reader must
  // consume exactly the message body so the following RowDescription stays
  // correctly framed and the second result set decodes with its own column name.
  test("NoticeResponse between result sets does not corrupt message framing", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, idleTimeout: 5, connectionTimeout: 5 });

    const result =
      await sql`select '1'::text as x; do $$ begin raise notice 'relation exists, skipping'; end $$; select '2'::text as y`.simple();
    // The DO block contributes its own (rowless) CommandComplete, hence the
    // empty middle entry. The load-bearing checks are unchanged: {x:"1"} and
    // {y:"2"} — a mis-framed NoticeResponse reader would corrupt or drop the
    // third result set, and a stale field cache would surface {x:"2"}.
    expect(result).toEqual([[{ x: "1" }], [], [{ y: "2" }]]);
  });
});

// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// NotificationResponse ('A', sent by NOTIFY), a degenerate empty NoticeResponse,
// and unknown async messages can arrive between result sets. A real Postgres
// will not emit a NotificationResponse mid-result-set (it defers to the
// ReadyForQuery boundary), nor a length-4 NoticeResponse with no field list,
// nor a NegotiateProtocolVersion mid-stream — so these stay mocked. The
// protocol reader must consume exactly the message body so the following
// messages stay correctly framed.
for (const [name, asyncMessage] of [
  // PostgreSQL FE/BE protocol §55.7 NotificationResponse: Byte1('A') Int32(len) Int32(pid) String(channel) String(payload)
  [
    "NotificationResponse",
    pgRaw("A", Buffer.concat([pgInt32(4321), pgCString("some_channel"), pgCString("some payload")])),
  ],
  // Degenerate notice: declared length 4, no field list at all.
  ["empty NoticeResponse", pgRaw("N", Buffer.alloc(0))],
  // 'v' = NegotiateProtocolVersion, which the client does not handle explicitly
  ["unknown message type", pgRaw("v", Buffer.concat([pgInt32(0), pgInt32(0)]))],
] as const) {
  test(`${name} between result sets does not corrupt message framing`, async () => {
    const { port, server } = await listeningServer(socket => {
      socket.on("error", () => {});
      let startup = true;
      socket.on("data", data => {
        if (startup) {
          startup = false;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
          return;
        }
        if (data[0] !== 0x51 /* 'Q' */) return;
        // End the socket after the response so a mis-framed reader stalls into a
        // connection error instead of waiting for more data forever.
        socket.end(
          Buffer.concat([
            pgRowDescription([{ name: "x", typeOid: 25 }]),
            pgDataRow([Buffer.from("1")]),
            pgCommandComplete("SELECT 1"),
            asyncMessage,
            pgRowDescription([{ name: "y", typeOid: 25 }]),
            pgDataRow([Buffer.from("2")]),
            pgCommandComplete("SELECT 1"),
            pgReadyForQuery(),
          ]),
        );
      });
    });

    const sql = new SQL({
      url: `postgres://u@127.0.0.1:${port}/db`,
      max: 1,
      idleTimeout: 5,
      connectionTimeout: 5,
    });

    try {
      const result = await sql`select 1 as x; select 2 as y`.simple();
      expect(result).toEqual([[{ x: "1" }], [{ y: "2" }]]);
    } finally {
      await sql.close().catch(() => {});
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
