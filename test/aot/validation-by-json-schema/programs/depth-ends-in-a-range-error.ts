// A type that reaches itself through a rule, and a value of 100,000 levels. The check answers or it ends in a RangeError.
// An end of the stack that a rule took for "the type refuses it" would be an accept under Not and under Contains<T, 0, 0>.
import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { acceptsOrThrowsRangeError, both, endsClosed, finish } from "./check";

type ThroughNot = { next?: unknown } & Schema.Not<{ next: ThroughNot }>;
type ThroughNone = { list: unknown[] & Schema.Contains<ThroughNone, 0, 0> };
type ThroughIf = { next?: unknown } & Schema.If<{ next: unknown }, { next: ThroughIf }>;
type ThroughOneOf = { next?: unknown } & Schema.OneOf<[{ next: ThroughOneOf }, { next?: never }]>;
type ThroughAllOf = { next?: unknown } & Schema.AllOf<[{ next?: ThroughAllOf }]>;
type ThroughPattern = { a?: unknown } & Schema.PatternProperties<{ "^next$": ThroughPattern }>;
type ThroughDependent = { next?: unknown } & Schema.DependentSchemas<{ next: { next: ThroughDependent } }>;
type Unique = unknown[] & Schema.UniqueItems;
interface UniqueAtEachLevel {
  kids: UniqueAtEachLevel[] & Schema.UniqueItems;
}

const objects = (levels: number, innermost = "{}") => '{"next":'.repeat(levels) + innermost + "}".repeat(levels);
const arrays = (levels: number, innermost = "[]") => "[".repeat(levels) + innermost + "]".repeat(levels);
const lists = (levels: number) => '{"list":['.repeat(levels) + '{"list":[]}' + "]}".repeat(levels);
const kids = (levels: number, innermost = '{"kids":[]}') => '{"kids":['.repeat(levels) + innermost + "]}".repeat(levels);
function made(levels: number, wrap: (value: unknown) => unknown, innermost: unknown): unknown {
  let value = innermost;
  for (let level = 0; level < levels; level++) value = wrap(value);
  return value;
}
const inObject = (value: unknown) => ({ next: value });
const inArray = (value: unknown) => [value];
const inList = (value: unknown) => ({ list: [value] });

// An object is a ThroughNot if what it holds is none, so every second level is one. The same for ThroughNone.
both("through Not", value => validate<ThroughNot>(value), text => JSON.parse<ThroughNot>(text), {
  [objects(0)]: true,
  [objects(1)]: false,
  [objects(2)]: true,
  [objects(3)]: false,
  [objects(1, "1")]: true,
});
both("through Contains", value => validate<ThroughNone>(value), text => JSON.parse<ThroughNone>(text), {
  [lists(0)]: true,
  [lists(1)]: false,
  [lists(2)]: true,
  [lists(3)]: false,
});
for (const [name, byValue, byText] of [
  ["through If", (value: unknown) => validate<ThroughIf>(value), (text: string) => JSON.parse<ThroughIf>(text)],
  ["through OneOf", (value: unknown) => validate<ThroughOneOf>(value), (text: string) => JSON.parse<ThroughOneOf>(text)],
  ["through AllOf", (value: unknown) => validate<ThroughAllOf>(value), (text: string) => JSON.parse<ThroughAllOf>(text)],
  ["through PatternProperties", (value: unknown) => validate<ThroughPattern>(value), (text: string) => JSON.parse<ThroughPattern>(text)],
  ["through DependentSchemas", (value: unknown) => validate<ThroughDependent>(value), (text: string) => JSON.parse<ThroughDependent>(text)],
] as const) {
  both(name, byValue, byText, { [objects(0)]: true, [objects(3)]: true, [objects(1, "1")]: false, [objects(3, "1")]: false });
  acceptsOrThrowsRangeError(name + " | 100,000 levels", () => byValue(made(100_000, inObject, {})));
  acceptsOrThrowsRangeError(name + " | 100,000 levels by text", () => byText(objects(100_000)));
  endsClosed(name + " | 100,000 levels, and the innermost is wrong", () => byValue(made(100_000, inObject, 1)));
  endsClosed(name + " | 100,000 levels by text, and the innermost is wrong", () => byText(objects(100_000, "1")));
}

acceptsOrThrowsRangeError("through Not | 100,000 levels", () => validate<ThroughNot>(made(100_000, inObject, {})));
acceptsOrThrowsRangeError("through Not | 100,000 levels by text", () => JSON.parse<ThroughNot>(objects(100_000)));
endsClosed("through Not | 100,001 levels", () => validate<ThroughNot>(made(100_001, inObject, {})));
endsClosed("through Not | 100,001 levels by text", () => JSON.parse<ThroughNot>(objects(100_001)));
acceptsOrThrowsRangeError("through Contains | 100,000 levels", () => validate<ThroughNone>(made(100_000, inList, { list: [] })));
acceptsOrThrowsRangeError("through Contains | 100,000 levels by text", () => JSON.parse<ThroughNone>(lists(100_000)));
endsClosed("through Contains | 100,001 levels", () => validate<ThroughNone>(made(100_001, inList, { list: [] })));
endsClosed("through Contains | 100,001 levels by text", () => JSON.parse<ThroughNone>(lists(100_001)));

acceptsOrThrowsRangeError("an element of 100,000 levels beside another", () => validate<Unique>([made(100_000, inArray, []), 1]));
acceptsOrThrowsRangeError("an element of 100,000 levels beside another, by text", () => JSON.parse<Unique>("[" + arrays(100_000) + ",1]"));
endsClosed("two elements of 100,000 levels that are alike", () => validate<Unique>([made(100_000, inArray, []), made(100_000, inArray, [])]));
endsClosed("two elements of 100,000 levels that are alike, by text", () => JSON.parse<Unique>("[" + arrays(100_000) + "," + arrays(100_000) + "]"));
acceptsOrThrowsRangeError("unique at each of 100,000 levels, by text", () => JSON.parse<UniqueAtEachLevel>(kids(100_000)));
endsClosed("unique at each of 100,000 levels, but not at the innermost, by text", () => JSON.parse<UniqueAtEachLevel>(kids(100_000, '{"kids":[{"kids":[]},{"kids":[]}]}')));

// After a check that ended in a RangeError the next one answers as if it were the first.
both("through Not, afterwards", value => validate<ThroughNot>(value), text => JSON.parse<ThroughNot>(text), { [objects(2)]: true, [objects(3)]: false });
both("through If, afterwards", value => validate<ThroughIf>(value), text => JSON.parse<ThroughIf>(text), { [objects(3)]: true, [objects(3, "1")]: false });

finish();
