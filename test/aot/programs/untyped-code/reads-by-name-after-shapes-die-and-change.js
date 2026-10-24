// Reads by name of many shapes through a few functions: what was learned about a shape and a name must end when the shape dies and its place is taken by another,
// when a prototype gains or loses the name, when a property moves out of the object, and when an object becomes a dictionary and is flattened.
const collect = typeof Bun === "object" ? () => Bun.gc(true) : typeof gc === "function" ? gc : () => {};
function readAlpha(o) { return o.alpha; }
function readBeta(o) { return o.beta; }
function readGamma(o) { return o.gamma; }
function readDelta(o) { return o.delta; }
const readers = { alpha: readAlpha, beta: readBeta, gamma: readGamma, delta: readDelta };
const names = Object.keys(readers);
let wrong = 0, checked = 0;
function check(o, expected, what) {
  for (const name of names) {
    const got = readers[name](o);
    checked++;
    if (got !== expected[name]) { if (wrong++ < 10) console.log("WRONG", what, name, String(got), String(expected[name])); }
  }
}

// Shapes that die: each generation puts the four names at other places, in the object and out of line.
let seed = 12345;
const random = n => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) % n;
function generation(number) {
  const made = [];
  for (let i = 0; i < 200; i++) {
    const o = {}, expected = {};
    const padding = random(14);
    for (let k = 0; k < padding; k++) o["pad" + number + "_" + i + "_" + k] = k;
    for (const name of names) {
      if (random(4)) { o[name] = expected[name] = number * 1000 + i + name.length; }
      if (random(3) === 0) o["mid" + number + "_" + i + name] = 0;
    }
    made.push([o, expected]);
  }
  for (let round = 0; round < 3; round++) for (const [o, expected] of made) check(o, expected, "generation " + number);
}
for (let number = 0; number < 40; number++) { generation(number); if (number % 4 === 3) collect(); }
console.log("generations", checked, wrong);

// A name that is absent until a prototype has it.
class Base {}
class Derived extends Base { constructor() { super(); this.alpha = 1; } }
const derived = new Derived();
const repeat = (o, expected, what) => { for (let i = 0; i < 50; i++) check(o, expected, what); };
repeat(derived, { alpha: 1 }, "absent");
Base.prototype.beta = 2; repeat(derived, { alpha: 1, beta: 2 }, "on the far prototype");
Derived.prototype.beta = 3; repeat(derived, { alpha: 1, beta: 3 }, "on the near prototype");
delete Derived.prototype.beta; repeat(derived, { alpha: 1, beta: 2 }, "far again");
delete Base.prototype.beta; repeat(derived, { alpha: 1 }, "absent again");
const root = {};
Object.setPrototypeOf(Base.prototype, root); repeat(derived, { alpha: 1 }, "a root of its own");
root.gamma = 4; repeat(derived, { alpha: 1, gamma: 4 }, "on the root");
delete root.gamma; repeat(derived, { alpha: 1 }, "gone from the root");
for (let i = 0; i < 20; i++) root["filler" + i] = i;
root.gamma = 5; repeat(derived, { alpha: 1, gamma: 5 }, "out of line on the root");
for (let i = 20; i < 60; i++) root["filler" + i] = i;
repeat(derived, { alpha: 1, gamma: 5 }, "the root's storage has grown");
delete root.gamma; repeat(derived, { alpha: 1 }, "gone from the root again");
Object.defineProperty(Base.prototype, "delta", { get() { return this.alpha + 10; }, configurable: true }); repeat(derived, { alpha: 1, delta: 11 }, "a getter");
delete Base.prototype.delta; repeat(derived, { alpha: 1 }, "no getter");
Object.setPrototypeOf(Base.prototype, { beta: 5 }); repeat(derived, { alpha: 1, beta: 5 }, "another end of the chain");
Object.setPrototypeOf(Base.prototype, Object.prototype); repeat(derived, { alpha: 1 }, "the old end of the chain");
Object.setPrototypeOf(derived, { gamma: 6 }); repeat(derived, { alpha: 1, gamma: 6 }, "another prototype");

// One object through deletion, dictionary and flattening.
const bag = { alpha: 1, beta: 2, gamma: 3, delta: 4 };
repeat(bag, { alpha: 1, beta: 2, gamma: 3, delta: 4 }, "whole");
delete bag.beta; repeat(bag, { alpha: 1, gamma: 3, delta: 4 }, "one deleted");
for (let i = 0; i < 300; i++) bag["k" + i] = i;
repeat(bag, { alpha: 1, gamma: 3, delta: 4 }, "large");
for (let i = 0; i < 300; i++) delete bag["k" + i];
delete bag.alpha; bag.beta = 7; bag.alpha = 8;
repeat(bag, { alpha: 8, beta: 7, gamma: 3, delta: 4 }, "a dictionary");
const heir = Object.create(bag);
repeat(heir, { alpha: 8, beta: 7, gamma: 3, delta: 4 }, "its heir");
repeat(bag, { alpha: 8, beta: 7, gamma: 3, delta: 4 }, "flattened");
delete bag.gamma; bag.gamma = 9; repeat(bag, { alpha: 8, beta: 7, gamma: 9, delta: 4 }, "changed after flattening");
repeat(heir, { alpha: 8, beta: 7, gamma: 9, delta: 4 }, "its heir after that");
Object.defineProperty(bag, "delta", { get() { return 40; }, configurable: true }); repeat(bag, { alpha: 8, beta: 7, gamma: 9, delta: 40 }, "an own getter");
Object.defineProperty(bag, "delta", { value: 41, writable: true, configurable: true }); repeat(bag, { alpha: 8, beta: 7, gamma: 9, delta: 41 }, "a value again");

// Receivers that are no plain objects.
repeat("text", {}, "a string"); repeat(5, {}, "a number"); repeat(true, {}, "a boolean"); repeat(Symbol.iterator, {}, "a symbol"); repeat(10n, {}, "a bigint");
repeat([1, 2], {}, "an array"); repeat(() => 1, {}, "a function");
repeat(new Proxy({}, { get(target, key) { return key === "alpha" ? 1 : undefined; } }), { alpha: 1 }, "a proxy");
for (const nothing of [null, undefined]) { let threw = 0; for (const name of names) { try { readers[name](nothing); } catch (error) { if (error instanceof TypeError) threw++; } } console.log(String(nothing), threw); }
console.log("checked", checked, "wrong", wrong);
