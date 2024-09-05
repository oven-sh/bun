import { expect, test } from "bun:test";
import "harness";
import { fileURLToPath } from "url";

test("Subprocess stdout can be used in Bun.serve()", async () => {
  expect([fileURLToPath(import.meta.resolve("./spawn-stream-http-fixture.js"))]).toRun("hello world");
});
