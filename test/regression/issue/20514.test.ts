import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/20514
test("test", () => {
  expect([
    "-p",
    `Object.defineProperty(Object.prototype, "1", {
      set: function (value) {
        throw new Error();
      }
});
const homeDir = process.env.HOME || process.env.USERPROFILE;`,
  ]).toRun();
});
