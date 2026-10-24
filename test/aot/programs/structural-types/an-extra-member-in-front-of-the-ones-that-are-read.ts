interface Point {
  x: number;
  y: number;
}

function sum(p: Point): number {
  return p.x + p.y;
}

const wide = { name: "wide", x: 1, y: 2 };
console.log(sum({ x: 10, y: 20 }));
console.log(sum(wide));
console.log(sum({ x: 30, y: 40 }));

export {};
