// A WebAssembly GC struct or array never passes a shape test, whatever its fields, its elements and its length are.
class Point { x = 1; y = 2; }
class Named { name = "n"; then = 3; }
class Size { width = 4; height = 5; }
class Interval { start = 6; end = 7; x = 8; }
class Pair { first = 9; second = 10; then = 11; }
class Entry { x = 12; then = 13; }

interface Shape { side: number; }
class Circle implements Shape { side = 35; }
class Square implements Shape { side = 36; }

const samples: any[] = [
  new Point(),
  new Named(),
  new Size(),
  new Interval(),
  new Pair(),
  new Entry(),
  { x: 14 },
  { then: 15 },
  { x: 16, then: 17 },
  { y: 18 },
  { y: 19, x: 20 },
  { name: "m" },
  { name: "m", x: 21 },
  { width: 22 },
  { width: 23, then: 24 },
  { first: 25 },
  { first: 26, second: 27 },
  { first: 28, second: 29, x: 30 },
  { start: 31 },
  { start: 32, end: 33, then: 34 },
];
const circle = new Circle();
const square = new Square();

function readX(o: any) { return o.x; }
function readThen(o: any) { return o.then; }
function readSide(s: Shape) { return s.side; }
function keys(o: any) { return Object.keys(o).length; }
function isPoint(o: unknown) { return o instanceof Point; }

let xSum = 0;
let thenSum = 0;
let sideSum = 0;
let keyCount = 0;
let pointCount = 0;
for (let i = 0; i < 1000; i++) {
  const sample = samples[i % samples.length];
  xSum += readX(sample) ?? 0;
  thenSum += readThen(sample) ?? 0;
  sideSum += readSide(i & 1 ? square : circle);
  keyCount += keys(sample);
  if (isPoint(sample)) pointCount++;
}
console.log("x", xSum);
console.log("then", thenSum);
console.log("side", sideSum);
console.log("keys", keyCount);
console.log("points", pointCount);

// (type $s (struct (field i32) (field i32))) (type $a (array (mut i32))) (type $b (array (mut i8)))
// (func (export "make") (param i32 i32) (result (ref $s)) local.get 0 local.get 1 struct.new $s)
// (func (export "makeArray") (param i32 i32) (result (ref $a)) local.get 0 local.get 1 array.new $a)
// (func (export "makeBytes") (param i32) (result (ref $b)) local.get 0 array.new_default $b)
const gcModule = new WebAssembly.Module(
  new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x21, 0x06, 0x5f, 0x02, 0x7f, 0x00, 0x7f, 0x00, 0x5e, 0x7f, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x64, 0x00, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x64, 0x01, 0x5e, 0x78, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x64, 0x04,
    0x03, 0x04, 0x03, 0x02, 0x03, 0x05,
    0x07, 0x20, 0x03, 0x04, 0x6d, 0x61, 0x6b, 0x65, 0x00, 0x00, 0x09, 0x6d, 0x61, 0x6b, 0x65, 0x41, 0x72, 0x72, 0x61, 0x79, 0x00, 0x01, 0x09, 0x6d, 0x61, 0x6b, 0x65, 0x42, 0x79, 0x74, 0x65, 0x73, 0x00, 0x02,
    0x0a, 0x1d, 0x03, 0x09, 0x00, 0x20, 0x00, 0x20, 0x01, 0xfb, 0x00, 0x00, 0x0b, 0x09, 0x00, 0x20, 0x00, 0x20, 0x01, 0xfb, 0x06, 0x01, 0x0b, 0x07, 0x00, 0x20, 0x00, 0xfb, 0x07, 0x04, 0x0b,
  ]),
);
const { make, makeArray, makeBytes } = new WebAssembly.Instance(gcModule, {}).exports as any;

function countMismatches(o: any) {
  let count = 0;
  if (readX(o) !== undefined) count++;
  if (readThen(o) !== undefined) count++;
  if (readSide(o) !== undefined) count++;
  if (keys(o) !== 0) count++;
  if (isPoint(o)) count++;
  if (typeof o !== "object") count++;
  if (Object.getPrototypeOf(o) !== null) count++;
  if ("x" in o) count++;
  return count;
}

const retained: any[] = [];
let mismatches = 0;
for (let k = 1; k <= 64; k++) {
  const s = make(7, -k);
  const a = makeArray(-k, 1);
  mismatches += countMismatches(s) + countMismatches(a);
  retained.push(s, a);
}
for (const length of [0x00ff0000, 0x00ff8000, 0x00ffff00, 0x00ffffff, 0x01ffff80]) {
  const bytes = makeBytes(length);
  mismatches += countMismatches(bytes);
  retained.push(bytes);
}
Bun.gc(true);
for (const o of retained) mismatches += countMismatches(o);
console.log("mismatches", mismatches);
console.log(readX(new Point()));
console.log(readSide(circle));
