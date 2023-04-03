import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("AbortSignal", () => {
  test("spawn test", async () => {
    const fileName = `/abort-${Date.now()}.test.ts`;
    const testFileContents = await Bun.file(join(import.meta.dir, "abort.ts")).arrayBuffer();

    writeFileSync(join(tmpdir(), fileName), testFileContents, "utf8");
    const { stderr } = Bun.spawnSync({
      cmd: [bunExe(), "test", fileName],
      env: bunEnv,
      cwd: tmpdir(),
    });

    expect(stderr?.toString()).not.toContain("✗");
  });
});
