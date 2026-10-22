interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
  shift(): number {
    return ++this.x;
  }
}

function setX(p: Point): string {
  try {
    p.x = 50;
    return "stored " + p.x;
  } catch (error) {
    return "threw " + (error instanceof TypeError) + " " + p.x;
  }
}

function shift(p: Pair): string {
  try {
    return "shifted " + p.shift();
  } catch (error) {
    return "threw " + (error instanceof TypeError) + " " + p.x;
  }
}

const lock = Object.freeze.bind(Object);

for (let i = 0; i < 2000; i++) {
  setX({ x: 1, y: 2 });
  shift(new Pair());
}

const literal: Point = { x: 1, y: 2 };
const instance = new Pair();
console.log("before: " + setX(literal) + ", " + setX(instance) + ", " + shift(instance));
lock(literal);
lock(instance);
console.log("after: " + setX(literal) + ", " + setX(instance) + ", " + shift(instance));
console.log("frozen: " + Object.isFrozen(literal) + " " + Object.isFrozen(instance));
console.log("others: " + setX({ x: 1, y: 2 }) + ", " + shift(new Pair()));

export {};
