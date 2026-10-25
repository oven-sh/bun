import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, both, changing, changingProxy, finish, handsBack, refuses } from "./check";

type Card = Record<string, unknown> & Schema.DependentSchemas<{ card: { address: string } }>;
type Forbidden = Record<string, unknown> & Schema.DependentSchemas<{ __proto__: never; a: unknown }>;
type Small = Record<string, unknown> & Schema.DependentSchemas<{ a: Record<string, unknown> & Schema.MaxProperties<2> }>;

both("card", value => validate<Card>(value), text => JSON.parse<Card>(text), {
  "{}": true,
  '{"address":1}': true,
  '{"card":1,"address":"a"}': true,
  '{"card":1}': false,
  '{"card":1,"address":1}': false,
  '{"card":null}': false,
});
both("forbidden", value => validate<Forbidden>(value), text => JSON.parse<Forbidden>(text), {
  "{}": true,
  '{"a":1}': true,
  '{"__proto__":1}': false,
});
both("the node sees the object", value => validate<Small>(value), text => JSON.parse<Small>(text), {
  '{"a":1,"b":1}': true,
  '{"a":1,"b":1,"c":1}': false,
  '{"b":1,"c":1,"d":1}': true,
});

accepts("a key that holds undefined is absent", () => validate<Card>({ card: undefined }));
refuses("a member that holds undefined is absent", () => validate<Card>({ card: 1, address: undefined }));
handsBack("a getter is read once", { card: 1, address: "a" }, () => validate<Card>(changing("address", "a", 1, { card: 1 })));
refuses("a getter is judged by what it first answers", () => validate<Card>(changing("address", 1, "a", { card: 1 })));
handsBack("a Proxy is read once", { address: 1 }, () => validate<Card>(changingProxy({ address: 1 }, { address: 1, card: 1 })));
refuses("a Proxy is judged by what it first answers", () => validate<Card>(changingProxy({ address: 1, card: 1 }, { address: 1 })));

finish();
