import { expect, test } from "bun:test";
import "harness";
import { join } from "path";

test("expect dns.lookup to keep the process alive", () => {
  expect([join(import.meta.dir, "dns-fixture.js")]).toRun();
});
