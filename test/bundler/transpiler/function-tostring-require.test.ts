import { test, expect } from "bun:test";

test("toString doesnt observe import.meta.require", () => {
  function hello() {
    return typeof require("fs") === "string" ? "PASS" : "FAIL";
  }
  const newFunctionBody = `return ${hello.toString()}`;
  const loadFakeModule = new Function("require", newFunctionBody)(id => `fake require ${id}`);
  expect(loadFakeModule()).toBe("PASS");
});

export {};
