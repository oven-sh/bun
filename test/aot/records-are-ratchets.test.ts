import { expect, test } from "bun:test";
import { isNoWorse } from "./instruction-counts/instruction-counts";
import { isNoLessTyped } from "./typedness/run-typedness";

const counted = (shares: string, bytes: number) => `typed, function: 0 instructions (${shares}), ${bytes} bytes`;
const typed = (numbers: string) => `program: ${numbers}`;

test.each([
  ["the same line", "kernel 7.40", 401, "kernel 7.40", 401, 200, true],
  ["a lower count and fewer bytes", "kernel 6.40", 300, "kernel 7.40", 401, 200, true],
  ["a fifth of an instruction more", "kernel 7.60", 401, "kernel 7.40", 401, 200, true],
  ["an instruction more in a loop of seven", "kernel 8.38", 401, "kernel 7.40", 401, 200, false],
  ["two instructions more in a stub, of 99", "kernel 67.14, stub CallHostFunction2 34", 383, "kernel 67.14, stub CallHostFunction2 32", 383, 200, false],
  ["work that moves from the function into a stub", "kernel 60, stub Add 20", 383, "kernel 70, stub Add 10", 383, 200, true],
  ["4% more bytes", "kernel 7.40", 417, "kernel 7.40", 401, 200, true],
  ["6% more bytes", "kernel 7.40", 426, "kernel 7.40", 401, 200, false],
  ["a block refill in a window that is counted once", "kernel 46, the runtime 9.32, elsewhere 1.46", 208, "kernel 46", 208, 200, true],
  ["as much in windows that are counted twice", "kernel 46, the runtime 9.32, elsewhere 1.46", 208, "kernel 46", 208, 0, false],
  ["a record with a refill in its shorter window", "kernel 81.22, the runtime 7.90, stub Cold 0.29", 689, "kernel 81.22, stub Cold -0.29, elsewhere -0.28, the runtime -7.92", 689, 200, true],
  ["14% more in the runtime", "kernel 137, the runtime 2775", 0, "kernel 139, the runtime 2435", 0, 200, true],
  ["16% more in the runtime", "kernel 137, the runtime 2830", 0, "kernel 139, the runtime 2435", 0, 200, false],
])("a counted line: %s", (_, shares, bytes, recordedShares, recordedBytes, operationsCountedOnce, passes) => {
  expect(isNoWorse(counted(shares, bytes), counted(recordedShares, recordedBytes), operationsCountedOnce)).toBe(passes);
});

test("a counted line is compared with the line of its own form", () => {
  expect(isNoWorse("untyped, function: 1 instructions (kernel 1), 1 bytes", counted("kernel 1", 1), 200)).toBe(false);
});

test.each([
  ["the same line", "0 layouts, 0 given, 0 open, places 58 of 67, reads 4 of 9", "0 layouts, 0 given, 0 open, places 58 of 67, reads 4 of 9", true],
  ["fewer typed reads", "0 layouts, 0 given, 0 open, places 58 of 67, reads 2 of 9", "0 layouts, 0 given, 0 open, places 58 of 67, reads 4 of 9", false],
  ["more typed reads", "0 layouts, 0 given, 0 open, places 58 of 67, reads 4 of 9", "0 layouts, 0 given, 0 open, places 58 of 67, reads 2 of 9", true],
  ["more places that say nothing", "19 layouts, 0 given, 22 open, places 61 of 127, reads 1 of 17", "19 layouts, 0 given, 22 open, places 61 of 97, reads 1 of 17", false],
  ["one more open type", "5 layouts, 0 given, 8 open, places 28 of 58, reads 8 of 38", "4 layouts, 0 given, 7 open, places 27 of 57, reads 8 of 38", false],
  ["one more given type", "4 layouts, 1 given, 7 open, places 27 of 57, reads 8 of 38", "4 layouts, 0 given, 7 open, places 27 of 57, reads 8 of 38", false],
  ["another number of layouts", "5 layouts, 0 given, 7 open, places 27 of 57, reads 8 of 38", "4 layouts, 0 given, 7 open, places 27 of 57, reads 8 of 38", true],
  ["no reads at all", "0 layouts, 0 given, 0 open, places 1 of 1, reads 0 of 0", "0 layouts, 0 given, 0 open, places 1 of 1, reads 0 of 0", true],
  ["refused before, typed now", "0 layouts, 0 given, 0 open, places 1 of 1, reads 0 of 0", "is refused", true],
  ["typed before, refused now", "is refused", "0 layouts, 0 given, 0 open, places 1 of 1, reads 0 of 0", false],
  ["refused as before", "is refused", "is refused", true],
  ["a signal", "signal SIGSEGV", "is refused", false],
])("a typedness line: %s", (_, numbers, recordedNumbers, passes) => {
  expect(isNoLessTyped(typed(numbers), typed(recordedNumbers))).toBe(passes);
});
