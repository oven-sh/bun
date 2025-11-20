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

// Test that onTestFinished throws proper error in concurrent tests
describe("onTestFinished errors", () => {
  test.concurrent("cannot be called in concurrent test 1", () => {
    expect(() => {
      onTestFinished(() => {
        console.log("should not run");
      });
    }).toThrow(
      "Cannot call onTestFinished() here. It cannot be called inside a concurrent test. Use test.serial or remove test.concurrent.",
    );
  });

  test.concurrent("cannot be called in concurrent test 2", () => {
    expect(() => {
      onTestFinished(() => {
        console.log("should not run");
      });
    }).toThrow(
      "Cannot call onTestFinished() here. It cannot be called inside a concurrent test. Use test.serial or remove test.concurrent.",
    );
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
