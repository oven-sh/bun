import { describe, it, expect } from "bun:test";
import { bunRun, runBunInstall, bunEnv, isLinux } from "harness";
import { join } from "path";
describe("next-auth", () => {
  // Watchpack Error (watcher): Error: ENXIO: no such device or address, open '/var/lib/buildkite-agent/builds/ip-172-31-28-24/bun/bun/test/js/junit-r'
  // Watchpack Error (watcher): Error: ENXIO: no such device or address, open '\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000...'
  // prettier-ignore
  it.todoIf(isLinux)("should be able to call server action multiple times using auth middleware #18977", async () => {
    await runBunInstall(bunEnv, join(import.meta.dir, "fixture"), {
      allowWarnings: true,
      allowErrors: true,
      savesLockfile: false,
    });
    const result = bunRun(join(import.meta.dir, "fixture", "server.js"), {
      AUTH_SECRET: "I7Jiq12TSMlPlAzyVAT+HxYX7OQb/TTqIbfTTpr1rg8=",
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBeDefined();
    const lines = result.stdout?.split("\n") ?? [];
    expect(lines[lines.length - 1]).toMatch(/request sent/);
  }, 30_000);
});
