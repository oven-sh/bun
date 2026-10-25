// Each check would take minutes, or for ever, if its time were quadratic or exponential in the value. Where a size can grow, four times the size may take eight times as long.
import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, acceptsOrThrowsRangeError, endsClosed, finish, growsLinearly, refuses } from "./check";

type Unique = unknown[] & Schema.UniqueItems;
const count = 300_000;
accepts("300,000 numbers", () => validate<Unique>(Array.from({ length: count }, (_, i) => i)));
refuses("300,000 numbers, the last as the first", () => validate<Unique>([...Array.from({ length: count }, (_, i) => i), 0]));
accepts("300,000 strings", () => validate<Unique>(Array.from({ length: count }, (_, i) => "item " + i)));
accepts("300,000 objects", () => validate<Unique>(Array.from({ length: count }, (_, i) => ({ id: i, tags: ["a", "b"] }))));
refuses("300,000 objects, two alike but for the order of keys", () =>
  validate<Unique>([...Array.from({ length: count }, (_, i) => ({ id: i, kind: "a" })), { kind: "a", id: 7 }]));
refuses("300,000 numbers by text", () => JSON.parse<Unique>("[" + Array.from({ length: count }, (_, i) => i).join(",") + ",0]"));
accepts("one object of 100,000 keys beside its like", () =>
  validate<Unique>([
    Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => ["k" + i, i])),
    Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => ["k" + (99_999 - i), i])),
  ]));
growsLinearly("unique numbers", 50_000, size => {
  const items = Array.from({ length: size }, (_, i) => i);
  return () => validate<Unique>(items);
});
growsLinearly("unique texts", 50_000, size => {
  const items = Array.from({ length: size }, (_, i) => "item " + i);
  return () => validate<Unique>(items);
});
growsLinearly("unique objects", 25_000, size => {
  const items = Array.from({ length: size }, (_, i) => ({ id: i, tags: ["a", "b"] }));
  return () => validate<Unique>(items);
});
growsLinearly("unique numbers by text", 50_000, size => {
  const text = "[" + Array.from({ length: size }, (_, i) => i).join(",") + "]";
  return () => JSON.parse<Unique>(text);
});
growsLinearly("two objects of many keys", 25_000, size => {
  const items = [
    Object.fromEntries(Array.from({ length: size }, (_, i) => ["k" + i, i])),
    Object.fromEntries(Array.from({ length: size }, (_, i) => ["k" + (size - 1 - i), i])),
  ];
  return () => validate<Unique>(items);
});

// Unique at every level: each level asks about the levels below it.
interface Tree {
  kids: Tree[] & Schema.UniqueItems;
}
const treeOf = (levels: number, leaves: number) =>
  '{"kids":['.repeat(levels) + '{"kids":[' + Array.from({ length: leaves }, (_, i) => '{"kids":[],"i":' + i + "}").join(",") + "]}" + "]}".repeat(levels);
growsLinearly("unique at every level, by text", 2_000, size => {
  const text = treeOf(size / 10, size);
  return () => JSON.parse<Tree>(text);
});
growsLinearly("unique at every level", 2_000, size => {
  const value = globalThis.JSON.parse(treeOf(size / 10, size));
  return () => validate<Tree>(value);
});
accepts("1,000 levels around 30,000 leaves, by text", () => JSON.parse<Tree>(treeOf(1_000, 30_000)));
accepts("1,000 levels around 30,000 leaves", () => validate<Tree>(globalThis.JSON.parse(treeOf(1_000, 30_000))));
refuses("1,000 levels around two leaves that are alike", () => JSON.parse<Tree>('{"kids":['.repeat(1_000) + '{"kids":[{"kids":[]},{"kids":[]}]}' + "]}".repeat(1_000)));
type Levels = (number | string | Levels)[] & Schema.UniqueItems;
accepts("200,000 texts under 1,000 levels that are each unique", () => {
  let value: unknown = Array.from({ length: 200_000 }, (_, i) => "item " + i);
  for (let level = 0; level < 1_000; level++) value = [0, value];
  return validate<Levels>(value);
});

