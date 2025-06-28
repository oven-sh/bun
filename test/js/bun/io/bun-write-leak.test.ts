import { expect, test } from "bun:test";
import path from "node:path";

import "harness";
import { tempDirWithFiles } from "harness";

// https://github.com/oven-sh/bun/issues/10588
test(
  "Bun.write should not leak the output data",
  async () => {
    const dir = tempDirWithFiles("bun-write-leak-fixture", {
      "bun-write-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "bun-write-leak-fixture.js")).text(),
      "out.bin": "here",
    });

    const dest = path.join(dir, "out.bin");
    expect([path.join(dir, "bun-write-leak-fixture.js"), dest]).toRun();
  },
  30 * 1000,
);
