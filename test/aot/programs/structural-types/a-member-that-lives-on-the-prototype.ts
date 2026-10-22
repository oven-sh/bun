interface Point {
  x: number;
  y: number;
}

function sum(p: Point): number {
  return p.x + p.y;
}

const child: Point = Object.create({ x: 1, y: 2 });
console.log(sum({ x: 10, y: 20 }));
console.log(sum(child));
console.log(Object.keys(child).length);
console.log(JSON.stringify(child));
console.log(JSON.stringify({ ...child }));
child.x = 5;
console.log(sum(child));
console.log(JSON.stringify(child));

export {};
