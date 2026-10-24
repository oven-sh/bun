// node:sqlite binds the named parameters of a statement from the properties of an object. The object may be a typed object.
import { DatabaseSync } from "node:sqlite";
type Params = { a: number; b: string };
class Pair {
  a = 5;
  b = "five";
}
function make(a: number, b: string): Params {
  return { a, b };
}
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE pairs (a INTEGER, b TEXT)");
const insert = db.prepare("INSERT INTO pairs (a, b) VALUES (:a, :b)");
const kept = { a: 1, b: "one" };
const named: Params = { a: 2, b: "two" };
const list: Params[] = [make(3, "three"), { a: 4, b: "four" }];
insert.run(kept);
insert.run(named);
for (const params of list) insert.run(params);
insert.run(new Pair() as unknown as Params);
insert.run({ a: 6, b: "six" });
insert.run({
  a: 7,
  get b() {
    return "seven";
  },
});
console.log(JSON.stringify(db.prepare("SELECT * FROM pairs ORDER BY a").all()));
const select = db.prepare("SELECT :a AS a, :b AS b");
console.log(JSON.stringify(select.get(named)), JSON.stringify(select.all(kept)), JSON.stringify([...select.iterate(list[0])]));
db.close();
