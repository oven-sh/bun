import { beforeEach, it, expect } from "bun:test";
beforeEach(async () => {
  await Bun.sleep(100);
  throw 5;
});
it("test 0", () => {
  expect(1).toBe(0);
});
