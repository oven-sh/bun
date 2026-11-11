import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { closeSync, constants, existsSync, openSync, symlinkSync } from "node:fs";
import { join, sep } from "node:path";

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
    // Longer than the buffers as written, but normalizes down to one component.
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
    dotSlashes: { exitCode: 0, stderr: "", created: true },
    // An absolute operand is not normalized (`..` through a symlink means
    // something else to the kernel), so like the kernel and coreutils, mkdir
    // bounds it as written. On Windows it fits the much larger buffer and the
    // fs layer normalizes it while converting it to a wide path, so it works.
    absoluteDotSlashes: isWindows
      ? { exitCode: 0, stderr: "", created: true }
      : { ...failed(`${dir}/${dotSlashes}as-written`), created: false },
  });
  expect(exitCode).toBe(0);
});

// Each failing operand used to queue two writes, and 32,768 of them overflowed a 16-bit counter.
test("mkdir reports all 32,768 failing operands and the commands after it still print their output", async () => {
  using dir = tempDir("mkdir-output-root", {});
  // The shell expands 15 brace groups to 32,768 operands. Each one fails because "nope" doesn't exist.
  const failingOperands = "nope/" + Buffer.alloc(15 * 5, "{0,1}").toString();
  const fixture = /* ts */ `
    import { $ } from "bun";
    const result = await $\`mkdir ${failingOperands} || echo AFTER-1; echo AFTER-2 | cat; echo AFTER-3\`.nothrow();
    console.log("EXIT:" + result.exitCode);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const errors = stderr.split("\n");
  const reported = errors.flatMap(line => /nope[\\/](\d+)/.exec(line)?.[1] ?? []);
  expect({
    operands: reported.length,
    // Brace expansion gives operand number i the name that is i in binary.
    firstOutOfOrder: reported.findIndex((operand, i) => parseInt(operand, 2) !== i),
    // A line of mkdir that names no operand.
    unmatched: errors.filter(line => line.startsWith("mkdir:") && !/nope[\\/]\d+/.test(line)),
    stdout: stdout.split("\n").filter(Boolean),
  }).toEqual({
    operands: 32768,
    firstOutOfOrder: -1,
    unmatched: [],
    stdout: ["AFTER-1", "AFTER-2", "AFTER-3", "EXIT:0"],
  });
  expect(exitCode).toBe(0);
});

// POSIX: "The mkdir utility shall create the directories specified by the operands, in the order
// specified." Every operand ran as a thread pool task of its own, all of them at once.
describe.concurrent("operands are handled one after another, in the order typed", () => {
  // Each operand is the parent of the next one, so any other order fails with ENOENT.
  const chain = Array.from({ length: 24 }, (_, depth) => "d" + Buffer.alloc(2 * depth, "/d").toString());
  // Every third operand has a parent that does not exist.
  const mixed = Array.from({ length: 24 }, (_, i) => (i % 3 === 1 ? `missing/${i}` : `made${i}`));
  // 200 operands that work, then 200 that fail, twice: each run prints more than a page.
  const pages = Array.from({ length: 800 }, (_, i) => (Math.floor(i / 200) % 2 ? `missing/${i}` : `made${i}`));
  const lines = (paths: string[]) => paths.map(path => path.replaceAll("/", sep) + "\n").join("");
  const noSuchFile = (path: string) => `mkdir: ${path.replaceAll("/", sep)}: No such file or directory\n`;
  const isMissing = (name: string) => name.startsWith("missing");
  // What `mkdir -v` prints for these operands: on each stream, and on one that takes both.
  const printed = (names: string[]) => ({
    stdout: lines(names.filter(name => !isMissing(name))),
    stderr: names.filter(isMissing).map(noSuchFile).join(""),
    both: names.map(name => (isMissing(name) ? noSuchFile(name) : lines([name]))).join(""),
  });

  // mkdir prints an operand joined onto the cwd. On Windows `-p` prints the `\\?\` form of that path.
  const relative = (dir: string, output: { toString(): string }) =>
    output
      .toString()
      .replaceAll("\\\\?\\", "")
      .replaceAll(dir + sep, "");

  async function run(dir: string, script: string) {
    const { exitCode, stdout, stderr } = await $`${{ raw: script }}`.cwd(dir).quiet().nothrow();
    return { exitCode, stdout: relative(dir, stdout), stderr: relative(dir, stderr) };
  }

  test.each([
    ["mkdir", ""],
    ["mkdir -v", lines(chain)],
    ["mkdir -pv", lines(chain)],
  ])("%s makes a parent before its child", async (command, stdout) => {
    using dir = tempDir("mkdir-operand-order", {});
    expect(await run(String(dir), `${command} ${chain.join(" ")}`)).toEqual({ exitCode: 0, stdout, stderr: "" });
    expect(existsSync(join(String(dir), chain.at(-1)!))).toBe(true);
  });

  test("a child typed before its parent fails, and the parent is still made", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const parents = Array.from({ length: 16 }, (_, i) => `parent${i}`);
    const result = await run(String(dir), `mkdir ${parents.flatMap(parent => [`${parent}/child`, parent]).join(" ")}`);
    expect({
      ...result,
      parents: parents.filter(parent => existsSync(join(String(dir), parent))),
      children: parents.filter(parent => existsSync(join(String(dir), parent, "child"))),
    }).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: parents.map(parent => noSuchFile(`${parent}/child`)).join(""),
      parents,
      children: [],
    });
  });

  test("an empty operand fails alone, and the operands after it are still handled", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const operands = [...chain.slice(0, 12), '""', ...chain.slice(12)];
    const { exitCode, stderr } = await run(String(dir), `mkdir ${operands.join(" ")}`);
    expect({
      exitCode,
      errors: stderr.split("\n").filter(Boolean).length,
      made: chain.filter(path => existsSync(join(String(dir), path))),
    }).toEqual({ exitCode: 1, errors: 1, made: chain });
  });

  test("-v lines and error lines come out in operand order", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const { stdout, stderr } = printed(mixed);
    expect(await run(String(dir), `mkdir -v ${mixed.join(" ")}`)).toEqual({ exitCode: 1, stdout, stderr });
  });

  // One place takes both streams: the error of an operand sits between the lines of its neighbours.
  test("2>&1 into a captured buffer keeps operand order across the two streams", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    expect(await run(String(dir), `mkdir -v ${mixed.join(" ")} 2>&1`)).toEqual({
      exitCode: 1,
      stdout: printed(mixed).both,
      stderr: "",
    });
  });

  test("&> into a file keeps operand order across the two streams", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    expect(await run(String(dir), `mkdir -v ${mixed.join(" ")} &> out.txt`)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "",
    });
    expect(relative(String(dir), await Bun.file(join(String(dir), "out.txt")).text())).toBe(printed(mixed).both);
  });

  test("&> into a buffer keeps operand order across the two streams", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const buffer = Buffer.alloc(16384);
    const { exitCode } = await $`mkdir -v ${{ raw: mixed.join(" ") }} &> ${buffer}`.cwd(String(dir)).nothrow();
    expect({ exitCode, written: relative(String(dir), buffer.subarray(0, buffer.indexOf(0))) }).toEqual({
      exitCode: 1,
      written: printed(mixed).both,
    });
  });

  // The two streams end in two places, so each gets its lines as one write.
  test("2> into a file gives the file the error lines and stdout the -v lines", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    expect(await run(String(dir), `mkdir -v ${mixed.join(" ")} 2> err.txt`)).toEqual({
      exitCode: 1,
      stdout: printed(mixed).stdout,
      stderr: "",
    });
    expect(relative(String(dir), await Bun.file(join(String(dir), "err.txt")).text())).toBe(printed(mixed).stderr);
  });

  // The child gets one pipe as both its stdout and its stderr: two file descriptors, each with a writer
  // of its own in the child's shell.
  test.each([
    ["a line at a time", "", mixed],
    ["pages at a time", "", pages],
    // On Windows the writer of stdout has given its handle to libuv by then, and cannot say what its file is.
    ["after a command that wrote to stdout", "echo first; ", mixed],
  ])("stdout and stderr that are two descriptors of one pipe keep operand order, %s", async (_, before, names) => {
    using dir = tempDir("mkdir-operand-order", {});
    const { exitCode, stdout, stderr } = await $`${bunExe()} exec ${`${before}mkdir -v ${names.join(" ")}`} 2>&1`
      .env(bunEnv)
      .cwd(String(dir))
      .quiet()
      .nothrow();
    expect({ exitCode, stdout: relative(String(dir), stdout), stderr: stderr.toString() }).toEqual({
      exitCode: 1,
      stdout: (before && "first\n") + printed(names).both,
      stderr: "",
    });
  });

  test("-pv lists a directory that several operands share once", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const leaves = Array.from({ length: 8 }, (_, i) => `shared/inner/leaf${i}`);
    expect(await run(String(dir), `mkdir -pv shared/inner ${leaves.join(" ")}`)).toEqual({
      exitCode: 0,
      stdout: lines(["shared", "shared/inner", ...leaves]),
      stderr: "",
    });
  });

  // The name is longer than NAME_MAX, so mkdir(2) refuses it after both of its parents are made. That
  // limit and its ENAMETOOLONG are those of the POSIX file systems.
  test.skipIf(isWindows)("a -pv operand that fails prints the parents it made before its error", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const long = Buffer.alloc(300, "n").toString();
    expect(await run(String(dir), `mkdir -pv first/second/${long} 2>&1`)).toEqual({
      exitCode: 1,
      stdout: lines(["first", "first/second"]) + `mkdir: first/second/${long}: File name too long\n`,
      stderr: "",
    });
  });

  // `mkdir -p` through a dangling symlink fails, so each link works only once its target is made.
  test.skipIf(isWindows)("-p sees the directory that the operand before it made", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const targets = Array.from({ length: 16 }, (_, i) => `target${i}`);
    for (const [i, target] of targets.entries()) symlinkSync(target, join(String(dir), `link${i}`));
    const result = await run(
      String(dir),
      `mkdir -p ${targets.flatMap((target, i) => [target, `link${i}/inside`]).join(" ")}`,
    );
    expect({
      ...result,
      made: targets.filter(target => existsSync(join(String(dir), target, "inside"))),
    }).toEqual({ exitCode: 0, stdout: "", stderr: "", made: targets });
  });

  // Both write to the real stdout and stderr, which are two pipes here. `bun exec` runs the shell on its
  // own event loop.
  const twoPipes = [...chain.flatMap((path, i) => [path, `missing/${i}`]), ...pages];
  const alternating = `mkdir -v ${twoPipes.join(" ")}`;
  test.each([
    ["bun exec", ["exec", alternating]],
    [
      "Bun.$ that is not quiet",
      ["-e", "process.exitCode = (await Bun.$`${{ raw: process.argv[1] }}`.nothrow()).exitCode;", alternating],
    ],
  ])("%s", async (_, args) => {
    using dir = tempDir("mkdir-operand-order", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = printed(twoPipes);
    expect({ stdout: relative(String(dir), stdout), stderr: relative(String(dir), stderr) }).toEqual({
      stdout: expected.stdout,
      stderr: expected.stderr,
    });
    expect(exitCode).toBe(1);
  });

  // A pipe and a file are two files on every platform: each stream is written apart.
  test("bun exec with a pipe as stdout and a file as stderr", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", `${alternating} 2> err.txt`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = printed(twoPipes);
    expect({
      stdout: relative(String(dir), stdout),
      stderr,
      file: relative(String(dir), await Bun.file(join(String(dir), "err.txt")).text()),
    }).toEqual({ stdout: expected.stdout, stderr: "", file: expected.stderr });
    expect(exitCode).toBe(1);
  });

  // Each error line is longer than a page, and goes to the real stderr. The names are too long for an
  // argument, so the child makes them.
  test("a line longer than a page is written in full", async () => {
    using dir = tempDir("mkdir-operand-order", {});
    const fixture = /* ts */ `
      const long = ["a", "b"].map(fill => Buffer.alloc(100_000, fill).toString());
      process.exitCode = (await Bun.$\`mkdir \${long[0]} made \${long[1]}\`.nothrow()).exitCode;
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const long = ["a", "b"].map(fill => Buffer.alloc(100_000, fill).toString());
    expect({ stdout, stderr: relative(String(dir), stderr), made: existsSync(join(String(dir), "made")) }).toEqual({
      stdout: "",
      stderr: long.map(name => `mkdir: ${name}: File name too long\n`).join(""),
      made: true,
    });
    expect(exitCode).toBe(1);
  });
});

// A blocking pipe that is writable takes one page. On Linux the writer learns no more than that, so a
// larger chunk can wait in write(2). The fixture is the only reader of the FIFO that is its own stdout,
// and it reads between event loop turns: a write that waits on the JS thread never returns.
test.if(isLinux).each([
  // 2,000 lines of a directory, a separator and a name.
  ["short -v lines", "mkdir -v", "", 2000, 30, 0],
  // Each of the two lines is larger than the pipe, because the name is too long for a path.
  ["error lines larger than the pipe", "mkdir", "2>&1", 2, 100_000, 1],
])(
  "output larger than a pipe holds does not wait in write(2) on the JS thread, %s",
  async (_, command, redirect, count, length, exitCode) => {
    using dir = tempDir("mkdir-blocking-pipe", {
      "fixture.ts": /* ts */ `
        import { $ } from "bun";
        import { constants, openSync, readSync } from "node:fs";
        const [fifo, command, redirect, count, length] = process.argv.slice(2);
        const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
        const fill = Buffer.alloc(+length, "n").toString();
        const names = Array.from({ length: +count }, (_, i) => fill + i);
        let running = true;
        const script = $\`\${{ raw: command }} \${names} \${{ raw: redirect }}\`;
        const result = script.nothrow().finally(() => (running = false));
        const chunk = Buffer.alloc(65536);
        let read = 0;
        const drain = () => {
          try {
            for (let n; (n = readSync(reader, chunk)) > 0; ) read += n;
          } catch (e) {
            if (e.code !== "EAGAIN") throw e;
          }
        };
        while (running) {
          await new Promise(resolve => setImmediate(resolve));
          drain();
        }
        drain();
        const { exitCode, stdout } = await result;
        console.error(JSON.stringify({ exitCode, read, printed: stdout.length }));
      `,
    });
    const fifo = join(String(dir), "fifo");
    {
      await using mkfifo = Bun.spawn({ cmd: ["mkfifo", fifo], env: bunEnv, stdout: "ignore", stderr: "pipe" });
      const [mkfifoError, mkfifoExit] = await Promise.all([mkfifo.stderr.text(), mkfifo.exited]);
      expect({ stderr: mkfifoError, exitCode: mkfifoExit }).toEqual({ stderr: "", exitCode: 0 });
    }
    // Opened for reading too, so that this open does not wait for the fixture to open its end.
    const stdout = openSync(fifo, constants.O_RDWR);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts", fifo, command, redirect, String(count), String(length)],
      env: bunEnv,
      cwd: String(dir),
      stdout,
      stderr: "pipe",
    });
    closeSync(stdout);
    const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
    const fill = Buffer.alloc(length, "n").toString();
    const line = (path: string) => (exitCode ? `mkdir: ${path}: File name too long\n` : `${path}\n`);
    const printed = Array.from({ length: count }, (_, i) => line(join(String(dir), fill + i))).join("").length;
    expect(stderr).toBe(JSON.stringify({ exitCode, read: printed, printed }) + "\n");
    expect(code).toBe(0);
  },
);

test.each([["mkdir"], ["mkdir -pv"]])("%s without an operand prints the usage and exits 1", async command => {
  const { exitCode, stdout, stderr } = await $`${{ raw: command }}`.quiet().nothrow();
  expect({ exitCode, stdout: stdout.toString(), stderr: stderr.toString() }).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "usage: mkdir [-pv] [-m mode] directory_name ...\n",
  });
});
