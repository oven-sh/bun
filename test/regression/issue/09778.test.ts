import { runInNewContext } from "node:vm";
import { test, expect } from "bun:test";

test("issue #9778", () => {
  const code = `
    process.on("poop", () => {
      throw new Error("woopsie");
    });
    `;

  runInNewContext(code, {
    process,
  });
  expect(() => process.emit("poop")).toThrow("woopsie");
});
