// Vitest 5.1.0 wrote the first line of __snapshots__/print-throws-vitest-sorted-file.fixture.js.snap and its first entry.
// Then Bun 1.4.4 appended the others with its own keys, and the keys of the file are still in Vitest's order.
// It printed `[native code]` for a getter and did not call it. Vitest's format calls it.
// To add a case, run it under that version. Never update them with a later Bun.
import { describe, expect, test } from "vitest";

const bad = () => ({
  ok: 1,
  get bad() {
    throw new Error("not ready");
  },
});

test("a, what Vitest wrote", () => {
  expect({ a: 1 }).toMatchSnapshot();
});
test("b, an own getter", () => {
  expect(bad()).toMatchSnapshot();
});
test("c, with property matchers", () => {
  expect(bad()).toMatchSnapshot({ ok: expect.any(Number) });
});
describe("d, in a describe", () => {
  test("an own getter", () => {
    expect(bad()).toMatchSnapshot();
  });
});
test("e, with a hint", () => {
  expect(bad()).toMatchSnapshot("the hint");
});
test("f, two calls and one that prints", () => {
  expect(bad()).toMatchSnapshot();
  expect(bad()).toMatchSnapshot();
  expect("the third of the test").toMatchSnapshot();
});
test("g, a getter that returns", () => {
  expect({
    ok: 1,
    get good() {
      return 2;
    },
  }).toMatchSnapshot();
});
