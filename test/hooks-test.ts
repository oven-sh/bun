import { afterEach, beforeEach, expect, test } from "bun:test";

let log: string[] = [];

beforeEach(() => {
  console.log("beforeEach");
  log.push("beforeEach");
});

afterEach(() => {
  console.log("afterEach");
  log.push("afterEach");
});

test(
  "repeat with hooks",
  () => {
    console.log("test");
    log.push("test");
  },
  { repeats: 2 },
);

test("verify order", () => {
  console.log("Final log:", log);
  expect(log).toEqual(["beforeEach", "test", "afterEach", "beforeEach", "test", "afterEach"]);
});
