import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("seq", async () => {
  TestBuilder.command`seq`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage");

  TestBuilder.command`seq -w`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only -w flag given");

  TestBuilder.command`seq --fixed-width`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only --fixed-width flag given");

  TestBuilder.command`seq -s ,`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only -s flag given");

  TestBuilder.command`seq -t ,`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only -t flag given");

  TestBuilder.command`seq -w -s , -t .`
    .exitCode(1)
    .stdout("")
    .stderr("usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n")
    .runAsTest("prints usage when only flags given");

  TestBuilder.command`seq -s`
    .exitCode(1)
    .stdout("")
    .stderr("seq: option requires an argument -- s\n")
    .runAsTest("tests -s");

  TestBuilder.command`seq -t`
    .exitCode(1)
    .stdout("")
    .stderr("seq: option requires an argument -- t\n")
    .runAsTest("tests -s");

  TestBuilder.command`seq 0 5`.exitCode(0).stdout("0\n1\n2\n3\n4\n5\n").stderr("").runAsTest("works basic up");

  TestBuilder.command`seq 5 0`.exitCode(0).stdout("5\n4\n3\n2\n1\n0\n").stderr("").runAsTest("works basic down");

  TestBuilder.command`seq -s, 0 5`.exitCode(0).stdout("0,1,2,3,4,5,").stderr("").runAsTest("-s works inline");

  TestBuilder.command`seq -s , 0 5`.exitCode(0).stdout("0,1,2,3,4,5,").stderr("").runAsTest("-s works separate");

  TestBuilder.command`seq --separator , 0 5`
    .exitCode(0)
    .stdout("0,1,2,3,4,5,")
    .stderr("")
    .runAsTest("--separator works");

  TestBuilder.command`seq -t, 0 5`.exitCode(0).stdout("0\n1\n2\n3\n4\n5\n,").stderr("").runAsTest("-t works inline");

  TestBuilder.command`seq -t , 0 5`.exitCode(0).stdout("0\n1\n2\n3\n4\n5\n,").stderr("").runAsTest("-t works separate");

  TestBuilder.command`seq --terminator , 0 5`
    .exitCode(0)
    .stdout("0\n1\n2\n3\n4\n5\n,")
    .stderr("")
    .runAsTest("--terminator works");

  TestBuilder.command`seq -s. -t, 0 5`
    .exitCode(0)
    .stdout("0.1.2.3.4.5.,")
    .stderr("")
    .runAsTest("-s and -t work together");

  TestBuilder.command`seq 0`.exitCode(0).stdout("1\n0\n").stderr("").runAsTest("seq 0");

  TestBuilder.command`seq 1`.exitCode(0).stdout("1\n").stderr("").runAsTest("seq 1");

  TestBuilder.command`seq 2`.exitCode(0).stdout("1\n2\n").stderr("").runAsTest("seq 2");

  TestBuilder.command`seq 8 8`.exitCode(0).stdout("8\n").stderr("").runAsTest("same start and end");

  TestBuilder.command`seq ab`.exitCode(1).stdout("").stderr("seq: invalid argument\n").runAsTest("invalid arg 1");

  TestBuilder.command`seq 4 ab`.exitCode(1).stdout("").stderr("seq: invalid argument\n").runAsTest("invalid arg 2");

  TestBuilder.command`seq 4 7 ba`.exitCode(1).stdout("").stderr("seq: invalid argument\n").runAsTest("invalid arg 3");

  TestBuilder.command`seq 4 0 7`.exitCode(1).stdout("").stderr("seq: zero increment\n").runAsTest("zero increment");

  TestBuilder.command`seq 4 -2 7`
    .exitCode(1)
    .stdout("")
    .stderr("seq: needs positive increment\n")
    .runAsTest("needs positive increment");

  TestBuilder.command`seq 7 2 4`
    .exitCode(1)
    .stdout("")
    .stderr("seq: needs negative decrement\n")
    .runAsTest("needs negative decrement");

  TestBuilder.command`seq 16777216 16777218`
    .exitCode(0)
    .stdout("16777216\n")
    .stderr("")
    .runAsTest("terminates when adding the increment no longer changes the value");

  TestBuilder.command`seq 1 0.00000001 2`
    .exitCode(0)
    .stdout("1\n")
    .stderr("")
    .runAsTest("terminates when the increment is too small to advance the accumulator");
});

describe("seq without stdout", async () => {
  TestBuilder.command`echo $(seq 0 5)`
    .exitCode(0)
    .stdout("0 1 2 3 4 5\n")
    .stderr("")
    .runAsTest("works basic up without stdout");

  TestBuilder.command`echo $(seq 5 0)`
    .exitCode(0)
    .stdout("5 4 3 2 1 0\n")
    .stderr("")
    .runAsTest("works basic down without stdout");
});

