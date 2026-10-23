import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";

const i32 = 0x7f;
const i8 = 0x78;
const immutable = 0x00;
const mutable = 0x01;
const nonNullReferenceTo = (type: number) => [0x64, type];
const localGet = (index: number) => [0x20, index];
const structNew = (type: number) => [0xfb, 0x00, type];
const arrayNew = (type: number) => [0xfb, 0x06, type];
const arrayNewDefault = (type: number) => [0xfb, 0x07, type];
const end = 0x0b;

const vector = (items: number[][]) => [items.length, ...items.flat()];
const section = (id: number, bytes: number[]) => [id, bytes.length, ...bytes];
const structType = (fields: number[][]) => [0x5f, ...vector(fields)];
const arrayType = (element: number, mutability: number) => [0x5e, element, mutability];
const functionType = (parameters: number[], result: number[]) => [0x60, parameters.length, ...parameters, 1, ...result];
const exportedFunction = (name: string, index: number) => [name.length, ...Buffer.from(name), 0x00, index];
const body = (instructions: number[][]) => {
  const bytes = [0, ...instructions.flat(), end];
  return [bytes.length, ...bytes];
};

const pair = 0;
const words = 1;
const makePairType = 2;
const makeWordsType = 3;
const bytes = 4;
const makeBytesType = 5;

const module = new WebAssembly.Module(
  new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...section(
      1,
      vector([
        structType([
          [i32, immutable],
          [i32, immutable],
        ]),
        arrayType(i32, mutable),
        functionType([i32, i32], nonNullReferenceTo(pair)),
        functionType([i32, i32], nonNullReferenceTo(words)),
        arrayType(i8, mutable),
        functionType([i32], nonNullReferenceTo(bytes)),
      ]),
    ),
    ...section(3, vector([[makePairType], [makeWordsType], [makeBytesType]])),
    ...section(
      7,
      vector([exportedFunction("makePair", 0), exportedFunction("makeWords", 1), exportedFunction("makeBytes", 2)]),
    ),
    ...section(
      10,
      vector([
        body([localGet(0), localGet(1), structNew(pair)]),
        body([localGet(0), localGet(1), arrayNew(words)]),
        body([localGet(0), arrayNewDefault(bytes)]),
      ]),
    ),
  ]),
);

const { makePair, makeWords, makeBytes } = new WebAssembly.Instance(module, {}).exports as {
  makePair(first: number, second: number): object;
  makeWords(value: number, length: number): object;
  makeBytes(length: number): object;
};

test("a WebAssembly GC struct is its 8-byte header and its fields", () => {
  expect(estimateShallowMemoryUsageOf(makePair(1, 2))).toBe(16);
});

// A build with assertions keeps one more field in the header.
test.skipIf(isASAN || isDebug)(
  "a WebAssembly GC array of narrow elements is its 12-byte header and its elements",
  () => {
    expect(estimateShallowMemoryUsageOf(makeWords(7, 1))).toBe(16);
    expect(estimateShallowMemoryUsageOf(makeWords(7, 2))).toBe(32);
    expect(estimateShallowMemoryUsageOf(makeWords(7, 5))).toBe(32);
    expect(estimateShallowMemoryUsageOf(makeBytes(4))).toBe(16);
    expect(estimateShallowMemoryUsageOf(makeBytes(5))).toBe(32);
  },
);
