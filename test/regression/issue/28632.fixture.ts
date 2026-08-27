// Child process for 28632.test.ts: re-executes one prepared statement against
// the wide table the test created and prints the RSS growth as its last line.
// argv: <mysql url> <column count>
import { SQL } from "bun";

const [url, columnCount] = process.argv.slice(2);
const COLUMNS = Number(columnCount);
// The first batches let the JIT tiers, the statement cache and the heap reach
// a steady state, so the delta measures only what the later queries keep.
const WARMUP_QUERIES = 100;
const MEASURED_QUERIES = 300;
const BATCH = 50;

const rss: () => number =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? (Bun.unsafe.memoryFootprint as () => number)
    : process.memoryUsage.rss;

await using sql = new SQL({ url, max: 1 });

// `.values()` skips the per-row object build, which is not on the
// column-definition path under test and doubles the debug-build time at 500
// columns. Every result is checked so a broken query path fails the test
// instead of measuring an idle process.
const query = () => sql`SELECT * FROM leak_test_28632 WHERE primary_id = ${"123"} LIMIT 1`.values();
function check(rows: unknown[][]) {
  if (rows.length !== 1 || rows[0].length !== COLUMNS + 1 || rows[0][0] !== "123") {
    throw new Error("unexpected result: " + JSON.stringify(rows).slice(0, 200));
  }
}

// Prepare the statement with a lone query first. A failed prepare rejects here
// instead of stalling the queued copies behind it.
check(await query());

// The queries in a batch queue on the single connection. Each batch ends with
// a full GC so RSS reflects native allocations rather than JS garbage.
async function run(count: number) {
  for (let done = 0; done < count; done += BATCH) {
    for (const rows of await Promise.all(Array.from({ length: BATCH }, query))) check(rows);
    Bun.gc(true);
  }
}

await run(WARMUP_QUERIES);
const before = rss();
await run(MEASURED_QUERIES);
console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
