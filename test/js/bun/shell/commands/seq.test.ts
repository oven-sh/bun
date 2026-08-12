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

  TestBuilder.command`seq 1 0.5 3`
    .exitCode(0)
    .stdout("1\n1.5\n2\n2.5\n3\n")
    .stderr("")
    .runAsTest("without -w, values print in their shortest form");

  TestBuilder.command`seq -f %g 1 3`
    .exitCode(1)
    .stdout("")
    .stderr("seq: unsupported option, please open a GitHub issue -- -f\n")
    .runAsTest("-f is reported as unsupported");

  TestBuilder.command`seq -f%03g 1 3`
    .exitCode(1)
    .stdout("")
    .stderr("seq: unsupported option, please open a GitHub issue -- -f\n")
    .runAsTest("-f with the format attached is reported as unsupported");

  TestBuilder.command`seq -f`
    .exitCode(1)
    .stdout("")
    .stderr("seq: unsupported option, please open a GitHub issue -- -f\n")
    .runAsTest("-f without a format is reported as unsupported");

  TestBuilder.command`seq --format %g 1 3`
    .exitCode(1)
    .stdout("")
    .stderr("seq: unsupported option, please open a GitHub issue -- --format\n")
    .runAsTest("--format is reported as unsupported");

  TestBuilder.command`seq -s , -f %g 1 3`
    .exitCode(1)
    .stdout("")
    .stderr("seq: unsupported option, please open a GitHub issue -- -f\n")
    .runAsTest("-f after other flags is reported as unsupported");
});

describe("seq -w", async () => {
  TestBuilder.command`seq -w 8 11`
    .exitCode(0)
    .stdout("08\n09\n10\n11\n")
    .stderr("")
    .runAsTest("pads to the width of the widest value");

  TestBuilder.command`seq --fixed-width 8 11`
    .exitCode(0)
    .stdout("08\n09\n10\n11\n")
    .stderr("")
    .runAsTest("--fixed-width is the long form of -w");

  TestBuilder.command`seq -w 11 8`
    .exitCode(0)
    .stdout("11\n10\n09\n08\n")
    .stderr("")
    .runAsTest("pads when counting down");

  TestBuilder.command`seq -w 10`
    .exitCode(0)
    .stdout("01\n02\n03\n04\n05\n06\n07\n08\n09\n10\n")
    .stderr("")
    .runAsTest("pads with a single operand");

  TestBuilder.command`seq -w 1 3`
    .exitCode(0)
    .stdout("1\n2\n3\n")
    .stderr("")
    .runAsTest("adds nothing when the values already share a width");

  TestBuilder.command`seq -w 99 1 101`
    .exitCode(0)
    .stdout("099\n100\n101\n")
    .stderr("")
    .runAsTest("width comes from the widest bound");

  TestBuilder.command`seq -w 1 4 10`
    .exitCode(0)
    .stdout("01\n05\n09\n")
    .stderr("")
    .runAsTest("width comes from the end bound even when it is not reached");

  TestBuilder.command`seq -w -1 1`
    .exitCode(0)
    .stdout("-1\n00\n01\n")
    .stderr("")
    .runAsTest("the sign counts towards the width");

  TestBuilder.command`seq -w -10 5 10`
    .exitCode(0)
    .stdout("-10\n-05\n000\n005\n010\n")
    .stderr("")
    .runAsTest("zeros go between the sign and the digits");

  TestBuilder.command`seq -w 1 0.5 3`
    .exitCode(0)
    .stdout("1.0\n1.5\n2.0\n2.5\n3.0\n")
    .stderr("")
    .runAsTest("every value gets the increment's decimals");

  TestBuilder.command`seq -w 0 0.25 1`
    .exitCode(0)
    .stdout("0.00\n0.25\n0.50\n0.75\n1.00\n")
    .stderr("")
    .runAsTest("every value gets the most decimals any operand has");

  TestBuilder.command`seq -w -0.5 0.25 0.5`
    .exitCode(0)
    .stdout("-0.50\n-0.25\n00.00\n00.25\n00.50\n")
    .stderr("")
    .runAsTest("fractional values pad after the sign");

  TestBuilder.command`seq -w 1.50 2`.exitCode(0).stdout("1.50\n").stderr("").runAsTest("keeps decimals as written");

  TestBuilder.command`seq -w 0 2.5e-1 1`
    .exitCode(0)
    .stdout("0.00\n0.25\n0.50\n0.75\n1.00\n")
    .stderr("")
    .runAsTest("a negative exponent adds decimals");

  TestBuilder.command`seq -w 1.5e1 16`
    .exitCode(0)
    .stdout("15\n16\n")
    .stderr("")
    .runAsTest("a positive exponent removes decimals");

  TestBuilder.command`seq -w -s , 8 11`.exitCode(0).stdout("08,09,10,11,").stderr("").runAsTest("works with -s");

  TestBuilder.command`seq -s, -t. -w 8 11`
    .exitCode(0)
    .stdout("08,09,10,11,.")
    .stderr("")
    .runAsTest("works after -s and -t");

  TestBuilder.command`echo $(seq -w 8 11)`
    .exitCode(0)
    .stdout("08 09 10 11\n")
    .stderr("")
    .runAsTest("pads when stdout is captured");

  TestBuilder.command`seq -w 8 11 > out.txt`
    .exitCode(0)
    .stdout("")
    .stderr("")
    .fileEquals("out.txt", "08\n09\n10\n11\n")
    .runAsTest("pads when stdout is a file");

  // 1e-70000 parses as 0 but was written with 70000 implied decimals; more
  // than core::fmt can print, so the precision is capped at 1074 (the most
  // fractional digits any double has) instead of panicking.
  const zeros = Buffer.alloc(1074, "0").toString();
  TestBuilder.command`seq -w 1e-70000 1`
    .exitCode(0)
    .stdout(`0.${zeros}\n1.${zeros}\n`)
    .stderr("")
    .runAsTest("caps the number of decimals");
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
