import { expect, test } from "bun:test";
import { existsSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";

const isUnsupportedHere = (stderr: string) =>
  /^error: --aot: (ahead-of-time compilation (only supports|is not available)|this build of Bun does not include)/m.test(stderr);

async function build(dir: string, executablePath: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "--compile-executable-path", executablePath, "entry.ts", "--outfile", "out"],
    cwd: dir,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

const files = { "entry.ts": `const n: number = 1 + 1;\nconsole.log("answer", n);\n` };

test.skipIf(isWindows)("--compile-executable-path with --aot takes another path to this Bun", async () => {
  using dir = tempDir("aot-executable-path-same", files);
  symlinkSync(bunExe(), join(String(dir), "same-bun"));
  const { stderr, exitCode } = await build(String(dir), "./same-bun");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  await using run = Bun.spawn({ cmd: [join(String(dir), "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, runStderr, runExitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect({ stdout, stderr: runStderr }).toEqual({ stdout: "answer 2\n", stderr: "" });
  expect(runExitCode).toBe(0);
});

test("--compile-executable-path with --aot refuses a file that is not a Bun", async () => {
  using dir = tempDir("aot-executable-path-other", { ...files, "no-bun": "#!/bin/sh\nexit 0\n" });
  const { stderr, exitCode } = await build(String(dir), "./no-bun");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain(
    "error: --aot: ./no-bun cannot carry code compiled by this Bun: it is not a Bun, or it is an older one. The executable has to be a Bun for this platform, of the same version",
  );
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("--compile-executable-path with --aot names a file that does not exist", async () => {
  using dir = tempDir("aot-executable-path-missing", files);
  const { stderr, exitCode } = await build(String(dir), "./nothing");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain("error: --aot: failed to read executable for ");
  expect(stderr).toContain("ENOENT");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});
