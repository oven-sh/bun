import { Shape } from "./index.js";
export function holdAndCall(f, seed) {
  const a = { tag: "a" + seed, list: [seed, seed + 1] }, b = new Shape("held" + seed), c = "text" + seed + "x".repeat(seed % 5), d = [a, b], e = new Map([[a, c]]), g = seed + 0.5, h = Symbol("s" + seed), i = BigInt(seed) * 10n ** 20n;
  const r = f(seed);
  return [a.tag, a.list.join(), b.name, c, d.length, e.get(a), g, h.description, String(i), r];
}
export function* holdAcrossYields(seed) { const a = { n: seed }, b = ["x" + seed], c = new Shape("gen" + seed); const s1 = yield a.n; const d = { s1 }; const s2 = yield b[0]; return [a.n, b[0], c.name, d.s1, s2]; }
export async function holdAcrossAwaits(f, seed) { const a = { n: seed }, b = "t" + seed, c = [seed]; const r1 = await f(1); const d = { r1 }; const r2 = await f(2); return [a.n, b, c[0], d.r1, r2]; }
export function deep(n, f) { const keep = { n }; return n === 0 ? f() : [keep.n, deep(n - 1, f)].flat().length + keep.n; }
export function plain(a, b) { return a + b; }
export const arrow = (a) => a;
export const holder = { method(a, b, c) { return this === holder; }, get got() { return 1; }, async later() {}, *gen() {}, ["comp" + "uted"]() {} };
export class WithStatics { static a = 1; static #hidden = 2; static get hidden() { return WithStatics.#hidden; } static method() { return this.a; } static { this.fromBlock = "block"; } instanceMethod() {} }
export const word = /(?<first>\w)(\w*)/g;
export const sticky = /a/y;
export function makeRegExp() { return /x+/g; }
export function matchWith(re, text) { return re.exec(text); }
export function replaceWith(text, re, f) { return text.replace(re, f); }
export const texts = { empty: "", one: "a", ascii: "hello world", wide: "héllo wörld ✓", key: "side", num: "42", long: "l".repeat(70) };
export class Base { who() { return "base"; } hello() { return "hello " + this.who(); } get prop() { return "base prop"; } static make() { return new this(); } }
export function callWho(o) { return o.who(); }
export function callHello(o) { return o.hello(); }
export function readProp(o) { return o.prop; }
export function loopWho(o, n) { let s = ""; for (let i = 0; i < n; i++) s += o.who()[0]; return s; }
export function getAt(o, k) { return o[k]; }
export function putAt(o, k, v) { o[k] = v; return o[k]; }
export function inAt(o, k) { return k in o; }
export function delAt(o, k) { return delete o[k]; }
export function forIn(o) { const keys = []; for (const k in o) keys.push(k); return keys; }
export function ownNames(o) { return Object.getOwnPropertyNames(o); }
export function iterate(o) { const out = []; for (const each of o) out.push(each); return out; }
export function destructure(o) { const [a, b = "default", ...rest] = o; return [a, b, rest]; }
