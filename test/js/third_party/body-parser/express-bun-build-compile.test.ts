import { expect, test } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import "harness";
import { bunExe, tempDirWithFiles } from "harness";

$.throws(true);

// https://github.com/oven-sh/bun/issues/10624
test("Express hello world app supports bun build --compile --minify --sourcemap", async () => {
  const dir = tempDirWithFiles("express-bun-build-compile", {
    "out.exe": "",
  });

  const file = join(dir, "out.exe");
  await $`${bunExe()} build --compile --minify --sourcemap ${join(import.meta.dir, "express-compile-fixture.ts")} --outfile=${file}`;
  await $`${file}`;
});
