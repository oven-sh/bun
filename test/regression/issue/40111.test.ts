import { expect, test } from "bun:test";
import { readdirSync, statSync } from "fs";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/40111
// `bun build --compile` created its temporary `.bun-build` executable with
// mode 000. POSIX checks write permission at open(), so this worked on ext4,
// but WSL2 DrvFS (9p) re-checks the file mode on ftruncate() and returned
// EACCES, failing the build. The temp file must carry owner read/write
// permission from creation. Skipped on macOS: the clonefile() fast path
// copies the executable's 0755 mode and never reaches the open() under test.
test.skipIf(isWindows || isMacOS)("compile temp file is not created with mode 000", async () => {
  using dir = tempDir("issue-40111", {
    "index.ts": `console.log("hello");`,
  });
  const cwd = String(dir);
  const outfile = join(cwd, "out-exe");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.ts", "--compile", "--outfile", outfile],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Poll the cwd for the `.bun-build` temp file while the compile runs and
  // record every mode we observe. The window is wide: the file exists from
  // creation through the copy of the whole bun executable and the ELF
  // rewrite, until it is renamed to the outfile.
  const observed: number[] = [];
  // Drain the pipes while the loop runs so a full pipe cannot block the child.
  const stdoutPromise = proc.stdout.text();
  const stderrPromise = proc.stderr.text();
  let exited = false;
  const exitPromise = proc.exited.then(code => {
    exited = true;
    return code;
  });
  while (!exited) {
    for (const name of readdirSync(cwd)) {
      if (name.endsWith(".bun-build")) {
        try {
          observed.push(statSync(join(cwd, name)).mode & 0o777);
        } catch {
          // The rename to the outfile can race the stat.
        }
      }
    }
    await Bun.sleep(1);
  }

  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, exitPromise]);

  expect(observed.length).toBeGreaterThan(0);
  for (const mode of observed) {
    // Owner read+write from creation (0o600). The final fchmod to 0o755 also
    // satisfies this. Mode 000 does not.
    expect(mode & 0o600).toBe(0o600);
  }
  expect(stderr).not.toContain("EACCES");
  expect(stdout).toContain("compile");
  expect(exitCode).toBe(0);
});
