interface Pair {
  a: number;
  optional?: number;
  b: number;
}
interface Wider extends Pair {
  c: number;
}
const later: Pair = { a: 1, b: 2 };
later.optional = 3;
const wider: Wider = { ...later, a: 5, c: 6 };
const copy: Pair = { ...wider };
class Base {
  x = 1;
}
const adopted: Base = Object.setPrototypeOf({ x: 2 }, Base.prototype);
console.log(JSON.stringify(wider), JSON.stringify(copy), adopted instanceof Base, adopted.x);
