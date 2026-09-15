import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, realpathSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";

// Every operand, absolute or not, was joined into a fixed-size path buffer, so
// an operand longer than that crashed the process. Runs in a child process so a
// crash shows up as a failed assertion rather than taking the test runner down
// with it.
test("operands longer than the path buffer are reported, not a crash", async () => {
  using dir = tempDir("touch-long-operand", {});
  const fixture = /* ts */ `
    import { $ } from "bun";
    import { existsSync } from "node:fs";
    $.nothrow();
    const dir = process.argv[1];
    const long = Buffer.alloc(5000, "a").toString();
    // Past the path buffer on every platform, Windows included.
    const huge = Buffer.alloc(100_000, "h").toString();
    // Longer than PATH_MAX as written, a single component once normalized.
    const dotSlashes = Buffer.alloc(6000, "./").toString() + "normalized";
    const run = async (...args: string[]) => {
      const { exitCode, stderr } = await $\`touch \${args}\`.quiet();
      return { exitCode, stderr: stderr.toString() };
    };
    console.log(JSON.stringify({
      cwd: process.cwd(),
      relative: await run(long),
      absolute: await run(dir + "/" + long),
      huge: await run(huge),
      mixed: { ...(await run(long, "short")), shortCreated: existsSync(dir + "/short") },
      dotSlashes: { ...(await run(dotSlashes)), created: existsSync(dir + "/normalized") },
    }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture, String(dir)],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { cwd, ...results } = JSON.parse(stdout);

  const long = Buffer.alloc(5000, "a").toString();
  const huge = Buffer.alloc(100_000, "h").toString();
  const dotSlashes = Buffer.alloc(6000, "./").toString() + "normalized";
  // The over-long path is passed to the OS whole and as written, and touch
  // reports the path it operated on: a relative operand joined onto the cwd.
  // Which errno Windows picks for it is up to the OS; what matters is that
  // each operand fails on its own. Windows also resolves `.`/`..` in the path
  // string itself, so there the dotted operand names a short path and works.
  const failed = (path: string) =>
    isWindows
      ? { exitCode: 1, stderr: expect.stringMatching(/^touch: /) }
      : { exitCode: 1, stderr: `touch: ${path}: File name too long\n` };
  expect(results).toEqual({
    relative: failed(join(cwd, long)),
    absolute: failed(`${dir}/${long}`),
    huge: failed(join(cwd, huge)),
    mixed: { ...failed(join(cwd, long)), shortCreated: true },
    dotSlashes: isWindows
      ? { exitCode: 0, stderr: "", created: true }
      : { ...failed(`${cwd}/${dotSlashes}`), created: false },
  });
  expect(exitCode).toBe(0);
});

// The operand reaches the kernel as written (prefixed with the shell cwd when
// relative). Folding `link/..` or `missing/..` out of the string first touched
// or created a different file than the one every other program sees. Windows
// resolves `..` in the path string itself, before any symlink, so it has only
// one view.
test.skipIf(isWindows)("operands are touched where the kernel resolves them", async () => {
  using dir = tempDir("touch-kernel-path", {
    "d/c.txt": "",
    "other/c.txt": "",
    "other/sub/.keep": "",
  });
  const base = String(dir);
  symlinkSync("../other/sub", join(base, "d", "link"));
  const past = new Date("2001-02-03T04:05:06Z");
  for (const file of ["d/c.txt", "other/c.txt"]) utimesSync(join(base, file), past, past);

  const fixture = /* ts */ `
    import { $ } from "bun";
    $.nothrow();
    const run = async (...args: string[]) => {
      const { exitCode, stderr } = await $\`touch \${args}\`.quiet();
      return { exitCode, stderr: stderr.toString() };
    };
    console.log(JSON.stringify({
      // d/link/.. is other/, not d/
      existing: await run("d/link/../c.txt"),
      created: await run("d/link/../new.txt"),
      missing: await run("d/nothere/../x"),
      empty: await run(""),
    }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: base,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const cwd = realpathSync(base);
  expect(JSON.parse(stdout)).toEqual({
    existing: { exitCode: 0, stderr: "" },
    created: { exitCode: 0, stderr: "" },
    missing: { exitCode: 1, stderr: `touch: ${cwd}/d/nothere/../x: No such file or directory\n` },
    empty: { exitCode: 1, stderr: "touch: No such file or directory\n" },
  });
  expect({
    d: readdirSync(join(base, "d")).sort(),
    other: readdirSync(join(base, "other")).sort(),
    dTouched: statSync(join(base, "d", "c.txt")).mtime > past,
    otherTouched: statSync(join(base, "other", "c.txt")).mtime > past,
  }).toEqual({
    d: ["c.txt", "link"],
    other: ["c.txt", "new.txt", "sub"],
    dTouched: false,
    otherTouched: true,
  });
  expect(exitCode).toBe(0);
});
