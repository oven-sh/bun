import { describe, expect, test } from "bun:test";

// `.failing` inverts only the outcome of the test callback itself. An error
// that merely lands while the test is running is a real failure.

describe("callback outcome is still inverted", () => {
  test.failing("body throws", () => {
    throw new Error("expected failure");
  });

  test.failing("done(err)", done => {
    setTimeout(() => done(new Error("expected failure")), 0);
  });
});

describe("unhandled errors are not inverted", () => {
  test.failing("body resolves, stray timer throws meanwhile", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(() => {
      setTimeout(resolve, 0);
      throw new Error("stray timer error");
    }, 0);
    await promise;
  });

  test.failing("body resolves, floating promise rejects meanwhile", async () => {
    Promise.reject(new Error("floating rejection"));
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

  test.failing("body rejects, floating promise rejects first", async () => {
    Promise.reject(new Error("floating rejection before expected failure"));
    throw new Error("expected failure");
  });

  test.failing("done(err) first, then a nextTick throws", done => {
    process.nextTick(() => {
      throw new Error("nextTick error after done(err)");
    });
    done(new Error("expected failure"));
  });

  test.failing("expect() throws inside a timer, done() is never reached", done => {
    setTimeout(() => {
      expect(1).toBe(2);
      done();
    }, 0);
  });
});

describe("an error leaked by the previous test", () => {
  const leaked = Promise.withResolvers<void>();

  test("leaks a timer that throws", () => {
    setTimeout(() => {
      leaked.resolve();
      throw new Error("leaked from the previous test");
    }, 0);
  });

  test.failing("lands during a .failing test whose body passes", async () => {
    await leaked.promise;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
});
