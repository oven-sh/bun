import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";

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

const OLD = new Date("2001-01-01T00:00:00Z");
// A file time comes from the kernel's clock, which can be a tick behind Date.now().
const justBefore = () => Date.now() - 1000;

test("an existing file gets the current time", async () => {
  using dir = tempDir("touch-now", { marker: "" });
  const marker = join(String(dir), "marker");
  utimesSync(marker, OLD, OLD);

  const start = justBefore();
  const { exitCode, stderr } = await $`touch marker`.cwd(String(dir)).nothrow().quiet();
  expect({ exitCode, stderr: stderr.toString() }).toEqual({ exitCode: 0, stderr: "" });
  const { atimeMs, mtimeMs } = statSync(marker);
  expect(atimeMs).toBeGreaterThanOrEqual(start);
  expect(mtimeMs).toBeGreaterThanOrEqual(start);
});

// POSIX lets a caller with write access set both times to the current time.
// Every other time is for the owner only, so touch has to ask the OS for "now"
// instead of passing its own reading of the clock. Windows has no such rule:
// SetFileTime needs write access and nothing else.
describe.skipIf(isWindows)("a file the caller does not own", () => {
  // This callback also runs on Windows, which has no process.getuid.
  const isRoot = process.getuid?.() === 0;
  const NOBODY = 65534;

  // Root passes every ownership check, so it runs the touch as another user.
  async function touch(operand: string) {
    const fixture = /* ts */ `
      const { exitCode, stderr } = await Bun.$\`touch \${process.argv[1]}\`.nothrow().quiet();
      console.log(JSON.stringify({ exitCode, stderr: stderr.toString() }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture, operand],
      env: bunEnv,
      cwd: "/",
      ...(isRoot ? { uid: NOBODY, gid: NOBODY } : {}),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(exitCode).toBe(0);
    return result;
  }

  // Root owns /dev/null and its mode is 666. On Linux only a touch moves the times of a device node.
  test.concurrent("write access is enough", async () => {
    const start = justBefore();
    expect(await touch("/dev/null")).toEqual({ exitCode: 0, stderr: "" });
    const { atimeMs, mtimeMs } = statSync("/dev/null");
    expect(atimeMs).toBeGreaterThanOrEqual(start);
    expect(mtimeMs).toBeGreaterThanOrEqual(start);
  });

  // Root owns /etc/passwd and its mode is 644.
  test.concurrent("write access is still required", async () => {
    expect(await touch("/etc/passwd")).toEqual({ exitCode: 1, stderr: "touch: /etc/passwd: Permission denied\n" });
  });

  // A regular file of another user takes root to set up, and no CI lane runs as root.
  test.skipIf(!isRoot).concurrent("a mode 666 file of another user gets the current time", async () => {
    using dir = tempDir("touch-not-owner", { marker: "" });
    const marker = join(String(dir), "marker");
    chmodSync(marker, 0o666);
    utimesSync(marker, OLD, OLD);
    const { uid, mode, mtime } = statSync(marker);
    expect({ uid, mode: mode & 0o777, mtime }).toEqual({ uid: 0, mode: 0o666, mtime: OLD });

    // The other user has to reach the file, and a temporary directory is private to its owner.
    const restore: [string, number][] = [];
    for (let p = dirname(marker); p !== dirname(p); p = dirname(p)) {
      const mode = statSync(p).mode & 0o7777;
      if ((mode & 0o001) === 0) {
        restore.push([p, mode]);
        chmodSync(p, mode | 0o001);
      }
    }
    try {
      const start = justBefore();
      expect(await touch(marker)).toEqual({ exitCode: 0, stderr: "" });
      const { atimeMs, mtimeMs } = statSync(marker);
      expect(atimeMs).toBeGreaterThanOrEqual(start);
      expect(mtimeMs).toBeGreaterThanOrEqual(start);
    } finally {
      for (const [p, mode] of restore) chmodSync(p, mode);
    }
  });
});
