import { test, expect, beforeAll, describe, afterAll } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";
import path from "path";
import { rm } from "fs/promises";
import { $ } from "bun";
import { readdirSync, statSync } from "fs";

// https://github.com/oven-sh/bun/issues/10139
describe("https://github.com/oven-sh/bun/issues/10139", async () => {
  let temp = "";
  beforeAll(async () => {
    temp = tempDirWithFiles("issue-10132", {
      "huge-asset.js": `
      import huge from './1.png'; 
      if (!huge.startsWith("https://example.com/huge")) {
        throw new Error("Unexpected public path: " + huge);
      }
      `,
      // Note: the SIGBUS only seemed to reproduce at >= 768 MB
      // However, that causes issues in CI. CI does not like writing 1 GB files
      // to disk. So we shrink it down to 128 MB instead, which still causes the
      // test to fail in Bun v1.1.2 and earlier.
      "1.png": new Buffer(1024 * 1024 * 128),
    });
  });

  afterAll(async () => {
    rm(temp, { recursive: true, force: true });
  });

  test("Bun.build", async () => {
    const results = await Bun.build({
      entrypoints: [path.join(temp, "huge-asset.js")],
      outdir: path.join(temp, "out"),
      sourcemap: "external",
    });
    var sourceMapCount = 0;
    for (const output of results.outputs) {
      const size = output?.sourcemap?.size || 0;
      expect(size).toBeLessThan(1024);
      sourceMapCount += Number(Number(size) > 0);
    }
    await rm(path.join(temp, "out"), { force: true, recursive: true });
    expect(sourceMapCount).toBe(1);
  });

  test("CLI", async () => {
    $.cwd(temp);
    await $`${bunExe()} build ./huge-asset.js --outdir=out --sourcemap=external --minify`;
    readdirSync(path.join(temp, "out")).forEach(file => {
      const size = statSync(path.join(temp, "out", file)).size;
      if (file.includes(".map")) {
        expect(size).toBeLessThan(1024);
      }
    });
    await rm(path.join(temp, "out"), { recursive: true, force: true });
  });
});
