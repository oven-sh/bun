// Everything that queries a function's executable, directly or indirectly.
export function ordinary(a: number, b = 2, ...rest: number[]) { return a + b + rest.length; }
export const arrowFn = (x: number) => x + 1;
export async function asyncFn(x: number) { return x + 1; }
export function* genFn(x: number) { yield x; }
export class Klass2 { static s() { return "s"; } m(a: number) { return a; } get g() { return 1; } #p = 2; p() { return this.#p; } field = () => this.#p + 1; }
export class Sub2 extends Klass2 { }
export function noThis(a: number) { return { a }; }
export function usesThis(this: any, a: number) { this.a = a; }
export function outer(x: number) { function inner(y: number) { return () => x + y; } return inner; }
export function tagged(strings: TemplateStringsArray, ...v: unknown[]) { return strings; }
export function template() { return tagged`a${1}b`; }
export function whoCalled() { return new Error("trace").stack!.split("\n").slice(1, 4).map(l => l.trim().replace(/\(.*[\\/]/, "(").replace(/:\d+:\d+/, "")).join(" | "); }
export function viaCallbacks() { return [1, 2, 3].map(arrowFn).filter(x => x > 2).reduce((a, b) => ordinary(a, b), 0); }
export function describe(f: Function) { return [typeof f, f.name, f.length, f.toString().replace(/\s+/g, " ").slice(0, 46)].join("~"); }
