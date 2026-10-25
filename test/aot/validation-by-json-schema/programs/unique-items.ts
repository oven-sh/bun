import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, both, changing, changingProxy, endsClosed, finish, handsBack, hidden, refuses, withIterator, withMethods } from "./check";

type Unique = unknown[] & Schema.UniqueItems;
type UniqueNumbers = number[] & Schema.UniqueItems & Schema.MinItems<1>;
const unique = (value: unknown) => validate<Unique>(value);

both("unique", unique, text => JSON.parse<Unique>(text), {
  "[]": true,
  "[1]": true,
  "[1,2]": true,
  "[1,1]": false,
  "[1,1.0]": false,
  "[0,-0]": false,
  "[1,true]": true,
  "[0,false]": true,
  '[1,"1"]': true,
  "[null,null]": false,
  "[{},[]]": true,
  "[[1],[1]]": false,
  "[[1,2],[2,1]]": true,
  '[{"a":1,"b":2},{"b":2,"a":1}]': false,
  '[{"a":1},{"a":1,"b":1}]': true,
  '[{"__proto__":1},{}]': true,
  '[{"__proto__":1},{"__proto__":1}]': false,
  '["[1]",[1]]': true,
  '[["a","b"],["a,b"]]': true,
  '[{"a":"b"},{"a":"b\\""}]': true,
  '["\\ud83d","\\ud83d"]': false,
  '["\\ud83d","\\udca9"]': true,
  "{}": false,
  "1": false,
});
both("unique numbers", value => validate<UniqueNumbers>(value), text => JSON.parse<UniqueNumbers>(text), {
  "[]": false,
  "[1,2,3]": true,
  "[1,2,1]": false,
  '[1,"2"]': false,
});

refuses("a key that holds undefined is no key of an element", () => unique([{ a: 1, b: undefined }, { a: 1 }]));
refuses("a key that is not enumerable is no key of an element", () => unique([hidden("a", 1), {}]));
refuses("a hole beside undefined", () => unique([, undefined]));
accepts("a hole is undefined, which unknown takes", () => unique([, 1]));
accepts("a hole in an element", () => unique([[, 1], 2]));
refuses("twice what is not a number", () => unique([NaN, NaN]));
refuses("twice undefined", () => unique([undefined, undefined]));
handsBack("a getter in an element is read once", [{ a: 1 }, { a: 2 }], () => unique([changing("a", 1, 2), { a: 2 }]));
refuses("a getter in an element is judged by what it first answers", () => unique([changing("a", 2, 1), { a: 2 }]));
handsBack("a Proxy as an element is read once", [{ a: 1 }, { a: 2 }], () => unique([changingProxy({ a: 1 }, { a: 2 }), { a: 2 }]));
refuses("a Proxy as an element is judged by what it first answers", () => unique([changingProxy({ a: 2 }, { a: 1 }), { a: 2 }]));
handsBack("a Proxy of an array is read once", [1, 2], () => unique(changingProxy([1, 2], [1, 1])));
refuses("a Proxy of an array is judged by what it first answers", () => unique(changingProxy([1, 1], [1, 2])));
endsClosed("two elements with the same methods: none is called", () => unique([withMethods(), withMethods(), "1", 1]));
refuses("an array with an iterator of its own", () => unique(withIterator([1, 1])));
const cycle: unknown[] = [];
cycle.push(cycle);
endsClosed("an element that holds itself", () => unique([cycle, 1]));

finish();
