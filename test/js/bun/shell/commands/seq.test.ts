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

  // Operands, and the lines that seq prints. null: seq prints `seq: invalid argument` and exits 1.
  const operandRows: [string[], string | null][] = [
    // Hex integers, in each operand position and with a sign.
    [["0x10", "0x10"], "16"],
    [["0X10", "0X10"], "16"],
    [["0xAb", "0xAb"], "171"],
    [["+0x10", "+0x10"], "16"],
    [["0x1", "0x3"], "1 2 3"],
    [["0xA", "0xC"], "10 11 12"],
    [["-0x2", "0x1"], "-2 -1 0 1"],
    [["1", "0x2", "5"], "1 3 5"],
    [["0x3", "-0x1", "0x1"], "3 2 1"],
    [["-0x3", "0x2", "0x3"], "-3 -1 1 3"],
    [["1.5", "0x3"], "1.5 2.5"],
    // Hex floats: a `.`, a `p` exponent, or both.
    [["0x1p4", "0x1p4"], "16"],
    [["0x1P4", "0x1P4"], "16"],
    [["0x1p+4", "0x1p+4"], "16"],
    [["0x1p-1", "0x1p-1"], "0.5"],
    [["0x1.8p1", "0x1.8p1"], "3"],
    [["0x.8p2"], "1 2"],
    [["0x8.", "0x8."], "8"],
    [["0x.8", "0x.8"], "0.5"],
    [["0x1.1", "0x1.1"], "1.0625"],
    [["0x1.4p-3", "0x1.4p-3"], "0.15625"],
    // More digits than 64 bits hold.
    [["0x10000000000000000p-64", "0x10000000000000000p-64"], "1"],
    [["0x1.00000000000000001", "0x1.00000000000000001"], "1"],
    [["0x.00000000000000001p68", "0x.00000000000000001p68"], "1"],
    // Exponents past the range of i32 and of i64.
    [["0x0p1024", "0x0p1024"], "0"],
    [["0x1p-2147483649", "0x1p-2147483649"], "0"],
    [["0x1p-18446744073709551612", "0x1p-18446744073709551612"], "0"],
    [["0x.8p-9223372036854775807", "0x.8p-9223372036854775807"], "0"],
    [["0x1p2147483648"], null],
    [["0x1p18446744073709551620"], null],
    [["0x10000000000000000p9223372036854775807"], null],
    // Too large: 2^128 for the f32 that seq stores, 2^1024 for an f64.
    [["0x1p128"], null],
    [["0x1p1024"], null],
    // Not a hex float.
    [["0x"], null],
    [["0x."], null],
    [["0xg"], null],
    [["0xp1"], null],
    [["0x1p"], null],
    [["0x1p+"], null],
    [["0x0pZ"], null],
    [["0x1.2.3"], null],
    [["0x 5"], null],
    [["0x5 "], null],
    [["-+0x5"], null],
    [["- 0x5"], null],
    // The `_` digit separator of Zig is not taken.
    [["1_0"], null],
    [["0x1_0"], null],
    // A sign alone, and no text.
    [["-"], null],
    [["+"], null],
    [[""], null],
    // Decimal operands.
    [["-1", "1"], "-1 0 1"],
    [["+3"], "1 2 3"],
    [["010"], "1 2 3 4 5 6 7 8 9 10"],
    [[".5", "2"], "0.5 1.5"],
  ];
  for (const [operands, lines] of operandRows) {
    const builder = TestBuilder.command`seq ${operands}`;
    (lines === null
      ? builder.exitCode(1).stdout("").stderr("seq: invalid argument\n")
      : builder
          .exitCode(0)
          .stdout(lines.replaceAll(" ", "\n") + "\n")
          .stderr("")
    ).runAsTest(`seq ${operands.map(operand => JSON.stringify(operand)).join(" ")}`);
  }

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
      `const rss = process.memoryUsage.rss;` +
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
