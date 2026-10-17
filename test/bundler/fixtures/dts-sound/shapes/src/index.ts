import { helper, type Shape } from "./helper";
export abstract class Base<T> {
  protected abstract area(): number;
  declare label: string;
  [key: string]: unknown;
  static toString(): string { return "Base"; }
  describe(this: Base<T>, extra?: T): string { return this.area() + String(extra ?? ""); }
}
export class Square extends Base<number> implements Shape {
  constructor(private readonly side: number) { super(); }
  protected override area(): number { return this.side ** 2; }
  get kind() { return "square" as const; }
}
export const make = async <T extends number>(side: T): Promise<Square> => new Square(side);
export const identity = <T,>(value: T): T => value;
export function first<T>(list: T[]): T;
export function first<T>(list: T[], fallback: T): T;
export function first<T>(list: T[], fallback?: T): T {
  return (list[0] ?? fallback)!;
}
const table = { a: 1, b: 2 } satisfies Record<string, number>;
let late!: number;
late = (table.a + table.b) as number;
export const total = late, other = (<number>late) * 2;
export const sized = (helper({ kind: "square" }) as unknown as { size: number }).size;
export function narrow(value: unknown): value is string { return typeof value === "string"; }
try { narrow(1); } catch (error: unknown) { console.log((error as Error).message); }
for (const [key, value] of Object.entries(table) as [string, number][]) console.log(key, value);
export default class extends Square {}
function local() {
  interface Inner { x: number }
  type Pair = [Inner, Inner];
  const pair: Pair = [{ x: 1 }, { x: 2 }];
  return pair.map((inner: Inner): number => inner.x);
}
console.log(local(), (await make(2)).describe(), identity<string>("x"), new (class { y = 1 })().y);
