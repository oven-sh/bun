import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, statSync, utimesSync } from "node:fs";
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

$.nothrow();

const ENOENT = "touch: No such file or directory\n";
const past = new Date("2000-01-01T00:00:00Z");

describe.concurrent("bunshell touch", () => {
  // An empty operand used to be joined onto the shell's cwd, which resolved to
  // the cwd itself: `touch ""` exited 0 and bumped the cwd's timestamps.
  test('touch "" fails and leaves the cwd untouched', async () => {
    using dir = tempDir("touch-empty", {});
    const cwd = String(dir);
    utimesSync(cwd, past, past);

    const { stdout, stderr, exitCode } = await $`touch ""`.cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(statSync(cwd).mtimeMs).toBe(past.getTime());
  });

  test('touch ${""} fails and leaves the cwd untouched', async () => {
    using dir = tempDir("touch-empty-interp", {});
    const cwd = String(dir);
    utimesSync(cwd, past, past);

    const { stdout, stderr, exitCode } = await $`touch ${""}`.cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(statSync(cwd).mtimeMs).toBe(past.getTime());
  });

  test("the other operands are still touched when one is empty", async () => {
    using dir = tempDir("touch-empty-multi", { existing: "" });
    const cwd = String(dir);
    utimesSync(join(cwd, "existing"), past, past);

    const { stdout, stderr, exitCode } = await $`touch created "" existing`.cwd(cwd).quiet();

    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe(ENOENT);
    expect(exitCode).toBe(1);
    expect(existsSync(join(cwd, "created"))).toBeTrue();
    expect(statSync(join(cwd, "existing")).mtimeMs).toBeGreaterThan(past.getTime());
  });
});
