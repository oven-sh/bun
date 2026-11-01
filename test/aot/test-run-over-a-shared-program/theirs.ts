// What the test files import: one program under theirs. Nothing here touches its own classes and functions before a test does.
export class Lazy {
  static count = 0;
  static label = "lazy";
  static make(n: number) { return new this(n); }
  static get twice() { return this.count * 2; }
  n: number;
  constructor(n = 1) { this.n = n; Lazy.count++; }
  m() { return this.n + 1; }
  get value() { return this.n * 10; }
  set value(v: number) { this.n = v / 10; }
  who() { return new.target === undefined ? this.constructor.name : "?"; }
  toString() { return `Lazy(${this.n})`; }
}
export class Lazy2 { a = 1; static s = "s"; m2() { return "m2"; } static sm() { return "sm"; } }
export class Lazy3 { b = 2; m3() { return "m3"; } get g3() { return "g3"; } }
export class Lazy4 { c = 3; static f4 = 4; m4() { return "m4"; } }
export class Lazy5 { d = 4; m5() { return "m5"; } static s5() { return "s5"; } }
export class Lazy6 { e = 5; m6() { return "m6"; } }
export class Lazy7 { f = 6; static t = 7; m7() { return "m7"; } }
export class Lazy8 { g = 7; m8() { return "m8"; } }
export class Target { seen: any; constructor() { this.seen = new.target; } name() { return (new.target as any) === undefined ? "called" : "?"; } }
export class Child extends Lazy { m() { return super.m() * 2; } static make(n: number) { return super.make(n + 1); } get value() { return super.value + 1; } }
export function Ctor(this: any, a: number) { this.a = a; }
Ctor.prototype.double = function () { return this.a * 2; };
export function Ctor2(this: any, a: number) { this.a = a; this.b = a + 1; }
export function Ctor3(this: any) { this.z = 1; }
export function Ctor4(this: any) { this.y = 2; }
export function Ctor5(this: any) { this.x = new.target === undefined ? "call" : new.target.name; }
export function plain(a: number, b: number) { return a + b; }
export function plain2(a: number, b = 2, ...rest: number[]) { return a + b + rest.length; }
export function plain3() { return "p3"; }
export function plain4() { return "p4"; }
export function plain5() { return "p5"; }
export function plain6(this: any) { return this; }
export const arrow = (a: number) => a * 2;
export const arrow2 = () => "a2";
export const arrow3 = () => "a3";
export async function later(v: any) { return await v; }
export function* count(n: number): Generator<number, string, any> { let sent; for (let i = 0; i < n; i++) sent = yield i + (sent ?? 0); return "done"; }
export async function* countLater(n: number) { for (let i = 0; i < n; i++) yield i; }
export const holder = { method() { return "held"; }, get got() { return "got"; }, fn: function named() { return "named"; }, ["comp" + "uted"]() { return "c"; } };
export const mixin = <T extends new (...a: any[]) => any>(B: T) => class Mixed extends B { mixed() { return "mixed"; } m() { return (super.m?.() ?? 0) + 100; } };
export class Err extends Error { code = 7; constructor(m: string) { super(m); this.name = "Err"; } describe() { return `${this.name}:${this.message}:${this.code}`; } }
export class Bag extends Map<string, number> { label = "bag"; total() { let n = 0; for (const v of this.values()) n += v; return n; } }
export class Pile extends Set<number> { label = "pile"; top() { return Math.max(...this); } }
export class List extends Array<number> { sum() { return this.reduce((a, b) => a + b, 0); } }
export class Priv {
  #f = "field"; static #sf = "static field";
  #m() { return "method"; } get #a() { return "accessor"; } set #a(v: string) { this.#f = v; }
  static #sm() { return "static method"; }
  static has(o: any) { return [#f in o, #m in o, #a in o]; }
  static read(o: any) { return [o.#f, o.#m(), o.#a]; }
  static write(o: any, v: string) { o.#a = v; return o.#f; }
  static statics(o: any) { return [o.#sf, o.#sm()]; }
}
export const apply = (f: any, self: any, args: any[]) => f.apply(self, args);
export const construct = (C: any, ...args: any[]) => new C(...args);
export const reflectConstruct = (C: any, args: any[], T: any) => Reflect.construct(C, args, T);
export const isInstance = (o: any, C: any) => o instanceof C;
export const text = (o: any) => `${o}`;
export const number = (o: any) => +o;
export const json = (o: any) => JSON.stringify(o);
export const spreadAll = (it: any) => [...it];
export const first = ([a]: any) => a;
export const awaitIt = async (t: any) => await t;
export const forAwait = async (it: any) => { const all = []; for await (const v of it) all.push(v); return all; };
export const names = (o: any) => Object.getOwnPropertyNames(o);
export const keys = (o: any) => Reflect.ownKeys(o);
export const descriptor = (o: any, k: PropertyKey) => Object.getOwnPropertyDescriptor(o, k);
export const define = (o: any, k: PropertyKey, d: PropertyDescriptor) => Object.defineProperty(o, k, d);
export const setProto = (o: any, p: any) => Object.setPrototypeOf(o, p);
export const create = (p: any) => Object.create(p);
export const source = (f: any) => Function.prototype.toString.call(f);
export const resume = (g: any, v?: any) => g.next(v);
export const sortBy = (list: any[], f: any) => list.slice().sort(f);
export const get = (o: any, k: PropertyKey) => o[k];
export const set = (o: any, k: PropertyKey, v: any) => { o[k] = v; return o[k]; };
export const remove = (o: any, k: PropertyKey) => delete o[k];
export const callMethod = (o: any, k: PropertyKey, ...a: any[]) => o[k](...a);
export const subclass = (B: any) => class Sub extends B { sub() { return "sub"; } };
export const capture = (o: any) => { Error.captureStackTrace(o); return typeof o.stack; };
export const stackThrough = (f: any) => { try { f(); } catch (e: any) { return e.stack as string; } return ""; };
export const sites = (f: any) => {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, list) => list.slice(0, 4).map(s => [s.getFunctionName(), s.getTypeName(), s.getMethodName(), s.isConstructor(), s.isAsync(), s.isToplevel(), typeof s.getFunction(), s.isNative()]);
  try { f(); } catch (e: any) { return e.stack; } finally { Error.prepareStackTrace = before; }
};
export type Part = { a: number; b?: string; c?: number; d?: { x: number }; e?: boolean };
export const makePart = (i: number): Part => ({ a: i });
export const fillPart = (o: Part) => { o.b = "s"; o.c = 1.5; o.d = { x: 1 }; o.e = true; return o; };
export const setB = (o: any, v: any) => { o.b = v; return o; };
export const setC = (o: any, v: any) => { o.c = v; return o; };
export const setKey = (o: any, k: string, v: any) => { o[k] = v; return o; };
export const mergeInto = (o: any, from: any) => { for (const k in from) o[k] = from[k]; return o; };
