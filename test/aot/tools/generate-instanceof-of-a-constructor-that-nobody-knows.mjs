// generate-instanceof-of-a-constructor-that-nobody-knows.mjs <folder>: all 501; ../parallel/instanceof-of-a-constructor-that-nobody-knows/ holds 9 of them: of each deed and each kind of constructor that answers wrongly where a remembered place outlives the slots it was copied from, where the place is filled though Symbol.hasInstance lies where a store can change it, or where a place outlives a collection, one program that does. `value instanceof Kind` with Kind a value that nobody knows: every kind of constructor, tested often enough that whatever remembers an answer has remembered it, then a deed that changes the answer.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const folder = process.argv[2];
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
let count = 0;
function write(name, text) { writeFileSync(`${folder}/${name}.mjs`, text); count++; }

const kinds = {
  "a-class": { says: `class Shelf { constructor(n) { this.n = n; } }\nclass Crate { constructor(n) { this.n = n; } }` },
  "a-class-with-static-members": { says: `class Shelf { static width = 3; static depth() { return 4; } constructor(n) { this.n = n; } }\nclass Crate { static height = 5; constructor(n) { this.n = n; } }` },
  "a-class-below-a-class": { says: `class Rack { constructor(n) { this.n = n; } }\nclass Shelf extends Rack { constructor(n) { super(n); this.m = n; } }\nclass Crate extends Rack { constructor(n) { super(n); this.k = n; } }`, above: "Rack" },
  "a-class-two-below-a-class": { says: `class Rack { constructor(n) { this.n = n; } }\nclass Frame extends Rack {}\nclass Shelf extends Frame { constructor(n) { super(n); this.m = n; } }\nclass Crate extends Frame {}`, above: "Rack" },
  "a-class-below-a-built-in": { says: `class Shelf extends Map { constructor(n) { super(); this.n = n; } }\nclass Crate extends Map {}` },
  "a-constructor-function": { says: `function Shelf(n) { this.n = n; }\nfunction Crate(n) { this.n = n; }` },
  "a-constructor-function-with-members": { says: `function Shelf(n) { this.n = n; }\nShelf.width = 3; Shelf.depth = function () { return 4; };\nfunction Crate(n) { this.n = n; }\nCrate.height = 5;` },
  "a-constructor-function-with-a-prototype-object-of-its-own": { says: `function Shelf(n) { this.n = n; }\nShelf.prototype = { kind() { return "shelf"; } };\nfunction Crate(n) { this.n = n; }\nCrate.prototype = {};` },
  "a-constructor-function-below-another": { says: `function Rack(n) { this.n = n; }\nfunction Shelf(n) { Rack.call(this, n); this.m = n; }\nObject.setPrototypeOf(Shelf, Rack);\nShelf.prototype = Object.create(Rack.prototype);\nfunction Crate(n) { Rack.call(this, n); }\nObject.setPrototypeOf(Crate, Rack);\nCrate.prototype = Object.create(Rack.prototype);`, above: "Rack" },
  "a-constructor-function-with-many-members-taken-off": { says: `function Shelf(n) { this.n = n; }\nfor (let i = 0; i < 80; i++) Shelf["member" + i] = i;\nfor (let i = 0; i < 80; i += 2) delete Shelf["member" + i];\nfunction Crate(n) { this.n = n; }` },
  "an-arrow-function-below-a-constructor-function": { says: `function Rack(n) { this.n = n; }\nconst Shelf = () => {};\nObject.setPrototypeOf(Shelf, Rack);\nfunction Crate(n) { this.n = n; }`, above: "Rack", makes: "new Rack(1)" },
  "a-method-below-a-class": { says: `class Rack { constructor(n) { this.n = n; } }\nconst Shelf = { shelf() {} }.shelf;\nObject.setPrototypeOf(Shelf, Rack);\nclass Crate { constructor(n) { this.n = n; } }`, above: "Rack", makes: "new Rack(1)" },
  "a-bound-function": { says: `function Rack(n) { this.n = n; }\nconst Shelf = Rack.bind(null);\nfunction Crate(n) { this.n = n; }`, target: "Rack" },
  "a-bound-class": { says: `class Rack { constructor(n) { this.n = n; } }\nconst Shelf = Rack.bind(null);\nclass Crate { constructor(n) { this.n = n; } }`, target: "Rack" },
  "a-proxy-of-a-class": { says: `class Rack { constructor(n) { this.n = n; } }\nconst Shelf = new Proxy(Rack, { get(target, key, receiver) { mark("get " + String(key)); return Reflect.get(target, key, receiver); } });\nclass Crate { constructor(n) { this.n = n; } }`, target: "Rack" },
  "a-proxy-without-traps-of-a-function": { says: `function Rack(n) { this.n = n; }\nconst Shelf = new Proxy(Rack, {});\nfunction Crate(n) { this.n = n; }`, target: "Rack" },
  "two-classes-out-of-one-maker": { says: `function make() { return class Made { constructor(n) { this.n = n; } }; }\nconst Shelf = make(), Crate = make();` },
  "two-functions-out-of-one-maker": { says: `function make() { return function Made(n) { this.n = n; }; }\nconst Shelf = make(), Crate = make();` },
  "a-generator-function": { says: `function* Shelf() {}\nfunction Crate(n) { this.n = n; }`, makes: "Shelf()" },
  "an-async-function": { says: `async function Shelf() {}\nfunction Crate(n) { this.n = n; }`, makes: "{}" },
};

