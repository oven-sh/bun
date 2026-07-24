import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
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

// Regression guard: the fd-output path used to build the full output into a
// local Vec, store it into state, then clone the stored Vec to hand to
// BuiltinIO::enqueue (which itself copies into IOWriter's buffer). That is a
// full-output-sized clone on top of the two copies that must exist, so peak
// RSS was ~3x the output instead of ~2x. ASAN-gated because release mimalloc
// does not retain freed pages the way ASAN's allocator does.
test.skipIf(!isASAN)("seq piped to an fd does not clone its output buffer before enqueue", async () => {
  // 100-byte separator keeps the output large (~32 MB) with only 300k
  // iterations, so the child finishes in ~1s under ASAN.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const sep = Buffer.alloc(100, "x").toString();` +
        `await Bun.$\`seq 1 10 > /dev/null\`;` +
        `const b = process.memoryUsage().rss;` +
        `await Bun.$\`seq -s \${sep} 1 300000 > /dev/null\`;` +
        `console.log(process.memoryUsage().rss - b);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const deltaBytes = parseInt(stdout.trim(), 10);
  // Output is 31_888_894 bytes. With the fix the child's RSS grows by ~134 MB
  // (rendered Vec capacity + IOWriter's copy + ASAN shadow); without it the
  // extra clone pushes it to ~170 MB.
  expect(deltaBytes).toBeLessThan(152 * 1024 * 1024);
  expect(exitCode).toBe(0);
});
