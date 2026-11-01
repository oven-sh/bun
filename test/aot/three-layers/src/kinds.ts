import { Base } from "one-site";
export type Options = { a: number; b?: string; name?: string; level?: number; extra?: unknown; list?: number[]; inner?: { x: number; y?: number } };
export class Plain { a = 1; b = "b"; name?: string; level?: number; extra: unknown; }
export class Derived extends Base { a = 2; own = "derived"; level?: number; describe() { return "d:" + super.describe(); } }
export class WithAccessors { #hidden = 5; a = 3; get name() { return "acc" + this.#hidden; } set name(v: string) { this.#hidden = v.length; } get level() { return this.#hidden; } }
// The layout has fields that the object does not have yet: whoever stores them first creates them, in whichever order.
export function partly(i: number): Options {
  const o: Options = { a: i };
  if (i < 0 || i % 4 === 1) { o.b = "x"; o.name = "n"; o.level = 1; o.extra = 2; o.list = [1]; o.inner = { x: 1 }; }
  return o;
}
export function partlyOtherOrder(i: number): Options {
  const o: Options = { a: i };
  if (i < 0) { o.inner = { x: 1 }; o.extra = 2; o.level = 1; o.name = "n"; o.b = "x"; }
  else if (i % 3 === 0) o.level = i;
  return o;
}
export class Lazy { a = 1; b?: string; name?: string; level?: number; extra?: unknown; fill() { this.b = "b"; this.name = "n"; this.level = 2; this.extra = 3; return this; } }
export const srcMakers: ((i: number) => any)[] = [
  i => partly(i),
  i => partlyOtherOrder(i),
  i => new Lazy(),
  i => (i % 2 ? new Lazy().fill() : new Lazy()),
  i => ({ a: i }) as Options,
  i => ({ a: i, b: "s" + i }) as Options,
  i => ({ a: i, level: i * 2, inner: { x: i } }) as Options,
  i => ({ a: i + 0.5, list: [i] }) as Options,
  i => new Plain(),
  i => new Derived(),
  i => new WithAccessors(),
  i => Object.freeze({ a: i, b: "frozen" }),
  i => Object.seal({ a: i, name: "sealed" }),
  i => Object.preventExtensions({ a: i, level: 1 }),
  i => { const o: Options = { a: i }; o.name = "late"; o.extra = i; return o; },
  i => { const o: any = { a: i, b: "x", name: "y" }; delete o.b; return o; },
];
