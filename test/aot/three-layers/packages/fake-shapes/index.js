export class Shape {
  static count = 0;
  static registry = new Map();
  #id;
  name;
  tags = [];
  constructor(name) {
    this.name = name;
    this.#id = ++Shape.count;
    Shape.registry.set(this.#id, this);
    if (typeof this.init === "function") this.init();
  }
  get id() { return this.#id; }
  static isShape(value) { return typeof value === "object" && value !== null && #id in value; }
  #double() { return this.area() * 2; }
  doubled() { return this.#double(); }
  area() { return 0; }
  describe() { return `${this.constructor.name}:${this.name}:${this.area()}`; }
  toJSON() { return { kind: this.constructor.name, name: this.name, area: this.area() }; }
  get [Symbol.toStringTag]() { return "Shape"; }
  static create(...args) { return new this(...args); }
  *corners() {}
  [Symbol.toPrimitive](hint) { return hint === "number" ? this.area() : this.describe(); }
  withTag(tag) { this.tags.push(tag); return this; }
  static [Symbol.hasInstance](value) { return typeof value === "object" && value !== null && (Function.prototype[Symbol.hasInstance].call(this, value) || value.pretendsToBeShape === true); }
}
export class Circle extends Shape {
  constructor(name, r) { super(name); this.r = r; }
  area() { return Math.round(Math.PI * this.r * this.r * 100) / 100; }
  get diameter() { return this.r * 2; }
  set diameter(value) { this.r = value / 2; }
}
export function makePoint(x, y) { return { x, y }; }
export function makeWide(seed) { return { a: seed, b: seed + 1, c: String(seed), d: [seed], e: { inner: seed }, f: null, g: undefined, h: seed % 2 === 0 }; }
export function makeCounter() { let n = 0; return { inc() { return ++n; }, get value() { return n; }, reset: () => { n = 0; } }; }
export const kinds = Object.freeze({ circle: "circle", square: "square", nested: Object.freeze({ deep: "deep" }) });
export let live = 0;
export function bump() { return ++live; }
export const secret = Symbol("secret");
export const shared = Symbol.for("border.shared");
export function callTwice(f, ...args) { return [f(...args), f.call({ who: "pkg" }, ...args)]; }
export function callWithNew(C, ...args) { return new C(...args); }
export function mapValues(object, f) { const out = {}; for (const key of Object.keys(object)) out[key] = f(object[key], key, object); return out; }
export const Serializable = Base => class extends Base {
  serialize() { return JSON.stringify(this); }
  static label() { return "serializable " + super.name + "/" + this.name; }
};
export const Countable = Base => class Counted extends Base {
  static made = 0;
  constructor(...args) { super(...args); new.target.made++; this.ordinal = Counted.made; }
  describe() { return "#" + this.ordinal + " " + super.describe(); }
};
export class Stack extends Array {
  static get [Symbol.species]() { return Array; }
  top() { return this[this.length - 1]; }
}
export class Keeper extends Array {
  sum() { return this.reduce((a, b) => a + b, 0); }
}
export function* range(from, to, step = 1) { try { for (let i = from; i < to; i += step) { const sent = yield i; if (sent === "skip") i += step; } return "done"; } finally { range.closed = (range.closed || 0) + 1; } }
export async function* ticks(n, log) { try { for (let i = 0; i < n; i++) { await null; log?.push("tick " + i); yield i; } } finally { log?.push("closed"); } }
export class PkgError extends Error {
  constructor(message, code, options) { super(message, options); this.name = "PkgError"; this.code = code; }
  get summary() { return this.name + "[" + this.code + "] " + this.message; }
}
export function thrower(kind, payload) {
  switch (kind) {
    case "pkg": throw new PkgError("from the package", 7);
    case "type": return null.x;
    case "range": return new Array(-1);
    case "value": throw payload;
    case "callback": return payload();
    case "deep": return (function a() { return (function b() { throw new PkgError("deep", 9); })(); })();
    default: return "nothing thrown";
  }
}
export function guarded(f, log) { try { log.push("try"); return f(); } catch (error) { log.push("catch " + (error && error.name)); throw error; } finally { log.push("finally"); } }
export function tag(strings, ...values) { return { strings, raw: strings.raw, values }; }
export function sameTemplate() { const get = () => tag`a${1}b`; return get().strings === get().strings; }
const names = ["alpha", "beta", "gamma", "x", "y", "name", "length", "constructor", "__proto__", "0", "1", "toString", "r", "tags", "side", "absent"];
export function keyOf(index) { return names[index]; }
export function builtKey(a, b) { return a + b; }
export function readKey(object, key) { return object[key]; }
export function writeKey(object, key, value) { object[key] = value; return object; }
export function hasKey(object, key) { return key in object; }
export function deleteKey(object, key) { return delete object[key]; }
export function switchOn(text) { switch (text) { case "alpha": return 1; case "beta": return 2; case "circle": return 3; case "side": return 4; case "": return 5; default: return -1; } }
export function readX(object) { return object.x; }
export function readName(object) { return object.name; }
export function sumXY(object) { return object.x + object.y; }
export function setX(object, value) { object.x = value; return object.x; }
export function callArea(object) { return object.area(); }
export function callMethod(object, name, ...args) { return object[name](...args); }
export function keysOf(object) { const keys = []; for (const key in object) keys.push(key); return keys; }
export function freezeIt(object) { return Object.freeze(object); }
export function thenable(value, log) { return { then(resolve) { log?.push("then called"); resolve(value); } }; }
export class Lazy extends Promise {
  static get [Symbol.species]() { return Promise; }
  static of(value) { return new Lazy(resolve => resolve(value)); }
}
export class Chained extends Promise {
  label() { return "chained"; }
}
export class Bytes extends Uint8Array {
  hex() { return Array.from(this, b => b.toString(16).padStart(2, "0")).join(""); }
}
export const registry = new Map();
export const weak = new WeakMap();
export const seen = new WeakSet();
export function remember(key, value) { registry.set(key, value); if (typeof key === "object" && key !== null) { weak.set(key, value); seen.add(key); } return registry.size; }
export function recall(key) { return [registry.get(key), typeof key === "object" && key !== null ? weak.get(key) : undefined, typeof key === "object" && key !== null && seen.has(key)]; }
export function compare(a, b) { return [a === b, a == b, Object.is(a, b), typeof a === typeof b]; }
export function sortWith(list, comparator) { return list.slice().sort(comparator); }
export function compose(...fs) { return x => fs.reduceRight((value, f) => f(value), x); }
export function curry(f) { return function curried(...args) { return args.length >= f.length ? f.apply(this, args) : (...more) => curried.apply(this, [...args, ...more]); }; }
export function once(f) { let done = false, value; return function (...args) { if (!done) { done = true; value = f.apply(this, args); } return value; }; }
export function argumentsOf() { return Array.prototype.slice.call(arguments); }
export function defaults(a, b = a + 1, { c = b + 1, ...rest } = {}, [d = c + 1, ...more] = []) { return { a, b, c, d, rest, more }; }
export const accessors = {
  _v: 1,
  get v() { return this._v; },
  set v(value) { this._v = value * 2; },
  get self() { return this; },
};
export function Legacy(name) { if (!(this instanceof Legacy)) return new Legacy(name); this.name = name; }
Legacy.prototype.greet = function () { return "legacy " + this.name; };
Legacy.version = 3;
export default function fallback(value) { return value ?? "fallback"; }
