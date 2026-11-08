export class Shape {
  static count: number;
  static registry: Map<number, Shape>;
  name: string;
  tags: string[];
  constructor(name: string);
  get id(): number;
  static isShape(value: unknown): boolean;
  doubled(): number;
  area(): number;
  describe(): string;
  toJSON(): { kind: string; name: string; area: number };
  static create<T extends new (...args: any[]) => any>(this: T, ...args: ConstructorParameters<T>): InstanceType<T>;
  corners(): Generator<[number, number], void, unknown>;
  withTag(tag: string): this;
  [Symbol.toPrimitive](hint: string): string | number;
}
export class Circle extends Shape {
  r: number;
  constructor(name: string, r: number);
  get diameter(): number;
  set diameter(value: number);
}
export function makePoint(x: number, y: number): { x: number; y: number };
export function makeWide(seed: number): { a: number; b: number; c: string; d: number[]; e: { inner: number }; f: null; g: undefined; h: boolean };
export function makeCounter(): { inc(): number; readonly value: number; reset: () => void };
export const kinds: { readonly circle: "circle"; readonly square: "square"; readonly nested: { readonly deep: "deep" } };
export let live: number;
export function bump(): number;
export const secret: unique symbol;
export const shared: unique symbol;
export function callTwice<A extends unknown[], R>(f: (...args: A) => R, ...args: A): [R, R];
export function callWithNew<A extends unknown[], R>(C: new (...args: A) => R, ...args: A): R;
export function mapValues<T, R>(object: Record<string, T>, f: (value: T, key: string, object: Record<string, T>) => R): Record<string, R>;
type Constructor<T = {}> = new (...args: any[]) => T;
export function Serializable<B extends Constructor>(Base: B): B & Constructor<{ serialize(): string }> & { label(): string };
export function Countable<B extends Constructor<{ describe(): string }>>(Base: B): B & Constructor<{ ordinal: number }> & { made: number };
export class Stack<T> extends Array<T> { top(): T | undefined; }
export class Keeper extends Array<number> { sum(): number; }
export function range(from: number, to: number, step?: number): Generator<number, string, unknown>;
export namespace range { let closed: number | undefined; }
export function ticks(n: number, log?: string[]): AsyncGenerator<number, void, unknown>;
export class PkgError extends Error {
  code: number;
  constructor(message: string, code: number, options?: { cause?: unknown });
  get summary(): string;
}
export function thrower(kind: string, payload?: any): any;
export function guarded<T>(f: () => T, log: string[]): T;
export function tag(strings: TemplateStringsArray, ...values: unknown[]): { strings: TemplateStringsArray; raw: readonly string[]; values: unknown[] };
export function sameTemplate(): boolean;
export function keyOf(index: number): string;
export function builtKey(a: string, b: string): string;
export function readKey(object: any, key: PropertyKey): any;
export function writeKey<T>(object: T, key: PropertyKey, value: unknown): T;
export function hasKey(object: object, key: PropertyKey): boolean;
export function deleteKey(object: any, key: PropertyKey): boolean;
export function switchOn(text: string): number;
export function readX(object: any): any;
export function readName(object: any): any;
export function sumXY(object: any): any;
export function setX(object: any, value: unknown): any;
export function callArea(object: { area(): number }): number;
export function callMethod(object: any, name: PropertyKey, ...args: unknown[]): any;
export function keysOf(object: object): string[];
export function freezeIt<T>(object: T): Readonly<T>;
export function thenable<T>(value: T, log?: string[]): PromiseLike<T>;
export class Lazy<T> extends Promise<T> { static of<T>(value: T): Lazy<T>; }
export class Chained<T> extends Promise<T> { label(): string; }
export class Bytes extends Uint8Array { hex(): string; }
export const registry: Map<unknown, unknown>;
export const weak: WeakMap<object, unknown>;
export const seen: WeakSet<object>;
export function remember(key: unknown, value: unknown): number;
export function recall(key: unknown): [unknown, unknown, boolean];
export function compare(a: unknown, b: unknown): boolean[];
export function sortWith<T>(list: T[], comparator?: (a: T, b: T) => number): T[];
export function compose(...fs: Array<(value: any) => any>): (value: any) => any;
export function curry(f: (...args: any[]) => any): (...args: any[]) => any;
export function once<A extends unknown[], R>(f: (...args: A) => R): (...args: A) => R;
export function argumentsOf(...args: unknown[]): unknown[];
export function defaults(a: number, b?: number, options?: { c?: number; [key: string]: unknown }, list?: number[]): { a: number; b: number; c: number; d: number; rest: Record<string, unknown>; more: number[] };
export const accessors: { _v: number; v: number; readonly self: unknown };
export function Legacy(this: any, name: string): any;
export namespace Legacy { let version: number; }
export default function fallback<T>(value: T | null | undefined): T | string;
