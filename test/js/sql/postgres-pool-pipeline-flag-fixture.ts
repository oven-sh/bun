// Fixture for postgres-pool-transaction-stall.test.ts ("pipelining feature
// flag keeps one query in flight per connection"). Runs with
// BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING=1: a second prepared query
// fired while another is in flight must not be written to the wire until the
// first one's response arrives.
import { SQL } from "bun";

const url = process.env.DATABASE_URL!;
const sql = new SQL({ url, max: 1 });
const ctl = new SQL({ url, max: 1 });

// Hang guard: turn "hangs forever" into a loud nonzero exit.
const watchdog = setTimeout(() => {
  console.error("WATCHDOG: queries never completed");
  process.exit(1);
}, 15_000);

function step(name: string) {
  console.log(`STEP ${name}`);
}

// Warm the statement so later executions take the already-prepared path.
await sql`select ${1}::int as hold_me`;
step("prepared");

// From here on, the mock server holds the response to hold_me executions
// until the release control query arrives.
await ctl.unsafe("/* ctl:arm_hold */ select 1");
step("armed");

// q1 is held by the mock. q2 is fired while q1 is in flight; with pipelining
// disabled it must stay queued client-side until q1 completes.
const q1 = sql`select ${2}::int as hold_me`;
q1.execute();
const q2 = sql`select ${3}::int as hold_me`;
q2.execute();

// Let the connection's deferred flush run so anything the client (wrongly)
// decided to write for q2 is on the socket before the control query below.
await new Promise(resolve => setImmediate(resolve));

// Release the held response. The mock snapshots how many hold_me Binds have
// arrived when it handles this query; the parent test asserts q2's was not
// among them.
await ctl.unsafe("/* ctl:release_slow */ select 1");
step("released");

await q1;
step("q1 done");
await q2;
step("q2 done");

clearTimeout(watchdog);
await sql.close();
await ctl.close();
console.log("DONE");
