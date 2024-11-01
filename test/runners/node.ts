import { mock, test, describe } from "bun:test";

console.log("preload");
mock.module("node:test", () => {
  return {
    default: test,
    test: test,
    describe: describe,
  };
});
