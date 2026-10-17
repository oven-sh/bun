// Named literals kept in an array of `unknown`, a Map of `unknown`, a field of type `unknown` and a member of a literal passed as `any`, and stored over when they come back.
interface Wide { count: number | string; more: { n: number; extra?: string } }
class Box {
  constructor(public held: unknown) {}
}
const untyped = (x: any): any => x;
const list: unknown[] = [];
const byName = new Map<string, unknown>();
const first = { count: 1, more: { n: 1, extra: "e" } };
const second = { count: 2, more: { n: 2, extra: "f" } };
const third = { count: 3, more: { n: 3, extra: "g" } };
const fourth = { count: 4, more: { n: 4, extra: "h" } };
list.push(first);
byName.set("second", second);
const box = new Box(third);
const outer = untyped({ inner: fourth });
for (const back of [list[0] as Wide, byName.get("second") as Wide, box.held as Wide, outer.inner as Wide]) {
  back.more = { n: 10 };
  back.count = "many";
  console.log(back.more.n, back.more.extra, back.count, JSON.stringify(back));
}
console.log(first.more.n, second.more.n, third.more.n, fourth.more.n, first.more.extra, String(fourth.count));
