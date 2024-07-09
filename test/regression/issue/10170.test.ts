import { test, expect } from "bun:test";
import { bunExe } from "harness";
import { execFile } from "node:child_process";
import util from "node:util";

test("issue 10170", async () => {
  const execFileAsync = util.promisify(execFile);
  const result = await execFileAsync(bunExe(), ["--version"]);
  expect(result.stdout).toContain(Bun.version);
  expect(result.stderr).toBe("");
});
