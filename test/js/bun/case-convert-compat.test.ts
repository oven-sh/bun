import { test, expect, describe } from "bun:test";

// Test cases ported from https://github.com/blakeembrey/change-case
// to ensure maximum compatibility

describe("change-case compatibility tests", () => {
  // Basic test cases from change-case library
  const testCases = [
    // Empty string
    {
      input: "",
      expected: {
        camelCase: "",
        pascalCase: "",
        snakeCase: "",
        kebabCase: "",
        screamingSnakeCase: "",
        constantCase: "", // alias
        dotCase: "",
        capitalCase: "",
        trainCase: "",
      },
    },
    // Single word
    {
      input: "test",
      expected: {
        camelCase: "test",
        pascalCase: "Test",
        snakeCase: "test",
        kebabCase: "test",
        screamingSnakeCase: "TEST",
        constantCase: "TEST",
        dotCase: "test",
        capitalCase: "Test",
        trainCase: "Test",
      },
    },
    // Two words
    {
      input: "test string",
      expected: {
        camelCase: "testString",
        pascalCase: "TestString",
        snakeCase: "test_string",
        kebabCase: "test-string",
        screamingSnakeCase: "TEST_STRING",
        constantCase: "TEST_STRING",
        dotCase: "test.string",
        capitalCase: "Test String",
        trainCase: "Test-String",
      },
    },
    // Capitalized words
    {
      input: "Test String",
      expected: {
        camelCase: "testString",
        pascalCase: "TestString",
        snakeCase: "test_string",
        kebabCase: "test-string",
        screamingSnakeCase: "TEST_STRING",
        constantCase: "TEST_STRING",
        dotCase: "test.string",
        capitalCase: "Test String",
        trainCase: "Test-String",
      },
    },
    // Version with V and number
    {
      input: "TestV2",
      expected: {
        camelCase: "testV2",
        pascalCase: "TestV2",
        snakeCase: "test_v2",
        kebabCase: "test-v2",
        screamingSnakeCase: "TEST_V2",
        constantCase: "TEST_V2",
        dotCase: "test.v2",
        capitalCase: "Test V2",
        trainCase: "Test-V2",
      },
    },
    // Leading/trailing underscores
    {
      input: "_foo_bar_",
      expected: {
        camelCase: "fooBar",
        pascalCase: "FooBar",
        snakeCase: "foo_bar",
        kebabCase: "foo-bar",
        screamingSnakeCase: "FOO_BAR",
        constantCase: "FOO_BAR",
        dotCase: "foo.bar",
        capitalCase: "Foo Bar",
        trainCase: "Foo-Bar",
      },
    },
    // ALL CAPS
    {
      input: "ALL CAPS",
      expected: {
        camelCase: "allCaps",
        pascalCase: "AllCaps",
        snakeCase: "all_caps",
        kebabCase: "all-caps",
        screamingSnakeCase: "ALL_CAPS",
        constantCase: "ALL_CAPS",
        dotCase: "all.caps",
        capitalCase: "All Caps",
        trainCase: "All-Caps",
      },
    },
    // camelCase input
    {
      input: "camelCase",
      expected: {
        camelCase: "camelCase",
        pascalCase: "CamelCase",
        snakeCase: "camel_case",
        kebabCase: "camel-case",
        screamingSnakeCase: "CAMEL_CASE",
        constantCase: "CAMEL_CASE",
        dotCase: "camel.case",
        capitalCase: "Camel Case",
        trainCase: "Camel-Case",
      },
    },
    // PascalCase input
    {
      input: "PascalCase",
      expected: {
        camelCase: "pascalCase",
        pascalCase: "PascalCase",
        snakeCase: "pascal_case",
        kebabCase: "pascal-case",
        screamingSnakeCase: "PASCAL_CASE",
        constantCase: "PASCAL_CASE",
        dotCase: "pascal.case",
        capitalCase: "Pascal Case",
        trainCase: "Pascal-Case",
      },
    },
    // snake_case input
    {
      input: "snake_case",
      expected: {
        camelCase: "snakeCase",
        pascalCase: "SnakeCase",
        snakeCase: "snake_case",
        kebabCase: "snake-case",
        screamingSnakeCase: "SNAKE_CASE",
        constantCase: "SNAKE_CASE",
        dotCase: "snake.case",
        capitalCase: "Snake Case",
        trainCase: "Snake-Case",
      },
    },
    // kebab-case input
    {
      input: "kebab-case",
      expected: {
        camelCase: "kebabCase",
        pascalCase: "KebabCase",
        snakeCase: "kebab_case",
        kebabCase: "kebab-case",
        screamingSnakeCase: "KEBAB_CASE",
        constantCase: "KEBAB_CASE",
        dotCase: "kebab.case",
        capitalCase: "Kebab Case",
        trainCase: "Kebab-Case",
      },
    },
    // CONSTANT_CASE input
    {
      input: "CONSTANT_CASE",
      expected: {
        camelCase: "constantCase",
        pascalCase: "ConstantCase",
        snakeCase: "constant_case",
        kebabCase: "constant-case",
        screamingSnakeCase: "CONSTANT_CASE",
        constantCase: "CONSTANT_CASE",
        dotCase: "constant.case",
        capitalCase: "Constant Case",
        trainCase: "Constant-Case",
      },
    },
    // dot.case input
    {
      input: "dot.case",
      expected: {
        camelCase: "dotCase",
        pascalCase: "DotCase",
        snakeCase: "dot_case",
        kebabCase: "dot-case",
        screamingSnakeCase: "DOT_CASE",
        constantCase: "DOT_CASE",
        dotCase: "dot.case",
        capitalCase: "Dot Case",
        trainCase: "Dot-Case",
      },
    },
    // path/case input
    {
      input: "path/case",
      expected: {
        camelCase: "pathCase",
        pascalCase: "PathCase",
        snakeCase: "path_case",
        kebabCase: "path-case",
        screamingSnakeCase: "PATH_CASE",
        constantCase: "PATH_CASE",
        dotCase: "path.case",
        capitalCase: "Path Case",
        trainCase: "Path-Case",
      },
    },
    // Mixed separators
    {
      input: "mixed_string-case.dot/path",
      expected: {
        camelCase: "mixedStringCaseDotPath",
        pascalCase: "MixedStringCaseDotPath",
        snakeCase: "mixed_string_case_dot_path",
        kebabCase: "mixed-string-case-dot-path",
        screamingSnakeCase: "MIXED_STRING_CASE_DOT_PATH",
        constantCase: "MIXED_STRING_CASE_DOT_PATH",
        dotCase: "mixed.string.case.dot.path",
        capitalCase: "Mixed String Case Dot Path",
        trainCase: "Mixed-String-Case-Dot-Path",
      },
    },
    // Consecutive uppercase (acronyms)
    {
      input: "XMLHttpRequest",
      expected: {
        camelCase: "xmlHttpRequest",
        pascalCase: "XmlHttpRequest",
        snakeCase: "xml_http_request",
        kebabCase: "xml-http-request",
        screamingSnakeCase: "XML_HTTP_REQUEST",
        constantCase: "XML_HTTP_REQUEST",
        dotCase: "xml.http.request",
        capitalCase: "Xml Http Request",
        trainCase: "Xml-Http-Request",
      },
    },
    // Numbers (basic)
    {
      input: "foo2bar",
      expected: {
        camelCase: "foo2bar",
        pascalCase: "Foo2bar",
        snakeCase: "foo2bar",
        kebabCase: "foo2bar",
        screamingSnakeCase: "FOO2BAR",
        constantCase: "FOO2BAR",
        dotCase: "foo2bar",
        capitalCase: "Foo2bar",
        trainCase: "Foo2bar",
      },
    },
    // Multiple spaces
    {
      input: "multiple   spaces",
      expected: {
        camelCase: "multipleSpaces",
        pascalCase: "MultipleSpaces",
        snakeCase: "multiple_spaces",
        kebabCase: "multiple-spaces",
        screamingSnakeCase: "MULTIPLE_SPACES",
        constantCase: "MULTIPLE_SPACES",
        dotCase: "multiple.spaces",
        capitalCase: "Multiple Spaces",
        trainCase: "Multiple-Spaces",
      },
    },
    // Special characters
    {
      input: "special@#$characters",
      expected: {
        camelCase: "specialCharacters",
        pascalCase: "SpecialCharacters",
        snakeCase: "special_characters",
        kebabCase: "special-characters",
        screamingSnakeCase: "SPECIAL_CHARACTERS",
        constantCase: "SPECIAL_CHARACTERS",
        dotCase: "special.characters",
        capitalCase: "Special Characters",
        trainCase: "Special-Characters",
      },
    },
    // Unicode with accented characters
    {
      input: "café_münchen",
      expected: {
        camelCase: "caféMünchen",
        pascalCase: "CaféMünchen",
        snakeCase: "café_münchen",
        kebabCase: "café-münchen",
        screamingSnakeCase: "CAFÉ_MÜNCHEN",
        constantCase: "CAFÉ_MÜNCHEN",
        dotCase: "café.münchen",
        capitalCase: "Café München",
        trainCase: "Café-München",
      },
    },
    // Single letter
    {
      input: "a",
      expected: {
        camelCase: "a",
        pascalCase: "A",
        snakeCase: "a",
        kebabCase: "a",
        screamingSnakeCase: "A",
        constantCase: "A",
        dotCase: "a",
        capitalCase: "A",
        trainCase: "A",
      },
    },
    // Two letters
    {
      input: "aB",
      expected: {
        camelCase: "aB",
        pascalCase: "AB",
        snakeCase: "a_b",
        kebabCase: "a-b",
        screamingSnakeCase: "A_B",
        constantCase: "A_B",
        dotCase: "a.b",
        capitalCase: "A B",
        trainCase: "A-B",
      },
    },
    // Tabs and newlines
    {
      input: "tabs\tand\nnewlines",
      expected: {
        camelCase: "tabsAndNewlines",
        pascalCase: "TabsAndNewlines",
        snakeCase: "tabs_and_newlines",
        kebabCase: "tabs-and-newlines",
        screamingSnakeCase: "TABS_AND_NEWLINES",
        constantCase: "TABS_AND_NEWLINES",
        dotCase: "tabs.and.newlines",
        capitalCase: "Tabs And Newlines",
        trainCase: "Tabs-And-Newlines",
      },
    },
  ];

  // Run all test cases
  for (const { input, expected } of testCases) {
    describe(`input: "${input}"`, () => {
      test("camelCase", () => {
        expect(Bun.camelCase(input)).toBe(expected.camelCase);
      });

      test("pascalCase", () => {
        expect(Bun.pascalCase(input)).toBe(expected.pascalCase);
      });

      test("snakeCase", () => {
        expect(Bun.snakeCase(input)).toBe(expected.snakeCase);
      });

      test("kebabCase", () => {
        expect(Bun.kebabCase(input)).toBe(expected.kebabCase);
      });

      test("screamingSnakeCase", () => {
        expect(Bun.screamingSnakeCase(input)).toBe(expected.screamingSnakeCase);
      });

      test("constantCase (alias)", () => {
        expect(Bun.constantCase(input)).toBe(expected.constantCase);
      });

      test("dotCase", () => {
        expect(Bun.dotCase(input)).toBe(expected.dotCase);
      });

      test("capitalCase", () => {
        expect(Bun.capitalCase(input)).toBe(expected.capitalCase);
      });

      test("trainCase", () => {
        expect(Bun.trainCase(input)).toBe(expected.trainCase);
      });
    });
  }

  // Edge cases and special scenarios
  describe("edge cases", () => {
    test("null input", () => {
      expect(Bun.camelCase(null)).toBe("null");
      expect(Bun.pascalCase(null)).toBe("Null");
      expect(Bun.snakeCase(null)).toBe("null");
    });

    test("undefined input", () => {
      expect(Bun.camelCase(undefined)).toBe("undefined");
      expect(Bun.pascalCase(undefined)).toBe("Undefined");
      expect(Bun.snakeCase(undefined)).toBe("undefined");
    });

    test("number input", () => {
      expect(Bun.camelCase(123)).toBe("123");
      expect(Bun.pascalCase(123)).toBe("123");
      expect(Bun.snakeCase(123)).toBe("123");
    });

    test("boolean input", () => {
      expect(Bun.camelCase(true)).toBe("true");
      expect(Bun.pascalCase(false)).toBe("False");
      expect(Bun.snakeCase(true)).toBe("true");
    });

    test("very long string", () => {
      const longString = "this is a very long string with many words".repeat(10);
      const result = Bun.camelCase(longString);
      expect(result).toContain("thisIsAVeryLongString");
      expect(result.length).toBeGreaterThan(100);
    });

    test("only special characters", () => {
      expect(Bun.camelCase("!@#$%^&*()")).toBe("");
      expect(Bun.snakeCase("!@#$%^&*()")).toBe("");
      expect(Bun.kebabCase("!@#$%^&*()")).toBe("");
    });

    test("only numbers", () => {
      expect(Bun.camelCase("123456")).toBe("123456");
      expect(Bun.pascalCase("123456")).toBe("123456");
      expect(Bun.snakeCase("123456")).toBe("123456");
    });

    test("mixed numbers and letters", () => {
      expect(Bun.camelCase("123abc456def")).toBe("123abc456def");
      expect(Bun.snakeCase("123abc456def")).toBe("123abc456def");
    });
  });

  // Test for proper acronym handling
  describe("acronym handling", () => {
    test("XMLHttpRequest", () => {
      expect(Bun.camelCase("XMLHttpRequest")).toBe("xmlHttpRequest");
      expect(Bun.snakeCase("XMLHttpRequest")).toBe("xml_http_request");
    });

    test("IOError", () => {
      expect(Bun.camelCase("IOError")).toBe("ioError");
      expect(Bun.snakeCase("IOError")).toBe("io_error");
    });

    test("HTTPSConnection", () => {
      expect(Bun.camelCase("HTTPSConnection")).toBe("httpsConnection");
      expect(Bun.snakeCase("HTTPSConnection")).toBe("https_connection");
    });

    test("APIKey", () => {
      expect(Bun.camelCase("APIKey")).toBe("apiKey");
      expect(Bun.snakeCase("APIKey")).toBe("api_key");
    });
  });

  // Test for version strings (important for change-case compatibility)
  describe("version strings", () => {
    test("version 1.2.10", () => {
      const input = "version 1.2.10";
      // Note: change-case with separateNumbers option would split these differently
      // Our implementation keeps numbers together unless there's a case change
      expect(Bun.camelCase(input)).toBe("version1210");
      expect(Bun.snakeCase(input)).toBe("version_1_2_10");
    });

    test("v1.0.0", () => {
      expect(Bun.camelCase("v1.0.0")).toBe("v100");
      expect(Bun.snakeCase("v1.0.0")).toBe("v1_0_0");
    });
  });

  // Consistency checks
  describe("consistency", () => {
    test("idempotency - applying same conversion twice yields same result", () => {
      const testString = "test_string";
      const once = Bun.snakeCase(testString);
      const twice = Bun.snakeCase(once);
      expect(once).toBe(twice);
    });

    test("round-trip conversions maintain structure", () => {
      const original = "testString";
      const snake = Bun.snakeCase(original);
      const camel = Bun.camelCase(snake);
      expect(camel).toBe(original);
    });
  });
});