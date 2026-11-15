// The same places, in the files between.
export const get = (o: any, k: any) => o[k];
export const set = (o: any, k: any, v: any) => { o[k] = v; return o; };
export const del = (o: any, k: any) => delete o[k];
export const has = (o: any, k: any) => k in o;
export const own = (o: any, k: any) => Object.prototype.hasOwnProperty.call(o, k);
export const define = (o: any, k: any, v: any) => Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
export const keys = (o: any) => Object.keys(o).join(",");
export const forIn = (o: any) => { let s = ""; for (const k in o) s += k + ";"; return s; };
export const assign = (o: any, s: any) => Object.assign(o, s);
export const spread = (o: any) => ({ ...o });
export const rest = (o: any) => { const { a, ...others } = o; return others; };
export const call = (o: any, k: any, ...args: any[]) => o[k](...args);
export const bump = (o: any, k: any) => { o[k]++; return o[k]; };
export const add = (o: any, k: any, v: any) => { o[k] += v; return o[k]; };
export const orSet = (o: any, k: any, v: any) => (o[k] ??= v);
export const named = (o: any) => [o.a, o.b, o.name, o.level, o.extra, o.missing];
export const setNamed = (o: any, v: any) => { o.a = v; o.extra = v; o.name = "n" + v; return o; };
