import { test } from "bun:test";

test("importing empty files in the async transpiler does not crash", async () => {
  const promises = new Array(10);
  for (let i = 0; i < 10; i++) {
    promises.push(import("./empty.ts" + "?i" + i));
  }

  await Promise.all(promises);
});
