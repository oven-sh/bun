import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

// Regression test for https://github.com/oven-sh/bun/issues/22317
// bun build crashes with "index out of bounds" when CSS files are passed as
// entry points alongside multiple JS/TS entry points. This happens when glob
// expansion (e.g. ./public/**/*) includes CSS files.
test("issue 22317: build with CSS file entry points mixed with JS should not crash", async () => {
  await using dir = tempDir("22317", {
    "src/index.ts": `console.log("main");`,
    "src/server.worker.ts": `console.log("worker");`,
    "public/assets/index.css": `body { color: red; }`,
  });

  const result = await Bun.build({
    entrypoints: [
      join(String(dir), "src/index.ts"),
      join(String(dir), "public/assets/index.css"),
      join(String(dir), "src/server.worker.ts"),
    ],
    outdir: join(String(dir), "build"),
  });

  expect(result.success).toBeTrue();
  expect(result.outputs.length).toBeGreaterThan(0);
});
