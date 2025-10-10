import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("invalid bun: module should preserve prefix in error", async () => {
  const dir = tempDirWithFiles("bun-invalid-module", {
    "test.js": 'import foo from "bun:apskdaposkdpok"',
  });

  const { stderr } = Bun.spawnSync({
    cmd: [bunExe(), "test.js"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });

  const output = stderr.toString();
  // Error should mention "bun:apskdaposkdpok" not just "apskdaposkdpok"
  expect(output).toContain("bun:apskdaposkdpok");
  // The error could be "Cannot find package" or "Cannot resolve invalid URL"
  // The key is that it shows the full "bun:..." prefix
  expect(output).toMatch(/Cannot (find package|resolve invalid URL)/);
});
