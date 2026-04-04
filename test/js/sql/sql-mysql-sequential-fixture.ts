// Fixture for issue #27362: Sequential await sql.unsafe() calls should not hang.
// Without the fix, the process hangs on the 3rd-4th sequential call because the
// poll_ref is not re-refed when a new query is enqueued on an idle connection.
const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
const sql = new Bun.SQL({
  url: process.env.MYSQL_URL,
  tls,
  max: 1,
  idleTimeout: 100,
  maxLifetime: 100,
  connectionTimeout: 100,
});

// Warmup / establish connection
await sql`SELECT 1`;

// Sequential queries - these would hang without the fix
const r1 = await sql.unsafe("SELECT 1 as v");
console.log("query1:", r1[0].v);

const r2 = await sql.unsafe("SELECT 2 as v");
console.log("query2:", r2[0].v);

const r3 = await sql.unsafe("SELECT 3 as v");
console.log("query3:", r3[0].v);

const r4 = await sql.unsafe("SELECT 4 as v");
console.log("query4:", r4[0].v);

const r5 = await sql.unsafe("SELECT 5 as v");
console.log("query5:", r5[0].v);

console.log("all queries completed");
// process should exit with code 0
