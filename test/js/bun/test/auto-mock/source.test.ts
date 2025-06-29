import { expect, test } from "bun:test";
import { foo } from "./foo";
import result from "./source";

test("uses __mocks__ for non-test imports", () => {
  expect(result).toBe("mock");
  expect(foo).toBe("real");
});
