import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";

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
    // Longer than the buffer as written, but normalizes down to one component.
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
  // The over-long path is passed to the OS whole, and touch reports the path
  // it operated on: a relative operand joined onto the cwd. Which errno
  // Windows picks for it is up to the OS; what matters is that each operand
  // fails on its own.
  const failed = (path: string) =>
    isWindows
      ? { exitCode: 1, stderr: expect.stringMatching(/^touch: /) }
      : { exitCode: 1, stderr: `touch: ${path}: File name too long\n` };
  expect(results).toEqual({
    relative: failed(join(cwd, long)),
    absolute: failed(`${dir}/${long}`),
    huge: failed(join(cwd, huge)),
    mixed: { ...failed(join(cwd, long)), shortCreated: true },
    dotSlashes: { exitCode: 0, stderr: "", created: true },
  });
  expect(exitCode).toBe(0);
});

// Every operand ran as a thread pool task of its own, all of them at once.
describe.concurrent("operands are handled one after another, in the order typed", () => {
  // Every third operand has a parent that does not exist.
  const mixed = Array.from({ length: 24 }, (_, i) => (i % 3 === 1 ? `missing/${i}` : `made${i}`));
  const missing = mixed.filter(name => name.startsWith("missing"));
  const noSuchFile = (path: string) => `touch: ${path.replaceAll("/", sep)}: No such file or directory\n`;

  // touch prints an operand joined onto the cwd.
  const relative = (dir: string, output: { toString(): string }) => output.toString().replaceAll(dir + sep, "");

  async function run(dir: string, script: string) {
    const { exitCode, stdout, stderr } = await $`${{ raw: script }}`.cwd(dir).quiet().nothrow();
    return { exitCode, stdout: stdout.toString(), stderr: relative(dir, stderr) };
  }

  // `file` exists by the time `file/inside` is tried, so the error is ENOTDIR and never ENOENT.
  test.skipIf(isWindows)("an operand sees what the operands before it made", async () => {
    using dir = tempDir("touch-operand-order", {});
    const files = Array.from({ length: 16 }, (_, i) => `file${i}`);
    expect(await run(String(dir), `touch ${files.flatMap(file => [file, `${file}/inside`]).join(" ")}`)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: files.map(file => `touch: ${file}/inside: Not a directory\n`).join(""),
    });
  });

  test("error lines come out in operand order, and the operands after a failure are still made", async () => {
    using dir = tempDir("touch-operand-order", {});
    const result = await run(String(dir), `touch ${mixed.join(" ")}`);
    expect({ ...result, made: mixed.filter(name => existsSync(join(String(dir), name))) }).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: missing.map(noSuchFile).join(""),
      made: mixed.filter(name => !name.startsWith("missing")),
    });
  });

  // `bun exec` runs the shell on its own event loop and writes to the real stderr.
  test("bun exec", async () => {
    using dir = tempDir("touch-operand-order", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", `touch ${mixed.join(" ")}`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr: relative(String(dir), stderr) }).toEqual({
      stdout: "",
      stderr: missing.map(noSuchFile).join(""),
    });
    expect(exitCode).toBe(1);
  });
});

test("touch without an operand prints the usage and exits 1", async () => {
  const { exitCode, stdout, stderr } = await $`touch`.quiet().nothrow();
  expect({ exitCode, stdout: stdout.toString(), stderr: stderr.toString() }).toEqual({
    exitCode: 1,
    stdout: "",
    stderr:
      "usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n" +
      "       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n",
  });
});
