{
  const postgres = new Bun.SQL();
  const id = 1;
  await postgres`select * from users where id = ${id}`;
}

{
  const postgres = new Bun.SQL("postgres://localhost:5432/mydb");
  const id = 1;
  await postgres`select * from users where id = ${id}`;
}

{
  const postgres = new Bun.SQL({ url: "postgres://localhost:5432/mydb" });
  const id = 1;
  await postgres`select * from users where id = ${id}`;
}

{
  const postgres = new Bun.SQL();
  postgres("ok");
}