const laid = `value(value) { mark("asked"); return value === 7; }, configurable: true`;
const deeds = {
  "nothing": () => ``,
  "has-instance-is-laid-on-it": () => `Object.defineProperty(pick(0), Symbol.hasInstance, { ${laid} });`,
  "has-instance-is-laid-on-it-and-taken-off": () => `Object.defineProperty(pick(0), Symbol.hasInstance, { ${laid} }); tell("between"); tell("between again"); delete pick(0)[Symbol.hasInstance];`,
  "has-instance-is-laid-above": kind => kind.above && `Object.defineProperty(${kind.above}, Symbol.hasInstance, { ${laid} });`,
  "has-instance-is-laid-above-and-taken-off": kind => kind.above && `Object.defineProperty(${kind.above}, Symbol.hasInstance, { ${laid} }); tell("between"); tell("between again"); delete ${kind.above}[Symbol.hasInstance];`,
  "has-instance-is-laid-on-the-target": kind => kind.target && `Object.defineProperty(${kind.target}, Symbol.hasInstance, { ${laid} });`,
  "a-getter-of-has-instance": () => `Object.defineProperty(pick(0), Symbol.hasInstance, { get() { mark("read"); return undefined; }, configurable: true });`,
  "has-instance-is-assigned": () => `try { pick(0)[Symbol.hasInstance] = () => true; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "has-instance-of-all-functions-is-assigned": () => `try { Function.prototype[Symbol.hasInstance] = () => true; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "has-instance-of-all-functions-is-defined": () => `try { Object.defineProperty(Function.prototype, Symbol.hasInstance, { value: () => true }); mark("defined"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-ordinary-has-instance-is-laid-on-it-and-then-stored-over": () => `Object.defineProperty(pick(0), Symbol.hasInstance, { value: Function.prototype[Symbol.hasInstance], writable: true, configurable: true }); tell("between"); tell("between again"); tell("between a third time"); pick(0)[Symbol.hasInstance] = function (value) { mark("asked"); return value === 7; };`,
  "the-ordinary-has-instance-is-laid-above-and-then-stored-over": kind => kind.above && `Object.defineProperty(${kind.above}, Symbol.hasInstance, { value: Function.prototype[Symbol.hasInstance], writable: true, configurable: true }); tell("between"); tell("between again"); tell("between a third time"); ${kind.above}[Symbol.hasInstance] = function (value) { mark("asked"); return value === 7; };`,
  "another-parent-with-has-instance": () => `const parent = function () {}; Object.defineProperty(parent, Symbol.hasInstance, { value() { mark("asked the parent"); return true; } }); Object.setPrototypeOf(pick(0), parent);`,
  "what-stands-above-gets-another-parent-with-has-instance": kind => kind.above && `const parent = function () {}; Object.defineProperty(parent, Symbol.hasInstance, { value() { mark("asked the parent"); return true; } }); Object.setPrototypeOf(${kind.above}, parent);`,
  "no-parent": () => `Object.setPrototypeOf(pick(0), null);`,
  "the-prototype-property-is-stored": () => `try { pick(0).prototype = { other: true }; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-is-stored-with-that-of-the-other": () => `try { pick(0).prototype = pick(1).prototype; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-is-no-object": () => `try { pick(0).prototype = 3; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-is-defined": () => `try { Object.defineProperty(pick(0), "prototype", { value: pick(1).prototype }); mark("defined"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-becomes-a-getter": () => `try { Object.defineProperty(pick(0), "prototype", { get() { mark("read prototype"); return pick(1).prototype; } }); mark("defined"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-above-is-stored": kind => kind.above && `try { ${kind.above}.prototype = pick(1).prototype; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-of-the-target-is-stored": kind => kind.target && `try { ${kind.target}.prototype = pick(1).prototype; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "it-gets-a-member": () => `pick(0).added = 1;`,
  "it-gets-a-member-and-loses-it": () => `pick(0).added = 1; tell("between"); tell("between again"); delete pick(0).added;`,
  "it-is-frozen": () => `Object.freeze(pick(0));`,
  "it-gets-many-members-and-then-has-instance": () => `for (let i = 0; i < 90; i++) pick(0)["late" + i] = i; for (let i = 0; i < 90; i += 3) delete pick(0)["late" + i]; tell("between"); tell("between again"); tell("between a third time"); Object.defineProperty(pick(0), Symbol.hasInstance, { ${laid} });`,
  "a-collection": () => `Bun.gc(true);`,
  "an-object-gets-another-prototype": () => `Object.setPrototypeOf(things[1], pick(1).prototype); Object.setPrototypeOf(things[2], Object.getPrototypeOf(things[3]));`,
  "an-object-gets-no-prototype": () => `Object.setPrototypeOf(things[1], null);`,
  "a-proxy-stands-above-an-object": () => `Object.setPrototypeOf(things[2], new Proxy({}, { getPrototypeOf() { mark("trap"); return Object.getPrototypeOf(things[3]); } }));`,
};

for (const [kindName, kind] of Object.entries(kinds))
  for (const [deedName, deed] of Object.entries(deeds)) {
    const does = deed(kind);
    if (does === undefined || does === null || does === false) continue;
    write(`${kindName}--${deedName}`, `const marks = []; function mark(text) { marks.push(text); }
${kind.says}
globalThis.kept = [Shelf, Crate];
function pick(index) { return globalThis.kept[index + (marks.length & 0)]; }
function count(list, Kind) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Kind) hits += 1 << i; return hits; }
function is(value, Kind) { return value instanceof Kind; }
const first = ${kind.makes ?? "new Shelf(1)"};
const things = [7, first, new Crate(2), Object.create(Object.getPrototypeOf(first)), { n: 3 }, null, undefined, "text", Shelf, Object.create(null), new Proxy(first, {}), function () {}];
function tell(when) {
  let told;
  try { told = count(things, pick(0)) + " " + count(things, pick(1)) + " " + is(things[1], pick(0)) + " " + is(things[2], pick(0)); } catch (error) { told = "threw " + error.constructor.name + ": " + error.message; }
  console.log(when, told, marks.splice(0).join(" . "));
}
tell("first"); tell("again"); tell("a third time");
${does}
tell("behind the deed"); tell("again"); tell("a third time");
`);
  }

const head = `const marks = []; function mark(text) { marks.push(text); }
function count(list, Kind) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Kind) hits += 1 << i; return hits; }
function say(when, does) { let told; try { told = does(); } catch (error) { told = "threw " + error.constructor.name + ": " + error.message; } console.log(when, told, marks.splice(0).join(" . ")); }
`;
const others = {
  "what-is-no-constructor": `${head}const things = [{}, 7, null, function () {}];
globalThis.kept = [{}, 7, null, undefined, "text", Symbol.iterator, 3n, [], Object.create(null), { prototype: {} }, { [Symbol.hasInstance]: value => value === 7 }, { [Symbol.hasInstance]: 4 }, Math, JSON];
for (let turn = 0; turn < 4; turn++)
  for (let i = 0; i < globalThis.kept.length; i++) say(turn + " " + i, () => count(things, globalThis.kept[i]));`,
  "more-constructors-than-any-table-holds": `${head}const kinds = [], things = [];
for (let i = 0; i < 300; i++) {
  const Kind = i % 3 === 0 ? class { static ["member" + i] = i; } : i % 3 === 1 ? function () {} : class extends (kinds[i - 2]) {};
  if (i % 3 === 1) Kind["member" + i] = i;
  kinds.push(Kind);
  if (i % 7 === 0) things.push(new Kind());
}
globalThis.kept = kinds;
for (let turn = 0; turn < 5; turn++) {
  let sum = 0;
  for (let i = 0; i < globalThis.kept.length; i++) sum = (sum * 31 + count(things, globalThis.kept[i])) % 1000003;
  console.log(turn, sum);
  if (turn === 2) for (let i = 0; i < kinds.length; i += 5) { if (i % 3 === 1) kinds[i].prototype = kinds[(i + 3) % 300].prototype; else Object.defineProperty(kinds[i], Symbol.hasInstance, { value: () => true }); }
  if (turn === 3) Bun.gc(true);
}`,
  "constructors-die-and-others-are-made": `${head}function round(seed) {
  const kinds = [];
  for (let i = 0; i < 40; i++) {
    const Kind = function () {};
    for (let j = 0; j <= (i + seed) % 5; j++) Kind["member" + seed + "x" + i + "x" + j] = j;
    if ((i + seed) % 2) Kind.prototype = { seed };
    kinds.push(Kind);
  }
  globalThis.kept = kinds;
  const things = kinds.map(Kind => new Kind());
  let sum = 0;
  for (let turn = 0; turn < 4; turn++) for (let i = 0; i < 40; i++) sum = (sum * 31 + count(things, globalThis.kept[i])) % 1000003;
  return sum;
}
for (let seed = 0; seed < 30; seed++) { console.log(seed, round(seed)); globalThis.kept = null; Bun.gc(true); }`,
  "built-ins": `${head}globalThis.kept = [Promise, Map, Set, Array, Error, TypeError, RegExp, Date, Object, Function, Uint8Array, ArrayBuffer, WeakMap, Symbol, Boolean, Number, String, Proxy, Blob, ReadableStream, Response, Request, URL, Headers, Buffer, AbortController, EventTarget];
const things = [Promise.resolve(1), new Map(), new Set(), [], new Error("x"), new TypeError("y"), /z/, new Date(0), {}, () => 1, new Uint8Array(2), new ArrayBuffer(2), new WeakMap(), Object(Symbol.iterator), Object(true), Object(1), Object("s"), new Blob(["x"]), new ReadableStream(), new Response("y"), new Request("http://localhost/"), new URL("http://localhost/"), new Headers(), Buffer.from("b"), new AbortController(), new EventTarget(), Object.create(Promise.prototype), Object.create(null), 4, null];
for (let turn = 0; turn < 4; turn++)
  for (let i = 0; i < globalThis.kept.length; i++) say(turn + " " + i, () => count(things, globalThis.kept[i]));`,
  "classes-of-the-library": `import Stream, { Readable, Writable, Duplex, Transform, PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
${head}globalThis.kept = [Stream, Readable, Writable, Duplex, Transform, PassThrough, EventEmitter, Readable.ReadableState, Writable.WritableState];
const readable = new Readable({ read() {} }), writable = new Writable({ write() {} });
const things = [readable, writable, new Duplex({ read() {}, write() {} }), new Transform(), new PassThrough(), new EventEmitter(), new Stream(), {}, null, Object.create(Readable.prototype), { _writableState: {} }, { _writableState: writable._writableState }, readable._readableState, writable._writableState];
for (let turn = 0; turn < 4; turn++)
  for (let i = 0; i < globalThis.kept.length; i++) say(turn + " " + i, () => count(things, globalThis.kept[i]));`,
  "has-instance-of-the-state-of-a-stream-is-laid-late": `import { Readable, Writable } from "node:stream";
let asked = 0;
const readable = new Readable({ read() {} });
const writable = new Writable({ write(chunk, encoding, callback) { callback(); } });
function tell(when) {
  const said = [];
  for (const [name, does] of [["readable", () => readable.readable], ["destroyed", () => readable.destroyed], ["flowing", () => readable.readableFlowing], ["writable", () => writable.writable], ["length", () => writable.writableLength], ["is", () => writable instanceof Writable], ["holder", () => ({ _writableState: writable._writableState }) instanceof Writable]]) { asked = 0; const value = does(); said.push(name + " " + value + " " + asked); }
  console.log(when, said.join(" . "));
}
tell("first"); tell("again"); tell("a third time");
for (const State of [Readable.ReadableState, Writable.WritableState])
  Object.defineProperty(State, Symbol.hasInstance, { configurable: true, value(value) { asked++; return Function.prototype[Symbol.hasInstance].call(this, value); } });
tell("behind the deed"); tell("again");
for (const State of [Readable.ReadableState, Writable.WritableState]) delete State[Symbol.hasInstance];
tell("taken off"); tell("again");`,
  "constructors-and-objects-of-another-realm": `import vm from "node:vm";
${head}const theirs = vm.runInNewContext("function Shelf(n) { this.n = n; } class Crate {} ; [Map, Error, Shelf, Crate, new Map(), new Error('x'), new Shelf(1), new Crate(), Function.prototype[Symbol.hasInstance]]");
globalThis.kept = [theirs[0], theirs[1], theirs[2], theirs[3], Map, Error];
const things = [theirs[4], theirs[5], theirs[6], theirs[7], new Map(), new Error("y"), {}, 7];
for (let turn = 0; turn < 4; turn++) {
  for (let i = 0; i < globalThis.kept.length; i++) say(turn + " " + i, () => count(things, globalThis.kept[i]));
  if (turn === 1) theirs[2].prototype = theirs[3].prototype;
  if (turn === 2) Object.defineProperty(theirs[3], Symbol.hasInstance, { value: value => value === 7 });
}
function Ledge() {}
Object.defineProperty(Ledge, Symbol.hasInstance, { value: theirs[8], writable: true });
globalThis.kept = [Ledge];
const more = [new Ledge(), {}, 7];
for (let turn = 0; turn < 4; turn++) { say("theirs on ours " + turn, () => count(more, globalThis.kept[0])); if (turn === 2) Ledge[Symbol.hasInstance] = value => value === 7; }`,
  "one-structure-and-many-function-objects": `${head}function make(n) { const Made = function () {}; if (n % 2) Made.prototype = { n }; return Made; }
const kinds = []; for (let i = 0; i < 12; i++) kinds.push(make(i));
globalThis.kept = kinds;
const things = kinds.map(Kind => new Kind());
for (let turn = 0; turn < 4; turn++) {
  console.log(turn, globalThis.kept.map(Kind => count(things, Kind)).join(" "));
  if (turn === 1) kinds[4].prototype = kinds[5].prototype;
  if (turn === 2) kinds[6].prototype = "no object";
  if (turn === 2) try { count(things, globalThis.kept[6]); } catch (error) { console.log(error.constructor.name, error.message); kinds[6].prototype = {}; }
}`,
};
for (const [name, text] of Object.entries(others)) write(name, text + "\n");
console.log(count + " programs");
