import { expect, test } from "bun:test";
import path from "node:path";

import { bunRun, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/10588
test.concurrent(
  "Bun.write should not leak the output data",
  async () => {
    await using dir = tempDir("bun-write-leak-fixture", {
      "bun-write-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "bun-write-leak-fixture.js")).text(),
      "out.bin": "here",
    });

    const dest = path.join(dir, "out.bin");
    expect(await bunRun([path.join(dir, "bun-write-leak-fixture.js"), dest])).toSpawn();
  },
  30 * 1000,
);
