// The early errors of ECMAScript are looked for in checked TypeScript too. An exported interface has no binding, and a constant may share its name with an imported type: both are valid TypeScript, and plain Bun drops the export and the import.
import { Shape } from "./types";
interface Point { x: number }
export { Point };
const Shape = { side: 2 };
const held: Shape = { side: 3 };
const point: Point = { x: 1 };
console.log(point.x, Shape.side, held.side);
