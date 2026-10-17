// Untyped on purpose. What the run time remembers about copying, spreading, leaving out, classes made again and again and constructor functions names shapes and functions that may die. After any mix of collections each of these must work as at first, for shapes made long ago, just now, and made again after they died.
const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? fullGC() : edenGC());
function churn(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += { a: i, b: "t" + i, c: [i] }.b.length;
  return sum;
}
function show(o) {
  let text = "";
  for (const key of Object.keys(o)) text += key + ":" + (typeof o[key] === "object" ? "o" : typeof o[key] === "function" ? "f" : o[key]) + " ";
  return text;
}
function source(round, i) {
  const o = { id: i, name: "n" + i };
  o["r" + (round % 4)] = round;
  if (i % 2) o.odd = true;
  if (i % 3 === 0) o["only" + round] = i;
  return o;
}
function spreadMore(o, extra) {
  return { ...o, extra, last: 1 };
}
function spreadTwo(a, b) {
  return { first: 0, ...a, ...b };
}
function without(o) {
  const { id, name, ...rest } = o;
  return rest;
}
function withoutComputed(o, key) {
  const { [key]: gone, ...rest } = o;
  return rest;
}
function assign(o) {
  return Object.assign({ base: 1 }, o, { tail: 2 });
}
function Point(x, y) {
  this.x = x;
  this.y = y;
  this.sum = x + y;
}
function Wide(n) {
  this.a = n;
  this.b = n;
  this.c = n;
  this.d = n;
  this.e = n;
  this.f = n;
  this.g = n;
  this.h = n;
  this.i = n;
}
function makeClass(round) {
  const parent = class {
    constructor() {
      this.fromParent = round;
    }
    hello() {
      return "p" + round;
    }
  };
  return class extends parent {
    field = round * 2;
    static made = round;
    constructor() {
      super();
      this.own = round + 1;
    }
    hello() {
      return super.hello() + "c";
    }
  };
}
function makeConstructor(round) {
  function Local(n) {
    this.n = n;
    this["k" + (round % 3)] = round;
    this.z = 1;
  }
  Local.prototype.twice = function () {
    return this.n * 2;
  };
  return Local;
}
let kept = [];
for (let round = 0; round < 22; round++) {
  let lengths = 0;
  const fresh = [];
  for (let i = 0; i < 60; i++) {
    const o = source(round, i);
    const results = [spreadMore(o, i), spreadTwo(o, source(round + 1, i + 1)), without(o), withoutComputed(o, i % 2 ? "name" : "r" + (round % 4)), assign(o), new Point(i, round), new Wide(i)];
    for (const result of results) lengths += show(result).length;
    if (i % 20 === 0) fresh.push(results);
  }
  const Made = makeClass(round);
  const instance = new Made();
  const Local = makeConstructor(round);
  const local = new Local(round);
  local.later = 1;
  console.log("round", round, lengths, show(instance), instance.hello(), Made.made, show(local), local.twice(), kept.length ? show(kept[0][round % 7]) : "");
  if (round % 5 === 0) kept = fresh;
  churn(3000);
  collect(round % 7 === 6);
  if (round % 2) collect(false);
}
collect(true);
collect(false);
for (const results of kept) for (const result of results) console.log(show(spreadMore(result, 0)), "|", show(without(result)));
