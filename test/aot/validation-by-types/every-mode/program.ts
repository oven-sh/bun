import { validate as check, type Schema } from "bun";
import { parsedInCycle, seenFromCycle } from "./cycle";
import "./far";
import type { Account, Closed, ClosedThroughout, Loose, Order, Orders, Shape, Tree, WithIndex } from "./types";

export function before(): void {}

function show(what: string, parse: () => unknown): void {
  try {
    const value: any = parse();
    const keys = typeof value === "object" && value !== null ? Object.keys(value).join() : typeof value;
    console.log(what, "|", JSON.stringify(value), "|", keys);
  } catch (error: any) {
    console.log(what, "|", error.constructor.name, "|", error.message, "|", JSON.stringify(error.issues));
  }
}

console.log("above its declaration", hoisted('{"value":1,"children":[]}'), hoisted('{"value":"1","children":[]}'));
function hoisted(text: string): string {
  try {
    return JSON.stringify(JSON.parse<Tree>(text));
  } catch (error: any) {
    return error.constructor.name + " " + error.message;
  }
}
console.log("in a CommonJS module", require("./commonjs.cts").parsePoint('{"y":2,"x":1,"z":3}'), require("./commonjs.cts").parsePoint('{"x":1}'));
console.log("in a cycle", seenFromCycle, parsedInCycle('{"value":1,"children":[{"value":2,"children":[]}]}'), parsedInCycle('{"value":1,"children":[{"value":2}]}'));

const order = { id: 7, items: [{ sku: "a", quantity: 1 }], to: { name: "n", city: "c" }, kind: "gift", coupon: null };
const orders: [string, unknown][] = [
  ["as declared", order],
  ["in another order", { coupon: "c", kind: "plain", to: { city: "c", name: "n" }, items: [{ note: "n", quantity: 2, sku: "b" }], id: 7 }],
  ["with more", { first: 1, ...order, to: { ...order.to, zip: "z" }, last: [{ a: null }] }],
  ["a member is missing", { ...order, id: undefined }],
  ["a number is a string", { ...order, id: "7" }],
  ["null for an object", { ...order, to: null }],
  ["an array for an object", { ...order, to: [] }],
  ["an object for an array", { ...order, items: {} }],
  ["below, in an array", { ...order, items: [{ sku: "a", quantity: 1 }, { sku: "b", quantity: "2" }] }],
  ["two at once", { ...order, id: null, to: { name: 1, city: "c" } }],
  ["no literal of the union", { ...order, kind: "other" }],
  ["an optional member of another kind", { ...order, items: [{ sku: "a", quantity: 1, note: 5 }] }],
  ["an optional member that is null", { ...order, items: [{ sku: "a", quantity: 1, note: null }] }],
  ["too long and too short", { ...order, items: [{ sku: "abcde", quantity: 1 }, { sku: "", quantity: 1 }] }],
  ["not whole", { ...order, items: [{ sku: "a", quantity: 1.5 }] }],
  ["too small, too big", { ...order, items: [{ sku: "a", quantity: 0 }, { sku: "a", quantity: 100 }] }],
  ["too few", { ...order, items: [] }],
  ["too many", { ...order, items: [order.items[0], order.items[0], order.items[0], order.items[0]] }],
];
for (const [what, value] of orders) show("Order: " + what, () => JSON.parse<Order>(JSON.stringify(value)));
for (const text of ["[]", "null", "1", '"text"', "true"]) show("Order: the root is " + text, () => JSON.parse<Order>(text));
show("Order: indented", () => JSON.parse<Order>(JSON.stringify(order, null, 2)));
show("Orders", () => JSON.parse<Orders>(JSON.stringify({ items: [order, order], next: null })));
show("Orders: below", () => JSON.parse<Orders>(JSON.stringify({ items: [order, { ...order, kind: 1 }], next: "2" })));

