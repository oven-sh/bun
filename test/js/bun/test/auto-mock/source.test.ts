import { expect, test } from "bun:test";
import result from "./source";
import { foo } from "./foo";

test("uses __mocks__ for non-test imports", () => {
  expect(result).toBe("mock");
  expect(foo).toBe("real");
});
