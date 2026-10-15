import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/31636
//
// `bun run --parallel` (with `--filter` or `--workspaces`) parsed a standalone
// PackageJSON per workspace package and moved its `scripts` map into a
// collected struct. The map's values borrow the package.json source bytes the
// PackageJSON owns, so when that PackageJSON dropped at the end of each
// collection-loop iteration, the bytes were freed while the scripts map still
// pointed into them (heap-use-after-free). The freed bytes were later scanned
// while building the shell command, producing a corrupted command: the reporter
// saw `bash: line 1: $'\375\001': command not found` and exit 127, with the
// garbage varying between runs.
//
// Under ASAN the use-after-free is deterministic; on release builds the freed
// region is only sometimes reused before the read, which is why a tiny repro
// "may succeed" while heavier monorepos fail consistently. Release CI lanes
// skip this; the gate runs under `bun bd` which is debug+ASAN, so it's covered.

// The workspace scripts run `bun <file>` — `bun` goes through
// `replacePackageManagerRun` (which scans the freed script bytes) and the file
// is a real entrypoint that prints a marker and exits, so we can assert the
// children actually started with an uncorrupted command.
function workspace() {
  const dev = (marker: string) => ({
    [`packages/${marker}/package.json`]: JSON.stringify({
      name: marker,
      scripts: { dev: "bun index.ts" },
    }),
    [`packages/${marker}/index.ts`]: `console.log(${JSON.stringify(marker + "-started")});`,
  });
  return tempDir("issue-31636", {
    "package.json": JSON.stringify({
      name: "monorepo-root",
      private: true,
      workspaces: ["packages/*"],
    }),
    ...dev("pdf-service"),
    ...dev("app-website"),
    ...dev("api"),
  });
}

describe.concurrent.skipIf(!isDebug)("issue 31636", () => {
  test("bun run --parallel --filter spawns an uncorrupted workspace script", async () => {
    using dir = workspace();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--parallel", "--filter=pdf-service", "dev"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("command not found");
    expect(stderr).not.toContain("No such file or directory");
    expect(stdout).toContain("pdf-service-started");
    expect(exitCode).toBe(0);
  });

  test("bun run --parallel --workspaces spawns uncorrupted workspace scripts", async () => {
    using dir = workspace();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--parallel", "--workspaces", "--if-present", "dev"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("command not found");
    expect(stderr).not.toContain("No such file or directory");
    expect(stdout).toContain("pdf-service-started");
    expect(stdout).toContain("app-website-started");
    expect(stdout).toContain("api-started");
    expect(exitCode).toBe(0);
  });
});
