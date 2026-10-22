import { expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";

const isUnsupportedHere = (stderr: string) =>
  /^error: (--aot |ahead-of-time compilation )(only supports|isn't available)/m.test(stderr);

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

// The note of the linker: name size 4, description size 20, NT_GNU_BUILD_ID, "GNU".
const buildIdNote = Buffer.from([4, 0, 0, 0, 20, 0, 0, 0, 3, 0, 0, 0, 0x47, 0x4e, 0x55, 0]);

test("--compile-executable-path with --aot takes another path to this Bun", async () => {
  using dir = tempDir("aot-executable-path-same", files);
  if (isWindows) copyFileSync(bunExe(), join(String(dir), "same-bun.exe"));
  else symlinkSync(bunExe(), join(String(dir), "same-bun.exe"));
  const { stderr, exitCode } = await build(String(dir), "./same-bun.exe");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  await using run = Bun.spawn({ cmd: [join(String(dir), "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, runStderr, runExitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect({ stdout, stderr: runStderr }).toEqual({ stdout: "answer 2\n", stderr: "" });
  expect(runExitCode).toBe(0);
});

test.skipIf(!isLinux)("--compile-executable-path with --aot refuses another build of the same text", async () => {
  using dir = tempDir("aot-executable-path-another-build", files);
  const other = readFileSync(bunExe());
  const note = other.indexOf(buildIdNote);
  if (note < 0) return;
  other[note + 16] ^= 0xff;
  writeFileSync(join(String(dir), "another-build"), other);
  chmodSync(join(String(dir), "another-build"), 0o755);
  const { stderr, exitCode } = await build(String(dir), "./another-build");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain("error: ./another-build is a different build of Bun");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test.skipIf(!isLinux)("--compile-executable-path with --aot rejects a Bun that has no build id", async () => {
  using dir = tempDir("aot-executable-path-unidentified", files);
  const other = readFileSync(bunExe());
  const note = other.indexOf(buildIdNote);
  if (note < 0) return;
  other[note + 8] = 0;
  writeFileSync(join(String(dir), "no-build-id"), other);
  chmodSync(join(String(dir), "no-build-id"), 0o755);
  const { stderr, exitCode } = await build(String(dir), "./no-build-id");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toMatch(/^error: .*no-build-id/m);
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("--compile-executable-path with --aot refuses a file that is not a Bun", async () => {
  using dir = tempDir("aot-executable-path-other", { ...files, "no-bun": "#!/bin/sh\nexit 0\n" });
  const { stderr, exitCode } = await build(String(dir), "./no-bun");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain(
    "error: ./no-bun can't run code compiled by this Bun. It isn't a Bun executable, or it's a different version. Use the same version of Bun, built for this platform",
  );
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("--compile-executable-path with --aot names a file that does not exist", async () => {
  using dir = tempDir("aot-executable-path-missing", files);
  const { stderr, exitCode } = await build(String(dir), "./nothing");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain("error: failed to read executable for ");
  expect(stderr).toContain("ENOENT");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});
