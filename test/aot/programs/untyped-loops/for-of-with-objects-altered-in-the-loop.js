// A loop over an iterable reads an object that does not change from turn to turn, until something in the loop alters the object, the array or the iteration itself.
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const lines = [];

function weighted(list, scale) {
  let sum = 0;
  for (const item of list) sum += item * scale.k;
  return sum;
}

function weightedWithHook(list, scale, hook) {
  let sum = 0;
  for (const item of list) {
    sum += item * scale.k;
    if (item === 3) hook(list, scale);
    sum += scale.k;
  }
  return sum;
}

function nested(rows, scale) {
  let sum = 0;
  for (const row of rows) {
    sum += scale.k;
    for (const cell of row.cells) sum += cell * scale.k + row.bias;
  }
  return sum;
}

function overValues(map, scale) {
  let sum = 0;
  for (const value of map.values()) sum += value * scale.k;
  return sum;
}

function pairs(list, scale) {
  let sum = 0;
  for (const [left, right] of list) sum += (left + right) * scale.k;
  return sum;
}

function spreadInLoop(lists, scale) {
  const all = [];
  for (const list of lists) {
    all.push(...list);
    all.push(scale.k);
  }
  return all.join();
}

const numbers = () => unknown([1, 2, 3, 4, 5]);
const scaleOf = k => unknown({ k });

for (let warm = 0; warm < 50; warm++) {
  weighted(numbers(), scaleOf(2));
  weightedWithHook(numbers(), scaleOf(2), () => {});
  nested(unknown([{ cells: [1, 2], bias: 1 }, { cells: [3], bias: 2 }]), scaleOf(2));
  overValues(unknown(new Map([["a", 1], ["b", 2]])), scaleOf(2));
  pairs(unknown([[1, 2], [3, 4]]), scaleOf(2));
  spreadInLoop(unknown([[1], [2, 3]]), scaleOf(2));
}

lines.push("as made: " + weighted(numbers(), scaleOf(2)));
lines.push("another layout: " + weighted(numbers(), unknown({ j: 1, k: 3 })));
lines.push("an inherited name: " + weighted(numbers(), unknown(Object.create({ k: 4 }))));
lines.push("a getter: " + weighted(numbers(), unknown({ get k() { return 5; } })));
lines.push("no such name: " + weighted(numbers(), unknown({})));
lines.push("a string: " + weighted(numbers(), unknown({ k: "6" })));
lines.push("a proxy: " + weighted(numbers(), unknown(new Proxy({}, { get: () => 7 }))));
for (const nothing of [undefined, null]) {
  let answer;
  try { answer = weighted(numbers(), unknown(nothing)); } catch (error) { answer = error.constructor.name; }
  lines.push("scale " + nothing + ": " + answer);
  lines.push("scale " + nothing + ", nothing to walk: " + weighted(unknown([]), unknown(nothing)));
}

const hooks = {
  "stores another number": (list, scale) => { scale.k = 10; },
  "stores a string": (list, scale) => { scale.k = "x"; },
  "deletes the name": (list, scale) => { delete scale.k; },
  "plants a getter": (list, scale) => { let reads = 0; Object.defineProperty(scale, "k", { get: () => ++reads, configurable: true }); },
  "adds a name": (list, scale) => { scale.other = 1; },
  "freezes": (list, scale) => { Object.freeze(scale); },
  "gives another prototype": (list, scale) => { delete scale.k; Object.setPrototypeOf(scale, { k: 100 }); },
  "appends": (list, scale) => { if (list.length < 8) list.push(3); },
  "shortens": (list, scale) => { list.length = 3; },
  "makes a hole": (list, scale) => { delete list[3]; },
  "stores a fraction": (list, scale) => { list[4] = 0.5; },
  "stores an object": (list, scale) => { list[4] = { valueOf: () => 9 }; },
  "stores far outside": (list, scale) => { list[40] = 1; list.length = 6; },
  "plants an index getter": (list, scale) => { Object.defineProperty(list, 4, { get: () => 11 }); },
  "replaces the iterator method": (list, scale) => { list[Symbol.iterator] = function* () { yield 1000; }; },
  "gives the array another prototype": (list, scale) => { Object.setPrototypeOf(list, { __proto__: Array.prototype, 3: 77 }); delete list[3]; },
  "throws": () => { throw new RangeError("stop"); },
};
for (const [name, hook] of Object.entries(hooks)) {
  const list = numbers(), scale = scaleOf(2);
  let answer;
  try { answer = weightedWithHook(list, scale, unknown(hook)); } catch (error) { answer = error.constructor.name + " " + error.message; }
  lines.push(name + ": " + answer + " | " + JSON.stringify(list) + " | " + JSON.stringify(scale));
}

function* generated() { yield 1; yield 2; yield 3; yield 4; }
const closed = [];
const byHand = {
  [Symbol.iterator]() {
    let turn = 0;
    return { next: () => ({ done: ++turn > 4, value: turn }), return() { closed.push(turn); return {}; } };
  },
};
lines.push("a generator: " + weighted(unknown(generated()), scaleOf(2)));
lines.push("an iterator by hand: " + weighted(unknown(byHand), scaleOf(2)));
try { weightedWithHook(unknown(byHand), scaleOf(2), hooks.throws); } catch (error) { lines.push("closed at " + closed.join() + " by " + error.message); }
lines.push("a string: " + weighted(unknown("123"), scaleOf(2)));
lines.push("a typed array: " + weighted(unknown(new Float64Array([0.5, 1.5])), scaleOf(2)));
lines.push("a set: " + weighted(unknown(new Set([1, 1, 2])), scaleOf(2)));
class Sublist extends Array { *[Symbol.iterator]() { yield 50; } }
lines.push("a subclass with its own iterator: " + weighted(unknown(Sublist.from([1, 2])), scaleOf(2)));
for (const notIterable of [undefined, null, 1, {}]) {
  let answer;
  try { answer = weighted(unknown(notIterable), scaleOf(2)); } catch (error) { answer = error.constructor.name; }
  lines.push("walking " + String(notIterable) + ": " + answer);
}

const rows = unknown([{ cells: [1, 2], bias: 1 }, { cells: new Set([3]), bias: 2 }, { cells: "45", bias: 3 }, { bias: 4, cells: [6] }]);
lines.push("nested: " + nested(rows, scaleOf(2)));
lines.push("nested, a getter that alters the scale: " + (() => {
  const scale = scaleOf(2);
  return nested(unknown([{ cells: [1], bias: 0 }, { get cells() { scale.k = 3; return [1]; }, bias: 0 }, { cells: [1], bias: 0 }]), scale);
})());

const map = unknown(new Map([["a", 1], ["b", 2]]));
lines.push("values of a map: " + overValues(map, scaleOf(2)));
lines.push("values of an array: " + overValues(unknown([1, 2, 3]), scaleOf(2)));
lines.push("values of an object with the method: " + overValues(unknown({ values: () => [4] }), scaleOf(2)));
map.values = () => [5];
lines.push("values of a map with its own method: " + overValues(map, scaleOf(2)));

lines.push("pairs: " + pairs(unknown([[1, 2], [3, 4]]), scaleOf(2)));
lines.push("pairs of strings and sets: " + pairs(unknown(["12", new Set([1, 2]), [1]]), scaleOf(2)));
lines.push("spread: " + spreadInLoop(unknown([[1], "23", new Set([4])]), scaleOf(2)));

console.log(lines.join("\n"));
