const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
const sql = new Bun.SQL({
  url: process.env.MYSQL_URL,
  tls,
  max: 1,
  // ensure that the process doesn't exit because of timeouts
  idleTimeout: 100,
  maxLifetime: 100,
  connectionTimeout: 100,
});

const result = await sql`select 1`;
console.log(result);
// process should exit with code 0
