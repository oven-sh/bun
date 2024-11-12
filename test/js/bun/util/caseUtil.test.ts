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

describe("capitalCase", () => {
  test("converts space separated words", () => {
    expect(Bun.capitalCase("hello world")).toBe("Hello World");
    expect(Bun.capitalCase("hello wonderful world")).toBe("Hello Wonderful World");
  });

  test("converts kebab-case", () => {
    expect(Bun.capitalCase("hello-world")).toBe("Hello World");
    expect(Bun.capitalCase("hello-wonderful-world")).toBe("Hello Wonderful World");
  });

  test("converts snake_case", () => {
    expect(Bun.capitalCase("hello_world")).toBe("Hello World");
    expect(Bun.capitalCase("hello_wonderful_world")).toBe("Hello Wonderful World");
  });

  test("handles existing capitalCase", () => {
    expect(Bun.capitalCase("Hello World")).toBe("Hello World");
    expect(Bun.capitalCase("Hello Wonderful World")).toBe("Hello Wonderful World");
  });

  test("handles mixed separators", () => {
    expect(Bun.capitalCase("hello.world-nice_day")).toBe("Hello World Nice Day");
    expect(Bun.capitalCase("hello_world-nice day")).toBe("Hello World Nice Day");
  });

  test("handles consecutive separators", () => {
    expect(Bun.capitalCase("hello__world")).toBe("Hello World");
    expect(Bun.capitalCase("hello--world")).toBe("Hello World");
    expect(Bun.capitalCase("hello  world")).toBe("Hello World");
  });

  test("handles edge cases", () => {
    expect(Bun.capitalCase("")).toBe("");
    expect(Bun.capitalCase(" ")).toBe("");
    expect(Bun.capitalCase("a")).toBe("A");
    expect(Bun.capitalCase("A")).toBe("A");
  });

  test("handles non-ASCII characters", () => {
    expect(Bun.capitalCase("héllo wörld")).toBe("Héllo Wörld");
    expect(Bun.capitalCase("こんにちは-世界")).toBe("こんにちは 世界");
  });

  test("handles camelCase input", () => {
    expect(Bun.capitalCase("helloWorld")).toBe("Hello World");
    expect(Bun.capitalCase("helloWonderfulWorld")).toBe("Hello Wonderful World");
  });

  test("handles PascalCase input", () => {
    expect(Bun.capitalCase("HelloWorld")).toBe("Hello World");
    expect(Bun.capitalCase("HelloWonderfulWorld")).toBe("Hello Wonderful World");
  });
});
