import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// A relative operand was joined onto the cwd in a fixed 4096-byte buffer, so an
// operand longer than that crashed the process, and an operand longer than a
// PathBuffer (however it was spelled) was handed to the fs layer as "" and
// reported as ENOENT. Runs in a child process so a crash shows up as a failed
// assertion rather than taking the test runner down with it.
test("operands longer than the path buffers are reported, not a crash", async () => {
  using dir = tempDir("mkdir-long-operand", {});
  const fixture = /* ts */ `
    import { $ } from "bun";
    import { existsSync } from "node:fs";
    $.nothrow();
    const dir = process.argv[1];
    const long = Buffer.alloc(5000, "a").toString();
    // Past the path buffer on every platform, Windows included.
    const huge = Buffer.alloc(100_000, "h").toString();
    // Longer than PATH_MAX as written, a single component once normalized.
    const dotSlashes = Buffer.alloc(6000, "./").toString();
    const run = async (...args: string[]) => {
      const { exitCode, stderr } = await $\`mkdir \${args}\`.quiet();
      return { exitCode, stderr: stderr.toString() };
    };
    console.log(JSON.stringify({
      cwd: process.cwd(),
      relative: await run(long),
      absolute: await run(dir + "/" + long),
      parents: await run("-p", long),
      huge: await run(huge),
      mixed: { ...(await run(long, "short")), shortCreated: existsSync(dir + "/short") },
      dotSlashes: { ...(await run(dotSlashes + "normalized")), created: existsSync(dir + "/normalized") },
      absoluteDotSlashes: {
        ...(await run(dir + "/" + dotSlashes + "as-written")),
        created: existsSync(dir + "/as-written"),
      },
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
  const dotSlashes = Buffer.alloc(6000, "./").toString();
  // mkdir reports the path it operated on: a relative operand joined onto the
  // cwd, an absolute one as written.
  const tooLong = (path: string) => `mkdir: ${path}: File name too long\n`;
  // 5000 bytes fits Windows' much larger path buffer, so there the OS picks
  // the error; what matters is that each operand fails on its own.
  const failed = (path: string) =>
    isWindows ? { exitCode: 1, stderr: expect.stringMatching(/^mkdir: /) } : { exitCode: 1, stderr: tooLong(path) };
  expect(results).toEqual({
    relative: failed(join(cwd, long)),
    absolute: failed(`${dir}/${long}`),
    parents: failed(join(cwd, long)),
    huge: { exitCode: 1, stderr: tooLong(join(cwd, huge)) },
    mixed: { ...failed(join(cwd, long)), shortCreated: true },
    // An operand is not normalized (`..` through a symlink means something
    // else to the kernel), so like the kernel and coreutils, mkdir bounds it
    // as written. Windows resolves `.`/`..` in the path string itself, and
    // there the operand fits the much larger buffer, so it works.
    dotSlashes: isWindows
      ? { exitCode: 0, stderr: "", created: true }
      : { ...failed(`${cwd}/${dotSlashes}normalized`), created: false },
    absoluteDotSlashes: isWindows
      ? { exitCode: 0, stderr: "", created: true }
      : { ...failed(`${dir}/${dotSlashes}as-written`), created: false },
  });
  expect(exitCode).toBe(0);
});

// The operand reaches the kernel as written (prefixed with the shell cwd when
// relative). Folding `link/..` or `missing/..` out of the string first named a
// different directory than the one every other program sees. Windows resolves
// `..` in the path string itself, before any symlink, so it has only one view.
test.skipIf(isWindows)("operands are created where the kernel resolves them", async () => {
  using dir = tempDir("mkdir-kernel-path", {
    "d/c.txt": "",
    "other/sub/.keep": "",
  });
  symlinkSync("../other/sub", join(String(dir), "d", "link"));
  const fixture = /* ts */ `
    import { $ } from "bun";
    $.nothrow();
    const run = async (...args: string[]) => {
      const { exitCode, stdout, stderr } = await $\`mkdir \${args}\`.quiet();
      return { exitCode, stdout: stdout.toString().split("\\n").sort(), stderr: stderr.toString() };
    };
    console.log(JSON.stringify({
      // d/link/.. is other/, not d/
      throughLink: await run("d/link/../made"),
      throughLinkParents: await run("-p", "d/link/../deep/er"),
      // coreutils creates the missing component, then follows the real ".."
      missingParent: await run("-pv", "d/missing/../beside"),
      missing: await run("d/nothere/../x"),
      notDir: await run("d/c.txt/../y"),
      empty: await run(""),
    }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const cwd = realpathSync(String(dir));
  const ok = { exitCode: 0, stdout: [""], stderr: "" };
  expect(JSON.parse(stdout)).toEqual({
    throughLink: ok,
    throughLinkParents: ok,
    missingParent: {
      exitCode: 0,
      stdout: ["", `${cwd}/d/missing`, `${cwd}/d/missing/../beside`],
      stderr: "",
    },
    missing: { exitCode: 1, stdout: [""], stderr: `mkdir: ${cwd}/d/nothere/../x: No such file or directory\n` },
    notDir: { exitCode: 1, stdout: [""], stderr: `mkdir: ${cwd}/d/c.txt/../y: Not a directory\n` },
    empty: { exitCode: 1, stdout: [""], stderr: "mkdir: No such file or directory\n" },
  });
  expect(readdirSync(join(String(dir), "d")).sort()).toEqual(["beside", "c.txt", "link", "missing"]);
  expect(readdirSync(join(String(dir), "other")).sort()).toEqual(["deep", "made", "sub"]);
  expect(readdirSync(join(String(dir), "other", "deep"))).toEqual(["er"]);
  expect(exitCode).toBe(0);
});
