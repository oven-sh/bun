import { build, file } from "bun";
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("minifying new Array(if (0) 1 else 2) works", async () => {
  using testDir = tempDir("minify-new-array-with-if", {
    "entry.js": "console.log(new Array(Math.random() > -1 ? 1 : 2));",
  });

  await build({
    entrypoints: [join(testDir, "entry.js")],
    minify: true,
    outdir: join(testDir, "outdir"),
  });

  expect(await file(join(testDir, "outdir/entry.js")).text()).toMatchInlineSnapshot(`
    "console.log(Array(Math.random()>-1?1:2));
    "
  `);
});
