import { JSON } from "bun";
import { validate } from "bun:bundle";
import { acceptsOrThrowsRangeError, both, changingProxy, endsClosed, finish, handsBack, refuses, refusesAt, yields } from "./check";

type WithOptional = [number, string?];
type AllOptional = [number?, string?];
type WithRest = [number, ...string[]];
type All = [number, string?, ...boolean[]];
type OnlyRest = [...number[]];
type Inner = [[number, string?], ...[boolean?][]];
interface Tree {
  children: [Tree?, ...Tree[]];
}

both("with optional", value => validate<WithOptional>(value), text => JSON.parse<WithOptional>(text), {
  "[]": false,
  "[1]": true,
  '[1,"a"]': true,
  "[1,1]": false,
  '[1,"a",1]': false,
  '["a"]': false,
  '{"0":1,"length":1}': false,
});
both("all optional", value => validate<AllOptional>(value), text => JSON.parse<AllOptional>(text), {
  "[]": true,
  "[1]": true,
  '[1,"a"]': true,
  '["a"]': false,
  '[1,"a",null]': false,
});
both("with rest", value => validate<WithRest>(value), text => JSON.parse<WithRest>(text), {
  "[]": false,
  "[1]": true,
  '[1,"a","b"]': true,
  '[1,"a",1]': false,
  "[1,1]": false,
});
both("optional and rest", value => validate<All>(value), text => JSON.parse<All>(text), {
  "[]": false,
  "[1]": true,
  '[1,"a"]': true,
  '[1,"a",true,false]': true,
  "[1,true]": false,
  '[1,"a",true,1]': false,
  '[1,"a",null]': false,
});
both("only rest", value => validate<OnlyRest>(value), text => JSON.parse<OnlyRest>(text), { "[]": true, "[1,2]": true, '[1,"a"]': false });
both("inner", value => validate<Inner>(value), text => JSON.parse<Inner>(text), {
  "[[1]]": true,
  '[[1,"a"],[],[true]]': true,
  "[[]]": false,
  "[[1],[1]]": false,
  "[[1],[true,true]]": false,
});
both("recursive", value => validate<Tree>(value), text => JSON.parse<Tree>(text), {
  '{"children":[]}': true,
  '{"children":[{"children":[]},{"children":[{"children":[]}]}]}': true,
  '{"children":[{"children":[1]}]}': false,
});

yields("no element is added", "[1]", () => validate<All>([1]));
yields("each element is kept", '[1,"a",true,false]', () => validate<All>([1, "a", true, false]));
yields("no element is added, by text", "[1]", () => JSON.parse<All>("[1]"));
yields("each element is kept, by text", '[1,"a",true,false]', () => JSON.parse<All>('[1,"a",true,false]'));
yields("an empty tuple", "[]", () => validate<AllOptional>([]));
const given: unknown[] = [1, "a"];
yields("the result is a copy", "false", () => (validate<All>(given) as unknown) === given);
refusesAt("an optional element", [1], () => validate<All>([1, 1]));
refusesAt("an element of the rest", [3], () => validate<All>([1, "a", true, 1]));
refusesAt("an element of the rest, by text", [3], () => JSON.parse<All>('[1,"a",true,1]'));
refusesAt("an element of an inner tuple", [1, 0], () => validate<Inner>([[1], [1]]));

refuses("a hole where an element is required", () => validate<WithRest>([, "a"]));
refuses("a hole in the rest", () => validate<WithRest>([1, , "a"]));
refuses("a hole where an element is optional", () => validate<All>([1, , true]));
refuses("a hole as the last optional element", () => validate<WithOptional>([1, ,]));
refuses("a hole as the only optional element", () => validate<AllOptional>([,]));
refuses("undefined is no optional element", () => validate<WithOptional>([1, undefined]));
refuses("undefined is no first optional element", () => validate<AllOptional>([undefined]));
refuses("undefined in front of an optional element", () => validate<AllOptional>([undefined, "a"]));
refuses("undefined where an element is optional, in front of the rest", () => validate<All>([1, undefined, true]));
refuses("undefined is no element of the rest", () => validate<All>([1, "a", undefined]));
refusesAt("undefined as an optional element", [1], () => validate<WithOptional>([1, undefined]));
handsBack("a Proxy is read once", [1, "a"], () => validate<WithOptional>(changingProxy([1, "a"], [1, 1, 1])));
refuses("a Proxy is judged by what it first answers", () => validate<WithOptional>(changingProxy([1, 1], [1, "a"])));
refuses("a Proxy that is too long at first", () => validate<WithOptional>(changingProxy([1, "a", 1], [1, "a"])));
handsBack("a Proxy of an empty array", [], () => validate<AllOptional>(changingProxy([], [1, 1, 1])));
refuses("a third element", () => validate<WithOptional>(Object.assign([1, "a"], { 2: 1 })));
const opening = '{"children":['.repeat(100_000);
const closing = "]}".repeat(100_000);
acceptsOrThrowsRangeError("100,000 levels by text", () => JSON.parse<Tree>(opening + closing));
endsClosed("100,000 levels by text, and the innermost is wrong", () => JSON.parse<Tree>(opening + "1" + closing));
function nested(innermost: unknown): unknown {
  let value = innermost;
  for (let level = 0; level < 100_000; level++) value = { children: [value] };
  return value;
}
acceptsOrThrowsRangeError("100,000 levels by value", () => validate<Tree>(nested({ children: [] })));
endsClosed("100,000 levels by value, and the innermost is wrong", () => validate<Tree>(nested(1)));

finish();
