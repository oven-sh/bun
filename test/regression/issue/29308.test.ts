import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/29308
// `bunfig.toml` at the project root was ignored when running `bun` from a
// subdirectory, which broke `preload` (and every other config entry) in
// monorepos where commands are invoked from inside a package directory.
test("preload in bunfig.toml is respected when cwd is a subdirectory", async () => {
  using dir = tempDir("bun-issue-29308", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
    "packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: join(String(dir), "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(exitCode).toBe(0);
});

test("bunfig.toml preload with relative path works from project root", async () => {
  using dir = tempDir("bun-issue-29308-root", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "src/index.ts": `console.log("hello from root");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from root\n");
  expect(exitCode).toBe(0);
});
