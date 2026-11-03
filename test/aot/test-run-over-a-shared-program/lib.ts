// The "application": compiled into the shared image.
export class Animal {
  static count = 0;
  #secret = 7;
  name: string;
  constructor(name: string) { this.name = name; Animal.count++; }
  speak() { return `${this.name} makes a sound`; }
  get upper() { return this.name.toUpperCase(); }
  set upper(v: string) { this.name = v.toLowerCase(); }
  secret() { return this.#secret; }
  static create(name: string) { return new this(name); }
  toString() { return `Animal(${this.name})`; }
  [Symbol.toPrimitive](hint: string) { return hint === "number" ? 42 : this.toString(); }
}
export const sym = Symbol("lib");
export function makePoint(x: number, y: number) { return { x, y }; }
export function makeNested() { return { a: { b: { c: [1, 2, { d: "deep" }] } }, [sym]: "symbol", list: ["x", "y"] }; }
export function keysOf(o: any) { return Object.keys(o); }
export function entriesOf(o: any) { return Object.entries(o); }
export function valuesOf(o: any) { return Object.values(o); }
export function spread(o: any) { return { ...o, extra: 1 }; }
export function assign(t: any, s: any) { return Object.assign(t, s); }
export function json(o: any) { return JSON.stringify(o); }
export function clone(o: any) { return structuredClone(o); }
export function forIn(o: any) { const r: string[] = []; for (const k in o) r.push(k); return r; }
export function destructure({ x, y, ...rest }: any) { return [x, y, rest]; }
export function readX(o: any) { return o.x; }
export function writeX(o: any, v: any) { o.x = v; return o; }
export function addProp(o: any, k: string, v: any) { o[k] = v; return o; }
export function del(o: any, k: string) { delete o[k]; return o; }
export function has(o: any, k: string) { return k in o; }
export function hasOwn(o: any, k: string) { return Object.hasOwn(o, k); }
export function call(f: Function, ...args: any[]) { return f(...args); }
export function callMethod(o: any, m: string, ...args: any[]) { return o[m](...args); }
export function construct(C: any, ...args: any[]) { return new C(...args); }
export function isInstance(o: any, C: any) { return o instanceof C; }
export function mapArray(a: any[], f: (v: any, i: number) => any) { return a.map(f); }
export function reduceArray(a: any[], f: any, init: any) { return a.reduce(f, init); }
export function sortArray(a: any[], f: any) { return [...a].sort(f); }
export function thrower(msg: string): never { throw new Error(msg); }
export function throwValue(v: any): never { throw v; }
export function tryCall(f: Function) { try { return f(); } catch (e: any) { return "caught:" + (e?.message ?? String(e)); } finally { counter.finallyRan++; } }
export const counter = { finallyRan: 0, n: 0 };
export function* gen(n: number) { for (let i = 0; i < n; i++) yield i * 2; }
export function iterate(it: Iterable<any>) { const r = []; for (const v of it) r.push(v); return r; }
export async function asyncDouble(v: number) { await null; return v * 2; }
export async function asyncCall(f: () => Promise<any>) { const v = await f(); return ["got", v]; }
export async function asyncThrow(msg: string) { await Promise.resolve(); throw new TypeError(msg); }
export async function* asyncGen(n: number) { for (let i = 0; i < n; i++) { await null; yield i; } }
export async function collect(it: AsyncIterable<any>) { const r = []; for await (const v of it) r.push(v); return r; }
export function later(f: Function, ms = 1) { return new Promise(res => setTimeout(() => res(f()), ms)); }
export function bindTo(f: Function, t: any, ...a: any[]) { return f.bind(t, ...a); }
export function counterInAClosure() { let n = 0; return { inc: () => ++n, get: () => n }; }
export function proto(o: any) { return Object.getPrototypeOf(o); }
export function setProto(o: any, p: any) { return Object.setPrototypeOf(o, p); }
export function define(o: any, k: string, d: PropertyDescriptor) { return Object.defineProperty(o, k, d); }
export function describe_(o: any, k: string) { return Object.getOwnPropertyDescriptor(o, k); }
export function freeze(o: any) { return Object.freeze(o); }
export function isFrozen(o: any) { return Object.isFrozen(o); }
export function ownNames(o: any) { return Reflect.ownKeys(o); }
export function proxy(o: any, log: string[]) { return new Proxy(o, { get(t, k, r) { log.push(String(k)); return Reflect.get(t, k, r); } }); }
export function mapOf(o: any) { return new Map(Object.entries(o)); }
export function setKey(m: Map<any, any>, k: any, v: any) { m.set(k, v); return m.get(k); }
export function weak(o: object) { const w = new WeakMap(); w.set(o, 1); return w.get(o); }
export function typeOf(v: any) { return typeof v; }
export function str(v: any) { return String(v); }
export function tmpl(v: any) { return `${v}`; }
export function num(v: any) { return +v; }
export function eq(a: any, b: any) { return a === b; }
export function stackOf(f: Function) { try { f(); } catch (e: any) { return e.stack as string; } return ""; }
export function nameOf(f: Function) { return f.name; }
export function lengthOf(f: Function) { return f.length; }
export function sourceOf(f: Function) { return f.toString().length > 0; }
export class Base { kind() { return "base"; } who() { return "I am " + this.kind(); } static make() { return new this(); } }
export abstract class Shape { abstract area(): number; describe() { return `area ${this.area()}`; } }
export function mixin<T extends new (...a: any[]) => any>(C: T) { return class extends C { mixed() { return "mixed"; } }; }
export let mutable = 1;
export function bump() { mutable++; return mutable; }
export const arrow = (a: number, b = 2) => a + b;
export default function defaultExport() { return "default"; }
export const big = Array.from({ length: 50 }, (_, i) => ({ id: i, tag: "t" + (i % 3) }));
export function groupBy(a: any[], f: (v: any) => string) { const r: Record<string, any[]> = {}; for (const v of a) (r[f(v)] ??= []).push(v); return r; }
export class Emitter { #l = new Map<string, Function[]>(); on(e: string, f: Function) { (this.#l.get(e) ?? this.#l.set(e, []).get(e)!).push(f); return this; } emit(e: string, ...a: any[]) { return (this.#l.get(e) ?? []).map(f => f(...a)); } }
export function getter(o: any) { return o.value; }
export function optional(o: any) { return o?.a?.b?.c ?? "none"; }
export function argsLen() { return arguments.length; }
export function restArgs(...r: any[]) { return r; }
export function applyFn(f: Function, t: any, a: any[]) { return f.apply(t, a); }
export function tagged(s: TemplateStringsArray, ...v: any[]) { return s.raw.join("|") + v.join(","); }
export function regex(s: string, f: (m: string) => string) { return s.replace(/[a-z]+/g, f); }
export function dateOf(o: { when: Date }) { return o.when.getTime(); }
export function errorIs(e: any) { return [e instanceof Error, e.name, e.message]; }
export class MyError extends Error { code = "E_MY"; constructor(m: string) { super(m); this.name = "MyError"; } }
