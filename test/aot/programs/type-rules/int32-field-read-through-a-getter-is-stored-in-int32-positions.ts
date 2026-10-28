// Stores an int32 field, read through a getter of an unnamed object, wherever an int32 is declared: variables, fields, parameters, results, setters.
import type { int32 } from "bun";

class Point {
  x: int32 = 1;
  y?: int32;
}
class Factory {
  get point(): Point {
    return new Point();
  }
}
class Owner {
  point = new Point();
  get owned(): Point {
    return this.point;
  }
}
interface Size {
  width: int32;
}
class Kept {
  initialized: int32 = new Factory().point.x;
  #hidden: int32 = 0;
  constructor(public given: int32 = new Factory().point.x) {}
  set hidden(value: int32) {
    this.#hidden = value;
  }
  get hidden(): int32 {
    return this.#hidden;
  }
  keep(value: int32): int32 {
    return value;
  }
}
class Below extends Kept {
  constructor() {
    super(make().point.x);
  }
}

function make(): Factory {
  return new Factory();
}
const owner = new Owner();
function sameOwner(): Owner {
  return owner;
}
function returned(): int32 {
  return new Factory().point.x;
}
const arrow = (): int32 => make().point.x;
function withDefault(n: int32 = new Factory().point.x): int32 {
  return n;
}
function two(a: int32, b: int32): int32 {
  return (a + b) | 0;
}
function count(...all: int32[]): number {
  return all.length;
}
function call(read: () => int32): int32 {
  return read();
}
function* each(): Generator<int32> {
  yield new Factory().point.x;
}

const variable: int32 = new Factory().point.x;
let assigned: int32 = 0;
assigned = make().point.x;
const target = new Point();
target.x = new Factory().point.x;
new Factory().point.x = variable;
const size: Size = { width: new Factory().point.x };
const kept = new Kept();
kept.hidden = make().point.x;
const { x } = new Factory().point;
const { x: renamed } = make().point;
const { y = 4 } = new Factory().point;

sameOwner().owned.x |= 6;
console.log("or", sameOwner().owned.x);
sameOwner().owned.x &= 5;
console.log("and", sameOwner().owned.x);
sameOwner().owned.x <<= 3;
console.log("shift", sameOwner().owned.x);
sameOwner().owned.y ??= 9;
console.log("default", two(sameOwner().owned.y!, 0));

let sum: int32 = 0;
for (let turn = 0; turn < 1000; turn++) sum = (sum + make().point.x) | 0;

let chosen = "";
switch (new Factory().point.x) {
  case 1:
    chosen = "one";
    break;
  default:
    chosen = "other";
}

console.log(variable, assigned, target.x, size.width, kept.initialized, kept.given, kept.hidden, new Below().given);
console.log(
  returned(),
  arrow(),
  withDefault(),
  two(new Factory().point.x, make().point.x),
  count(new Factory().point.x, make().point.x),
);
console.log(
  call(() => new Factory().point.x),
  [...each()].join(),
  new Kept().keep(new Factory().point.x),
  two(x, renamed),
  two(y, 0),
);
console.log(
  sum,
  chosen,
  two(new Factory().point.y ?? 0, 0),
  ["a", "b"][new Factory().point.x],
  `${make().point.x}`,
  new Factory().point.x < 2,
);
