import { Shape, Circle, PkgError, Serializable, Countable, Stack, Keeper, Bytes } from "fake-shapes";
import { Vec2, Animal, Dog, Temperature, type Sized, type Named, type Item } from "fake-typed";

export class Square extends Shape {
  side: number;
  readonly kind: string = "square";
  initialised = false;
  constructor(name: string, side: number) { super(name); this.side = side; }
  init(): void { this.initialised = true; }
  override area(): number { return this.side * this.side; }
  override *corners(): Generator<[number, number], void, unknown> { yield [0, 0]; yield [this.side, 0]; yield [this.side, this.side]; yield [0, this.side]; }
  static unit(): Square { return new Square("unit", 1); }
}
export class Ring extends Circle {
  hole: number;
  constructor(name: string, r: number, hole: number) { super(name, r); this.hole = hole; }
  override area(): number { return Math.round((super.area() - Math.PI * this.hole * this.hole) * 100) / 100; }
  override get diameter(): number { return super.diameter + 1000; }
  override set diameter(value: number) { super.diameter = value - 1000; }
}
export class Vec3 extends Vec2 {
  z: number;
  constructor(x: number, y: number, z: number) { super(x, y); this.z = z; }
  override parts(): number[] { return [...super.parts(), this.z]; }
  override dims(): number { return super.dims() + 1; }
  override get length(): number { return Math.hypot(this.x, this.y, this.z); }
  override add(other: Vec2): Vec3 { return new Vec3(this.x + other.x, this.y + other.y, this.z + (other instanceof Vec3 ? other.z : 0)); }
}
export class Cat extends Animal {
  lives = 9;
  constructor(name: string) { super(name); }
  sound(): string { return this.lives === undefined ? "silent" : "meow"; }
}
export class Puppy extends Dog {
  override tricks: string[] = ["roll"];
  override sound(): string { return "yip"; }
  override speak(times: number = 2): string { return super.speak(times) + "!"; }
}
export class AppError extends PkgError {
  readonly layer = "src";
  constructor(message: string, readonly detail: { at: string }) { super(message, 42); this.name = "AppError"; }
  override get summary(): string { return "app " + super.summary + " @" + this.detail.at; }
}
export const SerialSquare = Serializable(Square);
export const CountedSquare = Countable(Square);
export const Both = Countable(Serializable(Circle));
export class Pile<T> extends Stack<T> { bottom(): T | undefined { return this[0]; } }
export class Ledger extends Keeper { average(): number { return this.length ? this.sum() / this.length : 0; } }
export class Packet extends Bytes { checksum(): number { let sum = 0; for (const each of this) sum = (sum + each) & 255; return sum; } }
export class Fever extends Temperature { isHigh(): boolean { return this.fahrenheit > 100; } }
export interface User extends Named, Sized { id: number; roles: string[]; address?: { city: string; zip?: string }; }
export function makeUser(id: number): User { return { id, name: "user" + id, size: id * 10, roles: id % 2 ? ["admin", "dev"] : ["dev"], ...(id % 3 === 0 ? { address: { city: "c" + id } } : {}) }; }
export function makeItems(): Item[] { return [{ kind: "a", a: 3 }, { kind: "b", b: "four" }, { kind: "c", c: [true, true, false] }]; }
export const defaults = { retries: 3, verbose: false, tags: ["x"], nested: { limit: 10 } };
export type Settings = typeof defaults;
export function withDefaults(over: Partial<Settings>): Settings { return { ...defaults, ...over }; }
export let created = 0;
export function noteCreated(): number { return ++created; }
export enum Stage { Draft = "draft", Live = "live" }
export const stages: Record<Stage, number> = { [Stage.Draft]: 0, [Stage.Live]: 1 };
