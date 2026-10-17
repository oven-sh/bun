// As wider-optional-field-costs-nothing, for what is kept as a number or a boolean with a mark for "absent": `Point` fits `Loose`, the fields of one name lie in one place, an object made as `Loose` may lack them, no `Point` ever does. Through `Point` a store is a store and a read is a load.
// CALLS- putNumberThroughPoint DidCreate
// CALLS- putBooleanThroughPoint DidCreate
// CALLS+ putNumberThroughLoose DidCreate
// SIZE< putNumberThroughPoint 40
// SIZE< getNumberThroughPoint 20
// SIZE< putBooleanThroughPoint 40
// SIZE< getBooleanThroughPoint 24
// VALIDATED compiles
type Point = { x: number; y: number; on: boolean; many: number };
type Loose = { x: number; y?: number; on?: boolean; many?: number };
function putNumberThroughPoint(p: Point, n: number) { p.y = n }
function getNumberThroughPoint(p: Point): number { return p.y }
function putBooleanThroughPoint(p: Point, b: boolean) { p.on = b }
function getBooleanThroughPoint(p: Point): boolean { return p.on }
function putNumberThroughLoose(o: Loose, n: number) { o.y = n }
function seenThroughLoose(o: Loose): string { return String(o.y) + " " + String(o.on) + " " + String(o.many) }
(globalThis as { kept?: unknown }).kept = [putNumberThroughPoint, getNumberThroughPoint, putBooleanThroughPoint, getBooleanThroughPoint, putNumberThroughLoose, seenThroughLoose];
const point: Point = { x: 1, y: 2.5, on: true, many: 7 };
const loose: Loose = { x: 3 };
console.log(getNumberThroughPoint(point), getBooleanThroughPoint(point), seenThroughLoose(point), "|", seenThroughLoose(loose), Object.keys(loose).join());
putNumberThroughPoint(point, 2.5);
for (const n of [3.5, NaN, -0, 1e300, 4]) { putNumberThroughPoint(point, n); console.log(Object.is(getNumberThroughPoint(point), n), seenThroughLoose(point)) }
putBooleanThroughPoint(point, false); putNumberThroughLoose(loose, 0.5); putNumberThroughLoose(point, 9.5);
console.log(getNumberThroughPoint(point), getBooleanThroughPoint(point), seenThroughLoose(loose), Object.keys(point).join(), Object.keys(loose).join(), JSON.stringify(point), JSON.stringify(loose));
