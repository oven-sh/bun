import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

function structuresMadeFor(enumerable: boolean) {
  const descriptor = { value: 1, enumerable, configurable: true, writable: true };
  const make = () => {
    const object = {};
    Object.defineProperty(object, "first", descriptor);
    Object.defineProperty(object, "second", descriptor);
    delete (object as any).second;
    delete (object as any).first;
    return object;
  };
  const kept = [make()];
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.Structure;
  for (let i = 0; i < 20000; i++) kept.push(make());
  Bun.gc(true);
  return heapStats().objectTypeCounts.Structure - before;
}

test("objects that lose the same non-enumerable properties share their Structures", () => {
  expect(structuresMadeFor(true)).toBeLessThan(2000);
  expect(structuresMadeFor(false)).toBeLessThan(2000);
});
