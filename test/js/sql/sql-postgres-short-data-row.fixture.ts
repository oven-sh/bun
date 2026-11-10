// Fault-injection fixture for sql.test.ts: a hostile Postgres server emits a
// RowDescription declaring 62 columns followed by a DataRow declaring zero of
// them. A real Postgres will not produce this. All wire-protocol bytes come
// from ./wire-frames.

import { SQL } from "bun";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// 62 text columns (oid 25, format 0) that all share the same name "c", so the
// cached row Structure has a single property and the other 61 fields are
// duplicates.
const COLUMNS = 62;
const dupRowDescription = pgRowDescription(
  Array.from({ length: COLUMNS }, () => ({ name: "c", typeOid: 25, format: 0 as const })),
);
// One named column and one all-digit column name, so the row builder has to
// handle both a Structure offset and putDirectIndex in the same row.
const mixedRowDescription = pgRowDescription([
  { name: "a", typeOid: 25, format: 0 as const },
  { name: "7", typeOid: 25, format: 0 as const },
]);
// Multiple named columns interleaved with an indexed one: the slow path must
// write each named value to its own Structure offset without reordering.
const interleavedRowDescription = pgRowDescription([
  { name: "foo", typeOid: 25, format: 0 as const },
  { name: "5", typeOid: 25, format: 0 as const },
  { name: "bar", typeOid: 25, format: 0 as const },
]);

async function run(label: string, rowDescription: Buffer, rowValues: string[]) {
  const { server, port } = await listeningServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' */) return;
      socket.write(
        Buffer.concat([
          rowDescription,
          pgDataRow(rowValues.map(v => Buffer.from(v))),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ]),
      );
    });
    socket.on("error", () => {});
  });
  const sql = new SQL({
    url: "postgres://u@127.0.0.1:" + port + "/db",
    max: 1,
    idleTimeout: 5,
    connectionTimeout: 5,
  });
  try {
    const rows = await sql`select c`.simple();
    console.log(label + " " + JSON.stringify(rows[0]));
  } catch (e: any) {
    console.log(label + "_ERROR " + (e.code || e.message));
  } finally {
    await sql.close().catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

// The DataRow declares zero of the 62 described columns: the row's single
// named property must come back as null and nothing else may be written.
await run("EMPTY_ROW", dupRowDescription, []);
// A DataRow that supplies all 62 declared columns still resolves the duplicate
// column name following the established "last one wins" rule.
await run(
  "FULL_ROW",
  dupRowDescription,
  Array.from({ length: COLUMNS }, (_, i) => "v" + i),
);
// A short DataRow against a mixed named + indexed RowDescription must still
// surface both keys as null; the indexed column must not be silently dropped.
await run("MIXED_EMPTY", mixedRowDescription, []);
// And the full row keeps both values at their respective keys.
await run("MIXED_FULL", mixedRowDescription, ["va", "v7"]);
// Two named columns with an indexed one between them: each named value must
// land on its own key (Structure offsets are assigned in RowDescription order).
await run("INTERLEAVED_SHORT", interleavedRowDescription, ["vfoo"]);
await run("INTERLEAVED", interleavedRowDescription, ["vfoo", "v5", "vbar"]);
console.log("FIXTURE_DONE");
