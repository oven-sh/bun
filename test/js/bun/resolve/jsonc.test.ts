import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";
test("empty jsonc - package.json", async () => {
  const dir = tempDirWithFiles("jsonc", {
    "package.json": ``,
    "index.ts": `
    import pkg from './package.json';
    if (JSON.stringify(pkg) !== '{}') throw new Error('package.json should be empty');
    `,
  });
  expect([join(dir, "index.ts")]).toRun();
});

test("empty jsonc - tsconfig.json", async () => {
  const dir = tempDirWithFiles("jsonc", {
    "tsconfig.json": ``,
    "index.ts": `
    import tsconfig from './tsconfig.json';
    if (JSON.stringify(tsconfig) !== '{}') throw new Error('tsconfig.json should be empty');
    `,
  });
  expect([join(dir, "index.ts")]).toRun();
});
