import { expect, test, describe } from "bun:test";

describe("camelCase", () => {
  test("converts space separated words", () => {
    expect(Bun.camelCase("hello world")).toBe("helloWorld");
    expect(Bun.camelCase("hello wonderful world")).toBe("helloWonderfulWorld");
  });

  test("converts kebab-case", () => {
    expect(Bun.camelCase("hello-world")).toBe("helloWorld");
    expect(Bun.camelCase("hello-wonderful-world")).toBe("helloWonderfulWorld");
  });

  test("converts snake_case", () => {
    expect(Bun.camelCase("hello_world")).toBe("helloWorld");
    expect(Bun.camelCase("hello_wonderful_world")).toBe("helloWonderfulWorld");
  });

  test("handles existing camelCase", () => {
    expect(Bun.camelCase("helloWorld")).toBe("helloWorld");
    expect(Bun.camelCase("helloWonderfulWorld")).toBe("helloWonderfulWorld");
  });

  test("handles mixed separators", () => {
    expect(Bun.camelCase("hello.world-nice_day")).toBe("helloWorldNiceDay");
    expect(Bun.camelCase("hello_world-nice day")).toBe("helloWorldNiceDay");
  });

  test("handles consecutive separators", () => {
    expect(Bun.camelCase("hello__world")).toBe("helloWorld");
    expect(Bun.camelCase("hello--world")).toBe("helloWorld");
    expect(Bun.camelCase("hello  world")).toBe("helloWorld");
  });

  test("handles edge cases", () => {
    expect(Bun.camelCase("")).toBe("");
    expect(Bun.camelCase(" ")).toBe("");
    expect(Bun.camelCase("a")).toBe("a");
    expect(Bun.camelCase("A")).toBe("a");
  });

  test("handles non-ASCII characters", () => {
    expect(Bun.camelCase("héllo wörld")).toBe("hélloWörld");
    expect(Bun.camelCase("こんにちは-世界")).toBe("こんにちは世界");
  });

});
