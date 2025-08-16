import { mock } from "bun:test";

const mockTrue = mock(() => true);

test("should work with explicit import from bun:test", () => {
  expect(mockTrue()).toEqual(true);
});
