import { bunEnv, bunExe } from "harness";
import { file, spawn, write } from "bun";
import { expect, it } from "bun:test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

const tmp = realpathSync(tmpdir());

// https://github.com/oven-sh/bun/issues/4722
it("existing snapshots are correctly parsed and matched against tests", async () => {
  const code = `
    it("test", () => {
      expect("\`\${contents}\`").toMatchSnapshot();
    });
  `;
  const testDir = await mkdtemp(join(tmp, "04722-test-"));
  const filename = "04722.test.js";
  try {
    await write(join(testDir, filename), code);
    for (let i = 0; i < 2; i++) {
      const testRun = spawn({
        cmd: [bunExe(), "test", filename],
        cwd: testDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });
      expect(await testRun.exited).toBe(0);
      const snapshotFile = file(join(testDir, "__snapshots__", `${filename}.snap`));
      expect(await snapshotFile.text()).toBe('// Bun Snapshot v1, https://goo.gl/fbAQLP\n\nexports[`test 1`] = \`"\\\`${contents}\\\`"\`;\n');
    }
  } finally {
    await rm(testDir, { force: true, recursive: true });
  }
});
