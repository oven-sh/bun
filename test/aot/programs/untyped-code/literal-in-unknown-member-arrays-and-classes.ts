// Literals written under `unknown` inside typed literals: in an array of typed literals, in a member of type `unknown[]`, in a member of type `any`, two levels down, under `as Record<string, unknown>`, and in an argument whose parameter has a member of type `unknown`.
interface Entry { name: string; data: unknown }
interface Many { name: string; all: unknown[] }
interface Loose { name: string; anything: any }
interface Outer { inner: Entry }
function dataOf({ data }: Entry): unknown {
  return data;
}
const entries: Entry[] = [{ name: "a", data: { count: 1, more: { n: 1, extra: "e" } } }, { name: "b", data: { count: 2, more: { n: 2, extra: "f" } } }];
const many: Many = { name: "c", all: [{ count: 3, more: { n: 3, extra: "g" } }] };
const loose: Loose = { name: "d", anything: { count: 4, more: { n: 4, extra: "h" } } };
const outer: Outer = { inner: { name: "e", data: { count: 5, more: { n: 5, extra: "i" } } } };
const dictionary = { k: { count: 6, more: { n: 6, extra: "j" } } } as Record<string, unknown>;
const handed = dataOf({ name: "f", data: { count: 7, more: { n: 7, extra: "k" } } });
for (const back of [entries[0].data, entries[1].data, many.all[0], loose.anything, outer.inner.data, dictionary.k, handed] as any[]) {
  back.more = { n: 10 };
  back.count = "many";
  console.log(back.more.n, back.more.extra, back.count, JSON.stringify(back));
}
console.log(JSON.stringify([entries, many, loose, outer, dictionary]));
