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

describe("constantCase", () => {
  test("converts space separated words", () => {
    expect(Bun.constantCase("hello world")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("hello wonderful world")).toBe("HELLO_WONDERFUL_WORLD");
  });

  test("converts kebab-case", () => {
    expect(Bun.constantCase("hello-world")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("hello-wonderful-world")).toBe("HELLO_WONDERFUL_WORLD");
  });

  test("converts snake_case", () => {
    expect(Bun.constantCase("hello_world")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("hello_wonderful_world")).toBe("HELLO_WONDERFUL_WORLD");
  });

  test("handles existing CONSTANT_CASE", () => {
    expect(Bun.constantCase("HELLO_WORLD")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("HELLO_WONDERFUL_WORLD")).toBe("HELLO_WONDERFUL_WORLD");
  });

  test("handles mixed separators", () => {
    expect(Bun.constantCase("hello.world-nice_day")).toBe("HELLO_WORLD_NICE_DAY");
    expect(Bun.constantCase("hello_world-nice day")).toBe("HELLO_WORLD_NICE_DAY");
  });

  test("handles consecutive separators", () => {
    expect(Bun.constantCase("hello__world")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("hello--world")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("hello  world")).toBe("HELLO_WORLD");
  });

  test("handles edge cases", () => {
    expect(Bun.constantCase("")).toBe("");
    expect(Bun.constantCase(" ")).toBe("");
    expect(Bun.constantCase("a")).toBe("A");
    expect(Bun.constantCase("A")).toBe("A");
  });

  test("handles non-ASCII characters", () => {
    // FIXME: upper case for non ascii characters not implemented yet
    // expect(Bun.constantCase("héllo wörld")).toBe("HÉLLO_WÖRLD");
    expect(Bun.constantCase("こんにちは-世界")).toBe("こんにちは_世界");
  });

  test("handles camelCase input", () => {
    expect(Bun.constantCase("helloWorld")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("helloWonderfulWorld")).toBe("HELLO_WONDERFUL_WORLD");
  });

  test("handles PascalCase input", () => {
    expect(Bun.constantCase("HelloWorld")).toBe("HELLO_WORLD");
    expect(Bun.constantCase("HelloWonderfulWorld")).toBe("HELLO_WONDERFUL_WORLD");
  });
});

describe("dotCase", () => {
  test("converts space separated words", () => {
    expect(Bun.dotCase("hello world")).toBe("hello.world");
    expect(Bun.dotCase("hello wonderful world")).toBe("hello.wonderful.world");
  });

  test("converts kebab-case", () => {
    expect(Bun.dotCase("hello-world")).toBe("hello.world");
    expect(Bun.dotCase("hello-wonderful-world")).toBe("hello.wonderful.world");
  });

  test("converts snake_case", () => {
    expect(Bun.dotCase("hello_world")).toBe("hello.world");
    expect(Bun.dotCase("hello_wonderful_world")).toBe("hello.wonderful.world");
  });

  test("handles existing dot.case", () => {
    expect(Bun.dotCase("hello.world")).toBe("hello.world");
    expect(Bun.dotCase("hello.wonderful.world")).toBe("hello.wonderful.world");
  });

  test("handles mixed separators", () => {
    expect(Bun.dotCase("hello-world_nice day")).toBe("hello.world.nice.day");
    expect(Bun.dotCase("hello_world-nice.day")).toBe("hello.world.nice.day");
  });

  test("handles consecutive separators", () => {
    expect(Bun.dotCase("hello__world")).toBe("hello.world");
    expect(Bun.dotCase("hello--world")).toBe("hello.world");
    expect(Bun.dotCase("hello  world")).toBe("hello.world");
  });

  test("handles edge cases", () => {
    expect(Bun.dotCase("")).toBe("");
    expect(Bun.dotCase(" ")).toBe("");
    expect(Bun.dotCase("a")).toBe("a");
    expect(Bun.dotCase("A")).toBe("a");
  });

  test("handles non-ASCII characters", () => {
    // FIXME: upper case for non ascii characters not implemented yet
    // expect(Bun.dotCase("HÉLLO_WÖRLD")).toBe("héllo.wörld");
    expect(Bun.dotCase("こんにちは-世界")).toBe("こんにちは.世界");
  });

  test("handles camelCase input", () => {
    expect(Bun.dotCase("helloWorld")).toBe("hello.world");
    expect(Bun.dotCase("helloWonderfulWorld")).toBe("hello.wonderful.world");
  });

  test("handles PascalCase input", () => {
    expect(Bun.dotCase("HelloWorld")).toBe("hello.world");
    expect(Bun.dotCase("HelloWonderfulWorld")).toBe("hello.wonderful.world");
  });
});

