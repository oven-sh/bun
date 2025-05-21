import { $ } from "bun";
import { test } from "bun:test";
import "harness";
import { bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

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
