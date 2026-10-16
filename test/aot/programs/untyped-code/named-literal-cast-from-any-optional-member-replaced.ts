// A named literal passed through `any` is cast to an interface that parsed JSON also matches. A store that the interface allows is not refused because the literal started with more.
interface Key { key: number }
const untyped = (x: any): any => x;
interface Wanted { value: Key; more?: { n: number; extra?: string } }
const written = { value: { key: 1 }, more: { n: 1, extra: "e" } };
const held = untyped(written) as Wanted;
held.more = { n: 2 };
console.log(held.more.n, held.more.extra, JSON.stringify(held), written === held);
held.more = undefined;
console.log(held.more, JSON.stringify(written));
interface Parsed { value: any; more?: any }
const parsed = JSON.parse('{"value":1}') as Parsed;
console.log(parsed.value);
