import { Base, holdAndCall, deep } from "fake-shapes/more";
import { Vec2 } from "fake-typed";
export class Middle extends Base { override who(): string { return "middle"; } extra = 1; }
export class Quiet extends Base {}
export function throughSrc(f: (seed: number) => unknown, seed: number): unknown[] { const mine = new Vec2(seed, seed + 1), text = "src" + seed; const inner = holdAndCall(f, seed); return [mine.parts(), text, inner]; }
export function deepThroughSrc(n: number, f: () => number): number { const keep = [n, new Vec2(n, n)] as const; return deep(n, () => f() + keep[1].x); }
export let setting = "initial";
export function setSetting(value: string): void { setting = value; }
export const lazyValue = { get now() { return setting; } };
export function typedSum(a: number, b: number): number { return a + b; }
export function typedLength(text: string): number { return text.length; }
export function typedFirst(list: number[]): number | undefined { return list[0]; }
export function typedVec(v: Vec2): number { return v.x * 10 + v.y; }
export function typedOptional(a: number, b?: number, ...rest: number[]): string { return [a, b, rest.length].join(); }
export function typedRecord(r: { id: number; label: string }): string { return r.label + r.id; }
export function typedUnion(v: number | string | null): string { return v === null ? "null" : typeof v === "number" ? "n" + (v + 1) : "s" + v.length; }
export function typedCallback(f: (n: number) => number): number { return f(1) + 1; }