for (const text of ['{"kind":"circle","radius":1}', '{"radius":1,"kind":"circle"}', '{"kind":"square","side":2,"radius":"kept"}', '{"kind":"dot"}', '{"kind":"circle","side":1}', '{"kind":"line"}', "{}", "[]"]) {
  show("Shape " + text, () => JSON.parse<Shape>(text));
}
for (const text of ['{"a":1}', '{"b":"x"}', '{"a":"x","b":"y"}', '{"a":"x"}', "[1,2]", '[1,"2"]', "null", "1", "{}"]) show("Loose " + text, () => JSON.parse<Loose>(text));

const account = {
  id: "u1", handle: "@ada", version: "v2", color: "red", level: 1, email: "ada@example.com", slug: "ada-l", step: 10, port: 1,
  pair: [1, "one"], scores: { b: 1, a: 2 }, options: { deep: [{ x: null }], __proto__: 1 }, anything: [1, { y: 2 }],
};
const accounts: [string, unknown][] = [
  ["as declared", account],
  ["a default", { ...account, port: undefined }],
  ["templates", { ...account, handle: "ada", version: "vx" }],
  ["enums", { ...account, color: "blue", level: 2 }],
  ["formats", { ...account, email: "ada", slug: "Ada" }],
  ["a message", { ...account, step: 7 }],
  ["a tuple", { ...account, pair: [1] }],
  ["a tuple's members", { ...account, pair: ["1", 1] }],
  ["a dictionary", { ...account, scores: { a: "1" } }],
  ["other keys", { ...account, "x-one": 1, other: 2 }],
  ["anything is missing", { ...account, anything: undefined }],
];
for (const [what, value] of accounts) show("Account: " + what, () => JSON.parse<Account>(JSON.stringify(value)));

for (const text of ['{"a":1,"inner":{"b":2}}', '{"a":1,"inner":{"b":2},"c":3}', '{"a":1,"inner":{"b":2,"c":3}}']) {
  show("Closed " + text, () => JSON.parse<Closed>(text));
  show("ClosedThroughout " + text, () => JSON.parse<ClosedThroughout>(text));
}
for (const text of ['{"id":1}', '{"id":1,"a":2}', '{"id":1,"a":"2"}']) show("WithIndex " + text, () => JSON.parse<WithIndex>(text));

let deep = '{"value":0,"children":[]}';
for (let i = 1; i < 50; i++) deep = `{"value":${i},"children":[${deep}]}`;
show("Tree: deep", () => JSON.stringify(JSON.parse<Tree>(deep)).length);
show("Tree: deep, wrong at the bottom", () => JSON.parse<Tree>(deep.replace('"value":0', '"value":"0"')));

for (const text of ["1", "-0", "1.5e3", "1e400", '"1"', "null"]) show("number " + text, () => Object.is(JSON.parse<number>(text), -0) ? "-0" : JSON.parse<number>(text));
show("string", () => JSON.parse<string>('"\\u0061\\n"'));
show("boolean | null", () => [JSON.parse<boolean | null>("true"), JSON.parse<boolean | null>("null")]);
show("number[]", () => JSON.parse<number[]>(" [ 1 , 2 ] "));
show("number[]: below", () => JSON.parse<number[]>('[1,"2",3,null]'));
show("the later of two wins, and fits", () => JSON.parse<{ n: number }>('{"n":"x","n":1}'));
show("the later of two wins, and does not fit", () => JSON.parse<{ n: number }>('{"n":1,"n":"x"}'));
show("__proto__ is a key", () => Object.getOwnPropertyNames(JSON.parse<{ n: number }>('{"__proto__":{"n":2},"n":1}')));
show("a reviver makes it fit", () => JSON.parse<{ a: number }>('{"a":"1"}', (key, value) => (key === "a" ? Number(value) : value)));
show("a reviver makes it misfit", () => JSON.parse<{ a: number }>('{"a":1}', (key, value) => (key === "a" ? String(value) : value)));
show("one in another", () => JSON.parse<{ a: number }>(JSON.parse<string>('"{\\"a\\":1}"')));
show("one in another, the inner misfits", () => JSON.parse<{ a: number }>(JSON.parse<string>("1")));

