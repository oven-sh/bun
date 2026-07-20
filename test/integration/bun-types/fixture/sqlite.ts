import {
  type AsyncDatabaseBinding,
  type AsyncDatabaseBindings,
  type AsyncDatabaseOperationOptions,
  type AsyncDatabaseOptions,
  type AsyncDatabaseValue,
  type AsyncDatabaseValues,
  type Changes,
  AsyncDatabase,
  Database,
  constants,
} from "bun:sqlite";
import { expectType } from "./utilities";

expectType(constants.SQLITE_FCNTL_BEGIN_ATOMIC_WRITE).is<number>();
expectType<Record<string, number>>(constants);

const db = new Database(":memory:");
const query1 = db.query<
  { name: string; dob: number }, // return type first
  { $id: string }
>("select name, dob from users where id = $id");
query1.all({ $id: "asdf" }); // => {name: string; dob:string}[]

const query2 = db.query<
  { name: string; dob: number },
  [string, number] // pass tuple for positional params
>("select ?1 as name, ?2 as dob");
const allResults = query2.all("Shaq", 50); // => {name: string; dob:string}[]
const getResults = query2.get("Shaq", 50); // => {name: string; dob:string}[]

// tslint:disable-next-line:no-void-expression
const runResults = query2.run("Shaq", 50); // => {name: string; dob:string}[]

expectType<Array<{ name: string; dob: number }>>(allResults);
expectType<{ name: string; dob: number } | null>(getResults);
// tslint:disable-next-line:invalid-void
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
expectType<Changes>(runResults);

const query3 = db.prepare<
  { name: string; dob: number }, // return type first
  // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
  [{ $id: string }]
>("select name, dob from users where id = $id");
const allResults3 = query3.all({ $id: "asdf" });
expectType<Array<{ name: string; dob: number }>>(allResults3);

db.exec("CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)");
const insert = db.prepare("INSERT INTO cats (name, age) VALUES ($name, $age)");
const insertManyCats = db.transaction((cats: Array<{ $name: string; $age: number }>) => {
  for (const cat of cats) insert.run(cat);
});
insertManyCats([
  {
    $name: "Joey",
    $age: 2,
  },
  { $name: "Sally", $age: 4 },
  { $name: "Junior", $age: 1 },
  // @ts-expect-error - Should fail
  { fail: true },
]);

async function checkAsyncDatabaseTypes() {
  const signal = new AbortController().signal;
  const options: AsyncDatabaseOptions = {
    readonly: false,
    create: true,
    readwrite: true,
    strict: true,
    safeIntegers: true,
    busyTimeout: 1000,
    maxPending: 4,
  };
  const operationOptions: AsyncDatabaseOperationOptions = { signal };
  const binding: AsyncDatabaseBinding = 1;
  const readonlyBindings: AsyncDatabaseBindings = [binding, "Ada"] as const;
  const value: AsyncDatabaseValue = "Ada";
  const values: AsyncDatabaseValues = [[value]];
  const db = await AsyncDatabase.open(undefined, options);

  expectType<AsyncDatabase>(db);
  expectType<string>(db.filename);
  // @ts-expect-error filename is read-only.
  db.filename = "changed";
  expectType<Promise<void>>(db.exec("CREATE TABLE users (id INTEGER)", operationOptions));

  const changes = await db.run("INSERT INTO users VALUES (?)", [1], { signal });
  expectType<Changes>(changes);
  expectType<number>(changes.changes);
  expectType<number | bigint>(changes.lastInsertRowid);
  expectType<Promise<Changes>>(db.run("INSERT INTO users VALUES (?)", readonlyBindings));

  type User = { id: number; name: string };
  expectType<Promise<User | null>>(db.get<User>("SELECT * FROM users", [1], operationOptions));
  expectType<Promise<User[]>>(db.all<User>("SELECT * FROM users", { id: 1 }, operationOptions));
  expectType<Promise<Array<Array<string | number | bigint | Uint8Array | null>>>>(
    db.values("SELECT * FROM users", undefined, operationOptions),
  );

  const maybeUser = await db.get<User>("SELECT * FROM users");
  // @ts-expect-error get() can return null when no row matches.
  const user: User = maybeUser;
  void user;

  expectType<Promise<void>>(db.close());
  expectType<Promise<void>>(db[Symbol.asyncDispose]());

  // @ts-expect-error AsyncDatabase.open() is the only construction path.
  new AsyncDatabase();
  // @ts-expect-error options must use the documented boolean and numeric fields.
  AsyncDatabase.open(":memory:", { busyTimeout: "slow" });
  // @ts-expect-error bindings are positional arrays or named objects.
  db.run("INSERT INTO users VALUES (?)", 1);
  // @ts-expect-error SQL is always a string.
  db.get(123);
  // @ts-expect-error operation signals must be AbortSignal instances.
  db.exec("SELECT 1", { signal: "nope" });
  // @ts-expect-error AsyncDatabase does not expose synchronous statement APIs.
  db.query("SELECT 1");
  // @ts-expect-error AsyncDatabase does not expose callback transactions.
  db.transaction(() => {});
  // @ts-expect-error the nullable result must not be treated as a row.
  const definitelyUser: User = await db.get<User>("SELECT * FROM users");
  void definitelyUser;
}

void checkAsyncDatabaseTypes();
