export class Core {
  declare late?: unknown;
  declare more?: number;
  count = 0;
  label: string | undefined = undefined;
  list: number[] | undefined;
  constructor(count?: number) {
    if (count !== undefined) this.count = count;
  }
  describe(): string {
    return this.count + " " + String(this.label) + " " + String(this.list) + " " + String(this.late) + " " + String(this.more);
  }
  ownLate(): unknown {
    return this.late;
  }
  hasLate(): boolean {
    return "late" in this;
  }
  setLate(value: unknown): void {
    this.late = value;
  }
}
export class OtherBase {
  declare late?: unknown;
  other = "of the other base";
  count = -1;
  constructor(count?: number) {
    if (count !== undefined) this.count = -count;
  }
  describe(): string {
    return "other " + this.count + " " + String(this.late);
  }
  ownLate(): unknown {
    return this.late;
  }
  hasLate(): boolean {
    return "late" in this;
  }
  setLate(value: unknown): void {
    this.late = value;
  }
}
export class Small {
  declare late?: unknown;
  count = 0;
  constructor(count?: number) {
    if (count !== undefined) this.count = count;
  }
  describe(): string {
    return "small " + this.count + " " + String(this.late);
  }
  ownLate(): unknown {
    return this.late;
  }
  hasLate(): boolean {
    return "late" in this;
  }
  setLate(value: unknown): void {
    this.late = value;
  }
}
export const readLateOfSmall = (small: Small): unknown => small.late;
export const hasLateOfSmall = (small: Small): boolean => "late" in small;
export const readLateOfOther = (other: OtherBase): unknown => other.late;
export const hasLateOfOther = (other: OtherBase): boolean => "late" in other;
export const readLate = (core: Core): unknown => core.late;
export const hasLate = (core: Core): boolean => "late" in core;
export const readMore = (core: Core): number | undefined => core.more;
export function TypedTarget(this: unknown): void {}
export function TypedTargetForSmall(this: unknown): void {}
export function TypedTargetForOther(this: unknown): void {}
export function makeTypedTarget(kind: string): Function {
  function Target(this: unknown): string {
    return kind;
  }
  return Target;
}
export interface Point {
  x: number;
}
export function PointForCore(this: Point, x: number): void {
  this.x = x;
}
export function PointForSmall(this: Point, x: number): void {
  this.x = x;
}
export function PointForOther(this: Point, x: number): void {
  this.x = x;
}
export const points = (): number => new (PointForCore as any)(1).x + new (PointForSmall as any)(2).x + new (PointForOther as any)(3).x;
export function* GeneratorTarget(): Generator<number> {
  yield 1;
}
