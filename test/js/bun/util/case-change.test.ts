import { describe, expect, test } from "bun:test";
import {
  camelCase,
  capitalCase,
  constantCase,
  dotCase,
  kebabCase,
  noCase,
  pascalCase,
  pathCase,
  sentenceCase,
  snakeCase,
  trainCase,
} from "change-case";

type CaseFn = (input: string) => string;

const bunFns: Record<string, CaseFn> = {
  camelCase: Bun.camelCase,
  capitalCase: Bun.capitalCase,
  constantCase: Bun.constantCase,
  dotCase: Bun.dotCase,
  kebabCase: Bun.kebabCase,
  noCase: Bun.noCase,
  pascalCase: Bun.pascalCase,
  pathCase: Bun.pathCase,
  sentenceCase: Bun.sentenceCase,
  snakeCase: Bun.snakeCase,
  trainCase: Bun.trainCase,
};

const changeCaseFns: Record<string, CaseFn> = {
  camelCase,
  capitalCase,
  constantCase,
  dotCase,
  kebabCase,
  noCase,
  pascalCase,
  pathCase,
  sentenceCase,
  snakeCase,
  trainCase,
};

// Comprehensive input set covering many patterns
const testInputs = [
  // Basic words
  "test",
  "foo",
  "a",
  "",

  // Multi-word with various separators
  "test string",
  "test_string",
  "test-string",
  "test.string",
  "test/string",
  "test\tstring",

  // Cased inputs
  "Test String",
  "TEST STRING",
  "TestString",
  "testString",
  "TEST_STRING",

  // Acronyms and consecutive uppercase
  "XMLParser",
  "getHTTPSURL",
  "parseJSON",
  "simpleXML",
  "PDFLoader",
  "I18N",
  "ABC",
  "ABCdef",
  "ABCDef",
  "HTMLElement",
  "innerHTML",
  "XMLHttpRequest",
  "getURLParams",
  "isHTTPS",
  "CSSStyleSheet",
  "IOError",
  "UIKit",

  // Numbers
  "version 1.2.10",
  "TestV2",
  "test123",
  "123test",
  "test 123 value",
  "1st place",
  "v2beta1",
  "ES6Module",
  "utf8Decode",
  "base64Encode",
  "h1Element",
  "int32Array",
  "123",
  "123 456",
  "a1b2c3",
  "test0",

  // Multiple separators / weird spacing
  "foo___bar",
  "foo---bar",
  "foo...bar",
  "foo   bar",
  "  leading spaces  ",
  "__private",
  "--dashed--",
  "..dotted..",
  "  ",
  "\t\ttabs\t\t",
  "foo_-_bar",
  "foo.-bar",

  // All uppercase
  "FOO_BAR_BAZ",
  "ALLCAPS",
  "FOO BAR",
  "FOO-BAR",
  "FOO.BAR",

  // Mixed case
  "fooBarBaz",
  "FooBarBaz",
  "Foo Bar",
  "MiXeD CaSe",
  "already camelCase",
  "already PascalCase",
  "already_snake_case",
  "already-kebab-case",
  "Already Capital Case",
  "ALREADY_CONSTANT_CASE",

  // Pre-formatted cases
  "Train-Case-Input",
  "dot.case.input",
  "path/case/input",
  "Sentence case input",
  "no case input",

  // Single characters
  "A",
  "z",
  "Z",
  "0",

  // Real-world identifiers
  "backgroundColor",
  "border-top-color",
  "MAX_RETRY_COUNT",
  "Content-Type",
  "X-Forwarded-For",
  "user_id",
  "getUserById",
  "class_name",
  "className",
  "is_active",
  "isActive",
  "created_at",
  "createdAt",
  "HTTPSConnection",
  "myXMLParser",
  "getDBConnection",
  "setHTTPSEnabled",
  "enableSSL",
  "useGPU",
  "readCSV",
  "parseHTML",
  "toJSON",
  "fromURL",
  "isNaN",
  "toString",
  "valueOf",

  // Column name style inputs (SQL)
  "first_name",
  "last_name",
  "email_address",
  "phone_number",
  "order_total",
  "created_at",
  "updated_at",
  "is_deleted",

  // Hyphenated compound words
  "well-known",
  "read-only",
  "built-in",
  "self-contained",

  // Strings with only separators
  "---",
  "___",
  "...",
  "///",
  "-_.-_.",

  // Unicode (basic)
  "café latte",
  "naïve résumé",
  "hello 世界",

  // Long strings
  "this is a much longer test string with many words to convert",
  "thisIsAMuchLongerTestStringWithManyWordsToConvert",
  "THIS_IS_A_MUCH_LONGER_TEST_STRING_WITH_MANY_WORDS_TO_CONVERT",
];

