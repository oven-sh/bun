import { afterAll, afterEach, describe, onTestFinished, test } from "bun:test";

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
    output.push("test 2");
    // After test 2, verify the order from test 1
    if (output.length >= 4) {
      const expected = ["test 1", "inner afterAll", "afterEach", "onTestFinished"];
      for (let i = 0; i < expected.length; i++) {
        if (output[i] !== expected[i]) {
          throw new Error(
            `Expected output[${i}] to be "${expected[i]}", but got "${output[i]}". Full output: ${JSON.stringify(output)}`,
          );
        }
      }
    }
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
    const expected = ["test", "afterEach", "onTestFinished 1", "onTestFinished 2"];
    for (let i = 0; i < expected.length; i++) {
      if (output[i] !== expected[i]) {
        throw new Error(
          `Expected output[${i}] to be "${expected[i]}", but got "${output[i]}". Full output: ${JSON.stringify(output)}`,
        );
      }
    }
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
    const expected = ["test", "afterEach", "onTestFinished async"];
    for (let i = 0; i < expected.length; i++) {
      if (output[i] !== expected[i]) {
        throw new Error(
          `Expected output[${i}] to be "${expected[i]}", but got "${output[i]}". Full output: ${JSON.stringify(output)}`,
        );
      }
    }
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
    const expected = ["test", "inner afterAll", "afterEach", "onTestFinished"];
    for (let i = 0; i < expected.length; i++) {
      if (output[i] !== expected[i]) {
        throw new Error(
          `Expected output[${i}] to be "${expected[i]}", but got "${output[i]}". Full output: ${JSON.stringify(output)}`,
        );
      }
    }
  });
});
