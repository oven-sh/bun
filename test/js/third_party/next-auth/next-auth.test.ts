import { describe, it, expect } from "bun:test";
import { bunRun, runBunInstall, bunEnv } from "harness";
import { join } from "path";
describe("next-auth", () => {
  it("should be able to call server action multiple times using auth middleware #18977", async () => {
    await runBunInstall(bunEnv, join(import.meta.dir, "fixture"), {
      allowWarnings: true,
      allowErrors: true,
      savesLockfile: false,
    });
    const result = bunRun(join(import.meta.dir, "fixture", "server.js"));
    expect(result.stderr).toBe("");
    expect(result.stdout).toBeDefined();
    const lines = result.stdout?.split("\n") ?? [];
    expect(lines[lines.length - 1]).toMatch(/request sent/);
  }, 30_000);
});
