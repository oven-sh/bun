// Accesses through a type that also admits objects from elsewhere share a shape test per receiver. Where a later receiver fails its test and only fields of records have been read so far,
// the reads are simply made again by name: nothing is handed from one path to the other. What follows the last covered access is not copied.
// IRT= 0 twoReceivers Branch .*: b[0-9]+\(v
// IRT= 0 threeReceivers Branch .*: b[0-9]+\(v
// IRT= 0 nested Branch .*: b[0-9]+\(v
// IRT= 1 storeBetween Branch .*: b[0-9]+\(v
// IRT= 3 label = (Add|Strcat)\b
interface Inner { v: number; w: number }
interface Point { x: number; y: number; z: number; w: number; inner: Inner }
function make(i: number): Point { return { x: i + 0.5, y: i + 1.5, z: i + 2.5, w: i + 3.5, inner: { v: i, w: i + 1 } } }
let log: string[] = [];
function elsewhere(i: number): Point {
  const made: any = { inner: { v: i + 10, w: i + 11, more: 1 } };
  for (const name of ["x", "y", "z", "w"]) {
    let held = i + name.charCodeAt(0) + 0.25;
    Object.defineProperty(made, name, { get() { log.push("get " + name); return held }, set(v) { log.push("set " + name); held = v }, enumerable: true, configurable: true });
  }
  return made;
}
function twoReceivers(o: Point, p: Point): number { return o.x + p.x + o.y + p.y }
function threeReceivers(o: Point, p: Point, q: Point): number { return o.x + o.y + p.x + p.y + q.x + q.y }
function nested(o: Point): number { return o.inner.v + o.inner.w + o.x }
function storeBetween(o: Point, p: Point): number { o.z = o.x + 1; return o.z + p.x + o.y }
function label(o: Point, text: string): string { return text + o.x + text + "-" + text }
const table = [twoReceivers, threeReceivers, nested, storeBetween, label];
(globalThis as { kept?: unknown }).kept = table;
const lines: string[] = [];
function say(what: string, value: unknown): void { lines.push(what + ": " + value + (log.length ? " [" + log.join(" ") + "]" : "")); log = [] }
for (let i = 0; i < 4; i++) {
  say("two records", twoReceivers(make(i), make(i + 1)));
  say("the second from elsewhere", twoReceivers(make(i), elsewhere(i)));
  say("the first from elsewhere", twoReceivers(elsewhere(i), make(i)));
  say("both from elsewhere", twoReceivers(elsewhere(i), elsewhere(i + 1)));
  say("the third from elsewhere", threeReceivers(make(i), make(i + 1), elsewhere(i)));
  say("the second of three from elsewhere", threeReceivers(make(i), elsewhere(i), make(i + 1)));
  say("nested", nested(make(i)) + " " + nested(elsewhere(i)));
  const inside = make(i); (inside as { inner: unknown }).inner = elsewhere(i).inner;
  say("a record that holds an object from elsewhere", nested(inside));
  const stored = make(i);
  say("a store between", storeBetween(stored, elsewhere(i)) + " " + stored.z);
  say("a store between, both from elsewhere", storeBetween(elsewhere(i), elsewhere(i + 1)));
  say("a label", label(make(i), "a") + " " + label(elsewhere(i), "b"));
}
console.log(lines.join("\n"));
