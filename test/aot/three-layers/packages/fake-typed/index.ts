export class Vec2 {
  x: number;
  y: number;
  static readonly zero: Vec2 = new Vec2(0, 0);
  static made = 0;
  constructor(x: number, y: number) { this.x = x; this.y = y; Vec2.made++; }
  add(other: Vec2): Vec2 { return new Vec2(this.x + other.x, this.y + other.y); }
  scale(k: number): this { this.x *= k; this.y *= k; return this; }
  get length(): number { return Math.hypot(this.x, this.y); }
  dims(): number { return 2; }
  toString(): string { return `(${this.parts().join(", ")})`; }
  parts(): number[] { return [this.x, this.y]; }
  equals(other: Vec2): boolean { return this.x === other.x && this.y === other.y; }
  *[Symbol.iterator](): Generator<number, void, unknown> { yield* this.parts(); }
}
export interface Named { name: string; }
export interface Sized { size: number; label?: string; }
export type Item = { kind: "a"; a: number } | { kind: "b"; b: string } | { kind: "c"; c: boolean[] };
export function weigh(item: Item): number {
  switch (item.kind) {
    case "a": return item.a;
    case "b": return item.b.length;
    case "c": return item.c.filter(Boolean).length;
  }
}
export function makeItem(index: number): Item {
  return index % 3 === 0 ? { kind: "a", a: index } : index % 3 === 1 ? { kind: "b", b: "b".repeat(index) } : { kind: "c", c: [true, false, index > 3] };
}
export function sizeOf(thing: Sized): string { return (thing.label ?? "unlabelled") + ":" + thing.size; }
export function nameOf(thing: Named): string { return thing.name; }
export function total(list: readonly Vec2[]): Vec2 { let sum = new Vec2(0, 0); for (const each of list) sum = sum.add(each); return sum; }
export function sumField(list: Array<{ n: number }>): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]!.n; return sum; }
export function grow(record: { n: number; label: string }): { n: number; label: string } { record.n += 1; record.label += "!"; return record; }
export class Option<T> {
  private constructor(private readonly has: boolean, private readonly value: T | undefined) {}
  static some<T>(value: T): Option<T> { return new Option<T>(true, value); }
  static none<T>(): Option<T> { return new Option<T>(false, undefined); }
  map<R>(f: (value: T) => R): Option<R> { return this.has ? Option.some(f(this.value as T)) : Option.none<R>(); }
  orElse(other: T): T { return this.has ? (this.value as T) : other; }
  get isSome(): boolean { return this.has; }
}
export abstract class Animal {
  protected sounds: string[] = [];
  constructor(public readonly name: string, protected legs: number = 4) { this.sounds.push(this.sound()); }
  abstract sound(): string;
  speak(times: number = 1): string { return `${this.name} says ${Array(times).fill(this.sound()).join(" ")}`; }
  get legCount(): number { return this.legs; }
  heard(): string[] { return this.sounds; }
}
export class Dog extends Animal {
  tricks: string[] = ["sit"];
  sound(): string { return "woof"; }
}
export enum Color { Red, Green = 5, Blue }
export const enum Level { Low = 1, High = 10 }
export enum Word { Yes = "yes", No = "no" }
export function colorName(color: Color): string { return Color[color] ?? "none"; }
export let counter = 0;
export function increment(by: number = 1): number { counter += by; return counter; }
export const table: Record<string, number> = { one: 1, two: 2 };
export const list: number[] = [1, 2, 3];
export const config = { depth: 1, nested: { flag: true, names: ["a", "b"] } };
export function apply<T, R>(value: T, f: (value: T) => R): R { return f(value); }
export function eachPair<T>(items: T[], f: (a: T, b: T, index: number) => void): void { for (let i = 0; i + 1 < items.length; i++) f(items[i]!, items[i + 1]!, i); }
export function reduceNumbers(items: number[], f: (sum: number, each: number) => number, start: number): number { let sum = start; for (const each of items) sum = f(sum, each); return sum; }
export function makeAdder(by: number): (value: number) => number { return value => value + by; }
export function makeAccount(start: number) {
  let balance = start;
  return { deposit(n: number) { balance += n; return balance; }, get balance() { return balance; }, history: [start] as number[] };
}
export async function later<T>(value: T, log?: string[]): Promise<T> { log?.push("later starts"); await null; log?.push("later ends"); return value; }
export async function failLater(message: string): Promise<never> { await null; throw new RangeError(message); }
export async function mapAsync<T, R>(items: T[], f: (item: T, index: number) => Promise<R> | R): Promise<R[]> { const out: R[] = []; for (let i = 0; i < items.length; i++) out.push(await f(items[i]!, i)); return out; }
export function* walk<T>(tree: Tree<T>): Generator<T, number, unknown> { let n = 1; yield tree.value; for (const child of tree.children) n += yield* walk(child); return n; }
export interface Tree<T> { value: T; children: Tree<T>[]; }
export function tree<T>(value: T, ...children: Tree<T>[]): Tree<T> { return { value, children }; }
export class Temperature {
  #celsius = 0;
  static #made = 0;
  constructor(celsius: number) { this.#celsius = celsius; Temperature.#made++; }
  get fahrenheit(): number { return this.#celsius * 9 / 5 + 32; }
  set fahrenheit(value: number) { this.#celsius = (value - 32) * 5 / 9; }
  static get made(): number { return Temperature.#made; }
  static same(a: Temperature, b: Temperature): boolean { return a.#celsius === b.#celsius; }
  static is(value: object): boolean { return #celsius in value; }
  valueOf(): number { return this.#celsius; }
}
export function isVec(value: unknown): value is Vec2 { return value instanceof Vec2; }
export function describeUnknown(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array of " + value.length;
  if (value instanceof Vec2) return "vec " + value.toString();
  if (value instanceof Animal) return "animal " + value.name;
  if (value instanceof Error) return "error " + value.message;
  if (typeof value === "object") return "object with " + Object.keys(value).join(",");
  return typeof value;
}
