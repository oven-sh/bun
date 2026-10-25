import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { both, changing, changingProxy, finish, handsBack, hidden, holdsItsOwnCopy, refuses, refusesAt, yields } from "./check";

type Numbers = { a?: unknown } & Schema.PatternProperties<{ "^x": number }>;
type Closed = { a?: unknown } & Schema.Strict & Schema.PatternProperties<{ "^x": number }>;
type ClosedByTheRest = { a?: unknown } & Schema.PatternProperties<{ "^x": number }, never>;
type Both = { xa?: number } & Schema.PatternProperties<{ "^x": number & Schema.Max<1> }>;
type Two = { z?: unknown } & Schema.PatternProperties<{ a: number; b: number & Schema.Min<2> }>;
type Forbidden = { a?: unknown } & Schema.PatternProperties<{ "^_": never }>;
type RestAreStrings = { a?: boolean } & Schema.PatternProperties<{ "^n": number }, string>;
type OneCodePoint = { a?: unknown } & Schema.PatternProperties<{ "^.$": never }>;
type Objects = { a?: unknown } & Schema.PatternProperties<{ "^_": { b?: number } }, never>;

both("numbers", value => validate<Numbers>(value), text => JSON.parse<Numbers>(text), {
  "{}": true,
  '{"x1":1}': true,
  '{"x1":"s"}': false,
  '{"ax":"s"}': true,
  '{"x":null}': false,
  "[]": false,
});
both("closed", value => validate<Closed>(value), text => JSON.parse<Closed>(text), {
  '{"a":1,"x1":1}': true,
  '{"x1":"s"}': false,
  '{"y":1}': false,
  '{"ax":1}': false,
  '{"__proto__":1}': false,
});
both("closed by the type of the rest", value => validate<ClosedByTheRest>(value), text => JSON.parse<ClosedByTheRest>(text), {
  '{"a":1,"x1":1}': true,
  '{"x1":"s"}': false,
  '{"y":1}': false,
  '{"ax":1}': false,
  '{"__proto__":1}': false,
});
both("both", value => validate<Both>(value), text => JSON.parse<Both>(text), { '{"xa":1}': true, '{"xa":2}': false, '{"xa":"s"}': false });
both("two", value => validate<Two>(value), text => JSON.parse<Two>(text), {
  '{"ab":2}': true,
  '{"ab":1}': false,
  '{"a":1}': true,
  '{"b":1}': false,
  '{"c":"s"}': true,
});
both("forbidden", value => validate<Forbidden>(value), text => JSON.parse<Forbidden>(text), {
  '{"_a":1}': false,
  '{"a_":1}': true,
  '{"__proto__":1}': false,
});
both("the rest are strings", value => validate<RestAreStrings>(value), text => JSON.parse<RestAreStrings>(text), {
  '{"n":1,"s":"a"}': true,
  '{"n":"a"}': false,
  '{"s":1}': false,
  '{"a":true,"n":1,"s":"a"}': true,
  '{"a":"s"}': false,
  '{"__proto__":"s"}': true,
  '{"__proto__":1}': false,
});
both("a key is matched by code points", value => validate<OneCodePoint>(value), text => JSON.parse<OneCodePoint>(text), {
  '{"💩":1}': false,
  '{"b":1}': false,
  '{"ab":1}': true,
});
both("a key named __proto__ is an own key of the result", value => validate<Objects>(value), text => JSON.parse<Objects>(text), {
  '{"__proto__":{"b":1}}': true,
  '{"__proto__":{"b":"s"}}': false,
  '{"__proto__":{"isAdmin":true}}': true,
  '{"__proto__":1}': false,
});

refusesAt("the member that a pattern meets", ["x1"], () => validate<Numbers>({ a: 1, x1: "s" }));
refusesAt("the member that a pattern meets, by text", ["x1"], () => JSON.parse<Closed>('{"a":1,"x1":"s"}'));
yields("a member that a pattern meets is kept", '{"a":1,"x1":1}', () => validate<Closed>({ a: 1, x1: 1 }));
yields("a member that a pattern meets is kept, by text", '{"a":1,"x1":1}', () => JSON.parse<Closed>('{"a":1,"x1":1}'));

refuses("a key that holds undefined is a key", () => validate<Numbers>({ x1: undefined }));
refuses("a forbidden key that holds undefined is a key", () => validate<Forbidden>({ _a: undefined }));
handsBack("a key that is not enumerable is none, and the result does not have it", { a: 1 }, () => validate<Forbidden>(hidden("_a", 1, { a: 1 })));
const symbolKey = Symbol("_a");
refuses("a closed object takes no key that is a symbol", () => validate<Closed>({ a: 1, [symbolKey]: 1 }));
handsBack("a getter is read once", { x1: 1 }, () => validate<Numbers>(changing("x1", 1, "s")));
refuses("a getter is judged by what it first answers", () => validate<Numbers>(changing("x1", "s", 1)));
handsBack("a Proxy is read once", { a: 1 }, () => validate<Forbidden>(changingProxy({ a: 1 }, { a: 1, _a: 1 })));
refuses("a Proxy is judged by what it first answers", () => validate<Forbidden>(changingProxy({ a: 1, _a: 1 }, { a: 1 })));
handsBack("a Proxy under a closed type is read once", { x1: 1 }, () => validate<ClosedByTheRest>(changingProxy({ x1: 1 }, { x1: 1, y: 1 })));
holdsItsOwnCopy("what a pattern met is copied", { _a: { b: 1 } }, { _a: { b: 1 } }, value => validate<Objects>(value), value => (value._a.b = 2));

finish();
