// A record enters a type with an index signature that takes more than its fields hold, and nobody stores through that type: the function only looks.
// The record keeps its layout, and typed code reads its fields without a test of the shape.
// IR+ ^layout L\d+ .*name="Point" (?!.*isNeverAllocated=true)
// IR- ^layout (L\d+) .*name="Point" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
type Looked = { [key: string]: any };
type Point = { x: number; y: number };
const hasOwnProperty = Object.prototype.hasOwnProperty;
function hasProperty(map: Looked, key: string): boolean { return hasOwnProperty.call(map, key); }
function hasKey(map: Looked, key: string): boolean { return key in map; }
function keysOf(map: Looked): string { let all = ""; for (const key in map) all += key; return all; }
function listed(map: Looked): string { return Object.keys(map).join() + Object.entries(map).length + Object.values(map).length; }
function read(map: Looked, key: string): unknown { return map[key]; }
function owns(map: Looked, key: string): boolean { return Object.hasOwn(map, key) && Object.getOwnPropertyNames(map).includes(key); }
function isListed(map: Looked, key: string): boolean { return Object.prototype.propertyIsEnumerable.call(map, key) && ({}).hasOwnProperty.call(map, key) && Reflect.has(map, key); }
function written(map: Looked): string { return JSON.stringify(map) + Object.prototype.toString.call(map); }
function sum(points: Point[]): number { let total = 0; for (const point of points) total += point.x + point.y; return total; }
const points: Point[] = [];
for (let i = 0; i < 10; i++) points.push({ x: i, y: i * 2 });
console.log(hasProperty(points[1], "x"), hasProperty(points[1], "z"), hasKey(points[2], "y"), hasKey(points[2], "w"));
console.log(keysOf(points[3]), listed(points[4]), read(points[5], "y"), read(points[5], "q"), owns(points[6], "x"), owns(points[6], "toString"));
console.log(isListed(points[7], "y"), isListed(points[7], "z"), written(points[8]));
console.log(sum(points), [hasProperty, hasKey, keysOf, listed, read, owns, isListed, written, sum].map(one => one.name).join());