// The builtin renders and writes its output about 64 KiB at a time. These
// sequences span several chunks, written to each kind of stdout that takes a
// different path through the builtin: the captured buffer (written directly),
// a file (fd written synchronously) and a pipe (fd completed from the event
// loop).
describe("seq long output", () => {
  const COUNT = 40_000;
  // BSD seq: the separator follows every value, the terminator comes last.
  const expected = Array.from({ length: COUNT }, (_, i) => `${i + 1},`).join("") + "END";
  const copyStdin = "await Bun.write(Bun.stdout, await Bun.stdin.bytes())";

  test.concurrent("captured stdout", async () => {
    expect(await $`seq -s , -t END 1 ${COUNT}`.text()).toBe(expected);
  });

  test.concurrent("redirected to a file", async () => {
    using dir = tempDir("seq-long", {});
    const out = join(String(dir), "out.txt");
    await $`seq -s , -t END 1 ${COUNT} > ${out}`.quiet();
    expect(await Bun.file(out).text()).toBe(expected);
  });

  test.concurrent("piped to a process", async () => {
    const stdout = await $`seq -s , -t END 1 ${COUNT} | ${bunExe()} -e ${copyStdin}`.env(bunEnv).text();
    expect(stdout).toBe(expected);
  });

  test.concurrent("redirected to a Buffer that holds the whole sequence", async () => {
    const target = Buffer.alloc(expected.length);
    const { stderr, exitCode } = await $`seq -s , -t END 1 ${COUNT} > ${target}`.nothrow().quiet();
    expect({ stderr: stderr.toString(), exitCode, target: target.toString() }).toEqual({
      stderr: "",
      exitCode: 0,
      target: expected,
    });
  });

  // 100 KiB takes the first chunk whole and is filled up by part of the second;
  // the third is refused. The Buffer must hold exactly that prefix. Like the
  // other builtins, seq leaves reporting a too-small Buffer to the shared
  // write_no_io layer, which today makes this a silent truncation with exit 0.
  test.concurrent("redirected to a Buffer smaller than the sequence", async () => {
    const target = Buffer.alloc(100 * 1024);
    const { stderr, exitCode } = await $`seq -s , -t END 1 ${COUNT} > ${target}`.nothrow().quiet();
    expect({ stderr: stderr.toString(), exitCode, target: target.toString() }).toEqual({
      stderr: "",
      exitCode: 0,
      target: expected.slice(0, target.length),
    });
  });

  // 8192 four-digit values with a 4-byte separator are exactly 64 KiB. Ending
  // at 9191 the sequence runs out just as the first chunk fills up; ending at
  // 9192 one value and the terminator are left over for a second chunk.
  describe.each([
    [9191, 8192],
    [9192, 8193],
  ])("seq -s abcd -t END 1000 %i", (end, count) => {
    const expected = Array.from({ length: count }, (_, i) => `${1000 + i}abcd`).join("") + "END";

    test.concurrent("captured stdout", async () => {
      expect(await $`seq -s abcd -t END 1000 ${end}`.text()).toBe(expected);
    });

    test.concurrent("redirected to a file", async () => {
      using dir = tempDir("seq-boundary", {});
      const out = join(String(dir), "out.txt");
      await $`seq -s abcd -t END 1000 ${end} > ${out}`.quiet();
      expect(await Bun.file(out).text()).toBe(expected);
    });

    test.concurrent("piped to a process", async () => {
      const stdout = await $`seq -s abcd -t END 1000 ${end} | ${bunExe()} -e ${copyStdin}`.env(bunEnv).text();
      expect(stdout).toBe(expected);
    });
  });

  // Once the reader is gone the chunks still to come fail with EPIPE and seq
  // has to fail instead of hanging. A pipeline only reports the reader's exit
  // code, so seq's own failure is made visible by chaining an `echo` to stderr
  // off it; the drained reader shows the marker is not printed otherwise.
  // 200k lines (~1.3 MB) are far more than a pipe buffers.
  describe("fails once the reader is gone", () => {
    const LINES = 200_000;
    const run = async (pipeline: Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }>) => {
      const { stdout, stderr, exitCode } = await pipeline;
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
    };

    test.concurrent("reader exits after the first line", async () => {
      const firstLine =
        `const { value } = await Bun.stdin.stream().getReader().read();` +
        `console.log(new TextDecoder().decode(value).split("\\n")[0]);` +
        `process.exit(0);`;
      const pipeline = $`(seq 1 ${LINES} || echo seq-failed 1>&2) | ${bunExe()} -e ${firstLine}`.env(bunEnv);
      expect(await run(pipeline.nothrow().quiet())).toEqual({ stdout: "1\n", stderr: "seq-failed\n", exitCode: 0 });
    });

    test.concurrent("reader never reads", async () => {
      const pipeline = $`(seq 1 ${LINES} || echo seq-failed 1>&2) | true`;
      expect(await run(pipeline.nothrow().quiet())).toEqual({ stdout: "", stderr: "seq-failed\n", exitCode: 0 });
    });

    test.concurrent("reader drains the whole sequence", async () => {
      const drain = "await Bun.stdin.bytes()";
      const pipeline = $`(seq 1 ${LINES} || echo seq-failed 1>&2) | ${bunExe()} -e ${drain}`.env(bunEnv);
      expect(await run(pipeline.nothrow().quiet())).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });
  });

  // seq used to render the whole sequence into one Vec before writing any of
  // it, and IOWriter copies what it is handed, so writing N bytes to an fd
  // took more than 2N bytes of memory: the child's RSS grew by about 90 MB for
  // this ~30 MB sequence (130 MB under ASAN), and the freed buffers stay
  // resident after the command (ASAN quarantines them, mimalloc keeps the
  // pages). Streamed in chunks it grows by a couple of MB whatever the length.
  // Measured in a child so nothing else in this file moves the numbers; the
  // 100-byte separator makes the output large with few values, which keeps
  // the child fast under ASAN.
  test.concurrent("does not buffer the whole sequence before writing it", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const sep = Buffer.alloc(100, "x").toString();` +
          `await Bun.$\`seq -s \${sep} 1 2000 > /dev/null\`;` +
          `const before = process.memoryUsage.rss();` +
          `await Bun.$\`seq -s \${sep} 1 300000 > /dev/null\`;` +
          `console.log(process.memoryUsage.rss() - before);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^-?\d+\n$/);
    expect(Number(stdout) / 1024 / 1024).toBeLessThan(16);
    expect(exitCode).toBe(0);
  });
});
