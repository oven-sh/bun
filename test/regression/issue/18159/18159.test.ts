// Regression test for https://github.com/oven-sh/bun/issues/18159
// When setTimeout is called without a delay argument, it should not emit a TimeoutNaNWarning

import { expect, test } from "bun:test";

test("setTimeout() without delay should not emit TimeoutNaNWarning", done => {
  process.on("warning", warning => {
    try {
      expect(warning).toBeInstanceOf(Error);
      expect(warning).not.toHaveProperty("name", "TimeoutNaNWarning");
      expect(warning).toHaveProperty("message", "Another warning!");
    } catch (error) {
      done(error);
      return;
    }
    done();
  });

  expect(() => setTimeout(() => {})).not.toThrow();

  // Instead of waiting N seconds to see if the warning is emitted,
  // emit another warning to test that the warning handler is working.
  process.emitWarning("Another warning!");
});

test("setTimeout() with number delay should not emit TimeoutNaNWarning", done => {
  process.on("warning", warning => {
    try {
      expect(warning).toBeInstanceOf(Error);
      expect(warning).not.toHaveProperty("name", "TimeoutNaNWarning");
      expect(warning).toHaveProperty("message", "Another warning!");
    } catch (error) {
      done(error);
      return;
    }
    done();
  });

  expect(() => setTimeout(() => {}, 0)).not.toThrow();

  // Instead of waiting N seconds to see if the warning is emitted,
  // emit another warning to test that the warning handler is working.
  process.emitWarning("Another warning!");
});

test("setTimeout() with NaN delay should emit TimeoutNaNWarning", done => {
  process.on("warning", warning => {
    try {
      expect(warning).toBeInstanceOf(Error);
      expect(warning).toHaveProperty("name", "TimeoutNaNWarning");
    } catch (error) {
      done(error);
      return;
    }
    done();
  });

  expect(() => setTimeout(() => {}, NaN)).not.toThrow();
});
