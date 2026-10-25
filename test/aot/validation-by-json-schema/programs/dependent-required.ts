import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, both, changing, changingProxy, finish, handsBack, inheriting, refuses } from "./check";

type Card = Record<string, unknown> & Schema.DependentRequired<{ card: ["address", "name"] }>;
type Inherited = Record<string, unknown> & Schema.DependentRequired<{ a: ["toString", "__proto__"]; constructor: ["b"] }>;
type EachOther = { a?: number; b?: number } & Schema.DependentRequired<{ a: ["b"]; b: ["a"] }>;
type Nothing = Record<string, unknown> & Schema.DependentRequired<{ a: [] }>;

both("card", value => validate<Card>(value), text => JSON.parse<Card>(text), {
  "{}": true,
  '{"name":"a"}': true,
  '{"card":1,"address":"a","name":"a"}': true,
  '{"card":1,"address":"a"}': false,
  '{"card":null}': false,
  '{"card":1,"address":null,"name":null}': true,
});
both("names that every object inherits", value => validate<Inherited>(value), text => JSON.parse<Inherited>(text), {
  "{}": true,
  '{"a":1}': false,
  '{"a":1,"toString":1}': false,
  '{"a":1,"toString":1,"__proto__":1}': true,
  '{"constructor":1}': false,
  '{"constructor":1,"b":1}': true,
});
both("each other", value => validate<EachOther>(value), text => JSON.parse<EachOther>(text), {
  "{}": true,
  '{"a":1}': false,
  '{"b":1}': false,
  '{"a":1,"b":1}': true,
});
both("nothing", value => validate<Nothing>(value), text => JSON.parse<Nothing>(text), { '{"a":1}': true });

accepts("a key that holds undefined is absent", () => validate<Card>({ card: undefined }));
refuses("a name that holds undefined is absent", () => validate<Card>({ card: 1, address: "a", name: undefined }));
refuses("an inherited name is absent", () => validate<Card>(inheriting({ address: "a", name: "a" }, { card: 1 })));
handsBack("a getter is read once", { card: undefined }, () => validate<Card>(changing("card", undefined, 1)));
refuses("a getter is judged by what it first answers", () => validate<Card>(changing("card", 1, undefined)));
refuses("a name behind a getter is judged by what it first answers", () => validate<Card>(changing("name", undefined, "a", { card: 1, address: "a" })));
handsBack("a Proxy is read once", { name: "a" }, () => validate<Card>(changingProxy({ name: "a" }, { name: "a", card: 1 })));
refuses("a Proxy is judged by what it first answers", () => validate<Card>(changingProxy({ card: 1 }, {})));

finish();
