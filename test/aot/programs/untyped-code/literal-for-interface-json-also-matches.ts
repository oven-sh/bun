// A named literal assigned to a variable of the interface, without `any`.
interface Key { key: number }
interface Wanted { value: Key; more?: { n: number; extra?: string } }
const written = { value: { key: 1 }, more: { n: 1, extra: "e" } };
const held: Wanted = written;
held.more = { n: 2 };
console.log(held.more.n, held.more.extra, JSON.stringify(held), written === held);
interface Parsed { value: any; more?: any }
const parsed = JSON.parse('{"value":1}') as Parsed;
console.log(parsed.value);