describe("kebabCase", () => {
  test("converts space separated words", () => {
    expect(Bun.kebabCase("hello world")).toBe("hello-world");
    expect(Bun.kebabCase("hello wonderful world")).toBe("hello-wonderful-world");
  });

  test("converts camelCase", () => {
    expect(Bun.kebabCase("helloWorld")).toBe("hello-world");
    expect(Bun.kebabCase("helloWonderfulWorld")).toBe("hello-wonderful-world");
  });

  test("converts PascalCase", () => {
    expect(Bun.kebabCase("HelloWorld")).toBe("hello-world");
    expect(Bun.kebabCase("HelloWonderfulWorld")).toBe("hello-wonderful-world");
  });

  test("converts snake_case", () => {
    expect(Bun.kebabCase("hello_world")).toBe("hello-world");
    expect(Bun.kebabCase("hello_wonderful_world")).toBe("hello-wonderful-world");
  });

  test("handles existing kebab-case", () => {
    expect(Bun.kebabCase("hello-world")).toBe("hello-world");
    expect(Bun.kebabCase("hello-wonderful-world")).toBe("hello-wonderful-world");
  });

  test("handles mixed separators", () => {
    expect(Bun.kebabCase("hello.world-nice_day")).toBe("hello-world-nice-day");
    expect(Bun.kebabCase("hello_world-nice day")).toBe("hello-world-nice-day");
  });

  test("handles consecutive separators", () => {
    expect(Bun.kebabCase("hello__world")).toBe("hello-world");
    expect(Bun.kebabCase("hello--world")).toBe("hello-world");
    expect(Bun.kebabCase("hello  world")).toBe("hello-world");
  });

  test("handles edge cases", () => {
    expect(Bun.kebabCase("")).toBe("");
    expect(Bun.kebabCase(" ")).toBe("");
    expect(Bun.kebabCase("a")).toBe("a");
    expect(Bun.kebabCase("A")).toBe("a");
  });

  test("handles non-ASCII characters", () => {
    // FIXME: upper case for non ascii characters not implemented yet
    // expect(Bun.kebabCase("HÉLLO_WÖRLD")).toBe("héllo-wörld");
    expect(Bun.kebabCase("こんにちは-世界")).toBe("こんにちは-世界");
  });

  test("handles camelCase input", () => {
    expect(Bun.kebabCase("helloWorld")).toBe("hello-world");
    expect(Bun.kebabCase("helloWonderfulWorld")).toBe("hello-wonderful-world");
  });

  test("handles PascalCase input", () => {
    expect(Bun.kebabCase("HelloWorld")).toBe("hello-world");
    expect(Bun.kebabCase("HelloWonderfulWorld")).toBe("hello-wonderful-world");
  });
});

