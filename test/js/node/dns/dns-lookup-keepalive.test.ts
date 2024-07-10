import { describe, expect, test, it } from "bun:test";
import "harness";
import { bunExe } from "harness";
import { join } from "path";

test("expect dns.lookup to keep the process alive", () => {
  expect([join(import.meta.dir, "dns-fixture.js")]).toRun();
});
