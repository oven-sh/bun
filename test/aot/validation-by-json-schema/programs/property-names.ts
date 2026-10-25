import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { both, changingProxy, finish, handsBack, hidden, holdsItsOwnCopy, refuses } from "./check";

type Short = Record<string, unknown> & Schema.PropertyNames<string & Schema.MaxLength<1>>;
type Listed = Record<string, unknown> & Schema.PropertyNames<"a" | "__proto__">;
type Lower = Record<string, unknown> & Schema.PropertyNames<string & Schema.Pattern<"^[a-z]+$">>;
type None = Record<string, unknown> & Schema.PropertyNames<never>;
type AreNumbers = Record<string, unknown> & Schema.PropertyNames<number>;

both("short", value => validate<Short>(value), text => JSON.parse<Short>(text), {
  "{}": true,
  '{"a":1}': true,
  '{"💩":1}': true,
  '{"ab":1}': false,
  '{"__proto__":1}': false,
  '{"a":1,"bc":1}': false,
});
both("listed", value => validate<Listed>(value), text => JSON.parse<Listed>(text), {
  '{"a":1}': true,
  '{"__proto__":1}': true,
  '{"b":1}': false,
  '{"constructor":1}': false,
});
both("lower", value => validate<Lower>(value), text => JSON.parse<Lower>(text), {
  '{"ab":1}': true,
  '{"a1":1}': false,
  '{"":1}': false,
  '{"0":1}': false,
});
both("none", value => validate<None>(value), text => JSON.parse<None>(text), { "{}": true, '{"a":1}': false });
both("a key is a string", value => validate<AreNumbers>(value), text => JSON.parse<AreNumbers>(text), { "{}": true, '{"1":1}': false });

refuses("a key that holds undefined is a key", () => validate<Short>({ ab: undefined }));
handsBack("a Proxy is read once", { a: 1 }, () => validate<Short>(changingProxy({ a: 1 }, { a: 1, bc: 1 })));
refuses("a Proxy is judged by what it first answers", () => validate<Short>(changingProxy({ a: 1, bc: 1 }, { a: 1 })));
handsBack("a key that is not enumerable is none, and the result does not have it", { a: 1 }, () => validate<Short>(hidden("bc", 1, { a: 1 })));
const symbolKey = Symbol("a");
handsBack("a key that is a symbol is no key to a rule, and the copy leaves it out", {}, () => validate<None>({ [symbolKey]: 1 }));
type TextOrNamed = { v: string | (object & Schema.PropertyNames<"a">) };
holdsItsOwnCopy("any object in an arm of a union is copied", { v: { a: 1 } as Record<string, number> }, { v: { a: 1 } }, value => validate<TextOrNamed>(value), value => (value.v.b = 1));

finish();
