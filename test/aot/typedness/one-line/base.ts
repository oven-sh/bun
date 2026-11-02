export {};

interface Row {
  name: string;
  n: number;
}
interface Order {
  id: number;
  row: Row;
  tags: string[];
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  length(): number {
    return Math.hypot(this.x, this.y);
  }
}
interface Circle {
  kind: "circle";
  radius: number;
}
interface Square {
  kind: "square";
  side: number;
}
type Shape = Circle | Square;

const rows: Row[] = [
  { name: "Ada", n: 1 },
  { name: "Bo", n: 2 },
];
const orders: Order[] = [
  { id: 1, row: rows[0]!, tags: ["a"] },
  { id: 2, row: rows[1]!, tags: ["b", "c"] },
];
const points: Point[] = [new Point(3, 4), new Point(6, 8)];
const shapes: Shape[] = [
  { kind: "circle", radius: 1 },
  { kind: "square", side: 2 },
];
const record: Record<string, Row> = { ada: rows[0]!, bo: rows[1]! };
const byName = new Map<string, Row>([
  ["Ada", rows[0]!],
  ["Bo", rows[1]!],
]);
const unique = new Set<Row>(rows);

function total(list: Row[]): number {
  let sum = 0;
  for (const row of list) sum += row.n;
  return sum;
}
function label(row: Row): string {
  return row.name + ":" + row.n;
}
function describe(order: Order): string {
  return order.id + " " + label(order.row) + " " + order.tags.length + " " + order.row.name;
}
function area(shape: Shape): number {
  return shape.kind === "circle" ? Math.PI * shape.radius ** 2 : shape.side ** 2;
}
function far(point: Point): boolean {
  return point.x + point.y > 10 || point.length() > 9;
}
console.log(total(rows), label(rows[0]!), describe(orders[1]!), area(shapes[0]!), area(shapes[1]!), far(points[0]!), far(points[1]!));
console.log(record.ada!.name, byName.get("Bo")!.n, unique.size);
