import { expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";

const isUnsupportedHere = (stderr: string) =>
  /^error: --aot: (ahead-of-time compilation (only supports|is not available)|this build of Bun does not include)/m.test(
    stderr,
  );

async function build(dir: string, executablePath: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--compile-executable-path",
      executablePath,
      "entry.ts",
      "--outfile",
      "out",
    ],
    cwd: dir,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

const files = { "entry.ts": `const n: number = 1 + 1;\nconsole.log("answer", n);\n` };

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
  // The note of the linker: name size 4, description size 20, NT_GNU_BUILD_ID, "GNU".
  const note = other.indexOf(Buffer.from([4, 0, 0, 0, 20, 0, 0, 0, 3, 0, 0, 0, 0x47, 0x4e, 0x55, 0]));
  if (note < 0) return;
  other[note + 16] ^= 0xff;
  writeFileSync(join(String(dir), "another-build"), other);
  chmodSync(join(String(dir), "another-build"), 0o755);
  const { stderr, exitCode } = await build(String(dir), "./another-build");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain("error: --aot: ./another-build has another build of the JavaScript engine");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test.skipIf(!isLinux)(
  "an executable whose compiled code has the stamp of another build says so and runs none of it",
  async () => {
    using dir = tempDir("aot-another-stamp", files);
    const { stderr, exitCode } = await build(String(dir), bunExe());
    if (isUnsupportedHere(stderr)) return;
    expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
    await using asked = Bun.spawn({
      cmd: [bunExe(), "--aot-stamp"],
      env: { ...bunEnv, BUN_BE_BUN: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stamp = Buffer.from((await asked.stdout.text()).trim(), "hex").reverse();
    expect(stamp.length).toBe(8);
    const executable = readFileSync(join(String(dir), "out"));
    let places = 0;
    for (let at = executable.indexOf(stamp); at >= 0; at = executable.indexOf(stamp, at + 8)) {
      executable[at] ^= 0xff;
      places++;
    }
    expect(places).toBeGreaterThan(0);
    writeFileSync(join(String(dir), "changed"), executable);
    chmodSync(join(String(dir), "changed"), 0o755);
    await using run = Bun.spawn({ cmd: [join(String(dir), "changed")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, runStderr, runExitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect({ stdout, stderr: runStderr, exitCode: runExitCode }).toEqual({
      stdout: "",
      stderr: "error: this program's compiled code cannot be used: it was compiled for another build of the engine\n",
      exitCode: 1,
    });
  },
);

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
