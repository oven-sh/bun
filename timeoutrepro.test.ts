import { test, expect } from "bun:test";
import { sleep } from "bun";
test("timeout", async () => {
  await sleep(10000);
});
