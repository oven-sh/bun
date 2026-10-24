// An array is a Sized, which requires no name, and the program asserts that Sized to be a Point. Type parameters above Point get points, and once the array.
interface Sized { length?: number }
interface Point { x: number; y: number }
function same<T extends Point>(point: T): T { return point; }
function norm<T extends Point>(point: T, depth: number): number { return depth === 0 ? point.x * point.x + point.y * point.y : norm(point, depth - 1) + point.x; }
const sized: Sized = [1, 2, 3];
const asserted = sized as Point;
console.log(sized.length, asserted.x, same(asserted) === asserted, norm(asserted, 2));
const points: Point[] = [];
for (let i = 0; i < 100; i++) points.push({ x: i, y: i + 1 });
let total = 0;
for (let round = 0; round < 50; round++) for (const point of points) total += norm(same(point), 3);
console.log(total);
