// The native functions of internal/validators pass the everyday values in front of the code that words the errors (src/jsc/bindings/NodeValidatorBodies.h: one body for `bun run` and for compiled programs).
// Each case stands on either side of the edge of one such answer; ./numbers-checked-against-ranges.test.ts holds the numbers against ranges.
import { exposedInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const validators = exposedInternals["internal/validators"];
const answerOf = (name: string, ...operands: unknown[]): unknown => {
  try {
    return validators[name](...operands);
  } catch (error) {
    return (error as { code: string }).code;
  }
};

test("a number that is not finite", () => {
  expect(answerOf("validateFiniteNumber", 5, "n")).toBe(true);
  expect(answerOf("validateFiniteNumber", NaN, "n")).toBe(false);
  expect(answerOf("validateFiniteNumber", undefined, "n")).toBe(false);
  expect(answerOf("validateFiniteNumber", Infinity, "n")).toBe("ERR_OUT_OF_RANGE");
  expect(answerOf("validateFiniteNumber", -Infinity, "n")).toBe("ERR_OUT_OF_RANGE");
  expect(answerOf("checkRangesOrGetDefault", 5, "n", 0, Infinity, 7)).toBe(5);
  expect(answerOf("checkRangesOrGetDefault", NaN, "n", 0, Infinity, 7)).toBe(7);
  expect(answerOf("checkRangesOrGetDefault", Infinity, "n", 0, Infinity, 7)).toBe("ERR_OUT_OF_RANGE");
});

test("the ends of the ports", () => {
  expect(answerOf("validatePort", 65535)).toBe(65535);
  expect(answerOf("validatePort", 65536)).toBe("ERR_SOCKET_BAD_PORT");
  expect(answerOf("validatePort", 0)).toBe(0);
  expect(answerOf("validatePort", 0, "Port", 1)).toBe(0);
  expect(answerOf("validatePort", 0, "Port", false)).toBe("ERR_SOCKET_BAD_PORT");
  expect(answerOf("validatePort", -1)).toBe("ERR_SOCKET_BAD_PORT");
});

test("a list that is too short, and a list where an object is asked for", () => {
  expect(answerOf("validateArray", [], "n")).toBe(undefined);
  expect(answerOf("validateArray", [1, 2], "n", 2)).toBe(undefined);
  expect(answerOf("validateArray", [1], "n", 2)).toBe("ERR_INVALID_ARG_VALUE");
  expect(answerOf("validateObject", {}, "n")).toBe(undefined);
  expect(answerOf("validateObject", [], "n", 2)).toBe(undefined);
  expect(answerOf("validateObject", [], "n")).toBe("ERR_INVALID_ARG_TYPE");
});

test("one of several is found as Object.is() finds it", () => {
  expect(answerOf("validateOneOf", NaN, "n", [1, NaN])).toBe(undefined);
  expect(answerOf("validateOneOf", 1, "n", [0.5 + 0.5])).toBe(undefined);
  expect(answerOf("validateOneOf", 0, "n", [-0])).toBe("ERR_INVALID_ARG_VALUE");
});
