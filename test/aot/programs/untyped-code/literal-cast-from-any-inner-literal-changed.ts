// The literal inside the literal: an optional member of it is set to undefined and deleted, as its interface allows.
interface Key { key: number }
const untyped = (x: any): any => x;
interface Wanted { value: Key; more?: { n: number; extra?: string } }
const held = untyped({ value: { key: 1 }, more: { n: 1, extra: "e" } }) as Wanted;
if (held.more) {
  held.more.extra = undefined;
  console.log(held.more.n, held.more.extra, JSON.stringify(held));
  delete held.more.extra;
  console.log(held.more.n, "extra" in held.more, JSON.stringify(held));
}
interface Parsed { value: any; more?: any }
const parsed = JSON.parse('{"value":1}') as Parsed;
console.log(parsed.value);
