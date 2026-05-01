import { describe, test } from "bun:test";

describe("test.failing with a done callback", () => {
  test.failing("passes when an error is thrown", done => {
    throw new Error("test error");
  });

  test.failing("passes when done() is called with an error", done => {
    done(new Error("test error"));
  });

  describe("when test fn is asynchronous but does not return a promise", () => {
    test.failing("passes when done(err) is called on next tick", done => {
      process.nextTick(() => {
        done(new Error("test error"));
      });
    });

    test.failing("passes when done(err) is called on next event loop cycle", done => {
      setTimeout(() => {
        done(new Error("test error"));
      }, 0);
    });
  });

  describe("when test fn is async", () => {
    // NOTE: tests that resolve/reject immediately hit a different code path
    test.failing("passes when a promise rejects", async _done => {
      await Bun.sleep(5);
      throw new Error("test error");
    });

    test.failing("passes when a promise rejects immediately", async _done => {
      throw new Error("test error");
    });

    test.failing("passes when done() is called with an error", async done => {
      await Bun.sleep(5);
      done(new Error("test error"));
    });
  });
});
