import { describe, expect, test } from "bun:test";
import { chmodSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// An ancestor directory the process may traverse but not read (mode 0o111 —
// common on shared hosts and in sandboxes) must not abort module resolution
// for readable subtrees: the resolver treats it as an opaque, empty
// directory. Previously the whole walk failed with "error loading current
// directory". Root bypasses permission checks, so skip there.
describe.skipIf(isWindows || process.getuid?.() === 0)("resolver with unreadable ancestor", () => {
  test("bun run works under an execute-only ancestor", () => {
    const dir = tempDirWithFiles("xonly-ancestor", {
      "outer/project/package.json": JSON.stringify({
        name: "p",
        scripts: { start: "bun index.js" },
      }),
      "outer/project/index.js": `console.log("XONLY-OK", require("./dep.js"));`,
      "outer/project/dep.js": `module.exports = 42;`,
    });
    const outer = join(dir, "outer");
    chmodSync(outer, 0o111);
    try {
      const proc = Bun.spawnSync({
        cmd: [bunExe(), "run", "start"],
        cwd: join(outer, "project"),
        env: bunEnv,
      });
      if (proc.exitCode !== 0) console.error("stderr:", proc.stderr.toString());
      expect(proc.stdout.toString()).toContain("XONLY-OK 42");
      expect(proc.exitCode).toBe(0);
    } finally {
      chmodSync(outer, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("errors on the requested directory itself stay fatal", () => {
    const dir = tempDirWithFiles("unreadable-cwd", {
      "project/package.json": JSON.stringify({ name: "p", scripts: { start: "echo should-not-run" } }),
    });
    const project = join(dir, "project");
    // Execute-only: chdir succeeds, but `bun run` must read the requested
    // directory for script discovery, which is denied -- unlike ancestors,
    // this stays fatal ("error loading current directory").
    chmodSync(project, 0o111);
    try {
      const proc = Bun.spawnSync({
        cmd: [bunExe(), "run", "start"],
        cwd: project,
        env: bunEnv,
      });
      expect(proc.exitCode).not.toBe(0);
      expect(proc.stderr.toString()).toContain("error loading current directory");
      expect(proc.stdout.toString()).not.toContain("should-not-run");
    } finally {
      chmodSync(project, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
