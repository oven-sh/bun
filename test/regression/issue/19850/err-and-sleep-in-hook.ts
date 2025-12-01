import { beforeEach, test } from "bun:test";

beforeEach(() => {
  Bun.sleepSync(50);
  throw new Error("beforeEach");
});

test("test 0", () => {});
