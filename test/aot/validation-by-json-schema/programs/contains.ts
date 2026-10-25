import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, both, changing, changingProxy, finish, handsBack, refuses, withIterator, withMethods } from "./check";

type SomeNumber = unknown[] & Schema.Contains<number>;
type TwoOrThreeStrings = unknown[] & Schema.Contains<string, 2, 3>;
type AtMostOneNull = unknown[] & Schema.Contains<null, 0, 1>;
type SomePoint = unknown[] & Schema.Contains<{ x: number }>;
type Nothing = unknown[] & Schema.Contains<never>;
type AtLeastTwoNumbers = unknown[] & Schema.Contains<number, 2>;
type NoMaximum = unknown[] & Schema.Contains<number, 1, never>;
type NoPoint = unknown[] & Schema.Contains<{ x: number }, 0, 0>;

both("some number", value => validate<SomeNumber>(value), text => JSON.parse<SomeNumber>(text), {
  "[]": false,
  '["a"]': false,
  '["a",1]': true,
  "[1,2,3]": true,
  "[[1]]": false,
  "[1e999]": false,
  "{}": false,
});
both("two or three strings", value => validate<TwoOrThreeStrings>(value), text => JSON.parse<TwoOrThreeStrings>(text), {
  '["a"]': false,
  '["a","b"]': true,
  '["a",1,"b",2,"c"]': true,
  '["a","b","c","d"]': false,
  "[]": false,
});
both("at most one null", value => validate<AtMostOneNull>(value), text => JSON.parse<AtMostOneNull>(text), {
  "[]": true,
  "[1]": true,
  "[null]": true,
  "[null,1,null]": false,
});
both("some point", value => validate<SomePoint>(value), text => JSON.parse<SomePoint>(text), {
  '[{"x":1}]': true,
  '[{"x":"1"}]': false,
  '[1,{"y":1},{"x":1,"y":1}]': true,
  '[{"__proto__":{"x":1}}]': false,
});
both("nothing", value => validate<Nothing>(value), text => JSON.parse<Nothing>(text), { "[]": false, "[1]": false });
both("at least two numbers, and no maximum", value => validate<AtLeastTwoNumbers>(value), text => JSON.parse<AtLeastTwoNumbers>(text), {
  "[1]": false,
  "[1,2]": true,
  "[1,2,3,4,5,6,7,8,9]": true,
});
both("never in the place of the maximum is none", value => validate<NoMaximum>(value), text => JSON.parse<NoMaximum>(text), {
  "[]": false,
  "[1,2,3,4,5,6,7,8,9]": true,
});
both("no point", value => validate<NoPoint>(value), text => JSON.parse<NoPoint>(text), {
  "[]": true,
  '[{"y":1}]': true,
  '[{"x":1}]': false,
  '[{"x":1e999}]': false,
});

refuses("a hole is no number", () => validate<SomeNumber>([,]));
const holeOverInherited: unknown[] = [,];
Object.setPrototypeOf(holeOverInherited, Object.assign(Object.create(Array.prototype), { 0: 5 }));
accepts("an index that only the prototype holds is read as every reader reads it", () => validate<SomeNumber>(holeOverInherited));
accepts("a hole behind a number", () => validate<SomeNumber>([1, ,]));
refuses("a hole where no element may be a point", () => validate<NoPoint>([,]));
refuses("an object that converts to a number is none", () => validate<SomeNumber>([withMethods()]));
refuses("an array with an iterator of its own", () => validate<SomeNumber>(withIterator(["a"])));
handsBack("a Proxy as an element is read once", [{ x: 1 }], () => validate<SomePoint>([changingProxy({ x: 1 }, { x: "s" })]));
refuses("a Proxy as an element is judged by what it first answers", () => validate<SomePoint>([changingProxy({ x: "s" }, { x: 1 })]));
handsBack("a getter is read once", [{ x: 1 }], () => validate<SomePoint>([changing("x", 1, "s")]));
refuses("a getter is judged by what it first answers", () => validate<SomePoint>([changing("x", "s", 1)]));
handsBack("no point: a getter is read once", [{ x: "s" }], () => validate<NoPoint>([changing("x", "s", 1)]));
refuses("no point: a getter is judged by what it first answers", () => validate<NoPoint>([changing("x", 1, "s")]));
refuses("no point: a Proxy is judged by what it first answers", () => validate<NoPoint>([changingProxy({ x: 1 }, {})]));
refuses("an inherited member is none", () => validate<SomePoint>([Object.create({ x: 1 })]));

finish();