type SomeStrings = unknown[] & Schema.Contains<string, 1, 2>;
refuses("contains walks once", () => validate<SomeStrings>(Array.from({ length: 1_000_000 }, () => "a")));
refuses("contains finds none", () => validate<SomeStrings>(Array.from({ length: 1_000_000 }, () => 1)));

type Keys = { a?: number } &
  Schema.PatternProperties<{ "^a": number; "^k": number; "9$": number }> &
  Schema.PropertyNames<string & Schema.MaxLength<8>> &
  Schema.MaxProperties<200000>;
accepts("200,000 keys", () => validate<Keys>(Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => ["k" + i, i]))));
growsLinearly("keys", 25_000, size => {
  const value = Object.fromEntries(Array.from({ length: size }, (_, i) => ["k" + i, i]));
  return () => validate<Keys>(value);
});
growsLinearly("contains", 100_000, size => {
  const items = Array.from({ length: size }, () => 1);
  return () => validate<SomeStrings>(items);
});

// Both arms look at the same value again, one level down. Without a memory of verdicts each level doubles the work.
interface TwiceByOneOf {
  next?: TwiceByOneOf & Schema.OneOf<[TwiceByOneOf, TwiceByOneOf & { never: 1 }]>;
}
interface TwiceByIf {
  next?: TwiceByIf & Schema.If<TwiceByIf, TwiceByIf, TwiceByIf>;
}
interface TwiceByNot {
  next?: TwiceByNot & Schema.Not<TwiceByNot & { never: 1 }> & Schema.Not<TwiceByNot & { never: 2 }>;
}
type TwiceByUnion = { next?: TwiceByUnion; a?: 1 } | { next?: TwiceByUnion; b?: 1 };
interface TwiceByContains {
  next?: [TwiceByContains] & Schema.Contains<TwiceByContains> & Schema.Contains<TwiceByContains & { never: 1 }, 0>;
}

function chain(levels: number, wrap: (value: unknown) => unknown = value => value): unknown {
  let value: unknown = {};
  for (let level = 0; level < levels; level++) value = { next: wrap(value) };
  return value;
}
const levels = 200;
acceptsOrThrowsRangeError("oneOf, 200 levels", () => validate<TwiceByOneOf>(chain(levels)));
acceptsOrThrowsRangeError("if, 200 levels", () => validate<TwiceByIf>(chain(levels)));
acceptsOrThrowsRangeError("not, 200 levels", () => validate<TwiceByNot>(chain(levels)));
acceptsOrThrowsRangeError("a union, 200 levels", () => validate<TwiceByUnion>(chain(levels)));
acceptsOrThrowsRangeError("contains, 200 levels", () => validate<TwiceByContains>(chain(levels, value => [value])));
const text = '{"next":'.repeat(levels) + "{}" + "}".repeat(levels);
acceptsOrThrowsRangeError("oneOf, 200 levels by text", () => JSON.parse<TwiceByOneOf>(text));
acceptsOrThrowsRangeError("if, 200 levels by text", () => JSON.parse<TwiceByIf>(text));
acceptsOrThrowsRangeError("a union, 200 levels by text", () => JSON.parse<TwiceByUnion>(text));
const wrong = '{"next":'.repeat(levels) + "1" + "}".repeat(levels);
endsClosed("oneOf, 200 levels, the innermost is wrong", () => JSON.parse<TwiceByOneOf>(wrong));
endsClosed("if, 200 levels, the innermost is wrong", () => JSON.parse<TwiceByIf>(wrong));
endsClosed("not, 200 levels, the innermost is wrong", () => JSON.parse<TwiceByNot>(wrong));
endsClosed("a union, 200 levels, the innermost is wrong", () => JSON.parse<TwiceByUnion>(wrong));

finish();
