// The other side of wider-optional-field-costs-nothing: `delete` through the wider type takes the property from a `Point` too. From then on a `Point` may be seen without it: a read finds undefined, and a store creates it anew, as the last of the keys.
// CALLS+ putThroughPoint DidCreate
// VALIDATED compiles
type Point = { x: number; y: number; label: string };
type Loose = { x: number; y?: number; label?: string };
function putThroughPoint(p: Point, s: string) { p.label = s }
function getThroughPoint(p: Point): string { return p.label }
function drop(o: Loose) { delete o.label }
(globalThis as { kept?: unknown }).kept = [putThroughPoint, getThroughPoint, drop];
const point: Point = { x: 1, label: "a", y: 2 };
console.log(getThroughPoint(point), Object.keys(point).join());
drop(point);
console.log(String(getThroughPoint(point)), Object.keys(point).join(), "label" in point, JSON.stringify(point));
putThroughPoint(point, "b");
console.log(getThroughPoint(point), Object.keys(point).join(), "label" in point, JSON.stringify(point));
