import { describe, expect, it } from "bun:test";
import { cpSync } from "fs";
import { bunEnv, bunRun, runBunInstall, tmpdirSync } from "harness";
import { join } from "path";
describe("next-auth", () => {
  it("should be able to call server action multiple times using auth middleware #18977", async () => {
    const testDir = tmpdirSync("next-auth");

    cpSync(join(import.meta.dir, "fixture"), testDir, {
      recursive: true,
      filter: src => {
        if (src.includes("node_modules")) {
          return false;
        }
        if (src.startsWith(".next")) {
          return false;
        }
        return true;
      },
    });

    await runBunInstall(bunEnv, testDir, { savesLockfile: false });

    const result = bunRun(join(testDir, "server.js"), {
      AUTH_SECRET: "I7Jiq12TSMlPlAzyVAT+HxYX7OQb/TTqIbfTTpr1rg8=",
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBeDefined();
    const lines = result.stdout?.split("\n") ?? [];
    expect(lines[lines.length - 1]).toMatch(/request sent/);
  }, 30_000);
});
