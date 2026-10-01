export function shared(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += i * i; return t; }
export class Counter { value: number; constructor(v: number) { this.value = v; } add(n: number): this { this.value += n; return this; } }
export const table = new Map<string, number>([["a", 1], ["b", 2]]);
export function describe(o: { a: number; b: string }): string { return `${o.a}:${o.b}:${Math.floor(o.a / 2)}:${Object.keys(o).join()}`; }
export function thrower(): never { throw new RangeError("from lib"); }
