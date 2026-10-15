const lines = [];
function say(label, value) {
  lines.push(label + ": " + (typeof value === "function" ? "function " + value.name : typeof value === "symbol" ? value.toString() : JSON.stringify(value) ?? String(value)));
}

function readAlpha(o) { return o.alpha; }
function readBeta(o) { return o.beta; }
function readGamma(o) { return o.gamma; }
function readThree(o) { return [o.alpha, o.beta, o.gamma]; }
function readMethod(o) { return o.describe; }
function readToString(o) { return o.toString; }
function readConstructor(o) { return o.constructor; }
function readSize(o) { return o.size; }
function tryRead(read, o) {
  try {
    return read(o);
  } catch (error) {
    return error.constructor.name;
  }
}

// The same names at every place of the object.
{
  const shapes = [];
  for (let before = 0; before < 12; before++) {
    const o = {};
    for (let i = 0; i < before; i++) o["pad" + i] = i;
    o.alpha = "a" + before;
    o.beta = "b" + before;
    if (before % 3) o.gamma = "c" + before;
    shapes.push(o);
  }
  for (let round = 0; round < 3; round++) for (const o of shapes) say("place " + round, readThree(o));
}

// Properties that lie outside the object.
{
  const wide = {};
  for (let i = 0; i < 90; i++) wide["w" + i] = i;
  wide.alpha = 1;
  wide.beta = 2;
  for (let round = 0; round < 3; round++) say("wide", readThree(wide));
  wide.gamma = 3;
  say("wide grown", readThree(wide));
}

// Absent, then added to the object, to its prototype, to Object.create's argument.
{
  const parent = { describe() { return "parent"; } };
  const child = Object.create(parent);
  child.alpha = 1;
  for (let round = 0; round < 4; round++) say("inherits", [readAlpha(child), readBeta(child), readMethod(child)?.name]);
  parent.beta = "from parent";
  for (let round = 0; round < 3; round++) say("parent grew", [readAlpha(child), readBeta(child)]);
  child.beta = "own";
  say("child shadows", readBeta(child));
  delete child.beta;
  say("child no longer shadows", readBeta(child));
  delete parent.beta;
  for (let round = 0; round < 3; round++) say("parent shrank", String(readBeta(child)));
  parent.describe = function other() { return "other"; };
  say("method replaced", readMethod(child).name);
  const grandparent = { gamma: "from grandparent" };
  for (let round = 0; round < 3; round++) say("before the chain grows", String(readGamma(child)));
  Object.setPrototypeOf(parent, grandparent);
  for (let round = 0; round < 3; round++) say("after the chain grew", readGamma(child));
  Object.setPrototypeOf(child, null);
  say("without a prototype", [String(readGamma(child)), String(readMethod(child)), readAlpha(child)]);
}

// A data property becomes an accessor and back, is frozen, is deleted and added again elsewhere.
{
  const o = { alpha: 1, beta: 2, gamma: 3 };
  for (let round = 0; round < 3; round++) say("data", readThree(o));
  let reads = 0;
  Object.defineProperty(o, "beta", { get() { return "got " + ++reads; }, configurable: true, enumerable: true });
  for (let round = 0; round < 3; round++) say("accessor", readThree(o));
  Object.defineProperty(o, "beta", { value: "again", writable: true, configurable: true, enumerable: true });
  for (let round = 0; round < 3; round++) say("data again", readThree(o));
  Object.freeze(o);
  for (let round = 0; round < 3; round++) say("frozen", readThree(o));
  const p = { alpha: 1, beta: 2, gamma: 3 };
  say("whole", readThree(p));
  delete p.alpha;
  say("alpha deleted", readThree(p));
  p.alpha = "back";
  say("alpha back", readThree(p));
  delete p.gamma;
  delete p.beta;
  p.gamma = "g";
  say("shuffled", readThree(p));
}

// Objects used as dictionaries.
{
  const d = {};
  for (let i = 0; i < 300; i++) d["k" + i] = i;
  d.alpha = "in a dictionary";
  for (let round = 0; round < 3; round++) say("dictionary", readThree(d));
  for (let i = 0; i < 300; i += 2) delete d["k" + i];
  d.beta = "added after deletes";
  for (let round = 0; round < 3; round++) say("dictionary with holes", readThree(d));
  delete d.alpha;
  say("dictionary lost alpha", readThree(d));
  d.gamma = 1;
  d.alpha = 2;
  say("dictionary refilled", readThree(d));
}

