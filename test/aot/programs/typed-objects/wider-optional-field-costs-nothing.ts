// `Point` fits `Loose`, so an object of the one may be looked at as the other, and the two `label` lie in one place. An object made as `Loose` may lack it. No `Point` ever does: a store through `Point` creates nothing and a read through it asks nothing, whether or not the program has a `Loose`.
// CALLS- putThroughPoint DidCreate
// CALLS+ putThroughLoose DidCreate
// SIZE< putThroughPoint 64
// SIZE< getThroughPoint 24
// VALIDATED compiles
type Point = { x: number; y: number; label: string; next: Point | null };
type Loose = { x: number; y?: number; label?: string; next?: Point | null };
function putThroughPoint(p: Point, s: string) { p.label = s }
function getThroughPoint(p: Point): string { return p.label }
function putThroughLoose(o: Loose, s: string) { o.label = s }
function getThroughLoose(o: Loose): string | undefined { return o.label }
(globalThis as { kept?: unknown }).kept = [putThroughPoint, getThroughPoint, putThroughLoose, getThroughLoose];
const point: Point = { x: 1, y: 2, label: "a", next: null };
const loose: Loose = { x: 3 };
console.log(getThroughPoint(point), getThroughLoose(point), getThroughLoose(loose), Object.keys(point).join(), Object.keys(loose).join());
putThroughPoint(point, "b"); putThroughLoose(loose, "c");
console.log(getThroughPoint(point), getThroughLoose(point), getThroughLoose(loose), Object.keys(point).join(), Object.keys(loose).join());
putThroughLoose(point, "d");
console.log(getThroughPoint(point), JSON.stringify(point), JSON.stringify(loose), "label" in point, "label" in loose, "y" in loose);
