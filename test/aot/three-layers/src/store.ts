export * from "fake-typed/bus";
export { s, type Infer } from "fake-typed/schema";
export { default as _ } from "fake-cjs";
export * as shapes from "fake-shapes";
import { counter, increment } from "fake-typed";
import { live, bump } from "fake-shapes";
export function readBoth(): [number, number] { return [counter, live]; }
export function bumpBoth(): [number, number] { return [increment(), bump()]; }
const cache = new Map<string, { hits: number; value: unknown }>();
export function cached<T>(key: string, make: () => T): T {
  let entry = cache.get(key);
  if (!entry) cache.set(key, (entry = { hits: 0, value: make() }));
  entry.hits++;
  return entry.value as T;
}
export function hits(key: string): number { return cache.get(key)?.hits ?? 0; }
export const callbacks: Array<(value: number) => number> = [];
export function register(f: (value: number) => number): number { return callbacks.push(f); }
export function runAll(value: number): number[] { return callbacks.map(f => f(value)); }
