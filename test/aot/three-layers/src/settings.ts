export class Settings {
  a?: number; b?: string; c: { x?: number; y?: string; z?: unknown } = {}; list?: number[]; flag = false; n = 1; late?: unknown;
  constructor(i = 0) { if (i & 1) this.a = i; if (i & 2) this.b = "b" + i; if (i & 4) this.list = [i]; }
}
export class Wide {
  f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; f6 = 6; f7 = 7; f8 = 8; f9 = 9; g0 = "0"; g1 = "1"; g2 = "2"; g3 = "3"; g4 = "4"; g5 = "5"; g6 = "6"; g7 = "7"; g8 = "8"; g9 = "9";
  h0?: number; h1?: string; h2?: object; h3?: unknown; h4?: number; h5?: number; h6?: number; h7?: number; h8?: number; h9?: number;
  i0 = 1.5; i1 = true; i2: unknown = null; i3: unknown = undefined; i4 = {}; i5 = [1];
}
export type Maker = (i: number) => any;
export const makers: Record<string, Maker> = {
  empty: () => ({}),
  literal: i => (i & 1 ? { a: 1, b: "s", nested: { p: 1 } } : { a: 1, nested: { p: 1, q: [1] }, extra: undefined }),
  sparse: i => { const o: any = {}; if (i & 1) o.a = 1; if (i & 2) o.b = "x"; if (i & 4) o.c = { x: 1 }; if (i & 8) o.list = [1, 2]; return o; },
  settings: i => new Settings(i),
  wide: () => new Wide(),
  extras: i => { const o: any = { a: 1 }; for (let k = 0; k < (i % 7) + 1; k++) o["k" + k] = k; return o; },
  reordered: i => { const o: any = i & 1 ? { a: 1, b: 2, c: {} } : { c: {}, b: 2, a: 1 }; delete o.b; o.b = 3; return o; },
  typed: i => ({ a: i, b: "s" + i, n: 1.5, flag: true, c: { x: i } }),
  accessor: () => ({ _a: 0, get a() { return this._a; }, set a(v: any) { this._a = v; }, b: "s" }),
  nulls: () => ({ a: null, b: undefined, c: null, list: null }),
  inheriting: () => Object.create({ a: "inherited", c: { x: "inherited" } }),
  array: i => [i, { a: i }],
};
export const sources: Record<string, Maker> = {
  ...makers,
  otherTypes: i => ({ a: "text", b: i, c: { x: "text", y: 1, z: [i] }, list: "no list", flag: "no flag", n: { deep: 1 }, f0: "zero", g0: 0, h0: 1, h1: "one", h2: {}, h3: 3, i0: "x", i1: 1 }),
  many: i => { const o: any = {}; for (let k = 0; k < 40; k++) o["m" + k] = k + i; return o; },
  indices: () => ({ 0: "zero", 1: "one", 10: "ten" }),
  dunder: () => JSON.parse('{"__proto__": {"polluted": 1}, "a": 5}'),
  late: i => ({ late: i, h4: i, h5: i, h6: i, h7: i, h8: i, h9: i }),
};
export type Options = { a?: number; b?: string; c?: { x?: number; y?: string; z?: unknown }; list?: number[]; flag?: boolean; mode?: "on" | "off"; ratio?: number; n: number };
const defaults: Options = { a: 1, b: "b", flag: false, mode: "off", ratio: 0.5, n: 0 };
export const copiers: Record<string, (object: Options) => unknown> = {
  copy: object => ({ ...object }),
  overDefaults: (object): Options => ({ ...defaults, ...object }),
  underDefaults: (object): Options => ({ ...object, ...defaults }),
  assign: object => Object.assign({ n: 0 } as Options, object),
  assignTwo: object => Object.assign({}, defaults, object),
  rest: object => { const { a, ...others } = object; return [a, others]; },
  entries: object => Object.fromEntries(Object.entries(object)),
};
const hidden = Symbol("hidden");
export const odd: Record<string, Maker> = {
  options: (i): Options => (i & 1 ? { a: i, mode: "on", n: 2 } : { b: "s", flag: true, ratio: 1.5, n: 3, c: { x: i } }),
  everyOption: (i): Options => ({ a: i, b: "x", c: { x: 1, y: "y", z: null }, list: [i], flag: true, mode: i & 1 ? "on" : "off", ratio: i / 2, n: i }),
  inOtherOrder: (i): Options => { const o: Options = { n: i }; o.mode = "on"; o.flag = false; o.a = i; return o; },
  wrongTypes: (i): any => ({ a: "text", b: i, flag: "yes", mode: "neither", ratio: "half", n: null }),
  markers: (): any => ({ a: undefined, b: null, c: undefined, flag: null, n: -0 }),
  numbers: (i): any => ({ a: 2 ** 31 + i, ratio: NaN, n: 1e300, b: 10n }),
  functions: (i): any => ({ n: i, call: () => i, method() { return this.n; } }),
  getters: (i): any => ({ n: i, get a() { return i * 2; }, set b(v: unknown) {} }),
  symbols: (i): any => ({ n: i, [hidden]: i, [Symbol.iterator]: null }),
  notEnumerable: (i): any => Object.defineProperty({ n: i, a: 1 }, "a", { enumerable: false }),
  frozen: (i): any => Object.freeze({ a: i, mode: "on", n: 1 }),
};
import { packageMode, packageText, packageTextReadAboveFirst } from "fake-merge";
import * as merge from "fake-merge";
export const middleText = "text of the application";
export let middleMode: string = "one";
export function setMiddleMode(mode: string) { middleMode = mode; }
export const textsSeenInTheMiddle = () => [packageText, packageMode, packageTextReadAboveFirst, merge.packageText, merge.packageMode, middleText, middleMode];
export const codeFromTextInTheMiddle = (parameters: string[], body: string): ((...all: any[]) => any) => new Function(...parameters, body) as any;
export const importByPathInTheMiddle = (path: string): Promise<any> => import(path);
export const rowOfTheApplication = (id: number, title: string) => ({ id, title, done: false });
export const readRowInTheApplication = (row: { id: number; title: string; done: boolean }) => [row.id, row.title, row.done, Object.keys(row).join()];
export class StaticsOfTheApplication { static limit = 4; static label = "application"; static twice() { return this.limit * 2; } }
