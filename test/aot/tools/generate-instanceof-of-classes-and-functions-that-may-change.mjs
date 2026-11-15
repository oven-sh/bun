// generate-instanceof-of-classes-and-functions-that-may-change.mjs <folder>: all 1,173; ../parallel/instanceof-of-classes-and-functions-that-may-change/ holds 18 of them: of each kind of constructor, each deed, each place and each time that answers wrongly where the guard of Symbol.hasInstance is not asked, one program that does, and the one that stopped a build; of the tests that stand outside every loop (in a function that is called out of sight, so that nobody copies it into one), five more of those and five that answer wrongly where an object that misses the shape is called no instance. `value instanceof C`, with C a class or a constructor function that code out of sight may change, and every deed that changes the answer.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const folder = process.argv[2];
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
let count = 0;
function write(name, text) { writeFileSync(`${folder}/${name}.mjs`, text); count++; }

const kinds = {
  "a-class": `class Shelf { constructor(n) { this.n = n; } }\nclass Crate { constructor(n) { this.n = n; } }`,
  "a-class-below-a-class": `class Rack { constructor(n) { this.n = n; } }\nclass Shelf extends Rack { constructor(n) { super(n); this.m = n; } }\nclass Crate extends Rack { constructor(n) { super(n); this.k = n; } }`,
  "a-function": `function Shelf(n) { this.n = n; }\nfunction Crate(n) { this.n = n; }`,
  "a-function-with-its-own-prototype": `function Shelf(n) { this.n = n; }\nShelf.prototype = { kind() { return "shelf"; } };\nfunction Crate(n) { this.n = n; }\nCrate.prototype = {};`,
  "a-function-below-another": `function Rack(n) { this.n = n; }\nfunction Shelf(n) { Rack.call(this, n); this.m = n; }\nObject.setPrototypeOf(Shelf, Rack);\nShelf.prototype = Object.create(Rack.prototype);\nfunction Crate(n) { Rack.call(this, n); }\nObject.setPrototypeOf(Crate, Rack);\nCrate.prototype = Object.create(Rack.prototype);`,
};
const hasRack = kind => kind.includes("below");
const sights = {
  "in-sight": ``,
  "handed-out-of-sight": `globalThis.kept = [Shelf, Crate]; JSON.stringify(globalThis.kept);`,
};
const deeds = {
  "nothing": ``,
  "has-instance-is-laid-on-it": `Object.defineProperty(pick(Shelf), Symbol.hasInstance, { value(value) { mark("asked"); return value === 7; }, configurable: true });`,
  "has-instance-is-laid-and-taken-off": `Object.defineProperty(pick(Shelf), Symbol.hasInstance, { value() { return true; }, configurable: true }); tell("between"); delete pick(Shelf)[Symbol.hasInstance];`,
  "has-instance-is-laid-on-what-stands-above": `Object.defineProperty(Object.getPrototypeOf(pick(Shelf)) === Function.prototype ? pick(Shelf) : Object.getPrototypeOf(pick(Shelf)), Symbol.hasInstance, { value() { mark("asked above"); return false; }, configurable: true });`,
  "a-getter-has-instance": `Object.defineProperty(pick(Shelf), Symbol.hasInstance, { get() { mark("read"); return undefined; }, configurable: true });`,
  "another-parent-with-has-instance": `const parent = function () {}; Object.defineProperty(parent, Symbol.hasInstance, { value() { mark("asked the parent"); return true; } }); Object.setPrototypeOf(pick(Shelf), parent);`,
  "no-parent": `Object.setPrototypeOf(pick(Shelf), null);`,
  "the-prototype-property-is-stored": `try { pick(Shelf).prototype = { other: true }; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-is-stored-with-that-of-the-other": `try { pick(Shelf).prototype = pick(Crate).prototype; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "the-prototype-property-is-no-object": `try { pick(Shelf).prototype = 3; mark("stored"); } catch (error) { mark("refused " + error.constructor.name); }`,
  "an-object-gets-another-prototype": `Object.setPrototypeOf(things[1], pick(Crate).prototype); Object.setPrototypeOf(things[2], pick(Shelf).prototype);`,
  "an-object-gets-no-prototype": `Object.setPrototypeOf(things[1], null);`,
  "the-prototype-object-gets-another-parent": `Object.setPrototypeOf(pick(Crate).prototype, pick(Shelf).prototype);`,
  "the-prototype-object-gets-no-parent": `Object.setPrototypeOf(pick(Shelf).prototype, null);`,
  "a-proxy-stands-above-an-object": `Object.setPrototypeOf(things[2], new Proxy({}, { getPrototypeOf() { mark("trap"); return pick(Shelf).prototype; } }));`,
};
const places = {
  "in-a-loop": `function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Shelf) hits += 1 << i; return hits; }`,
  "outside-loops": `function is(value) { return value instanceof Shelf; }\nfunction count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (is(list[i])) hits += 1 << i; return hits; }`,
  "in-an-unseen-function": `function is(value) { return value instanceof Shelf; }\nglobalThis.asked = is;\nfunction count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (globalThis.asked(list[i])) hits += 1 << i; return hits; }`,
  "with-the-values-known": `function count(list) { let hits = 0; const a = new Shelf(1), b = new Crate(2); if (a instanceof Shelf) hits += 1; if (b instanceof Shelf) hits += 2; for (let i = 0; i < list.length; i++) if (list[i] instanceof Shelf) hits += 4 << i; return hits; }`,
};
const times = {
  "between-the-tests": deed => `tell("first"); tell("again"); ${deed} tell("behind the deed"); tell("again");`,
  "ahead-of-every-test": deed => `${deed} tell("behind the deed"); tell("again");`,
};
for (const [kind, classes] of Object.entries(kinds))
  for (const [sight, hands] of Object.entries(sights))
    for (const [deed, does] of Object.entries(deeds))
      for (const [place, counts] of Object.entries(places))
        for (const [time, order] of Object.entries(times)) {
          if (deed === "nothing" && time !== "between-the-tests") continue;
          write(`${kind}--${sight}--${deed}--${place}--${time}`, `const marks = []; function mark(text) { marks.push(text); }
${classes}
${hands}
function pick(what) { return [what][marks.length & 0]; }
${counts}
const things = [7, new Shelf(1), new Crate(2), Object.create(Shelf.prototype), { n: 3 }, null, undefined, "text", Shelf, Object.create(null), new Proxy(new Shelf(4), {}), function () {}${hasRack(kind) ? ", new Rack(5)" : ""}];
function tell(when) { let told; try { told = count(things); } catch (error) { told = "threw " + error.constructor.name; } console.log(when, told, marks.splice(0).join(" . ")); }
${order(does)}
`);
        }

const others = {
  "a-class-made-twice": `function make() { return class Shelf { constructor(n) { this.n = n; } }; }
const First = make(), Second = make();
function count(list, Kind) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Kind) hits += 1 << i; return hits; }
const things = [new First(1), new Second(2), Object.create(First.prototype)];
console.log(count(things, First), count(things, Second));`,
  "a-function-made-twice": `function make() { return function Shelf(n) { this.n = n; }; }
const First = make(), Second = make();
function count(list, Kind) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Kind) hits += 1 << i; return hits; }
const things = [new First(1), new Second(2), Object.create(First.prototype)];
console.log(count(things, First), count(things, Second));`,
  "a-bound-function": `class Shelf { constructor(n) { this.n = n; } }
globalThis.kept = Shelf;
const Bound = Shelf.bind(null);
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Bound) hits += 1 << i; return hits; }
console.log(count([new Shelf(1), {}, new Bound(2)]));`,
  "tested-before-its-prototype-object-is-laid": `function Shelf(n) { this.n = n; }
globalThis.kept = Shelf;
function is(value) { return value instanceof Shelf; }
const early = Object.create(Shelf.prototype);
console.log(is(early), is({}));
Shelf.prototype = { later: true };
const late = new Shelf(1);
console.log(is(early), is(late), is({}));
console.log(is(early), is(late), is({}));`,
  "tested-before-the-class-is-made": `function is(value) { return value instanceof Shelf; }
try { is({}); } catch (error) { console.log(error.constructor.name); }
class Shelf {}
globalThis.kept = Shelf;
console.log(is(new Shelf()), is({}));`,
  "a-static-has-instance-is-written": `class Even { static [Symbol.hasInstance](value) { return value % 2 === 0; } }
class Below extends Even {}
globalThis.kept = [Even, Below];
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) { if (list[i] instanceof Even) hits += 1 << i; if (list[i] instanceof Below) hits += 256 << i; } return hits; }
console.log(count([1, 2, 3, 4, new Even(), new Below()]));`,
  "a-static-member-under-a-computed-key": `const key = [Symbol.hasInstance][0];
class Odd { static [key](value) { return value % 2 === 1; } }
globalThis.kept = Odd;
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Odd) hits += 1 << i; return hits; }
console.log(count([1, 2, 3, 4, new Odd()]));`,
  "a-static-field-under-a-computed-key": `const key = [Symbol.hasInstance][0];
class Odd { static [key] = value => value % 2 === 1; }
globalThis.kept = Odd;
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Odd) hits += 1 << i; return hits; }
console.log(count([1, 2, 3, 4, new Odd()]));`,
  "a-statement-lays-has-instance-on-a-function": `function Odd() {}
Object.defineProperty(Odd, Symbol.hasInstance, { value: value => value % 2 === 1 });
globalThis.kept = Odd;
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Odd) hits += 1 << i; return hits; }
console.log(count([1, 2, 3, 4, new Odd()]));`,
  "a-class-below-a-built-in": `class Lines extends Array {}
class Failure extends Error {}
globalThis.kept = [Lines, Failure];
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) { const thing = list[i]; if (thing instanceof Lines) hits += 1 << i; if (thing instanceof Failure) hits += 256 << i; if (thing instanceof Array) hits += 65536 << i; if (thing instanceof Error) hits += 16777216 << i; } return hits; }
console.log(count([new Lines(), [], new Failure("x"), new Error("y"), {}, Object.create(Array.prototype)]));`,
  "built-ins-outside-loops": `function kindOf(thing) { if (thing instanceof Promise) return "promise"; if (thing instanceof Map) return "map"; if (thing instanceof Blob) return "blob"; if (thing instanceof ReadableStream) return "stream"; if (thing instanceof Response) return "response"; if (thing instanceof Uint8Array) return "bytes"; if (thing instanceof Error) return "error"; if (thing instanceof Function) return "function"; if (thing instanceof Object) return "object"; return "other"; }
const things = [Promise.resolve(1), new Map(), new Blob(["x"]), new ReadableStream(), new Response("y"), new Uint8Array(2), new TypeError("z"), () => 1, {}, Object.create(null), 4, null, Object.create(Promise.prototype), Object.create(Map.prototype), Object.setPrototypeOf(new Map(), Promise.prototype), new Proxy(new Map(), {}), new Proxy({}, { getPrototypeOf() { return Blob.prototype; } }), class extends Map {}, new (class extends Map {})(), new (class extends Response {})("w")];
for (const thing of things) console.log(kindOf(thing));
for (const thing of things) console.log(kindOf(thing));`,
  "a-built-in-of-another-realm": `import vm from "node:vm";
function isMap(thing) { return thing instanceof Map; }
function isError(thing) { return thing instanceof Error; }
const theirs = vm.runInNewContext("[new Map(), new Error('x'), Map, Error]");
console.log(isMap(theirs[0]), isError(theirs[1]), isMap(new Map()), isError(new Error("y")), theirs[0] instanceof theirs[2], new Map() instanceof theirs[2]);`,
  "classes-of-the-library": `import Stream, { Readable, Writable, Duplex, Transform } from "node:stream";
import { EventEmitter } from "node:events";
function kindOf(thing) { return [thing instanceof Stream, thing instanceof Readable, thing instanceof Writable, thing instanceof Duplex, thing instanceof Transform, thing instanceof EventEmitter].map(Number).join(""); }
const things = [new Readable({ read() {} }), new Writable({ write() {} }), new Duplex({ read() {}, write() {} }), new Transform(), new EventEmitter(), new Stream(), {}, null, Object.create(Readable.prototype), { _writableState: {} }];
for (const thing of things) console.log(kindOf(thing));
for (const thing of things) console.log(kindOf(thing));`,
};
for (const [name, text] of Object.entries(others)) write(name, text + "\n");
console.log(count + " programs");
