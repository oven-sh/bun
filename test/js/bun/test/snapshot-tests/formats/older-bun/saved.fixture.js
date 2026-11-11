import { describe, expect, test } from "vitest";

// What a test gives can depend on the runtime, as the text of an engine's error does.
const runtime = typeof Bun === "undefined" ? "node" : "bun";

describe("pairs", () => {
  test("a value", () => {
    expect(runtime).toMatchSnapshot();
  });

  test("a value and a hint", () => {
    expect({ runtime }).toMatchSnapshot("hint");
  });

  test("a thrown error", () => {
    expect(() => {
      throw new TypeError(runtime);
    }).toThrowErrorMatchingSnapshot();
  });

  describe("nested", () => {
    test("twice", () => {
      expect(runtime).toMatchSnapshot();
      expect([runtime]).toMatchSnapshot();
    });
  });
});

describe("the same for both", () => {
  test("a value", () => {
    expect({ a: 1 }).toMatchSnapshot();
  });

  test("a thrown error", () => {
    expect(() => {
      throw new RangeError("out of range");
    }).toThrowErrorMatchingSnapshot();
  });
});

test("at the top level", () => {
  expect({ a: 1 }).toMatchSnapshot();
});