const allCaseNames = Object.keys(bunFns);

describe("case-change", () => {
  // Main compatibility matrix: every function x every input
  for (const caseName of allCaseNames) {
    const bunFn = bunFns[caseName];
    const changeCaseFn = changeCaseFns[caseName];

    describe(caseName, () => {
      for (const input of testInputs) {
        const expected = changeCaseFn(input);
        test(`${JSON.stringify(input)} => ${JSON.stringify(expected)}`, () => {
          expect(bunFn(input)).toBe(expected);
        });
      }
    });
  }

  // Cross-conversion round-trips: convert from A to B, compare both implementations
  describe("cross-conversion round-trips", () => {
    const conversions = [
      "camelCase",
      "pascalCase",
      "snakeCase",
      "kebabCase",
      "constantCase",
      "noCase",
      "dotCase",
    ] as const;
    const roundTripInputs = [
      "hello world",
      "fooBarBaz",
      "FOO_BAR",
      "XMLParser",
      "getHTTPSURL",
      "test_string",
      "Test String",
      "already-kebab",
      "version 1.2.10",
    ];

    for (const input of roundTripInputs) {
      for (const from of conversions) {
        for (const to of conversions) {
          const intermediate = changeCaseFns[from](input);
          const expected = changeCaseFns[to](intermediate);
          test(`${from}(${JSON.stringify(input)}) => ${to}`, () => {
            const bunIntermediate = bunFns[from](input);
            expect(bunFns[to](bunIntermediate)).toBe(expected);
          });
        }
      }
    }
  });

  // Double-conversion stability: converting the output again should be idempotent
  describe("idempotency", () => {
    const idempotentInputs = ["hello world", "fooBarBaz", "FOO_BAR_BAZ", "XMLParser", "test 123", "café latte"];

    for (const caseName of allCaseNames) {
      const bunFn = bunFns[caseName];
      const changeCaseFn = changeCaseFns[caseName];

      for (const input of idempotentInputs) {
        test(`${caseName}(${caseName}(${JSON.stringify(input)})) is idempotent`, () => {
          const once = bunFn(input);
          const twice = bunFn(once);
          const expectedOnce = changeCaseFn(input);
          const expectedTwice = changeCaseFn(expectedOnce);
          expect(once).toBe(expectedOnce);
          expect(twice).toBe(expectedTwice);
        });
      }
    }
  });

  // Specific per-function expected values (hardcoded, not generated)
  describe("specific expected values", () => {
    test("camelCase", () => {
      expect(Bun.camelCase("foo bar")).toBe("fooBar");
      expect(Bun.camelCase("foo-bar")).toBe("fooBar");
      expect(Bun.camelCase("foo_bar")).toBe("fooBar");
      expect(Bun.camelCase("FOO_BAR")).toBe("fooBar");
      expect(Bun.camelCase("FooBar")).toBe("fooBar");
      expect(Bun.camelCase("fooBar")).toBe("fooBar");
      expect(Bun.camelCase("")).toBe("");
      expect(Bun.camelCase("foo")).toBe("foo");
      expect(Bun.camelCase("A")).toBe("a");
    });

    test("pascalCase", () => {
      expect(Bun.pascalCase("foo bar")).toBe("FooBar");
      expect(Bun.pascalCase("foo-bar")).toBe("FooBar");
      expect(Bun.pascalCase("foo_bar")).toBe("FooBar");
      expect(Bun.pascalCase("FOO_BAR")).toBe("FooBar");
      expect(Bun.pascalCase("fooBar")).toBe("FooBar");
      expect(Bun.pascalCase("")).toBe("");
      expect(Bun.pascalCase("foo")).toBe("Foo");
    });

    test("snakeCase", () => {
      expect(Bun.snakeCase("foo bar")).toBe("foo_bar");
      expect(Bun.snakeCase("fooBar")).toBe("foo_bar");
      expect(Bun.snakeCase("FooBar")).toBe("foo_bar");
      expect(Bun.snakeCase("FOO_BAR")).toBe("foo_bar");
      expect(Bun.snakeCase("foo-bar")).toBe("foo_bar");
      expect(Bun.snakeCase("")).toBe("");
    });

    test("kebabCase", () => {
      expect(Bun.kebabCase("foo bar")).toBe("foo-bar");
      expect(Bun.kebabCase("fooBar")).toBe("foo-bar");
      expect(Bun.kebabCase("FooBar")).toBe("foo-bar");
      expect(Bun.kebabCase("FOO_BAR")).toBe("foo-bar");
      expect(Bun.kebabCase("foo_bar")).toBe("foo-bar");
      expect(Bun.kebabCase("")).toBe("");
    });

    test("constantCase", () => {
      expect(Bun.constantCase("foo bar")).toBe("FOO_BAR");
      expect(Bun.constantCase("fooBar")).toBe("FOO_BAR");
      expect(Bun.constantCase("FooBar")).toBe("FOO_BAR");
      expect(Bun.constantCase("foo-bar")).toBe("FOO_BAR");
      expect(Bun.constantCase("foo_bar")).toBe("FOO_BAR");
      expect(Bun.constantCase("")).toBe("");
    });

    test("dotCase", () => {
      expect(Bun.dotCase("foo bar")).toBe("foo.bar");
      expect(Bun.dotCase("fooBar")).toBe("foo.bar");
      expect(Bun.dotCase("FOO_BAR")).toBe("foo.bar");
      expect(Bun.dotCase("")).toBe("");
    });

    test("capitalCase", () => {
      expect(Bun.capitalCase("foo bar")).toBe("Foo Bar");
      expect(Bun.capitalCase("fooBar")).toBe("Foo Bar");
      expect(Bun.capitalCase("FOO_BAR")).toBe("Foo Bar");
      expect(Bun.capitalCase("")).toBe("");
    });

    test("trainCase", () => {
      expect(Bun.trainCase("foo bar")).toBe("Foo-Bar");
      expect(Bun.trainCase("fooBar")).toBe("Foo-Bar");
      expect(Bun.trainCase("FOO_BAR")).toBe("Foo-Bar");
      expect(Bun.trainCase("")).toBe("");
    });

    test("pathCase", () => {
      expect(Bun.pathCase("foo bar")).toBe("foo/bar");
      expect(Bun.pathCase("fooBar")).toBe("foo/bar");
      expect(Bun.pathCase("FOO_BAR")).toBe("foo/bar");
      expect(Bun.pathCase("")).toBe("");
    });

    test("sentenceCase", () => {
      expect(Bun.sentenceCase("foo bar")).toBe("Foo bar");
      expect(Bun.sentenceCase("fooBar")).toBe("Foo bar");
      expect(Bun.sentenceCase("FOO_BAR")).toBe("Foo bar");
      expect(Bun.sentenceCase("")).toBe("");
    });

    test("noCase", () => {
      expect(Bun.noCase("foo bar")).toBe("foo bar");
      expect(Bun.noCase("fooBar")).toBe("foo bar");
      expect(Bun.noCase("FOO_BAR")).toBe("foo bar");
      expect(Bun.noCase("FooBar")).toBe("foo bar");
      expect(Bun.noCase("")).toBe("");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    test("empty string returns empty for all functions", () => {
      for (const caseName of allCaseNames) {
        expect(bunFns[caseName]("")).toBe("");
      }
    });

    test("single character", () => {
      for (const ch of ["a", "A", "z", "Z", "0", "9"]) {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](ch)).toBe(changeCaseFns[caseName](ch));
        }
      }
    });

    test("all separators produce empty for all functions", () => {
      for (const sep of ["---", "___", "...", "   ", "\t\t", "-_.-_."]) {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](sep)).toBe(changeCaseFns[caseName](sep));
        }
      }
    });

    test("numbers only", () => {
      for (const input of ["123", "0", "999", "123 456", "1.2.3"]) {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](input)).toBe(changeCaseFns[caseName](input));
        }
      }
    });

    test("mixed numbers and letters", () => {
      for (const input of [
        "test123",
        "123test",
        "test 123 value",
        "1st place",
        "v2beta1",
        "a1b2c3",
        "ES6Module",
        "utf8Decode",
        "base64Encode",
        "h1Element",
        "int32Array",
      ]) {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](input)).toBe(changeCaseFns[caseName](input));
        }
      }
    });

    test("consecutive separators are collapsed", () => {
      for (const input of ["foo___bar", "foo---bar", "foo...bar", "foo   bar"]) {
        expect(Bun.camelCase(input)).toBe(camelCase(input));
        expect(Bun.snakeCase(input)).toBe(snakeCase(input));
      }
    });

    test("leading and trailing separators are stripped", () => {
      for (const input of ["  foo  ", "__bar__", "--baz--", "..qux.."]) {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](input)).toBe(changeCaseFns[caseName](input));
        }
      }
    });

    test("unicode strings", () => {
      for (const input of ["café latte", "naïve résumé", "hello 世界"]) {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](input)).toBe(changeCaseFns[caseName](input));
        }
      }
    });

    test("acronym splitting", () => {
      // These specifically test the upper->upper+lower boundary rule
      for (const input of [
        "XMLParser",
        "HTMLElement",
        "innerHTML",
        "XMLHttpRequest",
        "getURLParams",
        "isHTTPS",
        "CSSStyleSheet",
        "IOError",
        "UIKit",
        "HTTPSConnection",
        "myXMLParser",
        "getDBConnection",
        "setHTTPSEnabled",
        "ABCDef",
        "ABCdef",
      ]) {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](input)).toBe(changeCaseFns[caseName](input));
        }
      }
    });

    test("digit-prefix underscore in camelCase/pascalCase", () => {
      // change-case inserts _ before digit-starting words (index > 0) in camel/pascal
      const input = "version 1.2.10";
      expect(Bun.camelCase(input)).toBe(camelCase(input));
      expect(Bun.pascalCase(input)).toBe(pascalCase(input));
      // snake/kebab/etc should NOT have the _ prefix
      expect(Bun.snakeCase(input)).toBe(snakeCase(input));
      expect(Bun.kebabCase(input)).toBe(kebabCase(input));
    });

    test("long strings", () => {
      const long =
        "this is a much longer test string with many words to convert and it keeps going and going and going";
      for (const caseName of allCaseNames) {
        expect(bunFns[caseName](long)).toBe(changeCaseFns[caseName](long));
      }
    });

    test("repeated single word", () => {
      expect(Bun.camelCase("foo")).toBe("foo");
      expect(Bun.pascalCase("foo")).toBe("Foo");
      expect(Bun.snakeCase("foo")).toBe("foo");
      expect(Bun.kebabCase("foo")).toBe("foo");
      expect(Bun.constantCase("foo")).toBe("FOO");
    });

    test("single uppercase word", () => {
      expect(Bun.camelCase("FOO")).toBe(camelCase("FOO"));
      expect(Bun.pascalCase("FOO")).toBe(pascalCase("FOO"));
      expect(Bun.snakeCase("FOO")).toBe(snakeCase("FOO"));
    });
  });

  // Error handling
  describe("error handling", () => {
    for (const caseName of allCaseNames) {
      const fn = bunFns[caseName];

      test(`${caseName}() with no arguments throws`, () => {
        // @ts-expect-error
        expect(() => fn()).toThrow();
      });

      test(`${caseName}(123) with number throws`, () => {
        // @ts-expect-error
        expect(() => fn(123)).toThrow();
      });

      test(`${caseName}(null) throws`, () => {
        // @ts-expect-error
        expect(() => fn(null)).toThrow();
      });

      test(`${caseName}(undefined) throws`, () => {
        // @ts-expect-error
        expect(() => fn(undefined)).toThrow();
      });

      test(`${caseName}({}) with object throws`, () => {
        // @ts-expect-error
        expect(() => fn({})).toThrow();
      });

      test(`${caseName}([]) with array throws`, () => {
        // @ts-expect-error
        expect(() => fn([])).toThrow();
      });

      test(`${caseName}(true) with boolean throws`, () => {
        // @ts-expect-error
        expect(() => fn(true)).toThrow();
      });
    }
  });

  // Ensure .length property is 1
  describe("function.length", () => {
    for (const caseName of allCaseNames) {
      test(`Bun.${caseName}.length === 1`, () => {
        expect(bunFns[caseName].length).toBe(1);
      });
    }
  });

  // Stress test with generated inputs
  describe("generated inputs", () => {
    // Words joined with various separators
    const words = ["foo", "bar", "baz", "qux"];
    const separators = [" ", "_", "-", ".", "/", "  ", "__", "--"];

    for (const sep of separators) {
      const input = words.join(sep);
      test(`words joined by ${JSON.stringify(sep)}: ${JSON.stringify(input)}`, () => {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](input)).toBe(changeCaseFns[caseName](input));
        }
      });
    }

    // Various camelCase-style inputs
    const camelInputs = [
      "oneTwoThree",
      "OneTwoThree",
      "oneTWOThree",
      "ONETwoThree",
      "oneTwo3",
      "one2Three",
      "one23",
      "oneABCTwo",
    ];

    for (const input of camelInputs) {
      test(`camelCase-style: ${JSON.stringify(input)}`, () => {
        for (const caseName of allCaseNames) {
          expect(bunFns[caseName](input)).toBe(changeCaseFns[caseName](input));
        }
      });
    }
  });
});
