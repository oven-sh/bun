// `x.slice(..)` where nothing is known of `x`: arrays of every kind, what only looks like one, and other receivers at the same site.
const lines = [];
function say(label, work) {
  let text;
  try {
    text = JSON.stringify(work());
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  lines.push(label + ": " + text);
}
function two(x, from, to) {
  return x.slice(from, to);
}
function one(x, from) {
  return x.slice(from);
}
function none(x) {
  return x.slice();
}
function three(x, from, to, more) {
  return x.slice(from, to, more);
}
const describe = part => [Array.isArray(part), part.length, Object.keys(part).join(), part];

const integers = [10, 11, 12, 13, 14, 15];
const fractions = [0.5, 1.5, 2.5, 3.5];
const values = ["a", { b: 1 }, null, undefined, 4, 5.5];
const made = [];
for (let i = 0; i < 9; i++) made.push({ id: i });
const holes = [1, , 3, , 5];
const fractionsWithHoles = [0.5, , 2.5];
const long = Array.from({ length: 200 }, (_, i) => i);
const sparse = [];
sparse[5000] = "far";
sparse[1] = "near";

for (let turn = 0; turn < 3; turn++) {
  for (const [name, array] of Object.entries({ integers, fractions, values, made, holes, fractionsWithHoles })) {
    say(name + " 1..3 " + turn, () => describe(two(array, 1, 3)));
    say(name + " from 2 " + turn, () => describe(one(array, 2)));
    say(name + " whole " + turn, () => describe(none(array)));
  }
}
for (const [from, to] of [[0, 0], [0, 1], [0, 100], [3, 1], [-2, 100], [-100, -1], [-1, -3], [5, 6], [6, 7], [100, 200], [-2147483648, 2147483647], [2147483647, -2147483648]])
  say("integers " + from + ".." + to, () => [two(integers, from, to), two(fractions, from, to), one(values, from).length]);
for (const [name, from, to] of [["fractions", 1.9, 3.1], ["undefined", undefined, undefined], ["an end that is undefined", 1, undefined], ["null", null, null], ["strings", "1", "3"], ["NaN", NaN, NaN], ["infinities", -Infinity, Infinity], ["minus zero", -0, 2], ["booleans", true, false], ["large numbers", 1, 4294967297]])
  say("bounds that are " + name, () => [two(integers, from, to), one(integers, from)]);
say("bounds with valueOf, in order", () => { const order = []; const bound = (name, value) => ({ valueOf() { order.push(name); return value; } }); return [two(integers, bound("from", 1), bound("to", 4)), order]; });
say("a bound that shortens the array", () => { const array = [1, 2, 3, 4, 5]; return describe(two(array, 1, { valueOf() { array.length = 2; return 4; } })); });
say("a bound that is a symbol", () => two(integers, Symbol(), 1));
say("a bound that is a bigint", () => one(integers, 1n));
say("more arguments", () => three(integers, 1, 3, "ignored"));
say("a long array", () => [two(long, 10, 150).length, two(long, 10, 150)[139], two(long, 190, 500), one(long, 100).length, two(long, 0, 64).length, two(long, 0, 65).length]);
say("a sparse array", () => [describe(two(sparse, 0, 3)), two(sparse, 4999, 5002).length, Object.keys(one(sparse, 1)).join()]);
say("the part is a copy", () => { const array = [1, 2, 3]; const part = two(array, 0, 2); part[0] = "changed"; part.push("more"); array[1] = "later"; return [array, part]; });
say("the elements are shared", () => two(made, 2, 3)[0] === made[2]);
say("the part of a literal can be written", () => { const part = two([1, 2, 3, 4], 1, 3); part[0] = 0.5; part[1] = "x"; return part; });
say("empty arrays", () => [describe(two([], 0, 1)), describe(one([], 0)), describe(two(new Array(3), 0, 2)), describe(two(new Array(0), 0, 2))]);
say("a frozen array", () => { const part = two(Object.freeze([1, 2, 3]), 0, 2); part.push(9); return [part, Object.isFrozen(part)]; });
say("an array with a name on it", () => { const array = Object.assign([1, 2, 3], { extra: true }); return describe(two(array, 0, 2)); });

class Stack extends Array {}
say("a subclass", () => { const part = two(Stack.from([1, 2, 3]), 0, 2); return [part instanceof Stack, part.length, [...part]]; });
say("its own constructor", () => { const array = [1, 2, 3]; array.constructor = Stack; const part = two(array, 1, 3); return [part instanceof Stack, [...part]]; });
say("a constructor without a species", () => { const array = [1, 2, 3]; array.constructor = { [Symbol.species]: null }; return describe(two(array, 1, 3)); });
say("a constructor that is no object", () => { const array = [1, 2, 3]; array.constructor = 1; return two(array, 1, 3); });
say("another prototype", () => { const array = Object.setPrototypeOf([1, 2, 3], { slice: () => "mine" }); return two(array, 0, 1); });
say("an own slice", () => { const array = [1, 2, 3]; array.slice = function (from) { return "own " + from + " of " + this.length; }; return two(array, 1, 2); });
say("an accessor at an index", () => { const array = [1, 2, 3]; Object.defineProperty(array, 1, { get() { return "got"; }, enumerable: true, configurable: true }); return two(array, 0, 3); });

const slice = Array.prototype.slice;
say("called on what is like an array", () => describe(slice.call({ length: 3, 0: "a", 2: "c" }, 0, 3)));
say("called on arguments", () => (function () { return slice.call(arguments, 1, 3); })(1, 2, 3, 4));
say("called on a string", () => slice.call("hello", 1, 3));
say("called on a number", () => slice.call(5, 0, 1));
say("called on undefined", () => slice.call(undefined, 0, 1));
say("called on an array", () => [slice.call(integers, 1, 3), slice.apply(fractions, [1, 3]), Reflect.apply(slice, values, [0, 1])]);
say("held in a variable", () => { const held = integers.slice; return held.call(made, 7, 9); });
say("bound", () => slice.bind(integers)(4, 6));

say("strings at the same site", () => [two("hello world", 1, 4), one("hello", -2), none("whole"), two("", 0, 1), two("é漢字", 1, 2)]);
say("typed arrays at the same site", () => [Array.from(two(new Uint8Array([1, 2, 3, 4]), 1, 3)), two(new Float64Array([0.5, 1.5]), 0, 1) instanceof Float64Array]);
say("buffers at the same site", () => two(new ArrayBuffer(8), 2, 6).byteLength);
say("an object's own method at the same site", () => two({ slice: (from, to) => from + to }, 1, 2));
say("no method", () => two({}, 1, 2));
say("null", () => two(null, 1, 2));

console.log(lines.join("\n"));
