// Every value stored into an `int32` or cast to one here is one by proof, so the program builds, no store is tested when it runs, and it prints what plain Bun prints. A cast converts nothing.
// IR- : (i32|int\S*) = Claim v\d+(?!.* isProven)
// VALIDATED compiles
import type { int32 } from "bun";

const given: number[] = JSON.parse("[3, 1.5, 4294967297, -2147483648, 2147483647, -0, 1e300, -7.9]");
const loose: any = JSON.parse("4.5");
const bytes = new Uint8Array([1, 2, 3, 4]);
const text = "some text";
enum Color { Red = 1, Green = 2 }

class Cursor {
  line: int32 = 0;
  column: int32 = -1;
  static made: int32 = 0;
  constructor(public start: int32 = 7) {
    Cursor.made = (Cursor.made + 1) | 0;
  }
  move(by: int32): int32 {
    this.line = (this.line + by) | 0;
    return this.line;
  }
  get twice(): int32 {
    return this.line << 1;
  }
  set half(value: int32) {
    this.line = value >> 1;
  }
}
interface Point {
  x: int32;
  y?: int32;
}
type Lane = int32;

function add(a: int32, b: int32): int32 { return (a + b) | 0; }
function times(a: int32, b: int32): int32 { return Math.imul(a, b); }
function half(a: int32): int32 { return a >> 1; }
function and(a: number, b: number): int32 { return a & b; }
function or(a: number, b: number): int32 { return a | b; }
function xor(a: number, b: number): int32 { return a ^ b; }
function not(a: number): int32 { return ~a; }
function left(a: number, n: number): int32 { return a << n; }
function right(a: number, n: number): int32 { return a >> n; }
function high(a: number): int32 { return a >>> 1; }
function zeros(a: number): int32 { return Math.clz32(a); }
function element(i: int32): int32 { return bytes[i] | 0; }
function elementOrNothing(i: int32): int32 { return bytes[i]; }
function code(i: int32): int32 { return text.charCodeAt(i) | 0; }
function length(s: string): int32 { return s.length; }
function find(s: string): int32 { return s.indexOf("t"); }
function pick(flag: boolean, a: int32): int32 { return flag ? a : 0; }
function first(a: int32 | undefined, b: int32): int32 { return a === undefined ? b : a | 0; }
function color(flag: boolean): int32 { return flag ? Color.Red : Color.Green; }
function small(a: int32): int32 { return (a & 255) + (a & 15) * 3 - 7; }
function rest(a: int32): int32 { return (a & 1023) % 10; }
function quotient(a: int32): int32 { return Math.floor((a & 1023) / 3); }
function least(a: int32, b: int32): int32 { return Math.min(a, b); }
function same(a: int32): int32 { const b: int32 = a; let c: int32 = b; c = a; return c; }
function next(a: int32): int32 { return a < 100 ? a + 1 : a; }
function optional(p: Point): int32 { return p.y ?? 0; }
function maybe(p: Point): int32 { return p.y as number; }
function cast(a: number): int32 { return (a | 0) as int32; }
function castSum(a: int32, b: int32): Lane { return ((a + b) | 0) as Lane; }
function castSame(a: int32): number { return a as int32; }
function opposite(a: int32): int32 { const low = a & 255; return low !== 0 ? -low : 0; }
function previous(a: int32): int32 { return a !== -2147483648 ? a - 1 : a; }
function upTo(from: int32, to: int32): int32 { let last: int32 = 0; for (let i: int32 = from; i < to; i++) last = i; return last; }
function downTo(from: int32, to: int32): int32 { let last: int32 = 0; for (let i: int32 = from; i > to; i--) last = i; return last; }
function scan(s: string): int32 { let at: int32 = 0; while (at < s.length && s.charCodeAt(at) !== 32) at++; return at; }
const double = (a: int32): int32 => a << 1;
function counter(): { next(): int32 } {
  var holder = { next(): int32 { return (count = (count + 1) | 0); } };
  var count: int32 = 4;
  return holder;
}
const addSix = add.bind(null, 6, given[0] | 0);
let late: int32;
const read = (): int32 => late;
const seven = 7 as int32;
interface Token { kind: int32 }
interface TokenConstructor { new (kind: int32): Token }
function Token(this: Token, kind: int32): void { this.kind = kind; }

let kept: int32 = given[0] | 0;
kept = loose | 0;
kept = (given[1] + 1) | 0;
kept |= given[2];
kept &= 255;
kept ^= 3;
kept <<= 2;
kept >>= 1;
const cursor = new Cursor(given[4] | 0);
cursor.line = given[3] | 0;
cursor["column"] = 2 ** 31 - 1;
cursor.half = 9;
const point: Point = { x: given[2] | 0 };
const copy: Point = { ...point, y: 3 };
point.y = cursor.move(5);
for (const n of given) {
  console.log(add(n | 0, 1), times(n | 0, 3), half(n | 0), and(n, 7), or(n, 8), xor(n, 1), not(n), left(n, 3), right(n, 1), high(n), zeros(n));
  console.log(small(n | 0), rest(n | 0), quotient(n | 0), least(n | 0, 5), same(n | 0), next(n | 0), pick(n > 0, n | 0), first(undefined, n | 0), double(n | 0), opposite(n | 0), previous(n | 0));
}
console.log(kept, cursor.line, cursor.column, cursor.start, cursor.twice, Cursor.made, new Cursor().start, point.x, point.y, copy.x, copy.y, optional(point), optional({ x: 1 }));
console.log(counter().next(), addSix(), new (Token as unknown as TokenConstructor)(given[0] | 0).kind);
console.log(element(1), element(9), elementOrNothing(1), elementOrNothing(9), code(1), code(99), length(text), find(text), color(true), upTo(2, 5), upTo(2147483644, 2147483647), downTo(5, 2), downTo(-2147483645, -2147483648), scan(text));
console.log(maybe(point), maybe({ x: 1 }), cast(given[1]), cast(given[2]), castSum(2147483647, 1), castSame(5), seven, read());
late = 1;
console.log(read());
