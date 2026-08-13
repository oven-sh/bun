// A query handed to a pool connection that is already idle must keep the
// process alive until the server answers. In every scenario below the second
// query is issued on a connection that has gone idle:
//
//   begin    max: 2. The transaction runs on the first connection; releasing
//            it appends it to the end of the pool's ready set, so the next
//            query is routed to the second connection, which has been idle
//            since its handshake finished.
//   reserve  Same as begin, via reserve() + release().
//   turn     max: 1. One event loop turn passes between the two queries, so
//            the only connection is idle when the second one is issued.
//
// This runs as its own process because `bun test` keeps the event loop alive
// by itself. The work is wrapped in main() on purpose: while an entry module's
// top-level await is pending the runtime keeps ticking the event loop whether
// or not anything is ref'd, which would hide the bug.
//
// Passes by printing both lines and exiting with code 0. With the bug, the
// process exits right after "first step done" with the second query still
// pending, so the exit code stays 1.
import { SQL } from "bun";

process.exitCode = 1;

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required");
const scenario = process.argv[2];

async function main() {
  const sql = new SQL({ url, max: scenario === "turn" ? 1 : 2 });

  switch (scenario) {
    case "begin":
      await sql.begin(async tx => {
        await tx`select 1`;
      });
      break;
    case "reserve": {
      const reserved = await sql.reserve();
      await reserved`select 1`;
      await reserved.release();
      break;
    }
    case "turn":
      await sql`select 1`;
      await new Promise(resolve => setImmediate(resolve));
      break;
    default:
      throw new Error(`unknown scenario: ${scenario}`);
  }
  console.log("first step done");

  const [row] = await sql`select 2 as x`;
  console.log(`second query done: ${row.x}`);

  // Deliberately no sql.close(): once the reply is in, the connections are idle
  // again and must stop keeping the process alive on their own.
  process.exitCode = 0;
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
