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

// Database.run takes the bindings as positional values in separate arguments, as one array of
// positional values, or as one object of named parameters.
type SQLQueryBindings = import("bun:sqlite").SQLQueryBindings;
declare const bindingList: string[];
declare const bindingTuple: [string, number];
declare const bindingArray: SQLQueryBindings[];
declare const readonlyBindings: readonly SQLQueryBindings[];
declare const oneBinding: SQLQueryBindings;
declare const namedBindings: Record<string, string | number | null>;
const constBindings = ["Joey", 2] as const;

expectType<Changes>(db.run("INSERT INTO cats (name) VALUES ('Joey')"));
expectType<Changes>(db.run("INSERT INTO cats (name) VALUES (?)", "Joey"));
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", "Joey", 2);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", "Joey", 2n);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", "Joey", true);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", "Joey", null);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", new Uint8Array([74]), 2);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", Buffer.from("Joey"), 2);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", new Float64Array([1.5]), 2);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", new ArrayBuffer(1), 2);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", ...bindingList);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", ...bindingTuple);

expectType<Changes>(db.run("INSERT INTO cats (name, age) VALUES (?, ?)", ["Joey", 2]));
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", ["Joey", 2n]);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", [new Uint8Array([74]), true]);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", [new ArrayBuffer(1), null]);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", bindingTuple);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", bindingArray);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", readonlyBindings);
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", constBindings);
db.run("INSERT INTO cats (name) VALUES ('Joey')", []);
db.run("INSERT INTO cats (name, age) VALUES ($name, $age)", { $name: "Joey", $age: 2 });
db.run("INSERT INTO cats (name) VALUES ($name)", namedBindings);
db.run("INSERT INTO cats (name) VALUES (?)", oneBinding);
db.run<[string, number]>("INSERT INTO cats (name, age) VALUES (?, ?)", ["Joey", 2]);
db.run<string[]>("INSERT INTO cats (name, age) VALUES (?, ?)", bindingList);
db.run<{ $name: string }>("INSERT INTO cats (name) VALUES ($name)", { $name: "Joey" });

// @ts-expect-error - the runtime binds only the first array
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", ["Joey"], [2]);
// @ts-expect-error - the runtime throws when an object follows a positional value
db.run("INSERT INTO cats (name, age) VALUES (?, $age)", "Joey", { $age: 2 });
// @ts-expect-error - the runtime ignores every argument after an object of named parameters
db.run("INSERT INTO cats (name, age) VALUES ($name, ?)", { $name: "Joey" }, 2);
// @ts-expect-error - the runtime throws when an array follows a positional value
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", "Joey", [2]);
// @ts-expect-error - a Date cannot be bound
db.run("INSERT INTO cats (name) VALUES (?)", new Date(0));
// @ts-expect-error - a Date cannot be bound
db.run("INSERT INTO cats (name, age) VALUES (?, ?)", "Joey", new Date(0));
// @ts-expect-error - a Date cannot be bound
db.run("INSERT INTO cats (name) VALUES (?)", [new Date(0)]);
// @ts-expect-error - a Date cannot be bound
db.run("INSERT INTO cats (name) VALUES ($name)", { $name: new Date(0) });
// @ts-expect-error - a symbol cannot be bound
db.run("INSERT INTO cats (name) VALUES (?)", Symbol("Joey"));
// @ts-expect-error - a function cannot be bound
db.run("INSERT INTO cats (name) VALUES (?)", () => "Joey");
// @ts-expect-error - an array inside the array of values cannot be bound
db.run("INSERT INTO cats (name) VALUES (?)", [["Joey"]]);
// @ts-expect-error - a Date cannot be bound
db.run<[Date]>("INSERT INTO cats (name) VALUES (?)", [new Date(0)]);

// Parameters<> reads the last overload, the one that takes one bindings value.
const runArguments: Parameters<Database["run"]> = ["INSERT INTO cats (name, age) VALUES (?, ?)", ["Joey", 2]];
// A function that takes those arguments is assignable to the method type.
const runWrapper: Database["run"] = (...args: Parameters<Database["run"]>): Changes => db.run(...args);
// A wrapper passes positional values on with a rest parameter. Its element type is every member of
// SQLQueryBindings that is not an object of named parameters.
const runValues = (sql: string, ...values: Array<Exclude<SQLQueryBindings, Record<string, unknown>>>) =>
  db.run(sql, ...values);
// A wrapper passes one bindings value on with one parameter.
const runBindings = (sql: string, bindings: SQLQueryBindings | readonly SQLQueryBindings[]) => db.run(sql, bindings);
// A driver interface that takes the bindings as one array accepts a Database.
const driver: { run(sql: string, params?: unknown[]): unknown } = db;
// Both overloads have the same type parameters. A call with a type argument needs no bindings,
// and a callback typed as the method gets its parameter types.
db.run<never>("INSERT INTO cats (name) VALUES ('Joey')");
const runCallback: Database["run"] = (sql, ...bindings) => ({ changes: bindings.length, lastInsertRowid: sql.length });

// Database.exec is an alias of Database.run.
expectType<Database["exec"]>().is<Database["run"]>();
expectType<Changes>(db.exec("INSERT INTO cats (name) VALUES ('Joey')"));
db.exec("INSERT INTO cats (name, age) VALUES (?, ?)", "Joey", 2);
db.exec("INSERT INTO cats (name, age) VALUES (?, ?)", ["Joey", 2]);
db.exec("INSERT INTO cats (name, age) VALUES ($name, $age)", { $name: "Joey", $age: 2 });
