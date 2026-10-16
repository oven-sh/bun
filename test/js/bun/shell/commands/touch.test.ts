import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// The index of each "nope/<index>" operand that has a line in `text`.
const reportedOperands = (text: string) => text.split("\n").flatMap(line => /nope[\\/](\d+)/.exec(line)?.[1] ?? []);
const allOperands = (count: number) => Array.from({ length: count }, (_, i) => String(i)).sort();

// touch reports a failed operand through a task that stays parked until the
// shell's writer has written its line. touch must not report done while a task
// is parked. A pipeline stage has its own writer, which is freed with the
// stage, so there an early done discards the lines with no error. Runs in a
// child process so that an abort is a failed assertion.
test.concurrent("touch writes every parked line when it feeds a pipeline", async () => {
  using dir = tempDir("touch-output-pipeline", {});
  const fixture = /* ts */ `
    import { $ } from "bun";
    // Every operand fails: the parent directory does not exist.
    const names = Array.from({ length: 256 }, (_, i) => "nope/" + i);
    const result = await $\`touch \${names} 2>&1 | \${process.execPath} -e \${"process.stdin.pipe(process.stdout)"}\`.quiet().nothrow();
    const summary = JSON.stringify({ exitCode: result.exitCode, stderr: result.stderr.toString() });
    // One write, so that the summary line cannot land inside the captured output.
    console.log(result.stdout.toString() + "RESULT:" + summary);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stderr,
    reported: reportedOperands(stdout).sort(),
    result: stdout.split("\n").filter(line => line.startsWith("RESULT:")),
  }).toEqual({
    stderr: "",
    reported: allOperands(256),
    result: ['RESULT:{"exitCode":0,"stderr":""}'],
  });
  expect(exitCode).toBe(0);
});
