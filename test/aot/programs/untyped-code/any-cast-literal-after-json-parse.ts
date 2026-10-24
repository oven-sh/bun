// The JSON.parse that matches the interface comes first in the text, the store comes after it.
interface Key { key: number }
const untyped = (x: any): any => x;
interface Parsed { value: any; more?: any }
const parsed = JSON.parse('{"value":1}') as Parsed;
console.log(parsed.value);
interface Wanted { value: Key; more?: { n: number; extra?: string } }
const held = untyped({ value: { key: 1 }, more: { n: 1, extra: "e" } }) as Wanted;
held.more = { n: 2 };
console.log(held.more.n, held.more.extra, JSON.stringify(held));
