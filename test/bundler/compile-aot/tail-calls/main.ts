const attempt = (name: string, f: () => unknown) => { try { console.log(name, f()); } catch (e) { console.log(name, "threw", (e as Error).name); } };
const N = 300000;
function plain(n: number): string { return n ? plain(n - 1) : "done"; }
function rest(n: number, ...more: number[]): string { return n ? rest(n - 1, ...more) : "done " + more.length; }
function restFixed(n: number, ...more: number[]): string { return n ? restFixed(n - 1, 1, 2) : "done " + more.length; }
function tag(strings: TemplateStringsArray, n: number): string { return n ? tag`a${n - 1}b` : "done"; }
function tagRest(strings: TemplateStringsArray, ...values: number[]): string { return values[0] ? tagRest`a${values[0] - 1}b` : "done"; }
function usesArguments(n: number): string { return n ? usesArguments(n - 1) : "done " + arguments.length; }
function many(n: number, a?: any, b?: any, c?: any, d?: any, e?: any, f?: any, g?: any, h?: any, i?: any, j?: any, k?: any, l?: any, m?: any): string { return n ? many(n - 1, a, b, c, d, e, f, g, h, i, j, k, l, m) : "done"; }
function fewer(n: number, a?: any, b?: any, c?: any): string { return n ? fewer(n - 1) : "done " + a; }
function more(n: number): string { return n ? (more as any)(n - 1, 1, 2, 3, 4, 5, 6) : "done"; }
const even = (n: number): boolean => n ? odd(n - 1) : true, odd = (n: number): boolean => n ? even(n - 1) : false;
const o = { m(n: number): string { return n ? this.m(n - 1) : "done"; }, r(n: number, ...x: number[]): string { return n ? this.r(n - 1, ...x) : "done"; } };
function viaCall(n: number): string { return n ? viaCall.call(null, n - 1) : "done"; }
function viaApply(n: number): string { return n ? viaApply.apply(null, [n - 1]) : "done"; }
const unknown = (globalThis as any).nothingHere ? null : (n: number, f: any): string => n ? f(n - 1, f) : "done";
attempt("plain", () => plain(N)); attempt("rest, spread", () => rest(N, 1, 2, 3)); attempt("rest, fixed", () => restFixed(N)); attempt("tagged", () => tag`a${N}b`); attempt("tagged, rest", () => tagRest`a${N}b`);
attempt("arguments", () => usesArguments(N)); attempt("many parameters", () => many(N)); attempt("fewer arguments", () => fewer(N)); attempt("more arguments", () => more(N));
attempt("mutual", () => even(N)); attempt("method", () => o.m(N)); attempt("method, rest", () => o.r(N, 1)); attempt("call", () => viaCall(N)); attempt("apply", () => viaApply(N)); attempt("unknown callee", () => unknown!(N, unknown));
function seen(n: number): number { return n ? hidden(n - 1) : 1; }
function hidden(n: number): number { return n ? seen(n - 1) : 2; }
(globalThis as any).keep = hidden;
attempt("int32, one escapes", () => seen(N));
function seenD(n: number): number { return n ? hiddenD(n - 1) : 1.5; }
function hiddenD(n: number): number { return n ? seenD(n - 1) : 2.5; }
(globalThis as any).keepD = hiddenD;
attempt("double, one escapes", () => seenD(N));
function seenB(n: number): boolean { return n ? hiddenB(n - 1) : true; }
function hiddenB(n: number): boolean { return n ? seenB(n - 1) : false; }
(globalThis as any).keepB = hiddenB;
attempt("boolean, one escapes", () => seenB(N));
function pair(n: number): { a: number; b: number } { return n ? pair2(n - 1) : { a: 1, b: 2 }; }
function pair2(n: number): { a: number; b: number } { return n ? pair(n - 1) : { a: 3, b: 4 }; }
attempt("several values", () => { const { a, b } = pair(N); return a + b; });
function pairE(n: number): { a: number; b: number } { return n ? pairE2(n - 1) : { a: 1, b: 2 }; }
function pairE2(n: number): { a: number; b: number } { return n ? pairE(n - 1) : { a: 3, b: 4 }; }
(globalThis as any).keepP = pairE2;
attempt("several values, one escapes", () => { const { a, b } = pairE(N); return a + b; });
function narrow(n: number): number { return n ? wide(n - 1) as number : 1; }
function wide(n: number): number | string { return n ? narrow(n - 1) : "s"; }
attempt("a wider result", () => narrow(N));
class C { static s(n: number): number { return n ? C.t(n - 1) : 1; } static t(n: number): number { return n ? C.s(n - 1) : 2; } m(n: number): number { return n ? this.k(n - 1) : 1; } k(n: number): number { return n ? this.m(n - 1) : 2; } }
attempt("static methods", () => C.s(N)); attempt("methods", () => new C().m(N));
async function notATailCall(n: number): Promise<number> { return n ? notATailCall(n - 1) : 1; }
attempt("async (not a tail call)", () => typeof notATailCall(1000));
