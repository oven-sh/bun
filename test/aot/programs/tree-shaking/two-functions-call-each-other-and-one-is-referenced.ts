// isEven and isOdd call each other; the program names only isEven. ping, pong and pang form a ring that is entered at pong, across two files' worth of kinds: a declaration, an arrow constant and a function constant.
function isEven(n: number): boolean {
  return n === 0 ? true : isOdd(n - 1);
}
function isOdd(n: number): boolean {
  return n === 0 ? false : isEven(n - 1);
}

function ping(n: number): string {
  return n === 0 ? "ping" : pong(n - 1);
}
const pong = (n: number): string => (n === 0 ? "pong" : pang(n - 1));
const pang = function (n: number): string {
  return n === 0 ? "pang" : ping(n - 1);
};

function lonelyA(): number {
  return lonelyB();
}
function lonelyB(): number {
  return lonelyA();
}

console.log(isEven(7), isEven(8));
console.log(pong(0), pong(1), pong(2), pong(3));
