import { expect, test } from "bun:test";
import { isNoLessTyped } from "./typedness/run-typedness";

const typed = (numbers: string) => `program: ${numbers}`;

const someTyped = "1 open, 2 checks, accesses 3 of 4";
const noAccesses = "0 open, 0 checks, accesses 0 of 0";

test.each([
  ["the same line", someTyped, someTyped, true],
  ["one more open type", "2 open, 2 checks, accesses 3 of 4", someTyped, false],
  ["one more check", "1 open, 3 checks, accesses 3 of 4", someTyped, false],
  ["a typed access that became untyped", "1 open, 2 checks, accesses 2 of 4", someTyped, false],
  ["the same share of more accesses", "1 open, 2 checks, accesses 6 of 8", someTyped, true],
  ["a typed access optimized away", "1 open, 2 checks, accesses 2 of 3", someTyped, true],
  ["better in all three numbers", "0 open, 1 checks, accesses 4 of 4", someTyped, true],
  ["no accesses, as before", noAccesses, noAccesses, true],
  ["accesses before, none now", noAccesses, someTyped, true],
  ["typed accesses where there were none", "0 open, 0 checks, accesses 10 of 10", noAccesses, true],
  ["untyped accesses where there were none", "0 open, 0 checks, accesses 0 of 10", noAccesses, false],
  ["compiled before, not now", "is not compiled", someTyped, false],
  ["not compiled before, compiled now", someTyped, "is not compiled", true],
  ["not compiled, as before", "is not compiled", "is not compiled", true],
  ["compiled before, a signal now", "signal SIGKILL", someTyped, false],
  ["a signal before, compiled now", someTyped, "signal SIGKILL", true],
  ["not compiled before, a signal now", "signal SIGSEGV", "is not compiled", false],
  ["a signal before, not compiled now", "is not compiled", "signal SIGSEGV", true],
  ["another signal", "signal SIGSEGV", "signal SIGKILL", false],
])("a typedness line: %s", (_, numbers, recordedNumbers, passes) => {
  expect(isNoLessTyped(typed(numbers), typed(recordedNumbers))).toBe(passes);
});
