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

  // 16777216 is 2^24, where f32 stops being able to represent consecutive integers.
  TestBuilder.command`seq 16777216 16777219`
    .exitCode(0)
    .stdout("16777216\n16777217\n16777218\n16777219\n")
    .stderr("")
    .runAsTest("counts past 2^24");

  TestBuilder.command`seq 100000001 100000003`
    .exitCode(0)
    .stdout("100000001\n100000002\n100000003\n")
    .stderr("")
    .runAsTest("keeps every digit of nine-digit bounds");

  TestBuilder.command`seq 100000003 100000001`
    .exitCode(0)
    .stdout("100000003\n100000002\n100000001\n")
    .stderr("")
    .runAsTest("counts down past 2^24");

  TestBuilder.command`seq 4294967295 4294967297`
    .exitCode(0)
    .stdout("4294967295\n4294967296\n4294967297\n")
    .stderr("")
    .runAsTest("counts past 2^32");

  TestBuilder.command`seq 16777217 2 16777221`
    .exitCode(0)
    .stdout("16777217\n16777219\n16777221\n")
    .stderr("")
    .runAsTest("explicit increment past 2^24");

  // 9007199254740992 is 2^53, the last integer f64 can count to one by one.
  TestBuilder.command`seq 9007199254740991 9007199254740992`
    .exitCode(0)
    .stdout("9007199254740991\n9007199254740992\n")
    .stderr("")
    .runAsTest("counts up to 2^53");

  TestBuilder.command`seq 9007199254740992 9007199254740994`
    .exitCode(0)
    .stdout("9007199254740992\n")
    .stderr("")
    .runAsTest("terminates once the increment can no longer advance the value (past 2^53)");

  TestBuilder.command`seq 1 1e-17 2`
    .exitCode(0)
    .stdout("1\n")
    .stderr("")
    .runAsTest("terminates when the increment is below the resolution of the start value");

  TestBuilder.command`seq 0 0.1 1`
    .exitCode(0)
    .stdout("0\n0.1\n0.2\n0.3\n0.4\n0.5\n0.6\n0.7\n0.8\n0.9\n1\n")
    .stderr("")
    .runAsTest("fractional increment prints exact decimals and reaches the end value");

  TestBuilder.command`seq 0.1 0.1 0.5`
    .exitCode(0)
    .stdout("0.1\n0.2\n0.3\n0.4\n0.5\n")
    .stderr("")
    .runAsTest("fractional start and increment");

  TestBuilder.command`seq 1 0.3 2`
    .exitCode(0)
    .stdout("1\n1.3\n1.6\n1.9\n")
    .stderr("")
    .runAsTest("fractional increment does not accumulate rounding error");

  TestBuilder.command`seq -0.9 0.3 0.9`
    .exitCode(0)
    .stdout("-0.9\n-0.6\n-0.3\n0\n0.3\n0.6\n0.9\n")
    .stderr("")
    .runAsTest("fractional sequence through zero");

  TestBuilder.command`seq 2 -0.5 0`
    .exitCode(0)
    .stdout("2\n1.5\n1\n0.5\n0\n")
    .stderr("")
    .runAsTest("fractional decrement");

  TestBuilder.command`seq 0.5 0.01 0.53`
    .exitCode(0)
    .stdout("0.5\n0.51\n0.52\n0.53\n")
    .stderr("")
    .runAsTest("uses the most precise operand's number of decimals");

  TestBuilder.command`seq 0.5 3`
    .exitCode(0)
    .stdout("0.5\n1.5\n2.5\n")
    .stderr("")
    .runAsTest("implicit increment from a fractional start");

  TestBuilder.command`seq 3 0.5`
    .exitCode(0)
    .stdout("3\n2\n1\n")
    .stderr("")
    .runAsTest("implicit decrement to a fractional end");

  TestBuilder.command`seq 0 1e-1 3e-1`
    .exitCode(0)
    .stdout("0\n0.1\n0.2\n0.3\n")
    .stderr("")
    .runAsTest("decimals implied by exponent notation");

  TestBuilder.command`seq 1e-9999999999 0.5 1`
    .exitCode(0)
    .stdout("0\n0.5\n1\n")
    .stderr("")
    .runAsTest("exponent too large to count decimals for");

  // 2251799813685248 is 2^51; halves are still representable there, but the
  // values are too large to be counted in tenths, so they are used as written.
  TestBuilder.command`seq 2251799813685248.5 2251799813685249.5`
    .exitCode(0)
    .stdout("2251799813685248.5\n2251799813685249.5\n")
    .stderr("")
    .runAsTest("large fractional values");

  TestBuilder.command`seq 0 0.00000000000000000000001 0.00000000000000000000002`
    .exitCode(0)
    .stdout("0\n0.00000000000000000000001\n0.00000000000000000000002\n")
    .stderr("")
    .runAsTest("more than 22 decimals");
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
// full-output-sized clone on top of the copy that must exist, so peak RSS was
// ~3x the output instead of ~2x. ASAN-gated because release mimalloc does not
// retain freed pages the way ASAN's allocator does.
test.skipIf(!isASAN)("seq piped to an fd does not clone its output buffer before enqueue", async () => {
  // 100-byte separator keeps the output large (~32 MB) with only 300k
  // iterations, so the child finishes in ~1s under ASAN.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;` +
        `const sep = Buffer.alloc(100, "x").toString();` +
        `await Bun.$\`seq 1 10 > /dev/null\`;` +
        `const b = rss();` +
        `await Bun.$\`seq -s \${sep} 1 300000 > /dev/null\`;` +
        `console.log(rss() - b);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const rawDelta = stdout.trim();
  expect(rawDelta).toMatch(/^\d+$/);
  const deltaBytes = Number(rawDelta);
  // Output is 31_688_895 bytes. With the fix the child's RSS grows by
  // ~128-134 MB (rendered Vec capacity + IOWriter's copy + ASAN shadow);
  // without it the extra clone pushes it to ~170 MB.
  expect(deltaBytes).toBeGreaterThan(0);
  expect(deltaBytes).toBeLessThan(152 * 1024 * 1024);
  expect(exitCode).toBe(0);
});
