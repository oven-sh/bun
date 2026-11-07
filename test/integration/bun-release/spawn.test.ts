import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import { spawn } from "../../../packages/bun-release/src/spawn";

// The release scripts read `stdout`/`stderr` of every result (`stderr || stdout`,
// `stdout.includes(...)`), so they have to be strings even when no process ran.

test("returns the exit code and output of a process that ran", () => {
  expect(
    spawn(bunExe(), ["-e", `console.log("out"); console.error("err"); process.exit(3);`], { env: bunEnv }),
  ).toEqual({
    exitCode: 3,
    stdout: "out\n",
    stderr: "err\n",
  });
});

test("returns empty output when stdio is not captured", () => {
  expect(spawn(bunExe(), ["--version"], { env: bunEnv, stdio: "ignore" })).toEqual({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
});

test("reports an executable that does not exist as a failure", () => {
  using dir = tempDir("bun-release-spawn", {});
  const exe = path.join(String(dir), "does-not-exist");
  expect(spawn(exe, ["--version"])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: expect.stringContaining(exe),
  });
});

test("reports a cwd that does not exist as a failure", () => {
  using dir = tempDir("bun-release-spawn", {});
  const cwd = path.join(String(dir), "does-not-exist");
  expect(spawn(bunExe(), ["--version"], { env: bunEnv, cwd })).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: expect.stringContaining("ENOENT"),
  });
});