class Holder {
  held = JSON.parse<{ a: number }>('{"a":1,"b":2}');
  static parse(text = JSON.stringify(JSON.parse<number[]>("[1]"))): unknown {
    return JSON.parse<number[]>(text);
  }
}
show("in a field", () => new Holder().held);
show("in a default", () => Holder.parse());

const shared = { inner: { n: 1 } };
const revived = JSON.parse<{ a: { inner: { n: number } }; b: { inner: { n: number } } }>('{"a":0,"b":0}', (key, value) => (key === "a" || key === "b" ? shared : value));
console.log("what a reviver hands out is copied", revived.a !== shared, revived.a !== revived.b, revived.a.inner !== shared.inner, JSON.stringify(revived));

const form = { z: 1, id: 7, items: [{ sku: "a", quantity: 1 }], to: { name: "n", city: "c" }, kind: "gift", coupon: null, extra: { kept: true } };
show("Bun.validate: fits", () => Bun.validate<Order>(form));
show("Bun.validate: a misfit", () => Bun.validate<Order>({ ...form, id: "7" }));
show("Bun.validate: two misfits", () => Bun.validate<Order>({ ...form, id: "7", items: [] }));
show("Bun.validate: not an object", () => Bun.validate<Order>("text"));
show("Bun.validate: a primitive", () => Bun.validate<number>(1));
show("Bun.validate: imported under another name", () => check<Order>({ ...form, kind: "other" }));
{
  const copy = Bun.validate<Order>(form) as Order & { extra: object };
  console.log("Bun.validate copies", copy !== (form as unknown), copy.items !== (form.items as unknown), copy.items[0] !== (form.items[0] as unknown), copy.to !== form.to, copy.extra === form.extra);
  let reads = 0;
  const once = Bun.validate<{ a: number }>({ get a() { return ++reads; } });
  console.log("Bun.validate reads a getter once", reads, once.a, reads);
  const frozen = Object.freeze({ name: "n" });
  console.log("Bun.validate leaves its argument alone", JSON.stringify(Bun.validate<{ name: string; role: string & Schema.Default<"guest"> }>(frozen)), JSON.stringify(frozen));
}
show("a parameter named Bun", () => ((Bun: { validate<T>(value: unknown): T }) => Bun.validate<{ id: number }>({ id: "one" }))({ validate: <T,>(value: unknown) => ("theirs " + JSON.stringify(value)) as T }));

const misfit = '{"id":"one"}';
show("no type argument", () => JSON.parse(misfit));
show("a cast", () => JSON.parse(misfit) as { id: number });
show("any", () => JSON.parse<any>(misfit));
show("unknown", () => JSON.parse<unknown>(misfit));
show("a parameter named JSON", () => ((JSON: { parse<T>(text: string): T }) => JSON.parse<{ id: number }>(misfit))({ parse: <T,>(text: string) => ("theirs " + text) as T }));
show("a variable named JSON", () => {
  const JSON = { parse<T>(text: string): T { return ("mine " + text) as T; } };
  return JSON.parse<{ id: number }>(misfit);
});

for (const text of ["", "{", '{"id":7', '{"id":7,}', "[1,]", "nul", '{"id":7} x', "{'id':7}", '{"id":07}', '"\n"']) {
  let plain = "";
  try {
    JSON.parse(text);
  } catch (error: any) {
    plain = error.name + ": " + error.message;
  }
  let typed = "";
  try {
    JSON.parse<Order>(text);
  } catch (error: any) {
    typed = error.name + ": " + error.message;
  }
  console.log("not JSON", JSON.stringify(text), typed === plain, typed.split(":")[0]);
}
