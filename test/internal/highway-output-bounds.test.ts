/**
 * `bun_highway::copy_u16_to_u8` and `bun_highway::fill_with_skip_mask`
 * (src/highway/lib.rs) are safe functions that hand C++ their `output` slice as
 * a bare pointer; the kernel then writes `input.len()` bytes without ever
 * seeing `output.len()`, so the length check in each wrapper is all that keeps
 * a too-short `output` from becoming a heap overflow. Both in-tree callers slice
 * their buffers to the input length first, so no JS API reaches the checks;
 * `highwayOutputProbes` (src/runtime/highway_testing.rs) calls the wrappers with
 * buffers of the test's choosing. The too-short cases run against the built
 * binary, which on release builds also pins the checks to `assert!`: a
 * `debug_assert!` compiles out there and the kernel writes past `output`
 * instead of panicking.
 */
import { highwayOutputProbes } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Straddles the 16/32/64-lane vector loops of both kernels and their scalar tails.
const LENGTHS = [0, 1, 3, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100];

// Neither kernel produces this byte from the inputs below, so an untouched byte is recognizable.
const UNTOUCHED = 0xee;

const mask = Uint8Array.of(0x12, 0x34, 0x56, 0x78);
const inputBytes = (length: number) => Uint8Array.from({ length }, (_, i) => i & 0x7f);
const maskedBytes = (length: number) => inputBytes(length).map((byte, i) => byte ^ mask[i & 3]);
// Every code unit has a non-zero high byte, so the output only matches if it was truncated.
const inputUnits = (length: number) => Uint16Array.from({ length }, (_, i) => 0xab00 | (i & 0x7f));

const fill = (length: number) => new Uint8Array(length).fill(UNTOUCHED);
const padded = (written: Uint8Array) => Uint8Array.of(...written, ...fill(3));

describe("copy_u16_to_u8", () => {
  test("an output of exactly the input length receives the low byte of every code unit", () => {
    expect(LENGTHS.map(n => highwayOutputProbes.copyU16ToU8(inputUnits(n), fill(n)))).toEqual(
      LENGTHS.map(n => inputBytes(n)),
    );
  });

  test("a longer output is only written up to the input length", () => {
    expect(LENGTHS.map(n => highwayOutputProbes.copyU16ToU8(inputUnits(n), fill(n + 3)))).toEqual(
      LENGTHS.map(n => padded(inputBytes(n))),
    );
  });
});

describe.each([
  ["masking", false, maskedBytes],
  ["skipping the mask", true, inputBytes],
])("fill_with_skip_mask %s", (_name, skipMask, expected) => {
  test("an output of exactly the input length receives every byte", () => {
    expect(LENGTHS.map(n => highwayOutputProbes.fillWithSkipMask(mask, fill(n), inputBytes(n), skipMask))).toEqual(
      LENGTHS.map(n => expected(n)),
    );
  });

  test("a longer output is only written up to the input length", () => {
    expect(LENGTHS.map(n => highwayOutputProbes.fillWithSkipMask(mask, fill(n + 3), inputBytes(n), skipMask))).toEqual(
      LENGTHS.map(n => padded(expected(n))),
    );
  });
});

// The panic aborts the process, so each too-short call gets a child of its own.
// The skip-mask call is a plain memcpy inside the kernel; it must be stopped by the same check.
test.concurrent.each([
  [
    "copyU16ToU8(new Uint16Array(2), new Uint8Array(1))",
    "copy_u16_to_u8: output too small (1 bytes for 2 input code units)",
  ],
  [
    "fillWithSkipMask(new Uint8Array(4), new Uint8Array(4), new Uint8Array(5), false)",
    "fill_with_skip_mask: output too small (4 bytes for 5 input bytes)",
  ],
  [
    "fillWithSkipMask(new Uint8Array(4), new Uint8Array(4), new Uint8Array(5), true)",
    "fill_with_skip_mask: output too small (4 bytes for 5 input bytes)",
  ],
])("%s panics instead of writing past the output", async (call, message) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.log(JSON.stringify(require("bun:internal-for-testing").highwayOutputProbes.${call}));`,
      // Skips the symbolized backtrace debug builds otherwise print, which takes seconds.
      "--debug-crash-handler-use-trace-string",
    ],
    // The panic is the expected outcome; it must not be reported as a crash.
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout,
    stderr: stderr.includes(message) ? message : stderr,
    exitCode: exitCode === 0 ? 0 : "non-zero",
  }).toEqual({ stdout: "", stderr: message, exitCode: "non-zero" });
});
