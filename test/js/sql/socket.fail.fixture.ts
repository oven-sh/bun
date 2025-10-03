setTimeout(() => {
  // no need to wait we know at this point that the test passed
  process.exit(0);
}, 100);
for (let i = 0; i < 3; i++) {
  try {
    const sql = new Bun.SQL({
      url: "postgres://-invalid-:1234/postgres",
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 1,
      maxLifetime: 1,
    });
    await sql.connect();
  } catch {
  } finally {
    Bun.gc(true);
  }
}
