interface Point {
  x: number;
  y: number;
}
function norm(point: Point): number {
  return point.x * point.x + point.y * point.y;
}
function total(text: string): number {
  const points: Point[] = JSON.parse(text);
  let sum = 0;
  for (const point of points) sum += norm(point);
  return sum;
}
let warm = 0;
for (let i = 0; i < 3; i++) warm += norm({ x: i, y: 1 });
console.log(warm, total('[{"x":3,"y":4}]'));
