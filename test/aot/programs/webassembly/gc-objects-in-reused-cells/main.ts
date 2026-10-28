// A WebAssembly GC struct or array in a cell that the collector freed never passes a shape test: the free list leaves its bits where a compiled object has its shape word.
/// <reference path="../wasm-files.d.ts" />
import path from "./module.wasm";

class Point { x = 1; y = 2; }
class Named { name = "n"; then = 3; }
interface Shape { side: number; }
class Circle implements Shape { side = 35; }
class Square implements Shape { side = 36; }

function readX(o: any) { return o.x; }
function readThen(o: any) { return o.then; }
function readSide(s: Shape) { return s.side; }
function keys(o: any) { return Object.keys(o).length; }
function isPoint(o: unknown) { return o instanceof Point; }

const samples: any[] = [new Point(), new Named(), new Circle(), new Square(), { x: 4 }, { then: 5 }, { x: 6, then: 7 }];
let sampleSum = 0;
for (let i = 0; i < 700; i++) {
  const sample = samples[i % samples.length];
  sampleSum += (readX(sample) ?? 0) + (readThen(sample) ?? 0) + (readSide(sample) ?? 0) + keys(sample) + (isPoint(sample) ? 1 : 0);
}
console.log("samples", sampleSum);

const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer())), {}).exports as any;

function countShapeMismatches(o: any) {
  let mismatches = 0;
  if (readX(o) !== undefined) mismatches++;
  if (readThen(o) !== undefined) mismatches++;
  if (readSide(o) !== undefined) mismatches++;
  if (keys(o) !== 0) mismatches++;
  if (isPoint(o)) mismatches++;
  if (typeof o !== "object") mismatches++;
  if (Object.getPrototypeOf(o) !== null) mismatches++;
  if ("x" in o) mismatches++;
  return mismatches;
}

// Two neighbors are of one kind, and an object of any kind takes a cell of 32 bytes.
function kindOf(i: number) { return (i >> 1) & 3; }

function allocate(count: number, round: number) {
  const objects: any[] = [];
  for (let i = 0; i < count; i++) {
    const kind = kindOf(i);
    objects.push(kind === 0 ? e.makeStruct(i, round) : kind === 1 ? e.makeArray(i, 2) : kind === 2 ? e.makePair(i) : e.makeBytes(5));
  }
  return objects;
}

// Every second object is dropped, so each freed cell is a free-list interval of its own, and the first cell of an interval has the bits.
function allocateAndDropEverySecond(count: number, round: number) {
  const objects = allocate(count, round);
  for (let i = 1; i < count; i += 2) objects[i] = null;
  return objects;
}

function countMismatches(objects: any[], round: number) {
  let mismatches = 0;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o === null) continue;
    mismatches += countShapeMismatches(o);
    const kind = kindOf(i);
    const contents = kind === 0 ? e.structSum(o) : kind === 3 ? e.bytesLength(o) : e.arraySum(o);
    if (contents !== (kind === 0 ? i + round : kind === 3 ? 5 : i + 2)) mismatches++;
  }
  return mismatches;
}

const retained = allocateAndDropEverySecond(16384, 1);
Bun.gc(true);
const reused = allocate(16384, 2);
console.log("mismatches", countMismatches(reused, 2), countMismatches(retained, 1));
Bun.gc(true);
console.log("after a collection", countMismatches(reused, 2), countMismatches(retained, 1));

let longArrayMismatches = 0;
for (const length of [0x00ff0000, 0x00ff8000, 0x00ffff00, 0x00ffffff, 0x01ffff80]) {
  const bytes = e.makeBytes(length);
  longArrayMismatches += countShapeMismatches(bytes);
  if (e.bytesLength(bytes) !== length) longArrayMismatches++;
}
console.log("long arrays", longArrayMismatches);
console.log(readX(new Point()), readSide(new Circle()));
