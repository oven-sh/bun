// @ts-nocheck
import { describe, test, expect } from "vitest";

class CustomError extends Error {
  code = 42;
  constructor(m: string) {
    super(m);
    this.name = "CustomError";
  }
}

describe("toThrowErrorMatchingSnapshot", () => {
  test("Error", () => {
    expect(() => {
      throw new Error("plain message");
    }).toThrowErrorMatchingSnapshot();
  });
  test("TypeError", () => {
    expect(() => {
      throw new TypeError("type message");
    }).toThrowErrorMatchingSnapshot();
  });
  test("custom error", () => {
    expect(() => {
      throw new CustomError("custom message");
    }).toThrowErrorMatchingSnapshot();
  });
  test("multi-line message", () => {
    expect(() => {
      throw new Error("first\nsecond\n  third");
    }).toThrowErrorMatchingSnapshot();
  });
  test("empty message", () => {
    expect(() => {
      throw new Error("");
    }).toThrowErrorMatchingSnapshot();
  });
  test("odd characters", () => {
    expect(() => {
      throw new Error("a `b` ${c} \\d \"e\" 'f'");
    }).toThrowErrorMatchingSnapshot();
  });
  test("with a hint", () => {
    expect(() => {
      throw new Error("hinted");
    }).toThrowErrorMatchingSnapshot("the hint");
  });
  test("twice", () => {
    expect(() => {
      throw new Error("one");
    }).toThrowErrorMatchingSnapshot();
    expect(() => {
      throw new Error("two");
    }).toThrowErrorMatchingSnapshot();
  });
  test("a thrown string", () => {
    expect(() => {
      throw "just a string";
    }).toThrowErrorMatchingSnapshot();
  });
  test("a thrown object", () => {
    expect(() => {
      throw { message: "object message", code: 1 };
    }).toThrowErrorMatchingSnapshot();
  });
  test("a thrown number", () => {
    expect(() => {
      throw 5;
    }).toThrowErrorMatchingSnapshot();
  });
  test("a thrown undefined", () => {
    expect(() => {
      throw undefined;
    }).toThrowErrorMatchingSnapshot();
  });
  test("with a cause", () => {
    expect(() => {
      throw new Error("outer", { cause: new Error("inner") });
    }).toThrowErrorMatchingSnapshot();
  });
  test("rejects", async () => {
    await expect(Promise.reject(new Error("rejected message"))).rejects.toThrowErrorMatchingSnapshot();
  });
  test("async function rejects", async () => {
    await expect(async () => {
      throw new RangeError("async message");
    }).rejects.toThrowErrorMatchingSnapshot();
  });
  test("mixed with toMatchSnapshot", () => {
    expect(1).toMatchSnapshot();
    expect(() => {
      throw new Error("in between");
    }).toThrowErrorMatchingSnapshot();
    expect(3).toMatchSnapshot();
  });
});

describe("promises", () => {
  test("resolves", async () => {
    await expect(Promise.resolve({ r: 1 })).resolves.toMatchSnapshot();
  });
  test("rejects", async () => {
    await expect(Promise.reject(new Error("as a value"))).rejects.toMatchSnapshot();
  });
});
