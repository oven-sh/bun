import { isDeepStrictEqual } from "node:util";
import assert from "node:assert";
const left = { a: [1, { b: new Map([["k", new Set([1, 2])]]) }], when: new Date(5), bytes: new Uint8Array([1, 2]) };
const right = { a: [1, { b: new Map([["k", new Set([2, 1])]]) }], when: new Date(5), bytes: new Uint8Array([1, 2]) };
console.log(
  Bun.deepEquals(left, right),
  Bun.deepEquals(left, { ...right, extra: undefined }),
  Bun.deepEquals(left, { ...right, extra: undefined }, true),
);
console.log(Bun.deepMatch({ a: [1] }, { a: [1], b: 2 }), Bun.deepMatch({ a: [2] }, { a: [1], b: 2 }));
console.log(isDeepStrictEqual(left, right), isDeepStrictEqual([1, 2], [1, "2"]), isDeepStrictEqual(NaN, NaN));
assert.partialDeepStrictEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } });
try {
  assert.partialDeepStrictEqual({ a: 1 }, { a: 2 });
} catch (error) {
  console.log((error as Error).name);
}
