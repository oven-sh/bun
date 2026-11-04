import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, statSync, utimesSync } from "node:fs";
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

// `touch` handles its operands one after the other, in the order of the command line, and reports the ones that
// fail in that order.
describe("several operands", () => {
  test("sets the times of each operand and of nothing else", async () => {
    using dir = tempDir("touch-times", { a: "", b: "", c: "" });
    const names = ["c", "a", "b"];
    const old = new Date("2001-02-03T04:05:06Z");
    for (const name of [...names, "."]) utimesSync(join(String(dir), name), old, old);

    const { stdout, stderr, exitCode } = await $`touch ${names}`.cwd(String(dir)).quiet().nothrow();
    expect({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode }).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const mtime = (name: string) => statSync(join(String(dir), name)).mtime;
    expect(names.filter(name => mtime(name) > old)).toEqual(names);
    // An operand that the command line does not have would be the directory itself.
    expect(mtime(".")).toEqual(old);
  });

  // `fNN/x` fails with ENOTDIR when `fNN` is a file, and with ENOENT when `fNN` is not there yet. So the text
  // shows that `touch` made each `fNN` before it went on to `fNN/x`. Windows reports ENOENT for both.
  test.skipIf(isWindows)("acts on the operands in the order of the command line", async () => {
    using dir = tempDir("touch-act-order", {});
    const files = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, "0")}`);
    const operands = files.flatMap(file => [file, `${file}/x`]);

    const { stderr, exitCode } = await $`touch ${operands}`.cwd(String(dir)).quiet().nothrow();
    expect(stderr.toString().split("\n")).toEqual([
      ...files.map(file => `touch: ${join(String(dir), file, "x")}: Not a directory`),
      "",
    ]);
    expect(exitCode).toBe(1);
  });

  const long = Buffer.alloc(5000, "a").toString();
  const missing = (names: string[]) => names.map(name => `nodir/part-${name}`);
  // `first` is there already, `last` is not, and the operands between them fail.
  const few = ["first", ...missing(["07", "02", "11", "05", "09", "01", "12", "04", "08", "03", "10", "06"]), "last"];
  // More text than one chunk of an `IOWriter` takes, and one line that is longer than a chunk.
  const many = [
    "first",
    ...missing(Array.from({ length: 75 }, (_, i) => String(149 - i))),
    long,
    ...missing(Array.from({ length: 75 }, (_, i) => String(i).padStart(3, "0"))),
    "last",
  ];
  // The lines that `touch` prints for `operands`, in their order.
  const report = (cwd: string, operands: string[]) =>
    operands.flatMap(operand => {
      if (operand.startsWith("nodir/")) return `touch: ${join(cwd, operand)}: No such file or directory`;
      if (operand !== long) return [];
      // Which errno Windows picks for a name this long is up to the OS.
      if (isWindows) return expect.stringMatching(/^touch: /);
      return `touch: ${join(cwd, operand)}: File name too long`;
    });

  type Sink = (cwd: string, operands: string[]) => Promise<{ text: string; exitCode: number }>;
  const sinks: [string, Sink][] = [
    [
      "a captured stderr",
      async (cwd, operands) => {
        const { stderr, exitCode } = await $`touch ${operands}`.cwd(cwd).quiet().nothrow();
        return { text: stderr.toString(), exitCode };
      },
    ],
    [
      "2>&1 into a captured stdout",
      async (cwd, operands) => {
        const { stdout, exitCode } = await $`touch ${operands} 2>&1`.cwd(cwd).quiet().nothrow();
        return { text: stdout.toString(), exitCode };
      },
    ],
    [
      "a file",
      async (cwd, operands) => {
        const { exitCode } = await $`touch ${operands} 2> errors.txt`.cwd(cwd).quiet().nothrow();
        return { text: readFileSync(join(cwd, "errors.txt"), "utf8"), exitCode };
      },
    ],
    [
      "a buffer",
      async (cwd, operands) => {
        const buffer = Buffer.alloc(64 * 1024);
        const { exitCode } = await $`touch ${operands} 2> ${buffer}`.cwd(cwd).quiet().nothrow();
        return { text: buffer.toString("utf8", 0, buffer.indexOf(0)), exitCode };
      },
    ],
    [
      // The shell of `bun exec` runs on the mini event loop and writes to the stderr of the process.
      "the stderr of `bun exec`",
      async (cwd, operands) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "exec", `touch ${operands.join(" ")}`],
          env: bunEnv,
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toBe("");
        return { text: stderr, exitCode };
      },
    ],
  ];

  describe.each([
    ["12 operands that fail", few],
    ["151 operands that fail", many],
  ])("reports %s in the order of the command line", (_, operands) => {
    test.concurrent.each(sinks)("to %s", async (_, sink) => {
      using dir = tempDir("touch-report-order", { first: "" });
      const { text, exitCode } = await sink(String(dir), operands);
      expect(text.split("\n")).toEqual([...report(String(dir), operands), ""]);
      // It goes on to the operands after one that fails.
      expect({ exitCode, last: existsSync(join(String(dir), "last")) }).toEqual({ exitCode: 1, last: true });
    });
  });

  // A `$` that is not quiet writes to the stderr of the process through an `IOWriter`, on the event loop of the
  // JS thread.
  test.concurrent("reports to the stderr of the process in the order of the command line", async () => {
    using dir = tempDir("touch-report-order-fd", { first: "" });
    const fixture = /* ts */ `
      import { $ } from "bun";
      $.nothrow();
      const few = JSON.parse(process.env.FEW);
      const many = JSON.parse(process.env.MANY);
      console.error("exit code " + (await $\`touch \${few}\`).exitCode);
      // The output of the substitution goes to a buffer and its errors go to the stderr of the process.
      console.error("exit code " + (await $\`echo $(touch \${few})\`).exitCode);
      console.error("exit code " + (await $\`touch \${many}\`).exitCode);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, FEW: JSON.stringify(few), MANY: JSON.stringify(many) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.split("\n")).toEqual([
      ...report(String(dir), few),
      "exit code 1",
      ...report(String(dir), few),
      "exit code 0",
      ...report(String(dir), many),
      "exit code 1",
      "",
    ]);
    expect(stdout).toBe("\n");
    expect(exitCode).toBe(0);
  });

  // `true` exits and reads nothing, so the `IOWriter` fails a chunk of the errors. `touch` has to finish then.
  test("finishes when nothing reads its errors", async () => {
    using dir = tempDir("touch-epipe", {});
    const { stdout, exitCode } = await $`touch ${many} 2>&1 | true`.cwd(String(dir)).quiet().nothrow();
    expect({ stdout: stdout.toString(), exitCode }).toEqual({ stdout: "", exitCode: 0 });
  });
});
