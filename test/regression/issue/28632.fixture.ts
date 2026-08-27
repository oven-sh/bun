// Child process for 28632.test.ts: re-executes one prepared statement against
// a wide temporary table and prints the RSS growth as its last line.
// argv: <mysql url>
import { SQL } from "bun";

const [url] = process.argv.slice(2);

// The server re-sends one column definition per column with every
// COM_STMT_EXECUTE response, and the adapter keeps an owned copy of each
// column name (`name_or_index`). The original bug leaked that copy on every
// re-decode, so the leak per query scales with the column count and the name
// length. MySQL caps identifiers at 64 bytes; 500 columns stay under MariaDB's
// table-definition size limit.
const COLUMNS = 500;
const columns = Array.from({ length: COLUMNS }, (_, i) => `col_${i}_`.padEnd(64, "x"));
// The first batches let the JIT tiers, the statement cache and the heap reach
// a steady state, so the delta measures only what the later queries keep.
const WARMUP_QUERIES = 100;
const MEASURED_QUERIES = 300;
const BATCH = 50;

const rss: () => number =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? (Bun.unsafe.memoryFootprint as () => number)
    : process.memoryUsage.rss;

// `max: 1` pins the connection, so the temporary table is visible to every
// query below and disappears with the connection.
await using sql = new SQL({ url, max: 1 });
await sql.unsafe(
  `CREATE TEMPORARY TABLE leak_test_28632 (id INT PRIMARY KEY, ${columns.map(name => `${name} TINYINT`).join(", ")})`,
);
await sql`INSERT INTO leak_test_28632 (id) VALUES (${1})`;

// `.values()` skips the per-row object build, which is not on the
// column-definition path under test and doubles the debug-build time at 500
// columns. Every result is checked so a broken query path fails the test
// instead of measuring an idle process.
const query = () => sql`SELECT * FROM leak_test_28632 WHERE id = ${1} LIMIT 1`.values();
function check(rows: unknown[][]) {
  if (rows.length !== 1 || rows[0].length !== COLUMNS + 1 || rows[0][0] !== 1) {
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
