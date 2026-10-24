// Every field of a typed object literal is stored with values of every other kind through `any`, and typed code reads it after each store.
type Item = { id: string; count: number; done: boolean; tags: string[]; owner: { name: string }; run: () => string; note?: string };

function make(): Item {
  return { id: "a", count: 1, done: false, tags: ["x"], owner: { name: "ann" }, run: () => "ran" };
}
function describe(value: unknown): string {
  if (typeof value === "function") return "function";
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  return typeof value + ":" + JSON.stringify(value);
}
function read(item: Item): string {
  return [item.id, item.count, item.done, item.tags, item.owner, item.run, item.note].map(describe).join(" ");
}

const values: unknown[] = ["text", 7, 1.5, -0, NaN, 2 ** 40, true, null, undefined, [1], { other: 1 }, () => 1, 10n, Symbol("s")];
const names = ["id", "count", "done", "tags", "owner", "run", "note"];
for (const name of names) {
  const item = make();
  for (const value of values) {
    (item as any)[name] = value;
    console.log(name, read(item), Object.keys(item).join());
  }
}
const item = make();
(item as any).id = 5;
console.log(typeof item.id, (item.id as any) + 1, item.id.length);
(item as any).count = "9";
console.log(typeof item.count, item.count + 1, item.count * 2);
(item as any).done = 0;
console.log(item.done ? "yes" : "no", item.done === false, !item.done);
