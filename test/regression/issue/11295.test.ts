import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #11295 - bun run --filter preserves directory case", async () => {
  // Regression test: the glob walker was using lowercase keys from the FS cache
  // instead of the case-preserved names, causing ENOENT when trying to open
  // directories with mixed-case names like "BuildIconList"
  using dir = tempDir("ws-case-sensitive", {
    "tools/BuildIconList/package.json": JSON.stringify({
      name: "@test/build-icon-list",
      version: "1.0.0",
      scripts: {
        build: "echo building BuildIconList",
      },
    }),
    "tools/lowercase/package.json": JSON.stringify({
      name: "@test/lowercase",
      version: "1.0.0",
      scripts: {
        build: "echo building lowercase",
      },
    }),
    "package.json": JSON.stringify({
      name: "case-test",
      private: true,
      workspaces: ["tools/*"],
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--filter", "*", "build"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("ENOENT");
  expect(stdout).toContain("building BuildIconList");
  expect(stdout).toContain("building lowercase");
  expect(exitCode).toBe(0);
});

test("issue #11295 - bun run --filter with path filter preserves case", async () => {
  using dir = tempDir("ws-path-filter", {
    "packages/MyPackage/package.json": JSON.stringify({
      name: "my-package",
      version: "1.0.0",
      scripts: {
        test: "echo testing MyPackage",
      },
    }),
    "package.json": JSON.stringify({
      name: "path-filter-test",
      private: true,
      workspaces: ["packages/*"],
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--filter", "./packages/MyPackage", "test"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("ENOENT");
  expect(stdout).toContain("testing MyPackage");
  expect(exitCode).toBe(0);
});

test("Bun.Glob preserves directory case (coverage test)", async () => {
  // Bun.Glob uses SyscallAccessor (direct filesystem access) which was not
  // affected by the case sensitivity bug, but adding coverage for completeness
  using dir = tempDir("glob-case", {
    "MixedCase/file.txt": "content",
    "lowercase/file.txt": "content",
    "UPPERCASE/file.txt": "content",
  });

  const glob = new Bun.Glob("*/file.txt");
  const results: string[] = [];
  for await (const entry of glob.scan({ cwd: String(dir) })) {
    results.push(entry);
  }

  results.sort();
  expect(results).toEqual(["MixedCase/file.txt", "UPPERCASE/file.txt", "lowercase/file.txt"]);
});
