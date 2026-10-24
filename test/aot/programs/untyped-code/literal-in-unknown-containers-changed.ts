// Literals kept by built-in containers whose element type is `unknown`: given to the constructor, added later, and copied from one container to another.
const set = new Set<unknown>([{ count: 1, more: { n: 1, extra: "e" } }]);
const map = new Map<string, unknown>([["k", { count: 2, more: { n: 2, extra: "f" } }]]);
const list: unknown[] = [{ count: 3, more: { n: 3, extra: "g" } }];
set.add({ count: 4, more: { n: 4, extra: "h" } });
map.set("l", { count: 5, more: { n: 5, extra: "i" } });
list.push({ count: 6, more: { n: 6, extra: "j" } });
const copied: unknown[] = Array.from([{ count: 7, more: { n: 7, extra: "k" } }]);
const found: unknown = [{ count: 8, more: { n: 8, extra: "l" } }].find(() => true);
for (const o of [...set, ...map.values(), ...list, ...copied, found] as any[]) {
  o.more = { n: 10 };
  o.count = "many";
  console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
}