// What JSON.parse, spread, Object.assign, Object.fromEntries and classes make.
{
  class Point {
    constructor(alpha, beta) { this.alpha = alpha; this.beta = beta; }
    describe() { return "point"; }
    get gamma() { return this.alpha + this.beta; }
  }
  class Point3 extends Point {
    constructor() { super(1, 2); this.delta = 3; }
    describe() { return "point3"; }
  }
  const made = [
    JSON.parse('{"alpha":1,"beta":[2],"gamma":{"alpha":3}}'),
    JSON.parse('{"gamma":1,"alpha":2}'),
    { ...{ beta: 1 }, alpha: 2 },
    Object.assign({}, { gamma: 7 }, { beta: 8 }),
    Object.fromEntries([["alpha", "x"], ["gamma", "y"]]),
    new Point(10, 20),
    new Point3(),
    Object.create(null),
    Object.assign(Object.create(null), { beta: "bare" }),
  ];
  for (let round = 0; round < 3; round++) for (const o of made) say("made", [readThree(o), readMethod(o)?.name, readToString(o)?.name, readConstructor(o)?.name]);
}

// Receivers that are not plain objects.
{
  function named() {}
  named.alpha = "on a function";
  const list = [1, 2, 3];
  list.beta = "on an array";
  const boxed = new String("boxed");
  boxed.gamma = "on a String object";
  const map = new Map([[1, 2]]);
  const proxy = new Proxy({ alpha: "target" }, { get(target, key) { return key === "beta" ? "trapped" : target[key]; } });
  const receivers = [named, list, boxed, "text", 12, 1.5, true, 10n, Symbol("s"), map, new Set([1, 2]), /x/g, new Date(0), proxy, () => 1, new Uint8Array(4), new Error("e"), Promise.resolve(1), globalThis.Math];
  for (let round = 0; round < 3; round++) {
    for (const o of receivers) say("receiver", [tryRead(readThree, o), readToString(o)?.name, readConstructor(o)?.name, tryRead(readSize, o)]);
  }
  for (const o of [undefined, null]) say("nothing", [tryRead(readAlpha, o), tryRead(readThree, o)]);
}

// A prototype shared by many shapes changes under all of them.
{
  const shared = { describe() { return 1; } };
  const heirs = [];
  for (let i = 0; i < 20; i++) {
    const heir = Object.create(shared);
    for (let k = 0; k <= i; k++) heir["own" + k] = k;
    heirs.push(heir);
  }
  const names = () => heirs.map(heir => String(readMethod(heir)?.name) + "/" + String(readAlpha(heir))).join(" ");
  say("heirs", names());
  say("heirs", names());
  shared.alpha = "late";
  say("heirs after alpha", names());
  Object.defineProperty(shared, "alpha", { get() { return "computed"; }, configurable: true });
  say("heirs after accessor", names());
  delete shared.alpha;
  delete shared.describe;
  say("heirs after deletes", names());
  heirs[3].describe = function mine() {};
  heirs[7].alpha = 7;
  say("heirs with their own", names());
}

// One object read by many names, and many short-lived shapes.
{
  const many = {};
  for (let i = 0; i < 40; i++) many["n" + i] = i;
  const sum = o =>
    o.n0 + o.n1 + o.n2 + o.n3 + o.n4 + o.n5 + o.n6 + o.n7 + o.n8 + o.n9 + o.n10 + o.n11 + o.n12 + o.n13 + o.n14 + o.n15 + o.n16 + o.n17 + o.n18 + o.n19 +
    o.n20 + o.n21 + o.n22 + o.n23 + o.n24 + o.n25 + o.n26 + o.n27 + o.n28 + o.n29 + o.n30 + o.n31 + o.n32 + o.n33 + o.n34 + o.n35 + o.n36 + o.n37 + o.n38 + o.n39;
  say("many names", [sum(many), sum(many), sum({ ...many, n39: 1000 })]);
  let total = 0;
  for (let i = 0; i < 20000; i++) {
    const o = {};
    o["unique" + i] = i;
    o.alpha = i;
    if (i & 1) o.beta = 1;
    total += readAlpha(o) + (readBeta(o) ?? 0) + (readGamma(o) ?? 0);
    if (i % 5000 === 0) gc();
  }
  say("short-lived shapes", total);
}

console.log(lines.join("\n"));
