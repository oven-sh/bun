interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
}

let reads = 0;

const getter: PropertyDescriptor = {
  get() {
    reads++;
    return 70;
  },
  enumerable: true,
  configurable: true,
};

function facts(p: Point): string {
  const before = reads;
  const sum = p.x + p.y;
  return sum + " reads " + (reads - before) + " keys " + Object.keys(p).join("") + " json " + JSON.stringify(p) + " has " + ("x" in p);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += facts({ x: 1, y: 2 }).length + facts(new Pair()).length;
console.log("2000 honest: " + warm + " " + typeof getter.get);

const literal: Point = { x: 1, y: 2 };
const instance = new Pair();
console.log("before: " + facts(literal) + " | " + facts(instance));
Reflect.apply(Object.defineProperty, Object, [literal, "x", getter]);
Reflect.apply(Object.defineProperty, Object, [instance, "x", getter]);
console.log("after: " + facts(literal) + " | " + facts(instance));
console.log("others: " + facts({ x: 1, y: 2 }) + " | " + facts(new Pair()));

export {};
