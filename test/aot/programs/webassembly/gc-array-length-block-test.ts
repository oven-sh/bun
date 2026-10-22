// The two classes are the only layouts, so their layout set can get a block test, which compares two bytes of the shape word. No length of a WebAssembly GC array passes it.
interface Shape { side: number; }
class Circle implements Shape { side = 1; }
class Square implements Shape { side = 2; }

function readSide(s: Shape) { return s.side; }

const circle = new Circle();
const square = new Square();
let sideSum = 0;
for (let i = 0; i < 1000; i++) sideSum += readSide(i & 1 ? square : circle);
console.log("side", sideSum);

// (type $b (array (mut i8)))
// (func (export "makeBytes") (param i32) (result (ref $b)) local.get 0 array.new_default $b)
const gcModule = new WebAssembly.Module(
  new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x0a, 0x02, 0x5e, 0x78, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x64, 0x00,
    0x03, 0x02, 0x01, 0x01,
    0x07, 0x0d, 0x01, 0x09, 0x6d, 0x61, 0x6b, 0x65, 0x42, 0x79, 0x74, 0x65, 0x73, 0x00, 0x00,
    0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0xfb, 0x07, 0x00, 0x0b,
  ]),
);
const { makeBytes } = new WebAssembly.Instance(gcModule, {}).exports as any;

let mismatches = 0;
for (const length of [0x00ff0000, 0x00ff8000, 0x00ffff00, 0x00ffffff, 0x01ffff80]) {
  if (readSide(makeBytes(length)) !== undefined) mismatches++;
}
console.log("mismatches", mismatches);
console.log(readSide(square));
