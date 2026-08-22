import { afterAll, afterEach, describe, expect, onTestFinished, test } from "bun:test";

// Test the basic ordering of onTestFinished
describe("onTestFinished ordering", () => {
  const output: string[] = [];

  afterEach(() => {
    output.push("afterEach");
  });

  test("test 1", () => {
    afterAll(() => {
      output.push("inner afterAll");
    });
    onTestFinished(() => {
      output.push("onTestFinished");
    });
    output.push("test 1");
  });

  test("test 2", () => {
    // After test 2 starts, verify the order from test 1
    expect(output).toEqual(["test 1", "inner afterAll", "afterEach", "onTestFinished"]);
  });
});

// Test multiple onTestFinished calls
describe("multiple onTestFinished", () => {
  const output: string[] = [];

  afterEach(() => {
    output.push("afterEach");
  });

  test("test with multiple onTestFinished", () => {
    onTestFinished(() => {
      output.push("onTestFinished 1");
    });
    onTestFinished(() => {
      output.push("onTestFinished 2");
    });
    output.push("test");
  });

  test("verify order", () => {
    expect(output).toEqual(["test", "afterEach", "onTestFinished 1", "onTestFinished 2"]);
  });
});

// Test onTestFinished with async callbacks
describe("async onTestFinished", () => {
  const output: string[] = [];

  afterEach(() => {
    output.push("afterEach");
  });

  test("async onTestFinished", async () => {
    onTestFinished(async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      output.push("onTestFinished async");
    });
    output.push("test");
  });

  test("verify async order", () => {
    expect(output).toEqual(["test", "afterEach", "onTestFinished async"]);
  });
});

// https://github.com/oven-sh/bun/issues/29236 — onTestFinished() is
// callable from inside a concurrent test. Each sequence accumulates its
// own hooks and runs them at the end of that sequence.
describe("onTestFinished in concurrent tests", () => {
  const a_output: string[] = [];
  const b_output: string[] = [];

  test.concurrent("test a", () => {
    onTestFinished(() => {
      a_output.push("a-finished");
    });
    a_output.push("a-body");
  });

  test.concurrent("test b", () => {
    onTestFinished(() => {
      b_output.push("b-finished");
    });
    b_output.push("b-body");
  });

  test("verify each sequence ran its own hook", () => {
    expect(a_output).toEqual(["a-body", "a-finished"]);
    expect(b_output).toEqual(["b-body", "b-finished"]);
  });
});

// Test onTestFinished with afterEach and afterAll together
describe("onTestFinished with all hooks", () => {
  const output: string[] = [];

  afterEach(() => {
    output.push("afterEach");
  });

  test("test with all hooks", () => {
    afterAll(() => {
      output.push("inner afterAll");
    });
    onTestFinished(() => {
      output.push("onTestFinished");
    });
    output.push("test");
  });

  test("verify complete order", () => {
    // Expected order: test body, inner afterAll, afterEach, onTestFinished
    expect(output).toEqual(["test", "inner afterAll", "afterEach", "onTestFinished"]);
  });
});

// Test that a failing test still runs the onTestFinished hook
describe("onTestFinished with failing test", () => {
  const output: string[] = [];

  test.failing("failing test", () => {
    onTestFinished(() => {
      output.push("onTestFinished");
    });
    output.push("test");
    throw new Error("fail");
  });
  test("verify order", () => {
    expect(output).toEqual(["test", "onTestFinished"]);
  });
});
