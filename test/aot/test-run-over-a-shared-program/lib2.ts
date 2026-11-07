import { EventEmitter } from "node:events";
import * as path from "node:path";
import data from "./data.json";
export { data };
export const cjs = require("./cjs.cjs");
export class Store<T> extends EventEmitter { items: T[] = []; add(v: T) { this.items.push(v); this.emit("add", v); return this; } get size() { return this.items.length; } *[Symbol.iterator]() { yield* this.items; } }
export function join(...p: string[]) { return path.join(...p); }
export class Temp { static #n = 0; static next() { return ++Temp.#n; } static { Temp.#n = 10; } accessor = 1; static get n() { return Temp.#n; } static isTemp(o: any) { return #priv in o; } #priv = 1; }
export const frozen = Object.freeze({ a: 1, nested: Object.freeze({ b: 2 }) });
export function withDefaults({ a = 1, b = { c: 2 } }: any = {}) { return a + b.c; }
export function visit(o: any, f: (k: string, v: any) => void) { for (const [k, v] of Object.entries(o)) { f(k, v); if (v && typeof v === "object") visit(v, f); } }
export function memo<T extends (...a: any[]) => any>(f: T): T { const c = new Map(); return ((...a: any[]) => { const k = JSON.stringify(a); if (!c.has(k)) c.set(k, f(...a)); return c.get(k); }) as T; }
export function compose(...f: Function[]) { return (x: any) => f.reduceRight((v, g) => g(v), x); }
export function curry(f: Function) { return function c(this: any, ...a: any[]): any { return a.length >= f.length ? f.apply(this, a) : (...b: any[]) => c.apply(this, [...a, ...b]); }; }
export async function retry(f: () => Promise<any>, n: number) { let last; for (let i = 0; i < n; i++) { try { return await f(); } catch (e) { last = e; } } throw last; }
export async function all(fs: (() => Promise<any>)[]) { return Promise.all(fs.map(f => f())); }
export async function settle(fs: (() => Promise<any>)[]) { return (await Promise.allSettled(fs.map(f => f()))).map(r => r.status); }
export function thenable(v: any) { return { then(res: Function) { res(v); } }; }
export function deepMerge(a: any, b: any): any { const r = { ...a }; for (const k of Object.keys(b)) r[k] = a[k] && typeof a[k] === "object" && typeof b[k] === "object" ? deepMerge(a[k], b[k]) : b[k]; return r; }
export function pick(o: any, ...k: string[]) { return Object.fromEntries(k.map(x => [x, o[x]])); }
export function countArgs(a?: any, b?: any, c?: any) { return [a, b, c].filter(x => x !== undefined).length; }
export function swap([a, b]: [any, any]) { return [b, a]; }
export function label(v: any) { switch (typeof v) { case "object": return v === null ? "null" : Array.isArray(v) ? "array" : v.constructor?.name ?? "bare"; default: return typeof v; } }
export function toJSONUser(o: any) { return JSON.stringify({ wrapped: o }); }
export function reviver(s: string, f: (k: string, v: any) => any) { return JSON.parse(s, f); }
export function replacer(o: any, f: (k: string, v: any) => any) { return JSON.stringify(o, f); }
export function sortBy(a: any[], k: string) { return a.toSorted((x, y) => (x[k] > y[k] ? 1 : -1)); }
export function flat(a: any[]) { return a.flatMap(x => x.list); }
export function find(a: any[], f: any) { return [a.find(f), a.findIndex(f), a.some(f), a.every(f), a.findLast(f)]; }
export function fromIter(it: any) { return Array.from(it, (v: any) => v.id ?? v); }
export function setOps(a: Set<any>, b: Set<any>) { return [...a.union(b)].length; }
export function symbolDesc(s: symbol) { return s.description; }
export function getSet(o: any) { o.v = o.v + 1; return o.v; }
export function inc(o: { n: number }) { o.n++; o.n += 2; return o; }
export function nullish(o: any) { o.a ??= 1; o.b ||= 2; o.c &&= 3; return o; }
export function spreadCall(f: Function, a: any[]) { return f(...a, ...a); }
export function newTarget(this: any) { return new.target === undefined ? "call" : "new"; }
export function instanceCheck(C: any, o: any) { return C[Symbol.hasInstance](o); }
export function species(a: any) { return a.map((x: any) => x).constructor.name; }
export class Matrix extends Array<number> { sum() { return this.reduce((a, b) => a + b, 0); } }
export function bigObject() { const o: any = {}; for (let i = 0; i < 100; i++) o["k" + i] = i; return o; }
export function env() { return process.env.CSO_TEST ?? "unset"; }
export function buffer(s: string) { return Buffer.from(s).toString("base64"); }
export function url(u: string) { return new URL(u).searchParams.get("q"); }
export const lazy = { get once() { const v = Math.random(); Object.defineProperty(this, "once", { value: v }); return v; } };
export function tdz() { try { (() => later)(); } catch (e: any) { return e.name; } const later = 1; return "no"; }
export function overflow(): number { return overflow() + 1; }
export function labelLoop(m: number[][]) { let c = 0; outer: for (const r of m) { for (const v of r) { if (v < 0) continue outer; if (v > 9) break outer; c += v; } } return c; }
