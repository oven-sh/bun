export function num() { return 41; }
export function dbl() { return 1.5; }
export function str() { return "s"; }
export function bool() { return true; }
export function undef() { }
export function nul() { return null; }
export function obj() { return { a: 1 }; }
export function arr() { return [1, 2, 3]; }
export function fn() { return () => 7; }
export function big() { return 10n; }
export function numOrStr(x: number): any { return x > 0 ? x : "neg"; }
export function numOrUndef(x: number): any { if (x > 0) return x; }
export function viaAny(x: any) { return x; }
export function chain1() { return chain2(); }
export function chain2() { return chain3(); }
export function chain3() { return num(); }
export function mixedChain(x: number): any { return x > 1 ? numOrStr(x - 3) : str(); }
export function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }
export function pingStr(n: number): any { return n === 0 ? "done" : pongNum(n - 1); }
export function pongNum(n: number): any { return n === 0 ? 0 : pingStr(n - 1); }
export function never(): never { throw new Error("never returns"); }
export function callsNever(x: number): any { if (x) return never(); return 5; }
export function loops(): never { for (;;) { if ((globalThis as any).nothingHere) continue; throw new Error("out of the loop"); } }
export async function asy() { return 3; }
export function* gen() { yield 1; return 2; }
export function overflowing() { return 2147483647; }
export function negZero() { return -0; }
export function nan() { return NaN; }
export function tryFinally(x: number): any { try { if (x) return "try"; return 1; } finally { if (x > 1) return null; } }
export function viaCatch(x: any): any { try { return x.y.z; } catch { return "caught"; } }
export function argsObject(): any { return arguments[0]; }
export function defaulted(a = 1, b: any = "b") { return a + b; }
