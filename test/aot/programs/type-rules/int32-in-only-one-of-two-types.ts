// An object of one type is used as another type, and a member is an `int32` in only one of the two: a store or a call through the one declaration would reach the other, so the build stops.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[1.5]");
interface Movable {
  line: number;
  column: int32;
  move(by: number): void;
  width(): int32;
}
class Cursor implements Movable {
  line: int32 = 0;
  column: number = 0;
  move(by: int32): void { this.line = by; }
  width(): number { return 1.5; }
}
class Base {
  at: int32 = 0;
  skip(by: int32): int32 { return by; }
}
class Derived extends Base {
  at: number = 0.5;
  skip(by: int32): number { return by / 2; }
}
class Agreeing extends Base {
  at: int32 = 1;
  skip(by: number): int32 { return by | 0; }
}
interface Point { x: int32 }
class Pixel { x: number = given[0]; }
function use(movable: Movable): number { movable.line = given[0]; movable.move(given[0]); return movable.column + movable.width(); }
function skip(base: Base): int32 { return base.skip(base.at); }
function read(point: Point): int32 { return point.x; }
const wide = { x: given[0] };
console.log(use(new Cursor()), skip(new Derived()), skip(new Agreeing()), read(wide), read(new Pixel()), read({ x: 1 }));
