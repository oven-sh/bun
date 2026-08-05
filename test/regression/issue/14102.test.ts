// https://github.com/oven-sh/bun/issues/14102
// `new File(...)[Symbol.toStringTag]` returns "Blob" instead of "File"
import { test, expect } from "bun:test";

test("File[Symbol.toStringTag] is 'File', Blob stays 'Blob' (#14102)", () => {
  const file = new File(["x"], "a.txt");
  const blob = new Blob(["x"]);

  // File should have its own toStringTag
  expect(file[Symbol.toStringTag]).toBe("File");
  expect(Object.prototype.toString.call(file)).toBe("[object File]");

  // Blob should be unaffected
  expect(blob[Symbol.toStringTag]).toBe("Blob");
  expect(Object.prototype.toString.call(blob)).toBe("[object Blob]");

  // instanceof checks
  expect(file instanceof File).toBe(true);
  expect(file instanceof Blob).toBe(true);

  // The tag must be non-enumerable (per spec) so it does not leak into spreads.
  const desc = Object.getOwnPropertyDescriptor(file, Symbol.toStringTag);
  expect(desc?.enumerable).toBe(false);
  expect(Object.getOwnPropertySymbols({ ...file })).not.toContain(Symbol.toStringTag);
});
