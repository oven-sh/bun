import { expect, test } from "bun:test";

// Inspecting a value can run user code (e.g. a custom inspect method) that
// throws. The matcher utils must surface that as a catchable JS exception,
// not abort the process.
test("matcher utils propagate exceptions thrown while inspecting the value", () => {
  const caught: Record<string, unknown> = {};
  expect.extend({
    _printThrowingValue(received) {
      try {
        this.utils.stringify(received);
      } catch (e) {
        caught.stringify = e;
      }
      try {
        this.utils.printExpected(received);
      } catch (e) {
        caught.printExpected = e;
      }
      try {
        this.utils.printReceived(received);
      } catch (e) {
        caught.printReceived = e;
      }
      return { pass: true, message: () => "" };
    },
  });

  // @ts-expect-error: _printThrowingValue is registered dynamically via expect.extend
  expect({
    [Symbol.for("nodejs.util.inspect.custom")]() {
      throw new Error("inspect failed");
    },
  })._printThrowingValue();

  expect(Object.keys(caught)).toEqual(["stringify", "printExpected", "printReceived"]);
  for (const error of Object.values(caught)) {
    expect(error).toHaveProperty("message", "inspect failed");
  }
});
