import { describe, test, expect } from "bun:test";

describe("test.failing with a done callback", () => {
  test.failing("fails when done is called with no args", done => {
    done();
  });

  test.failing("fails when done is called with undefined", done => {
    done(undefined);
  });

  test.failing("fails when all expectations are met and done is called without an error", done => {
    expect(1).toBe(1);
    done();
  });

  describe("when test fn is async", () => {
    // NOTE: tests that resolve/reject immediately hit a different code path
    test.failing("fails when done() is called immediately", async done => {
      done();
    });

    test.failing("fails when done() is called on the next tick", async done => {
      await new Promise(resolve => process.nextTick(resolve));
      done();
    });

    test.failing("fails when all expectations are met and done is called", async done => {
      await Bun.sleep(5);
      expect(1).toBe(1);
      done();
    });
  });
});
