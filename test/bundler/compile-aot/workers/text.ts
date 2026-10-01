import { bump, makePoint } from "./shapes.ts";
export const words = /\b([a-z]+)(\d*)\b/g;
export const sticky = /a+/y;
export function tokens(s: string): string[] { const out: string[] = []; for (const m of s.matchAll(words)) out.push(m[1] + ":" + (m[2] || "-")); return out; }
export function replaceAll(s: string): string { return s.replace(/[aeiou]/g, c => c.toUpperCase()).replace(/(\w)(\w)/, "$2$1"); }
export function kind(s: string): number { switch (s) { case "alpha": return 1; case "beta": return 2; case "gamma": return 3; case "delta": return 4; default: return bump(0) * 0 - 1; } }
export function tag(strings: TemplateStringsArray, ...v: unknown[]): string { return strings.raw.join("|") + "#" + v.join(",") + "#" + (strings === lastStrings ? "same" : "new") + ((lastStrings = strings), ""); }
let lastStrings: TemplateStringsArray | undefined;
export function tagged(n: number): string { return tag`a${n}b${makePoint(n, 1).x}c`; }
export function* range(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i * i; }
export async function later<T>(v: T): Promise<T> { await null; return v; }
export async function* stream(n: number): AsyncGenerator<string> { for (let i = 0; i < n; i++) { await null; yield "s" + i; } }
export function rest(a: number, ...more: number[]): number { return more.reduce((x, y) => x + y, a); }
export function spread(o: Record<string, number>): string { const { a, ...others } = o; return a + JSON.stringify({ ...others, z: 1 }); }
export function fail(depth: number): never { if (depth) return fail(depth - 1); const o: any = { inner: undefined }; return o.inner.value; }
export function tdz(): unknown { const f = () => late; const r = f(); let late = 1; return r; }
