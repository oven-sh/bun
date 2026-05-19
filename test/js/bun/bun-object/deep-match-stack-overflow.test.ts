import { test, expect } from "bun:test";

function makeDeep(depth: number) {
  const root: Record<string, unknown> = {};
  let p = root;
  for (let i = 0; i < depth; i++) {
    p.c = {};
    p = p.c as Record<string, unknown>;
  }
  return root;
}

test("Bun.deepMatch throws RangeError on deeply nested objects instead of crashing", () => {
  const a = makeDeep(100000);
  const b = makeDeep(100000);
  expect(() => Bun.deepMatch(a, b)).toThrow(RangeError);
});

test("expect().toMatchObject() throws RangeError on deeply nested objects instead of crashing", () => {
  const a = makeDeep(100000);
  const b = makeDeep(100000);
  expect(() => expect(a).toMatchObject(b)).toThrow(RangeError);
});
