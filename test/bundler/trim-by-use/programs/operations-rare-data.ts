interface Point {
  x: number;
  y: number;
  name: string;
}
const point: Point = JSON.parse('{"x":1,"y":2.5,"name":"p"}');
console.log(point.x + point.y, point.name);
const query = new URLSearchParams("a=1&b=2");
console.log([...query.entries()].join(";"), query.get("b"));
