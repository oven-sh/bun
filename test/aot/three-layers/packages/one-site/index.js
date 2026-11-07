// One site for each operation, for objects of every kind and every program.
export const get = (o, k) => o[k];
export const set = (o, k, v) => { o[k] = v; return o; };
export const del = (o, k) => delete o[k];
export const has = (o, k) => k in o;
export const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const define = (o, k, v) => Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
export const keys = o => Object.keys(o).join(",");
export const forIn = o => { let s = ""; for (const k in o) s += k + ";"; return s; };
export const assign = (o, s) => Object.assign(o, s);
export const spread = o => ({ ...o });
export const rest = o => { const { a, ...others } = o; return others; };
export const call = (o, k, ...args) => o[k](...args);
export const bump = (o, k) => { o[k]++; return o[k]; };
export const add = (o, k, v) => { o[k] += v; return o[k]; };
export const orSet = (o, k, v) => (o[k] ??= v);
export const named = o => [o.a, o.b, o.name, o.level, o.extra, o.missing];
export const setNamed = (o, v) => { o.a = v; o.extra = v; o.name = "n" + v; return o; };
export class Base { base = 1; tag = "base"; describe() { return this.tag + this.base; } get twice() { return this.base * 2; } set twice(v) { this.base = v / 2; } }
export const theirLiteral = i => ({ a: i, b: "p" + i, name: "pkg" });
