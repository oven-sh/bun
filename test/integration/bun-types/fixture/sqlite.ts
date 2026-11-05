import { type Changes, Database, type UpdateHook, constants } from "bun:sqlite";
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

expectType(db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0)).is<number>();
expectType(db.fileControl(constants.SQLITE_FCNTL_DATA_VERSION, new Uint32Array(2))).is<number>();
expectType(db.fileControl(constants.SQLITE_FCNTL_RESET_CACHE, null)).is<number>();
expectType(db.fileControl(constants.SQLITE_FCNTL_RESET_CACHE)).is<number>();
expectType(db.fileControl("main", constants.SQLITE_FCNTL_RESET_CACHE)).is<number>();
// @ts-expect-error - an object that is not an ArrayBufferView throws at runtime
db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, {});

expectType(query1.safeIntegers(true)).is<typeof query1>();
expectType(query1.safeIntegers()).is<boolean>();
expectType(query1.reader).is<boolean>();
expectType(query1.readonly).is<boolean>();
expectType(query1.isFinalized).is<boolean>();
expectType(query1.toJSON().columnNames).is<string[]>();
expectType(query1.values({ $id: "asdf" })).is<Array<Array<string | bigint | number | Uint8Array | null>>>();
expectType(db.clearQueryCache()).is<void>();
db.query<unknown, [ArrayBuffer]>("select ?").get(new ArrayBuffer(1));

expectType(db.function("add2", (a: number, b: number) => a + b)).is<Database>();
expectType(
  db.function(
    "count_args",
    { varargs: true, deterministic: true, directOnly: true, safeIntegers: true },
    (...args: bigint[]) => args.length,
  ),
).is<Database>();
db.function("nothing", () => {});
db.function("bytes", () => new ArrayBuffer(1));
// @ts-expect-error - SQLite cannot hold an object
db.function("object", () => ({ a: 1 }));
// @ts-expect-error - the function must be synchronous
db.function("promise", async () => 1);
// @ts-expect-error - there is no such option
db.function("option", { useBigIntArguments: true }, () => 1);

expectType(db.aggregate("add_all", { start: 0, step: (total, value: number) => total + value })).is<Database>();
db.aggregate<string[]>("list", {
  start: () => [],
  step: (list, value: string) => void list.push(value),
  inverse: list => void list.shift(),
  result: list => list.join(),
  varargs: false,
});
// @ts-expect-error - `step` is required
db.aggregate("no_step", { start: 0 });

expectType(db.onInsert).is<UpdateHook | null>();
db.onInsert = function (database, tableName, rowid, schemaName) {
  expectType(this).is<Database>();
  expectType(database).is<Database>();
  expectType(tableName).is<string>();
  expectType(rowid).is<number | bigint>();
  expectType(schemaName).is<string>();
};
db.onUpdate = null;
db.onDelete = undefined;
// @ts-expect-error - a function, null or undefined
db.onDelete = "cats";
