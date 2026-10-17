// The same with a required member: the interface allows an object without `extra`, whatever the literal started with.
interface Key { key: number }
const untyped = (x: any): any => x;
interface Wanted { value: Key; more: { n: number; extra?: string } }
const held = untyped({ value: { key: 1 }, more: { n: 1, extra: "e" } }) as Wanted;
held.more = { n: 2 };
console.log(held.more.n, held.more.extra, JSON.stringify(held));
interface Parsed { value: any; more: any }
const parsed = JSON.parse('{"value":1,"more":2}') as Parsed;
console.log(parsed.value, parsed.more);
