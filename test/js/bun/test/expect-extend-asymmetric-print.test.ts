import { expect, test } from "bun:test";

// Like Jest, Bun ignores a `toAsymmetricMatcher` property on a matcher function
// and prints the custom asymmetric matcher in the default `<name> [args]` form.
test("ignores a toAsymmetricMatcher property on the matcher function", () => {
  let hookCalls = 0;
  function _toBeDivisibleByHooked(actual: unknown, divisor: number) {
    return { pass: typeof actual === "number" && actual % divisor === 0, message: () => "" };
  }
  _toBeDivisibleByHooked.toAsymmetricMatcher = () => {
    hookCalls++;
    return "DivisibleBy<3>";
  };
  let stringified: string | undefined;
  expect.extend({
    _toBeDivisibleByHooked,
    _stringifyActual(actual) {
      stringified = this.utils.stringify(actual);
      return { pass: true, message: () => "" };
    },
  });
  const anyExpect = expect as any;

  let message = "";
  try {
    expect({ n: 7 }).toEqual({ n: anyExpect._toBeDivisibleByHooked(3) });
  } catch (err) {
    message = Bun.stripANSI((err as Error).message);
  }
  expect(message).toContain('"n": _toBeDivisibleByHooked [');
  expect(message).not.toContain("[object Object]");
  expect(message).not.toContain("DivisibleBy<3>");

  anyExpect(anyExpect.not._toBeDivisibleByHooked(3))._stringifyActual();
  expect(stringified).toStartWith("not _toBeDivisibleByHooked [");
  expect(stringified).not.toContain("[object Object]");
  expect(hookCalls).toBe(0);
});
