const sql = new Bun.SQL("sqlite://:memory:");
console.log(JSON.stringify(await sql`select 1 as a`));
await sql.close();
