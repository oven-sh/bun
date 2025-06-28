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

const query1 = sql1`SELECT * FROM users WHERE id = ${1}`;
const query2 = sql2({ foo: "bar" });

query1.cancel().simple().execute().raw().values();

const _promise: Promise<any> = query1;

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

sql1.transaction(async txn => {
  txn`SELECT 3`;
});

sql1.begin("read write", async txn => {
  txn`SELECT 4`;
});

sql1.transaction("read write", async txn => {
  txn`SELECT 5`;
});

sql1.beginDistributed("foo", async txn => {
  txn`SELECT 6`;
});

sql1.distributed("bar", async txn => {
  txn`SELECT 7`;
});

sql1.unsafe("SELECT * FROM users");
sql1.file("query.sql", [1, 2, 3]);

sql1.reserve().then(reserved => {
  reserved.release();
  reserved[Symbol.dispose]?.();
  reserved`SELECT 8`;
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

const sqlQueryAny: Bun.SQLQuery = {} as any;
const sqlQueryNumber: Bun.SQLQuery<number> = {} as any;
const sqlQueryString: Bun.SQLQuery<string> = {} as any;

expectAssignable<Promise<any>>(sqlQueryAny);
expectAssignable<Promise<number>>(sqlQueryNumber);
expectAssignable<Promise<string>>(sqlQueryString);

expectType(sqlQueryNumber).is<Bun.SQLQuery<number>>();
expectType(sqlQueryString).is<Bun.SQLQuery<string>>();
expectType(sqlQueryNumber).is<Bun.SQLQuery<number>>();

const queryA = sql`SELECT 1`;
expectType(queryA).is<Bun.SQLQuery>();
const queryB = sql({ foo: "bar" });
expectType(queryB).is<Bun.SQLQuery>();

expectType(sql).is<Bun.SQL>();

const opts2: Bun.SQLOptions = { url: "postgres://localhost" };
expectType(opts2).is<Bun.SQLOptions>();

const txCb: Bun.SQLTransactionContextCallback = async sql => [sql`SELECT 1`];
const spCb: Bun.SQLSavepointContextCallback = async sql => [sql`SELECT 2`];
expectType(txCb).is<Bun.SQLTransactionContextCallback>();
expectType(spCb).is<Bun.SQLSavepointContextCallback>();

expectType(queryA.cancel()).is<Bun.SQLQuery>();
expectType(queryA.simple()).is<Bun.SQLQuery>();
expectType(queryA.execute()).is<Bun.SQLQuery>();
expectType(queryA.raw()).is<Bun.SQLQuery>();
expectType(queryA.values()).is<Bun.SQLQuery>();

declare const queryNum: Bun.SQLQuery<number>;
expectType(queryNum.cancel()).is<Bun.SQLQuery<number>>();
expectType(queryNum.simple()).is<Bun.SQLQuery<number>>();
expectType(queryNum.execute()).is<Bun.SQLQuery<number>>();
expectType(queryNum.raw()).is<Bun.SQLQuery<number>>();
expectType(queryNum.values()).is<Bun.SQLQuery<number>>();

expectType(await queryNum.cancel()).is<number>();
expectType(await queryNum.simple()).is<number>();
expectType(await queryNum.execute()).is<number>();
expectType(await queryNum.raw()).is<number>();
expectType(await queryNum.values()).is<number>();

const _sqlInstance: Bun.SQL = Bun.sql;

expectType(sql({ name: "Alice", email: "alice@example.com" })).is<Bun.SQLQuery>();

expectType(
  sql([
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ]),
).is<Bun.SQLQuery>();

const user = { name: "Alice", email: "alice@example.com", age: 25 };
expectType(sql(user, "name", "email")).is<Bun.SQLQuery>();

const users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];
expectType(sql(users, "id")).is<Bun.SQLQuery>();

expectType(sql([1, 2, 3])).is<Bun.SQLQuery>();

expectType(sql("users")).is<Bun.SQLQuery>();

// @ts-expect-error - missing key in object
sql(user, "notAKey");

// @ts-expect-error - wrong type for key argument
sql(user, 123);

// @ts-expect-error - array of objects, missing key
sql(users, "notAKey");

// @ts-expect-error - array of numbers, extra key argument
sql([1, 2, 3], "notAKey");
