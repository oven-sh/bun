import { describe, test, expect } from "bun:test";
import path from "path";
describe("shell load", () => {
  test("immediate exit", () => {
    expect([path.join(import.meta.dir, "./shell-immediate-exit-fixture.js")]).toRun();
  });
});
