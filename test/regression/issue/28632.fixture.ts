// argv: <mysql url>
import { SQL } from "bun";

const [url] = process.argv.slice(2);

// Every COM_STMT_EXECUTE response repeats one definition per column. 64 bytes is MySQL's limit for a name.
const COLUMNS = 500;
const columns = Array.from({ length: COLUMNS }, (_, i) => `col_${i}_`.padEnd(64, "x"));
const WARMUP_QUERIES = 100;
const MEASURED_QUERIES = 300;
const BATCH = 50;

await using sql = new SQL({ url, max: 1 });
await sql.unsafe(
  `CREATE TEMPORARY TABLE leak_test_28632 (id INT PRIMARY KEY, ${columns.map(name => `${name} TINYINT`).join(", ")})`,
);
await sql`INSERT INTO leak_test_28632 (id) VALUES (${1})`;

const query = () => sql`SELECT * FROM leak_test_28632 WHERE id = ${1} LIMIT 1`.values();
function check(rows: unknown[][]) {
  if (rows.length !== 1 || rows[0].length !== COLUMNS + 1 || rows[0][0] !== 1) {
    throw new Error("unexpected result: " + JSON.stringify(rows).slice(0, 200));
  }
}

check(await query());

async function run(count: number) {
  for (let done = 0; done < count; done += BATCH) {
    for (const rows of await Promise.all(Array.from({ length: BATCH }, query))) check(rows);
    Bun.gc(true);
  }
}

await run(WARMUP_QUERIES);
const before = process.memoryUsage.rss();
await run(MEASURED_QUERIES);
console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
