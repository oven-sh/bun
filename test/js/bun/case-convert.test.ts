import { test, expect } from "bun:test";

test("Bun.camelCase", () => {
  expect(Bun.camelCase("two words")).toBe("twoWords");
  expect(Bun.camelCase("hello world")).toBe("helloWorld");
  expect(Bun.camelCase("HELLO_WORLD")).toBe("helloWorld");
  expect(Bun.camelCase("kebab-case")).toBe("kebabCase");
  expect(Bun.camelCase("snake_case")).toBe("snakeCase");
  expect(Bun.camelCase("PascalCase")).toBe("pascalCase");
  expect(Bun.camelCase("multiple   spaces")).toBe("multipleSpaces");
  expect(Bun.camelCase("123-numbers-456")).toBe("123Numbers456");
  expect(Bun.camelCase("")).toBe("");
  expect(Bun.camelCase("alreadyCamelCase")).toBe("alreadyCamelCase");
  expect(Bun.camelCase("XML-Parser")).toBe("xmlParser");
  expect(Bun.camelCase("XMLParser")).toBe("xmlParser");
});

test("Bun.pascalCase", () => {
  expect(Bun.pascalCase("two words")).toBe("TwoWords");
  expect(Bun.pascalCase("hello world")).toBe("HelloWorld");
  expect(Bun.pascalCase("HELLO_WORLD")).toBe("HelloWorld");
  expect(Bun.pascalCase("kebab-case")).toBe("KebabCase");
  expect(Bun.pascalCase("snake_case")).toBe("SnakeCase");
  expect(Bun.pascalCase("camelCase")).toBe("CamelCase");
  expect(Bun.pascalCase("multiple   spaces")).toBe("MultipleSpaces");
  expect(Bun.pascalCase("123-numbers-456")).toBe("123Numbers456");
  expect(Bun.pascalCase("")).toBe("");
  expect(Bun.pascalCase("AlreadyPascalCase")).toBe("AlreadyPascalCase");
  expect(Bun.pascalCase("xml-parser")).toBe("XmlParser");
  expect(Bun.pascalCase("XMLParser")).toBe("XmlParser");
});

test("Bun.snakeCase", () => {
  expect(Bun.snakeCase("two words")).toBe("two_words");
  expect(Bun.snakeCase("hello world")).toBe("hello_world");
  expect(Bun.snakeCase("HELLO_WORLD")).toBe("hello_world");
  expect(Bun.snakeCase("kebab-case")).toBe("kebab_case");
  expect(Bun.snakeCase("camelCase")).toBe("camel_case");
  expect(Bun.snakeCase("PascalCase")).toBe("pascal_case");
  expect(Bun.snakeCase("multiple   spaces")).toBe("multiple_spaces");
  expect(Bun.snakeCase("123-numbers-456")).toBe("123_numbers_456");
  expect(Bun.snakeCase("")).toBe("");
  expect(Bun.snakeCase("already_snake_case")).toBe("already_snake_case");
  expect(Bun.snakeCase("XMLParser")).toBe("xml_parser");
});

test("Bun.kebabCase", () => {
  expect(Bun.kebabCase("two words")).toBe("two-words");
  expect(Bun.kebabCase("hello world")).toBe("hello-world");
  expect(Bun.kebabCase("HELLO_WORLD")).toBe("hello-world");
  expect(Bun.kebabCase("snake_case")).toBe("snake-case");
  expect(Bun.kebabCase("camelCase")).toBe("camel-case");
  expect(Bun.kebabCase("PascalCase")).toBe("pascal-case");
  expect(Bun.kebabCase("multiple   spaces")).toBe("multiple-spaces");
  expect(Bun.kebabCase("123-numbers-456")).toBe("123-numbers-456");
  expect(Bun.kebabCase("")).toBe("");
  expect(Bun.kebabCase("already-kebab-case")).toBe("already-kebab-case");
  expect(Bun.kebabCase("XMLParser")).toBe("xml-parser");
});

test("Bun.constantCase", () => {
  expect(Bun.constantCase("two words")).toBe("TWO_WORDS");
  expect(Bun.constantCase("hello world")).toBe("HELLO_WORLD");
  expect(Bun.constantCase("hello_world")).toBe("HELLO_WORLD");
  expect(Bun.constantCase("kebab-case")).toBe("KEBAB_CASE");
  expect(Bun.constantCase("camelCase")).toBe("CAMEL_CASE");
  expect(Bun.constantCase("PascalCase")).toBe("PASCAL_CASE");
  expect(Bun.constantCase("multiple   spaces")).toBe("MULTIPLE_SPACES");
  expect(Bun.constantCase("123-numbers-456")).toBe("123_NUMBERS_456");
  expect(Bun.constantCase("")).toBe("");
  expect(Bun.constantCase("ALREADY_CONSTANT_CASE")).toBe("ALREADY_CONSTANT_CASE");
  expect(Bun.constantCase("XMLParser")).toBe("XML_PARSER");
});

