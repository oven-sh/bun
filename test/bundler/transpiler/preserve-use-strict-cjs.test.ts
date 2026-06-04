import { expect, test } from "bun:test";
import path from "path";

test(`"use strict'; preserves strict mode in CJS`, async () => {
  expect([path.join(import.meta.dir, "strict-mode-fixture.ts")]).toRun();
});

test(`sloppy mode by default in CJS`, async () => {
  expect([path.join(import.meta.dir, "sloppy-mode-fixture.ts")]).toRun();
});

// https://github.com/oven-sh/bun/issues/31806
test(`function-level "use strict" is honored in CJS`, async () => {
  expect([path.join(import.meta.dir, "function-use-strict-cjs-fixture.cjs")]).toRun();
});

test(`function-level "use strict" survives require() of a CJS module`, async () => {
  expect([path.join(import.meta.dir, "function-use-strict-require-entry-fixture.cjs")]).toRun();
});
