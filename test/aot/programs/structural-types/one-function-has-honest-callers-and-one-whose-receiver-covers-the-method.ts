class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
}

function small(p: Point): number {
  return p.norm();
}

function large(p: Point, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    try {
      total += p.norm();
      if (total > 1e9) throw new RangeError("too large");
    } catch {
      total = 0;
    }
  }
  return total;
}

function honestOne(): string {
  const p = new Point(1, 1);
  return small(p) + " " + large(p, 3);
}

function honestTwo(): string {
  const p = new Point(2, 2);
  return small(p) + " " + large(p, 3);
}

function honestThree(points: Point[]): string {
  return points.map(small).join() + " " + points.map(p => large(p, 2)).join();
}

function odd(): string {
  const p = new Point(3, 3);
  p.norm = () => 7;
  return small(p) + " " + large(p, 3);
}

function oddThroughCall(): string {
  const p = new Point(4, 4);
  p.norm = () => 8;
  return small.call(undefined, p) + " " + large.apply(undefined, [p, 3]) + " " + small.bind(undefined, p)();
}

function oddThroughABuiltIn(): string {
  const p = new Point(5, 5);
  p.norm = () => 9;
  return [p].map(small).join() + " " + Reflect.apply(large, undefined, [p, 3]);
}

console.log("honest one: " + honestOne());
console.log("honest two: " + honestTwo());
console.log("honest three: " + honestThree([new Point(0, 1), new Point(0, 2)]));
console.log("odd: " + odd());
console.log("honest one again: " + honestOne());
console.log("odd through call, apply and bind: " + oddThroughCall());
console.log("odd through a built-in: " + oddThroughABuiltIn());
console.log("honest two again: " + honestTwo());

let sum = 0;
for (let i = 0; i < 2000; i++) sum += honestOne().length + honestTwo().length;
console.log("2000 honest: " + sum);
console.log("odd after them: " + odd() + " | " + oddThroughCall() + " | " + oddThroughABuiltIn());
console.log("honest after that: " + honestOne() + " | " + honestTwo());

export {};
