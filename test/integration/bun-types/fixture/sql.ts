import { sql } from "bun";
import { expectAssignable, expectType } from "./utilities";

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

const sql1 = new Bun.SQL();
const sql2 = new Bun.SQL("postgres://localhost:5432/mydb");
const sql3 = new Bun.SQL(new URL("postgres://localhost:5432/mydb"));
const sql4 = new Bun.SQL({ url: "postgres://localhost:5432/mydb", idleTimeout: 1000 });

const query1 = sql1<string>`SELECT * FROM users WHERE id = ${1}`;
const query2 = sql2({ foo: "bar" });

query1.cancel().simple().execute().raw().values();

expectType(query1).extends<Promise<any>>();
expectType(query1).extends<Promise<string>>();

sql1.connect();
sql1.close();
sql1.end();
sql1.flush();

const reservedPromise: Promise<Bun.ReservedSQL> = sql1.reserve();

sql1.begin(async txn => {
  txn`SELECT 1`;
  await txn.savepoint("sp", async sp => {
    sp`SELECT 2`;
  });
});

expectType(
  sql1.transaction(async txn => {
    txn`SELECT 3`;
  }),
).is<Promise<void>>();

expectType(
  sql1.begin("read write", async txn => {
    txn`SELECT 4`;
  }),
).is<Promise<void>>();

expectType(
  sql1.transaction("read write", async txn => {
    txn`SELECT 5`;
  }),
).is<Promise<void>>();

expectType(
  sql1.beginDistributed("foo", async txn => {
    txn`SELECT 6`;
  }),
).is<Promise<void>>();

expectType(
  sql1.distributed("bar", async txn => {
    txn`SELECT 7`;
  }),
).is<Promise<void>>();

expectType(
  sql1.beginDistributed("foo", async txn => {
    txn`SELECT 8`;
  }),
).is<Promise<void>>();

{
  const tx = await sql1.transaction(async txn => {
    return [await txn<[9]>`SELECT 9`, await txn<[10]>`SELECT 10`];
  });

  expectType(tx).is<readonly [[9], [10]]>();
}

{
  const tx = await sql1.begin(async txn => {
    return [await txn<[9]>`SELECT 9`, await txn<[10]>`SELECT 10`];
  });

  expectType(tx).is<readonly [[9], [10]]>();
}

{
  const tx = await sql1.distributed("name", async txn => {
    return [await txn<[9]>`SELECT 9`, await txn<[10]>`SELECT 10`];
  });

  expectType(tx).is<readonly [[9], [10]]>();
}

expectType(sql1.unsafe("SELECT * FROM users")).is<Bun.SQL.Query<any>>();
expectType(sql1.unsafe<{ id: string }[]>("SELECT * FROM users")).is<Bun.SQL.Query<{ id: string }[]>>();
expectType(sql1.file("query.sql", [1, 2, 3])).is<Bun.SQL.Query<any>>();

sql1.reserve().then(reserved => {
  reserved.release();

  expectType(reserved<[8]>`SELECT 8`).is<Bun.SQL.Query<[8]>>();
});

sql1.begin(async txn => {
  txn.savepoint("sp", async sp => {
    sp`SELECT 9`;
  });
});

sql1.begin(async txn => {
  txn.savepoint(async sp => {
    sp`SELECT 10`;
  });
});

// @ts-expect-error
sql1.commitDistributed();

// @ts-expect-error
sql1.rollbackDistributed();

// @ts-expect-error
sql1.file(123);

// @ts-expect-error
sql1.unsafe(123);

// @ts-expect-error
sql1.begin("read write", 123);

// @ts-expect-error
sql1.transaction("read write", 123);

const sqlQueryAny: Bun.SQL.Query<any> = {} as any;
const sqlQueryNumber: Bun.SQL.Query<number> = {} as any;
const sqlQueryString: Bun.SQL.Query<string> = {} as any;

expectAssignable<Promise<any>>(sqlQueryAny);
expectAssignable<Promise<number>>(sqlQueryNumber);
expectAssignable<Promise<string>>(sqlQueryString);

expectType(sqlQueryNumber).is<Bun.SQL.Query<number>>();
expectType(sqlQueryString).is<Bun.SQL.Query<string>>();
expectType(sqlQueryNumber).is<Bun.SQL.Query<number>>();