describe("pascalCase", () => {
  test("converts space separated words", () => {
    expect(Bun.pascalCase("hello world")).toBe("HelloWorld");
    expect(Bun.pascalCase("hello wonderful world")).toBe("HelloWonderfulWorld");
  });

  test("converts kebab-case", () => {
    expect(Bun.pascalCase("hello-world")).toBe("HelloWorld");
    expect(Bun.pascalCase("hello-wonderful-world")).toBe("HelloWonderfulWorld");
  });

  test("converts snake_case", () => {
    expect(Bun.pascalCase("hello_world")).toBe("HelloWorld");
    expect(Bun.pascalCase("hello_wonderful_world")).toBe("HelloWonderfulWorld");
  });

  test("handles existing PascalCase", () => {
    expect(Bun.pascalCase("HelloWorld")).toBe("HelloWorld");
    expect(Bun.pascalCase("HelloWonderfulWorld")).toBe("HelloWonderfulWorld");
  });

  test("handles mixed separators", () => {
    expect(Bun.pascalCase("hello.world-nice_day")).toBe("HelloWorldNiceDay");
    expect(Bun.pascalCase("hello_world-nice day")).toBe("HelloWorldNiceDay");
  });

  test("handles consecutive separators", () => {
    expect(Bun.pascalCase("hello__world")).toBe("HelloWorld");
    expect(Bun.pascalCase("hello--world")).toBe("HelloWorld");
    expect(Bun.pascalCase("hello  world")).toBe("HelloWorld");
  });

  test("handles edge cases", () => {
    expect(Bun.pascalCase("")).toBe("");
    expect(Bun.pascalCase(" ")).toBe("");
    expect(Bun.pascalCase("a")).toBe("A");
    expect(Bun.pascalCase("A")).toBe("A");
  });

  test("handles non-ASCII characters", () => {
    expect(Bun.pascalCase("héllo wörld")).toBe("HélloWörld");
    expect(Bun.pascalCase("こんにちは-世界")).toBe("こんにちは世界");
  });

  test("handles camelCase input", () => {
    expect(Bun.pascalCase("helloWorld")).toBe("HelloWorld");
    expect(Bun.pascalCase("helloWonderfulWorld")).toBe("HelloWonderfulWorld");
  });

  test("handles PascalCase input", () => {
    expect(Bun.pascalCase("HelloWorld")).toBe("HelloWorld");
    expect(Bun.pascalCase("HelloWonderfulWorld")).toBe("HelloWonderfulWorld");
  });
});

describe("snakeCase", () => {
  test("converts space separated words", () => {
    expect(Bun.snakeCase("hello world")).toBe("hello_world");
    expect(Bun.snakeCase("hello wonderful world")).toBe("hello_wonderful_world");
  });

  test("converts kebab-case", () => {
    expect(Bun.snakeCase("hello-world")).toBe("hello_world");
    expect(Bun.snakeCase("hello-wonderful-world")).toBe("hello_wonderful_world");
  });

  test("converts camelCase", () => {
    expect(Bun.snakeCase("helloWorld")).toBe("hello_world");
    expect(Bun.snakeCase("helloWonderfulWorld")).toBe("hello_wonderful_world");
  });

  test("converts PascalCase", () => {
    expect(Bun.snakeCase("HelloWorld")).toBe("hello_world");
    expect(Bun.snakeCase("HelloWonderfulWorld")).toBe("hello_wonderful_world");
  });

  test("handles existing snake_case", () => {
    expect(Bun.snakeCase("hello_world")).toBe("hello_world");
    expect(Bun.snakeCase("hello_wonderful_world")).toBe("hello_wonderful_world");
  });

  test("handles mixed separators", () => {
    expect(Bun.snakeCase("hello.world-nice day")).toBe("hello_world_nice_day");
    expect(Bun.snakeCase("hello_world-nice.day")).toBe("hello_world_nice_day");
  });

  test("handles consecutive separators", () => {
    expect(Bun.snakeCase("hello__world")).toBe("hello_world");
    expect(Bun.snakeCase("hello--world")).toBe("hello_world");
    expect(Bun.snakeCase("hello  world")).toBe("hello_world");
  });

  test("handles edge cases", () => {
    expect(Bun.snakeCase("")).toBe("");
    expect(Bun.snakeCase(" ")).toBe("");
    expect(Bun.snakeCase("a")).toBe("a");
    expect(Bun.snakeCase("A")).toBe("a");
  });

  test("handles non-ASCII characters", () => {
    // FIXME: upper case for non ascii characters not implemented yet
    // expect(Bun.snakeCase("HÉLLO_WÖRLD")).toBe("héllo_wörld");
    expect(Bun.snakeCase("こんにちは-世界")).toBe("こんにちは_世界");
  });

  test("handles dot.case input", () => {
    expect(Bun.snakeCase("hello.world")).toBe("hello_world");
    expect(Bun.snakeCase("hello.wonderful.world")).toBe("hello_wonderful_world");
  });

  test("handles mixed case input", () => {
    expect(Bun.snakeCase("helloWorld.nice-day")).toBe("hello_world_nice_day");
    expect(Bun.snakeCase("Hello.World-NiceDay")).toBe("hello_world_nice_day");
  });
});
