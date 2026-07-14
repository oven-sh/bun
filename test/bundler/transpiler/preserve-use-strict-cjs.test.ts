import { expect, test } from "bun:test";
import path from "path";

test.skipIf(isOhos)(`"use strict'; preserves strict mode in CJS`, async () => {
  expect([path.join(import.meta.dir, "strict-mode-fixture.ts")]).toRun();
});

test.skipIf(isOhos)(`sloppy mode by default in CJS`, async () => {
  expect([path.join(import.meta.dir, "sloppy-mode-fixture.ts")]).toRun();
});