test("Bun.dotCase", () => {
  expect(Bun.dotCase("two words")).toBe("two.words");
  expect(Bun.dotCase("hello world")).toBe("hello.world");
  expect(Bun.dotCase("HELLO_WORLD")).toBe("hello.world");
  expect(Bun.dotCase("kebab-case")).toBe("kebab.case");
  expect(Bun.dotCase("camelCase")).toBe("camel.case");
  expect(Bun.dotCase("PascalCase")).toBe("pascal.case");
  expect(Bun.dotCase("multiple   spaces")).toBe("multiple.spaces");
  expect(Bun.dotCase("123-numbers-456")).toBe("123.numbers.456");
  expect(Bun.dotCase("")).toBe("");
  expect(Bun.dotCase("already.dot.case")).toBe("already.dot.case");
  expect(Bun.dotCase("XMLParser")).toBe("xml.parser");
});

test("Bun.capitalCase", () => {
  expect(Bun.capitalCase("two words")).toBe("Two Words");
  expect(Bun.capitalCase("hello world")).toBe("Hello World");
  expect(Bun.capitalCase("HELLO_WORLD")).toBe("Hello World");
  expect(Bun.capitalCase("kebab-case")).toBe("Kebab Case");
  expect(Bun.capitalCase("camelCase")).toBe("Camel Case");
  expect(Bun.capitalCase("PascalCase")).toBe("Pascal Case");
  expect(Bun.capitalCase("multiple   spaces")).toBe("Multiple Spaces");
  expect(Bun.capitalCase("123-numbers-456")).toBe("123 Numbers 456");
  expect(Bun.capitalCase("")).toBe("");
  expect(Bun.capitalCase("already Capital Case")).toBe("Already Capital Case");
  expect(Bun.capitalCase("XMLParser")).toBe("Xml Parser");
});

test("Bun.trainCase", () => {
  expect(Bun.trainCase("two words")).toBe("Two-Words");
  expect(Bun.trainCase("hello world")).toBe("Hello-World");
  expect(Bun.trainCase("HELLO_WORLD")).toBe("Hello-World");
  expect(Bun.trainCase("kebab-case")).toBe("Kebab-Case");
  expect(Bun.trainCase("camelCase")).toBe("Camel-Case");
  expect(Bun.trainCase("PascalCase")).toBe("Pascal-Case");
  expect(Bun.trainCase("multiple   spaces")).toBe("Multiple-Spaces");
  expect(Bun.trainCase("123-numbers-456")).toBe("123-Numbers-456");
  expect(Bun.trainCase("")).toBe("");
  expect(Bun.trainCase("Already-Train-Case")).toBe("Already-Train-Case");
  expect(Bun.trainCase("XMLParser")).toBe("Xml-Parser");
});

test("case conversion with special characters", () => {
  const input = "hello@world#test!";
  expect(Bun.camelCase(input)).toBe("helloWorldTest");
  expect(Bun.pascalCase(input)).toBe("HelloWorldTest");
  expect(Bun.snakeCase(input)).toBe("hello_world_test");
  expect(Bun.kebabCase(input)).toBe("hello-world-test");
  expect(Bun.constantCase(input)).toBe("HELLO_WORLD_TEST");
  expect(Bun.dotCase(input)).toBe("hello.world.test");
  expect(Bun.capitalCase(input)).toBe("Hello World Test");
  expect(Bun.trainCase(input)).toBe("Hello-World-Test");
});

test("case conversion with numbers", () => {
  // Numbers stay with adjacent letters unless there's a case change
  const input = "test123case456";
  expect(Bun.camelCase(input)).toBe("test123case456");
  expect(Bun.pascalCase(input)).toBe("Test123case456");
  expect(Bun.snakeCase(input)).toBe("test123case456");
  expect(Bun.kebabCase(input)).toBe("test123case456");
  expect(Bun.constantCase(input)).toBe("TEST123CASE456");
  expect(Bun.dotCase(input)).toBe("test123case456");
  expect(Bun.capitalCase(input)).toBe("Test123case456");
  expect(Bun.trainCase(input)).toBe("Test123case456");
  
  // When there's a case change after numbers, it splits
  const input2 = "test123Case456";
  expect(Bun.camelCase(input2)).toBe("test123Case456");
  expect(Bun.snakeCase(input2)).toBe("test123_case456");
  expect(Bun.kebabCase(input2)).toBe("test123-case456");
});

test("case conversion with non-strings", () => {
  // Should convert to string first
  expect(Bun.camelCase(123)).toBe("123");
  expect(Bun.camelCase(true)).toBe("true");
  expect(Bun.camelCase(null)).toBe("null");
  expect(Bun.camelCase(undefined)).toBe("undefined");
});

test("case conversion error handling", () => {
  // Should throw when no arguments provided
  expect(() => (Bun as any).camelCase()).toThrow();
  expect(() => (Bun as any).pascalCase()).toThrow();
  expect(() => (Bun as any).snakeCase()).toThrow();
  expect(() => (Bun as any).kebabCase()).toThrow();
  expect(() => (Bun as any).constantCase()).toThrow();
  expect(() => (Bun as any).dotCase()).toThrow();
  expect(() => (Bun as any).capitalCase()).toThrow();
  expect(() => (Bun as any).trainCase()).toThrow();
});