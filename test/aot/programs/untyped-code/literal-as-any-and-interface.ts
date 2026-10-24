// The same object is held as `any` and as an interface. Stores through both are seen through both, and typed code goes on reading it.
interface Key { key: number }
const untyped = (x: any): any => x;
interface Wanted { value: Key; more?: { n: number; extra?: string } }
const loose = untyped({ value: { key: 1 }, more: { n: 1, extra: "e" } });
const held = loose as Wanted;
console.log(held.more?.n, held.more?.extra, held.value.key);
loose.more = { n: 2 };
console.log(held.more?.n, held.more?.extra, held.value.key, loose === held);
loose.added = "later";
held.more = { n: 3, extra: "x" };
console.log(loose.more.n, loose.more.extra, loose.added, JSON.stringify(held), Object.keys(loose).join());
function total(each: Wanted): number {
  return each.value.key + (each.more ? each.more.n : 0);
}
let sum = 0;
for (let i = 0; i < 100; i++) sum += total(held);
console.log(sum);
