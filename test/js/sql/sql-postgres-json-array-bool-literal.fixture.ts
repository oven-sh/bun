// Fault-injection fixture for sql.test.ts: a hostile Postgres server emits a
// text-format json[] DataRow whose array literal contains an unquoted element
// starting with 'f' or 't' that is not exactly "false"/"true". A real Postgres
// will not produce this. All wire-protocol bytes come from ./wire-frames.

import { SQL } from "bun";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Single column "x" of type json[] (oid 199), format 0 (text).
const rowDescription = pgRowDescription([{ name: "x", typeOid: 199, format: 0 }]);

async function run(arrayText: string) {
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
          pgDataRow([Buffer.from(arrayText)]),
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
    const rows = await sql`select x`.simple();
    console.log("ROWS " + arrayText + " => " + JSON.stringify(rows[0] && rows[0].x));
  } catch (e: any) {
    console.log("REJECTED " + arrayText + " => " + (e.code || e.message));
  } finally {
    await sql.close().catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

// Malformed boolean literals: must error, not spin forever.
await run("{falsy}");
await run("{truthy}");
// Well-formed booleans in a json[] must still parse.
await run("{false,true}");
console.log("FIXTURE_DONE");
