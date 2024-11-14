import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

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
