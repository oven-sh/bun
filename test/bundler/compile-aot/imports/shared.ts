export let counter = 0;
export function bump(): number { counter += 1; return counter; }
export const K = 41;
export class Box { v: number; constructor(v: number) { this.v = v; } get(): number { return this.v; } }
export default function theDefault(): string { return "default"; }
export function neverCalledUntilLate(): string { return "late"; }
export const arrow = (x: number): number => x * 2;
export var legacy = "var";
export function setLegacy(s: string): void { legacy = s; }
function helperBelow(b: Holder): number { return b.base + 1; }
export class Holder { base = 10; readonly viaField = ((): number => helperBelow(this))(); readonly lazy = (): number => helperBelow(this) + K; static s = helperBelow({ base: 1 } as Holder); }
