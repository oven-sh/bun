// Objects and arrays that the program makes just before the check, and whose members nothing else reads. A rule about members or elements reads them.
import type { Schema } from "bun";
import { validate } from "bun:bundle";
import { finish, handsBack, refuses } from "./check";

const needsAddress = { type: "object", dependentRequired: { card: ["address"] } } as const;
type NeedsAddress = Schema.FromJSONSchema<typeof needsAddress>;
type NeedsAddressByAlias = { card?: unknown; address?: unknown } & Schema.DependentRequired<{ card: ["address"] }>;
type AtMostOne = { a?: unknown; b?: unknown } & Schema.MaxProperties<1>;
type AtLeastTwo = { a?: unknown; b?: unknown } & Schema.MinProperties<2>;
type Unique = { n: unknown }[] & Schema.UniqueItems;
type NoB = { a?: unknown; b?: unknown } & Schema.Not<{ b: number }>;
type OnlyShortNames = Record<string, unknown> & Schema.PropertyNames<string & Schema.MaxLength<1>>;
type NoUnderscore = { a?: unknown } & Schema.PatternProperties<{ "^_": never }>;
type SomeNumber = unknown[] & Schema.Contains<number>;

const body: any = globalThis.JSON.parse(process.env.BODY ?? '{"card":"4111","a":1,"b":2}');

refuses("dependentRequired", () => validate<NeedsAddress>({ card: body.card }));
refuses("DependentRequired", () => validate<NeedsAddressByAlias>({ card: body.card }));
handsBack("DependentRequired, with the member", { card: "4111", address: 1 }, () => validate<NeedsAddressByAlias>({ card: body.card, address: body.a }));
refuses("MaxProperties", () => validate<AtMostOne>({ a: body.a, b: body.b }));
handsBack("MinProperties", { a: 1, b: 2 }, () => validate<AtLeastTwo>({ a: body.a, b: body.b }));
refuses("MinProperties, one member", () => validate<AtLeastTwo>({ a: body.a }));
refuses("UniqueItems", () => validate<Unique>([{ n: body.a }, { n: body.a }]));
handsBack("UniqueItems, unlike", [{ n: 1 }, { n: 2 }], () => validate<Unique>([{ n: body.a }, { n: body.b }]));
refuses("Not", () => validate<NoB>({ a: body.a, b: body.b }));
refuses("PropertyNames", () => validate<OnlyShortNames>({ a: body.a, bc: body.b }));
refuses("PatternProperties", () => validate<NoUnderscore>({ a: body.a, _b: body.b }));
refuses("Contains", () => validate<SomeNumber>([body.card]));
handsBack("Contains, with a number", ["4111", 1], () => validate<SomeNumber>([body.card, body.a]));

refuses("MaxProperties, members that are stored one by one", () => {
  const made: { a?: unknown; b?: unknown } = {};
  made.a = 1;
  made.b = 1;
  return validate<AtMostOne>(made);
});
refuses("UniqueItems, elements that are stored one by one", () => {
  const made: { n: unknown }[] = [];
  made.push({ n: 1 });
  made.push({ n: 2 });
  made[1].n = 1;
  return validate<Unique>(made);
});
refuses("Not, a member that is stored after the object was made", () => {
  const made: { a?: unknown; b?: unknown } = { a: 1 };
  made.b = body.b;
  return validate<NoB>(made);
});
handsBack("MaxProperties, a member that is deleted", { a: 1 }, () => {
  const made: { a?: unknown; b?: unknown } = { a: 1, b: 1 };
  delete made.b;
  return validate<AtMostOne>(made);
});

finish();
