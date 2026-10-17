// Bun.YAML, Bun.JSON5, Bun.TOML and Bun.XML write their output into one string
// builder (src/jsc/StringBuilder.rs, a WTF::StringBuilder). A string holds at
// most 2**31 - 1 characters. The builder records an overflow when an append
// passes that limit, and also when it cannot grow its buffer, and stringify
// has to throw an out-of-memory error for it, the same as JSON.stringify. Two
// calls asserted on an overflowed builder and aborted the process instead: the
// capacity that block-style YAML reserves before indentation, and the append
// of a UTF-16 string, which YAML, JSON5 and XML make for keys, names and indents.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { totalmem } from "node:os";

// `big` overflows the builder, and what follows it makes one of the two calls.
const fixture = (big: string, expression: string) => `
  const big = ${big};
  try {
    console.log("returned", ${expression}.length);
  } catch (e) {
    console.log("threw", e.name, e.message);
  }
`;
const threw = "threw RangeError Out of memory\n";

// The overflow comes from a failed allocation. With Malloc=1 WebKit allocates
// through the system allocator, so ASAN's per-allocation cap covers the
// builder's buffer. `big` is 3/4 of the cap: the string itself fits, and the
// buffer cannot double to get past it.
describe.concurrent.skipIf(!isASAN)("stringify throws when the string builder cannot grow", () => {
  const CAP_MIB = 4;
  test.each([
    ["block-style YAML reserves capacity", `Bun.YAML.stringify([big, 1], null, 2)`],
    ["block-style YAML appends a UTF-16 key", `Bun.YAML.stringify({ a: big, "日本": 1 }, null, 2)`],
    ["block-style YAML appends a UTF-16 indent", `Bun.YAML.stringify([[big, 1]], null, "\\u3000")`],
    ["flow-style YAML appends a UTF-16 key", `Bun.YAML.stringify({ a: big, "日本": 1 })`],
    ["JSON5 appends a UTF-16 key", `Bun.JSON5.stringify({ a: big, "日本": 1 })`],
    ["XML appends a UTF-16 element name", `Bun.XML.stringify({ a: { b: big, "日本": "1" } })`],
  ])("%s", async (_name, expression) => {
    // "latin1" makes `big` an 8-bit string, so the builder is still 8-bit when the UTF-16 string arrives.
    const big = `Buffer.alloc(${0.75 * CAP_MIB} * 1024 * 1024, "x").toString("latin1")`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(big, expression)],
      env: {
        ...bunEnv,
        Malloc: "1",
        ASAN_OPTIONS: [
          bunEnv.ASAN_OPTIONS,
          "allocator_may_return_null=1",
          `max_allocation_size_mb=${CAP_MIB}`,
          "detect_leaks=0",
        ]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      // ASAN logs a warning for every refused allocation; drained, not asserted on.
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout, `the child exited with ${exitCode}\nstderr:\n${stderr}`).toBe(threw);
    expect(exitCode).toBe(0);
  });
});

// The overflow comes from the length: `a: ` and a string of the maximum length
// are three characters past the limit. The key after it needs both calls. The
// child holds 2 GiB and reads it once to decide on quoting, about 80 ns per
// character in a debug build, so this runs on release builds with enough memory.
test.skipIf(isASAN || isDebug || totalmem() < 10 * 1024 ** 3)(
  "stringify throws when the output passes the maximum string length",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(`"x".repeat(2 ** 31 - 1)`, `Bun.YAML.stringify({ a: big, "日本": 1 }, null, 2)`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: threw, stderr: "", exitCode: 0 });
  },
  120_000,
);
