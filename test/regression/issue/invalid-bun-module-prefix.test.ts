import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("invalid bun: module should preserve prefix in error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bun-invalid-module-"));
  const file = join(dir, "test.js");
  writeFileSync(file, 'import foo from "bun:apskdaposkdpok"');

  const { stderr } = Bun.spawnSync({
    cmd: [bunExe(), file],
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
