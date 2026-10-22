interface Point {
  x: number;
  y: number;
}

function norm(point: Point): number {
  return point.x * point.x + point.y * point.y;
}
function move(point: Point): void {
  point.x += 1;
  point.y -= 1;
}

const written: Point = { x: 3, y: 4 };
const turned: Point = JSON.parse('{"y":4,"x":3}');
const wider: Point = JSON.parse('{"a":0,"x":3,"b":0,"y":4,"c":0}');
const indexed: Point = JSON.parse('{"x":3,"1":0,"y":4,"0":0}');
const twice: Point = JSON.parse('{"x":0,"y":4,"x":3}');
for (const point of [written, turned, wider, indexed, twice]) {
  console.log(norm(point), Object.keys(point).join(), JSON.stringify(point));
  move(point);
  console.log(norm(point), Object.keys(point).join(), JSON.stringify(point));
}
