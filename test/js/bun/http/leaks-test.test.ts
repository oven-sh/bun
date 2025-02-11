import { expect, test } from "bun:test";
import "harness";
import { join } from "path";

// This test was never leaking, as far as i can tell.
test("request error doesn't leak", async () => {
  expect([join(import.meta.dir, "request-constructor-leak-fixture.js")]).toRun();
});

test("response error doesn't leak", async () => {
  expect([join(import.meta.dir, "response-constructor-leak-fixture.js")]).toRun();
});
