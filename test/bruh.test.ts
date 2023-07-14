import { AsyncLocalStorage } from "async_hooks";
import { describe, expect, test } from "bun:test";
const storage = new AsyncLocalStorage();

storage.run("dsafda", () => {
  test("dsafda", () => {
    console.log(1);
  });
});
