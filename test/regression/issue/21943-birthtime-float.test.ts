import { expect, test } from "bun:test";
import { nodeExe } from "harness";
import { mkdirSync, promises, rmSync, stat, statSync as nodeStatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("fs.stat matches node.js", async () => {
  const tempDir = join(tmpdir(), "bun-birthtime-test-" + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    const statSync = nodeStatSync(tempDir);

    const statAsync = await promises.stat(tempDir);

    // Check sync matches async.
    expect(JSON.parse(JSON.stringify(statSync))).toStrictEqual(JSON.parse(JSON.stringify(statAsync)));
    expect(JSON.parse(JSON.stringify(statSync))).toStrictEqual(
      JSON.parse(
        Bun.spawnSync({
          cmd: [nodeExe(), "--print", `JSON.stringify(fs.statSync(${JSON.stringify(tempDir.replaceAll("\\", "/"))}))`],
        })
          .stdout.toString()
          .trim(),
      ),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
