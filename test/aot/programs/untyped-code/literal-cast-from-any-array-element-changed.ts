// An array of literals passed through `any` and cast to an array of an interface: one element is stored over, the others are not.
const untyped = (x: any): any => x;
interface Wanted { id: number; more?: { n: number; extra?: string } }
const list = untyped([{ id: 1, more: { n: 1, extra: "e" } }, { id: 2, more: { n: 2, extra: "f" } }, { id: 3, more: { n: 3, extra: "g" } }]) as Wanted[];
list[1].more = { n: 20 };
for (const each of list) console.log(each.id, each.more?.n, each.more?.extra);
list[0].more = undefined;
console.log(JSON.stringify(list));
interface Parsed { id: any; more?: any }
const parsed = JSON.parse('{"id":1}') as Parsed;
console.log(parsed.id);
