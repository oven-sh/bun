// Fixture for postgres-pool-transaction-stall.test.ts. Drives the connection
// pool into the state from https://github.com/oven-sh/bun/issues/32004:
// a transaction acquires its connection through the release() -> reservedQueue
// handoff while concurrent pooled prepared-statement queries are running.
import { SQL } from "bun";

const url = process.env.DATABASE_URL!;
const sql = new SQL({ url, max: 1 });
const ctl = new SQL({ url, max: 1 });

// Hang guard: the bug wedges the pool forever. Turn "hangs forever" into a
// loud nonzero exit so the parent test fails fast with a useful message.
const watchdog = setTimeout(() => {
  console.error("WATCHDOG: pool wedged, queries never completed");
  process.exit(1);
}, 20_000);

function step(name: string) {
  console.log(`STEP ${name}`);
}

// Prepare all three statements up-front so later executions of the same query
// text take the already-prepared pipelining path in the native queue.
await sql`select ${1}::int as hold_me`;
await sql`select ${1}::int as fast_q`;
await sql`select ${1}::int as warmup_q`;
step("prepared");

// From here on, the mock server holds the response to hold_me executions
// until the release control query arrives.
await ctl.unsafe("/* ctl:arm_hold */ select 1");
step("armed");

// A pooled query that is still in flight when sql.begin() is called, so the
// transaction cannot take the direct reserved path in connect() and instead
// waits in reservedQueue for the release() handoff.
const p0 = sql`select ${2}::int as warmup_q`;
p0.execute();

const bodyGate = Promise.withResolvers<void>();
let slowQ: Promise<unknown>;
let victimQ: Promise<unknown>;

const txP = sql.begin(async tx => {
  // Pooled query (NOT tx): with the pool bug it is distributed onto this
  // transaction's connection and written to the wire immediately. The mock
  // server holds its response until the control query arrives.
  slowQ = sql`select ${3}::int as hold_me`;
  (slowQ as any).execute();
  // Simple-protocol query on the transaction connection: it is queued
  // UNWRITTEN behind slowQ until the pipeline drains.
  victimQ = tx.unsafe("select 641 as victim_q");
  (victimQ as any).execute();
  bodyGate.resolve();
  await victimQ;
  step("victim resolved");
});

await p0;
step("p0 done");
await bodyGate.promise;
step("body gate");

// Another pooled prepared query while victim_q is queued unwritten. The bug:
// run()'s pipelining fast path writes its Bind+Execute to the wire ahead of
// the queued victim_q, so the server's response to fast_q is attributed to
// victim_q (FIFO queue order) and the connection desyncs permanently.
const fastQ = sql`select ${4}::int as fast_q`;
fastQ.execute();

// Release the held response for slowQ.
await ctl.unsafe("/* ctl:release_slow */ select 1");
step("released");

await fastQ;
step("fast resolved");
await slowQ!;
step("slow resolved");
await txP;
step("tx resolved");

// The pool must still be usable afterwards.
await sql`select ${5}::int as warmup_q`;
step("pool alive");

clearTimeout(watchdog);
await sql.close();
await ctl.close();
console.log("DONE");
