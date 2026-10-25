import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, both, changingProxy, finish, handsBack, hidden, holdsItsOwnCopy, inheriting, refuses } from "./check";

type AtLeastTwo = Record<string, unknown> & Schema.MinProperties<2>;
type AtMostOne = Record<string, unknown> & Schema.MaxProperties<1>;
type Empty = Record<string, unknown> & Schema.MaxProperties<0>;
type OneOrTwo = { a?: number; b?: number; c?: number } & Schema.MinProperties<1> & Schema.MaxProperties<2>;
type AnyObjectWithOne = object & Schema.MaxProperties<1>;
type Holder = { meta: object & Schema.MaxProperties<1> } & Schema.Strict;

both("at least two", value => validate<AtLeastTwo>(value), text => JSON.parse<AtLeastTwo>(text), {
  "{}": false,
  '{"a":1}': false,
  '{"a":1,"b":1}': true,
  '{"a":1,"a":2}': false,
  '{"__proto__":1,"0":1}': true,
  '{"a":null,"b":null}': true,
  "[1,2]": false,
});
both("at most one", value => validate<AtMostOne>(value), text => JSON.parse<AtMostOne>(text), {
  "{}": true,
  '{"a":1}': true,
  '{"a":1,"a":2}': true,
  '{"__proto__":1,"a":1}': false,
  '{"0":1,"a":1}': false,
});
both("empty", value => validate<Empty>(value), text => JSON.parse<Empty>(text), { "{}": true, '{"":1}': false, '{"__proto__":null}': false });
both("one or two", value => validate<OneOrTwo>(value), text => JSON.parse<OneOrTwo>(text), {
  "{}": false,
  '{"a":1}': true,
  '{"a":1,"b":1}': true,
  '{"a":1,"b":1,"c":1}': false,
  '{"x":1,"y":1,"z":1}': false,
});

accepts("a key that holds undefined counts toward the least", () => validate<AtLeastTwo>({ a: 1, b: undefined }));
refuses("a key that holds undefined counts toward the most", () => validate<AtMostOne>({ a: 1, b: undefined }));
refuses("a key that is not enumerable does not count", () => validate<AtLeastTwo>(Object.assign(hidden("a", 1), { b: 1 })));
refuses("an inherited key does not count", () => validate<AtLeastTwo>(inheriting({ a: 1, b: 1 })));
handsBack("a key that is not enumerable is not in the result", {}, () => validate<Empty>(hidden("a", 1)));
handsBack("a Proxy is read once", { a: 1 }, () => validate<AtMostOne>(changingProxy({ a: 1 }, { a: 1, b: 1, c: 1 })));
refuses("a Proxy is judged by what it first answers", () => validate<AtMostOne>(changingProxy({ a: 1, b: 1 }, { a: 1 })));
refuses("a Proxy that has too few at first", () => validate<AtLeastTwo>(changingProxy({ a: 1 }, { a: 1, b: 1 })));
both("any object", value => validate<AnyObjectWithOne>(value), text => JSON.parse<AnyObjectWithOne>(text), {
  "{}": true,
  '{"a":1}': true,
  '{"a":1,"b":1}': false,
  "1": false,
  "null": false,
});
handsBack("any object: a Proxy is read once, and is not handed back", { a: 1 }, () => validate<AnyObjectWithOne>(changingProxy({ a: 1 }, { a: 1, b: 1, c: 1 })));
holdsItsOwnCopy("any object is copied", { a: 1 } as Record<string, number>, { a: 1 }, value => validate<AnyObjectWithOne>(value), value => (value.b = 2));
holdsItsOwnCopy("any object in a member is copied", { meta: { a: 1 } as Record<string, number> }, { meta: { a: 1 } }, value => validate<Holder>(value), value => (value.meta.b = 2));

finish();
