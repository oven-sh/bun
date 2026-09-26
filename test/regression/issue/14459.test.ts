import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/14459
// In a `bun build --compile` binary, Bun Shell's `bun` command fell back to
// process.execPath (the compiled app itself) when no `bun` was on PATH,
// re-running the app's entrypoint instead of behaving as the bun CLI.
//
// `bun build --compile` is slow under debug/ASAN; allow extra time.
test("Bun.$`bun ...` inside a compiled executable runs bun, not the entrypoint", async () => {
  using dir = tempDir("issue-14459", {
    "entry.ts": `
      import { $ } from "bun";
      console.log("entrypoint pid=" + process.pid);
      if (process.env.ISSUE_14459_CHILD === "1") {
        // Guard against infinite recursion on unfixed builds: if we get here,
        // $\`bun\` re-ran the entrypoint instead of behaving as the bun CLI.
        console.log("ERROR: entrypoint re-entered");
        process.exit(7);
      }
      const { stdout, exitCode } = await $\`bun --revision\`.env({ ISSUE_14459_CHILD: "1" }).nothrow().quiet();
      console.log("child revision=" + stdout.toString().trim());
      process.exit(exitCode);
    `,
  });

  const outfile = join(String(dir), isWindows ? "app.exe" : "app");
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./entry.ts", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stdout, stderr);
    expect(exitCode).toBe(0);
  }

  // Run with a PATH that does not contain `bun`, so the shell's fallback to
  // self_exe_path() is the only way `bun` can resolve. Point PATH at the empty
  // temp dir so no system-installed `bun` (e.g. /usr/bin/bun) is picked up.
  await using proc = Bun.spawn({
    cmd: [outfile],
    env: { ...bunEnv, PATH: String(dir), Path: String(dir), BUN_BE_BUN: undefined },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Before the fix the child re-ran the entrypoint (hitting the guard above)
  // instead of printing `bun --revision` output, so the revision line carried
  // the child's "entrypoint pid=" text and the process exited 7.
  //
  // Compare against the literal `--revision` output of the binary that built
  // the executable; `Bun.version` lacks the `-canary.N` tag so reconstructing
  // the string from it would break on release canary lanes.
  const expectedRevision = (await Bun.$`${bunExe()} --revision`.env(bunEnv).text()).trim();
  expect(stdout).not.toContain("ERROR: entrypoint re-entered");
  expect(stdout).toContain("child revision=" + expectedRevision);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}, 60_000);
