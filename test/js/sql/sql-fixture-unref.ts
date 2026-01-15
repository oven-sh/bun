// This test verifies that idle PostgreSQL connections allow the process to exit.
// Fixes #3548: Database clients that maintain persistent connections should not
// prevent the Bun process from exiting after queries complete.
//
// This test passes by:
//   1. Printing "query_done"
//   2. Exiting with code 0 within a reasonable timeout
//
// If the bug is present, the process will hang indefinitely after the query completes.
import { sql } from "bun";

async function main() {
  // Execute a query
  const result = await sql`select 1 as x`;
  console.log("query_done");

  // The connection is now idle. The process should exit naturally
  // without needing to explicitly close the connection.
  // Note: We intentionally do NOT call sql.close() here to test that
  // idle connections don't keep the process alive.
}

main();
