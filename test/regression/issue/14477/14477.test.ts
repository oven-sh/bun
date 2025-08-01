import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("JSXElement with mismatched closing tags produces a syntax error", async () => {
  const files = await fs.promises.readdir(import.meta.dir);
  const fixtures = files.filter(file => !file.endsWith(".test.ts")).map(fixture => join(import.meta.dir, fixture));

  const bakery = fixtures.map(
    fixture =>
      Bun.spawn({
        cmd: [bunExe(), fixture],
        cwd: import.meta.dir,
        stdio: ["inherit", "inherit", "inherit"],
        env: bunEnv,
      }).exited,
  );

  // all subprocesses should fail.
  const exited = await Promise.all(bakery);
  expect(exited).toEqual(Array.from({ length: fixtures.length }, () => 1));
});
