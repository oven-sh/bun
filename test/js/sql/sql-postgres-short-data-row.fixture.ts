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
const rowDescription = pgRowDescription(
  Array.from({ length: COLUMNS }, () => ({ name: "c", typeOid: 25, format: 0 as const })),
);

async function run(label: string, rowValues: string[]) {
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
await run("EMPTY_ROW", []);
// A DataRow that supplies all 62 declared columns still resolves the duplicate
// column name following the established "last one wins" rule.
await run(
  "FULL_ROW",
  Array.from({ length: COLUMNS }, (_, i) => "v" + i),
);
console.log("FIXTURE_DONE");
