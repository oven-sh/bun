import { Database } from "bun:sqlite";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const memory = new Database(":memory:");
memory.run("create table numbers (n integer, word text)");
const insert = memory.prepare("insert into numbers values (?, ?)");
memory.transaction(() => {
  for (let n = 1; n <= 100; n++) insert.run(n, "w" + n);
})();
console.log(
  "bun:sqlite",
  memory.query("select sum(n) as total, count(*) as rows, max(word) as last from numbers").get(),
);
console.log("bun:sqlite json", memory.query(`select json_extract('{"a":[1,2,3]}', '$.a[1]') as second`).get());
memory.close();

const sync = new DatabaseSync(":memory:");
sync.exec("create table t (k text primary key, v real)");
sync.prepare("insert into t values (?, ?)").run("pi", 3.25);
sync.function("twice", (value: any) => value * 2);
console.log("node:sqlite", sync.prepare("select k, twice(v) as doubled from t").all());
sync.close();

const sql = new Bun.SQL("sqlite://:memory:");
await sql`create table people (name text)`;
await sql`insert into people values (${"ada"}), (${"grace"})`;
console.log("Bun.SQL", await sql`select name from people order by name desc`);
await sql.close();

const folder = mkdtempSync(join(tmpdir(), "trim-sqlite-"));
const file = new Database(join(folder, "left-open.db"));
file.run("pragma journal_mode = wal");
file.run("create table kept (n integer)");
file.run("insert into kept values (7)");
process.on("exit", () => {
  console.log("left open at exit", statSync(join(folder, "left-open.db")).size > 0);
  if (process.platform !== "win32") rmSync(folder, { recursive: true, force: true });
});
