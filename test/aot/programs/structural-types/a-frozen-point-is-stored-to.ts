interface Point {
  x: number;
  y: number;
}

function setX(p: Point, value: number): void {
  p.x = value;
}

const open: Point = { x: 1, y: 2 };
const frozen: Point = Object.freeze({ x: 1, y: 2 });

setX(open, 5);
console.log(open.x);
try {
  setX(frozen, 5);
  console.log("stored");
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(frozen.x);

export {};
