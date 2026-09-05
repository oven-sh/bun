// A query handed to a connection that is already idle (one that has unref'd
// the event loop) must keep the process alive until the server answers.
//
// A connection only stays ref'd by accident when the next query is enqueued on
// it while its previous reply is still being processed, so every scenario makes
// sure that is not the case:
//
//   begin    max: 2. Both connections are established and released up front, so
//            they are idle before anything runs on them. The transaction's own
//            BEGIN goes to an idle connection, and the connection it used is
//            appended to the end of the pool's ready set on release, so the
//            final query is routed to the other, still untouched, connection.
//   reserve  Same as begin, via reserve() + release().
//   turn     max: 1. An event loop turn passes between the two queries, so the
//            only connection has unref'd itself by the time the second one is
//            issued.
//
// The final query sleeps server side: before exiting, the runtime polls the
// sockets once more without blocking, and against a server on the same machine
// an instant reply can land inside that poll and rescue a build that has the
// bug. With the delay, a build with the bug always exits before "second query
// done" is printed, leaving the exit code at 1.
//
// Queries use the text protocol (`unsafe` without parameters) so that the mock
// server in the test only has to answer COM_QUERY.
//
// This runs as its own process because `bun test` keeps the event loop alive
// by itself. The work is wrapped in main() on purpose: while an entry module's
// top-level await is pending the runtime keeps polling regardless of what is
// ref'd, which would also hide the bug.
import { SQL } from "bun";

process.exitCode = 1;

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required");
const scenario = process.argv[2];

async function main() {
  const sql = new SQL({ url, max: scenario === "turn" ? 1 : 2 });

  switch (scenario) {
    case "begin":
    case "reserve": {
      const [first, second] = await Promise.all([sql.reserve(), sql.reserve()]);
      await first.release();
      await second.release();

      if (scenario === "begin") {
        await sql.begin(async tx => {
          await tx.unsafe("select 1 as x");
        });
      } else {
        const reserved = await sql.reserve();
        await reserved.unsafe("select 1 as x");
        await reserved.release();
      }
      break;
    }
    case "turn":
      await sql.unsafe("select 1 as x");
      await new Promise(resolve => setImmediate(resolve));
      break;
    default:
      throw new Error(`unknown scenario: ${scenario}`);
  }
  console.log("first step done");

  const [row] = await sql.unsafe("select sleep(0.2) as slept, 2 as x");
  console.log(`second query done: ${row.x}`);
  process.exitCode = 0;

  // Deliberately no sql.close(): the connections are idle again and must stop
  // keeping the process alive on their own. The timer is unref'd, so it only
  // ever fires if they don't.
  setTimeout(() => {
    console.error("the idle connections kept the process alive");
    process.exit(3);
  }, 2_000).unref();
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