const queryA = sql`SELECT 1`;
expectType(queryA).is<Bun.SQL.Query<any>>();
expectType(await queryA).is<any>();

const queryB = sql({ foo: "bar" });
expectType(queryB).is<Bun.SQL.Helper<{ foo: string }>>();

expectType(sql).is<Bun.SQL>();

const opts2 = { url: "postgres://localhost" } satisfies Bun.SQL.Options;
expectType(opts2).extends<Bun.SQL.Options>();

const txCb = (async sql => [sql<[1]>`SELECT 1`]) satisfies Bun.SQL.TransactionContextCallback<unknown>;
const spCb = (async sql => [sql<[2]>`SELECT 2`]) satisfies Bun.SQL.SavepointContextCallback<unknown>;

expectType(await sql.begin(txCb)).is<[1][]>();
expectType(await sql.begin(spCb)).is<[2][]>();

expectType(queryA.cancel()).is<Bun.SQL.Query<any>>();
expectType(queryA.simple()).is<Bun.SQL.Query<any>>();
expectType(queryA.execute()).is<Bun.SQL.Query<any>>();
expectType(queryA.raw()).is<Bun.SQL.Query<any>>();
expectType(queryA.values()).is<Bun.SQL.Query<any>>();

declare const queryNum: Bun.SQL.Query<number>;
expectType(queryNum.cancel()).is<Bun.SQL.Query<number>>();
expectType(queryNum.simple()).is<Bun.SQL.Query<number>>();
expectType(queryNum.execute()).is<Bun.SQL.Query<number>>();
expectType(queryNum.raw()).is<Bun.SQL.Query<number>>();
expectType(queryNum.values()).is<Bun.SQL.Query<number>>();

expectType(await queryNum.cancel()).is<number>();
expectType(await queryNum.simple()).is<number>();
expectType(await queryNum.execute()).is<number>();
expectType(await queryNum.raw()).is<number>();
expectType(await queryNum.values()).is<number>();

expectType<Bun.SQL.Options>({
  password: () => "hey",
  pass: async () => "hey",
});

expectType<Bun.SQL.Options>({
  password: "hey",
});

expectType(sql({ name: "Alice", email: "alice@example.com" })).is<
  Bun.SQL.Helper<{
    name: string;
    email: string;
  }>
>();

expectType(
  sql([
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ]),
).is<
  Bun.SQL.Helper<{
    name: string;
    email: string;
  }>
>();

const userWithAge = { name: "Alice", email: "alice@example.com", age: 25 };

expectType(sql(userWithAge, "name", "email")).is<
  Bun.SQL.Helper<{
    name: string;
    email: string;
  }>
>();

const users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];
expectType(sql(users, "id")).is<Bun.SQL.Helper<{ id: number }>>();

expectType(sql([1, 2, 3])).is<Bun.SQL.Helper<number[]>>();
expectType(sql([1, 2, 3] as const)).is<Bun.SQL.Helper<readonly [1, 2, 3]>>();

expectType(sql("users")).is<Bun.SQL.Query<any>>();
expectType(sql<1>("users")).is<Bun.SQL.Query<1>>();

declare const user: { name: "Alice"; email: "alice@example.com" };

// @ts-expect-error - missing key in object
sql(user, "notAKey");

// @ts-expect-error - wrong type for key argument
sql(user, 123);

// @ts-expect-error - array of objects, missing key
sql(users, "notAKey");

// @ts-expect-error - array of numbers, extra key argument
sql([1, 2, 3], "notAKey");

// check the deprecated stuff still exists
expectType<Bun.SQLQuery<"hey">>();
expectType<Bun.SQLTransactionContextCallback<"hey">>();
expectType<Bun.SQLSavepointContextCallback<"hey">>();

// check some types exist
expectType<Bun.SQL.AwaitPromisesArray<[]>>;
expectType<Bun.SQL.SQLiteOptions>;
expectType<Bun.SQL.PostgresOrMySQLOptions>;
expectType<Bun.SQL.ContextCallbackResult<unknown>>;

declare const aSqlInstance: Bun.SQL;
expectType(aSqlInstance.options.host).is<string | undefined>(); // property exists in postgres/mysql/mariadb options
expectType(aSqlInstance.options.safeIntegers).is<boolean | undefined>(); // property exits in sqlite options
