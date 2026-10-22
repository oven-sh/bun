interface Point {
  x: number;
  y: number;
}

const xy: Point = { x: 1, y: 2 };
const yx: Point = { y: 4, x: 3 };

function show(p: Point): void {
  console.log(p.x);
  console.log(p.y);
  console.log(Object.keys(p).join());
  console.log(JSON.stringify(p));
  console.log(JSON.stringify({ ...p }));
  for (const key in p) console.log(key);
}

show(xy);
show(yx);

export {};
