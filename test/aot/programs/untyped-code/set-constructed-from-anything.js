// `new Set(x)`: arrays of every kind, other iterables, what is not iterable, and what can be observed of the construction.
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
function make(items) {
  return new Set(items);
}
const show = set => [set instanceof Set, set.size, [...set]];

const object = { id: 1 };
const long = Array.from({ length: 500 }, (_, i) => i % 300);
const sparse = [];
sparse[2000] = "far";
for (let turn = 0; turn < 3; turn++) {
  say("strings " + turn, () => show(make(["http:", "https:", "mailto:", "tel:"])));
  say("integers " + turn, () => show(make([3, 1, 2, 3, 1, turn])));
  say("fractions " + turn, () => show(make([0.5, 1.5, 0.5, turn + 0.25])));
  say("mixed " + turn, () => show(make(["a", 1, "1", 1.0, null, undefined, null, true, object, object, { id: 1 }])));
  say("empty " + turn, () => show(make([])));
}
say("zeros and NaN", () => { const set = make([0, -0, NaN, NaN, 0 / 1]); return [set.size, Object.is([...set][0], 0), set.has(-0), set.has(NaN)]; });
say("holes", () => show(make([1, , 3, , undefined])));
say("holes among fractions", () => show(make([0.5, , 1.5])));
say("only holes", () => show(make(new Array(4))));
say("a long array", () => { const set = make(long); return [set.size, set.has(299), set.has(300), [...set].slice(-2)]; });
say("a sparse array", () => { const set = make(sparse); return [set.size, set.has("far"), set.has(undefined)]; });
say("ropes and parts of strings", () => { const left = "ab" + lines.length; return show(make([left + "c", (left + "cd").slice(0, -1), "x" + left])).slice(1, 2); });
say("big integers and symbols", () => { const symbol = Symbol("s"); const set = make([1n, 1n, 2n ** 70n, 2n ** 70n, symbol, symbol, Symbol("s")]); return set.size; });
say("the order of insertion", () => [...make(["b", "a", "c", "a", "b", "d"])]);
say("the array is not kept", () => { const array = [1, 2]; const set = make(array); array.push(3); set.add(4); return [array, [...set]]; });
say("a frozen array", () => show(make(Object.freeze([1, 2, 2]))));
say("an array with a name on it", () => show(make(Object.assign([1, 2], { extra: 3 }))));

say("nothing", () => [show(new Set()), show(make(undefined)), show(make(null))]);
say("more arguments", () => show(new Set([1, 2], [3, 4])));
say("a string", () => show(make("hello")));
say("a set", () => { const first = make([1, 2]); const second = make(first); second.add(3); return [show(first), show(second)]; });
say("a map", () => show(make(new Map([["a", 1]]))));
say("the keys of a map", () => show(make(new Map([["a", 1], ["b", 2]]).keys())));
say("a typed array", () => show(make(new Uint8Array([1, 2, 1]))));
say("arguments", () => (function () { return show(make(arguments)); })(1, 1, 2));
say("a generator", () => show(make((function* () { yield 1; yield 1; yield 2; })())));
say("an iterable of my own", () => { let left = 3; return show(make({ [Symbol.iterator]() { return { next: () => ({ done: left === 0, value: left-- }) }; } })); });
for (const [name, value] of Object.entries({ "a number": 5, "true": true, "an object": {}, "a function": () => {}, "what is like an array": { length: 2, 0: "a", 1: "b" } })) say(name, () => show(make(value)));
say("a symbol", () => make(Symbol("s")));

class Stack extends Array {}
say("a subclass of Array", () => show(make(Stack.from([1, 1, 2]))));
say("a subclass with an iterator of its own", () => { class Odd extends Array { *[Symbol.iterator]() { yield "odd"; } } return show(make(Odd.from([1, 2]))); });
say("an array with an iterator of its own", () => { const array = [1, 2]; array[Symbol.iterator] = function* () { yield "own"; }; return show(make(array)); });
say("an array under another prototype", () => { const array = Object.setPrototypeOf([1, 2], { [Symbol.iterator]: function* () { yield "other"; } }); return show(make(array)); });
say("an array that is not iterable", () => make(Object.setPrototypeOf([1, 2], null)));
say("an accessor at an index", () => { const order = []; const array = [1, 2, 3]; Object.defineProperty(array, 1, { get() { order.push("read"); array.length = 2; return "got"; } }); return [show(make(array)), order]; });
say("a proxy of an array", () => { const asked = []; const set = make(new Proxy([1, 2], { get(target, key, receiver) { asked.push(String(key)); return Reflect.get(target, key, receiver); } })); return [show(set), asked]; });

class Counted extends Set {
  constructor(items) {
    super(items);
    this.made = true;
  }
  add(item) {
    Counted.added.push(item);
    return super.add(item);
  }
}
Counted.added = [];
say("a subclass of Set with an add of its own", () => { const set = new Counted([1, 2, 2]); return [set.made, set.size, Counted.added, set instanceof Counted]; });
say("Reflect.construct", () => { const set = Reflect.construct(Set, [[1, 2]], Counted); return [set instanceof Counted, set.size, Counted.added.length]; });
say("called without new", () => Set([1]));
say("held in a variable", () => { const Held = Set; return show(new Held([1, 1, 2])); });

console.log(lines.join("\n"));
