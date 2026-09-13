// Test data from Web Platform Tests
// https://github.com/web-platform-tests/wpt/blob/master/LICENSE.md
import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import testData from "./urlpatterntestdata.json";

const kComponents = ["protocol", "username", "password", "hostname", "port", "pathname", "search", "hash"] as const;

type Component = (typeof kComponents)[number];

interface TestEntry {
  pattern: any[];
  inputs?: any[];
  expected_obj?: Record<string, string> | "error";
  expected_match?: Record<string, any> | null | "error";
  exactly_empty_components?: string[];
}

function getExpectedPatternString(entry: TestEntry, component: Component): string {
  // If the test case explicitly provides an expected pattern string, use that
  if (entry.expected_obj && typeof entry.expected_obj === "object" && entry.expected_obj[component] !== undefined) {
    return entry.expected_obj[component];
  }

  // Determine if there is a baseURL present
  let baseURL: URL | null = null;
  if (entry.pattern.length > 0 && entry.pattern[0].baseURL) {
    baseURL = new URL(entry.pattern[0].baseURL);
  } else if (entry.pattern.length > 1 && typeof entry.pattern[1] === "string") {
    baseURL = new URL(entry.pattern[1]);
  }

  const EARLIER_COMPONENTS: Record<Component, Component[]> = {
    protocol: [],
    hostname: ["protocol"],
    port: ["protocol", "hostname"],
    username: [],
    password: [],
    pathname: ["protocol", "hostname", "port"],
    search: ["protocol", "hostname", "port", "pathname"],
    hash: ["protocol", "hostname", "port", "pathname", "search"],
  };

  if (entry.exactly_empty_components?.includes(component)) {
    return "";
  } else if (typeof entry.pattern[0] === "object" && entry.pattern[0][component]) {
    return entry.pattern[0][component];
  } else if (typeof entry.pattern[0] === "object" && EARLIER_COMPONENTS[component].some(c => c in entry.pattern[0])) {
    return "*";
  } else if (baseURL && component !== "username" && component !== "password") {
    let base_value = (baseURL as any)[component] as string;
    if (component === "protocol") base_value = base_value.substring(0, base_value.length - 1);
    else if (component === "search" || component === "hash") base_value = base_value.substring(1);
    return base_value;
  } else {
    return "*";
  }
}

function getExpectedComponentResult(
  entry: TestEntry,
  component: Component,
): { input: string; groups: Record<string, string | undefined> } {
  let expected_obj = entry.expected_match?.[component];

  if (!expected_obj) {
    expected_obj = { input: "", groups: {} as Record<string, string | undefined> };
    if (!entry.exactly_empty_components?.includes(component)) {
      expected_obj.groups["0"] = "";
    }
  }

  // Convert null to undefined in groups
  for (const key in expected_obj.groups) {
    if (expected_obj.groups[key] === null) {
      expected_obj.groups[key] = undefined;
    }
  }

  return expected_obj;
}

describe("URLPattern", () => {
  describe("WPT tests", () => {
    for (const entry of testData as TestEntry[]) {
      const testName = `Pattern: ${JSON.stringify(entry.pattern)} Inputs: ${JSON.stringify(entry.inputs)}`;

      test(testName, () => {
        // Test construction error
        if (entry.expected_obj === "error") {
          expect(() => new URLPattern(...entry.pattern)).toThrow(TypeError);
          return;
        }

        const pattern = new URLPattern(...entry.pattern);

        // Verify compiled pattern properties
        for (const component of kComponents) {
          const expected = getExpectedPatternString(entry, component);
          expect(pattern[component]).toBe(expected);
        }

        // Test match error
        if (entry.expected_match === "error") {
          expect(() => pattern.test(...(entry.inputs ?? []))).toThrow(TypeError);
          expect(() => pattern.exec(...(entry.inputs ?? []))).toThrow(TypeError);
          return;
        }

        // Test test() method
        expect(pattern.test(...(entry.inputs ?? []))).toBe(!!entry.expected_match);

        // Test exec() method
        const exec_result = pattern.exec(...(entry.inputs ?? []));

        if (!entry.expected_match || typeof entry.expected_match !== "object") {
          expect(exec_result).toBe(entry.expected_match);
          return;
        }

        const expected_inputs = entry.expected_match.inputs ?? entry.inputs;

        // Verify inputs
        expect(exec_result!.inputs.length).toBe(expected_inputs!.length);
        for (let i = 0; i < exec_result!.inputs.length; i++) {
          const input = exec_result!.inputs[i];
          const expected_input = expected_inputs![i];
          if (typeof input === "string") {
            expect(input).toBe(expected_input);
          } else {
            for (const component of kComponents) {
              expect(input[component]).toBe(expected_input[component]);
            }
          }
        }

        // Verify component results
        for (const component of kComponents) {
          const expected = getExpectedComponentResult(entry, component);
          expect(exec_result![component]).toEqual(expected);
        }
      });
    }
  });

  describe("constructor edge cases", () => {
    test("unclosed token with URL object - %(", () => {
      expect(() => new URLPattern(new URL("https://example.org/%("))).toThrow(TypeError);
    });

    test("unclosed token with URL object - %((", () => {
      expect(() => new URLPattern(new URL("https://example.org/%(("))).toThrow(TypeError);
    });

    test("unclosed token with string - (\\", () => {
      expect(() => new URLPattern("(\\")).toThrow(TypeError);
    });

    test("constructor with undefined arguments", () => {
      // Should not throw
      new URLPattern(undefined, undefined);
    });
  });

  describe("hasRegExpGroups", () => {
    test("match-everything pattern", () => {
      expect(new URLPattern({}).hasRegExpGroups).toBe(false);
    });

    for (const component of kComponents) {
      test(`wildcard in ${component}`, () => {
        expect(new URLPattern({ [component]: "*" }).hasRegExpGroups).toBe(false);
      });

      test(`segment wildcard in ${component}`, () => {
        expect(new URLPattern({ [component]: ":foo" }).hasRegExpGroups).toBe(false);
      });

      test(`optional segment wildcard in ${component}`, () => {
        expect(new URLPattern({ [component]: ":foo?" }).hasRegExpGroups).toBe(false);
      });

      test(`named regexp group in ${component}`, () => {
        expect(new URLPattern({ [component]: ":foo(hi)" }).hasRegExpGroups).toBe(true);
      });

      test(`anonymous regexp group in ${component}`, () => {
        expect(new URLPattern({ [component]: "(hi)" }).hasRegExpGroups).toBe(true);
      });

      if (component !== "protocol" && component !== "port") {
        test(`wildcards mixed with fixed text in ${component}`, () => {
          expect(new URLPattern({ [component]: "a-{:hello}-z-*-a" }).hasRegExpGroups).toBe(false);
        });

        test(`regexp groups mixed with fixed text in ${component}`, () => {
          expect(new URLPattern({ [component]: "a-(hi)-z-(lo)-a" }).hasRegExpGroups).toBe(true);
        });
      }
    }

    test("complex pathname with no regexp", () => {
      expect(new URLPattern({ pathname: "/a/:foo/:baz?/b/*" }).hasRegExpGroups).toBe(false);
    });

    test("complex pathname with regexp", () => {
      expect(new URLPattern({ pathname: "/a/:foo/:baz([a-z]+)?/b/*" }).hasRegExpGroups).toBe(true);
    });
  });

  // The tokenizer keeps one token (40 bytes or more) per code point in a
  // WTF::Vector, which holds at most 2^31 - 1 bytes. A pattern near 52 million
  // characters used to abort the process when that Vector could not grow. The
  // bound follows the synthetic allocation limit, so 1 MiB puts it below 64 Ki.
  describe("a pattern with more tokens than the token list can hold throws", () => {
    const dots = (length: number) => Buffer.alloc(length, ".").toString();
    const message = "URLPattern constructor: Failed to create URLPattern (from input string)";
    const tooLong = 64 * 1024;
    const fits = 8 * 1024;

    let originalLimit: number;
    beforeAll(() => {
      originalLimit = setSyntheticAllocationLimitForTesting(1024 * 1024);
    });
    afterAll(() => {
      setSyntheticAllocationLimitForTesting(originalLimit);
    });

    test.each(["username", "password", "hostname", "pathname", "search", "hash"] as const)("in %s", component => {
      expect(() => new URLPattern({ [component]: dots(tooLong) })).toThrow(message);
    });

    test("in a constructor string", () => {
      expect(() => new URLPattern("https://example.com/" + dots(tooLong))).toThrow(message);
      expect(new URLPattern("https://example.com/" + dots(fits)).test("https://example.com/" + dots(fits))).toBe(true);
    });

    test("in a pathname inherited from baseURL", () => {
      expect(() => new URLPattern({ search: "a", baseURL: "https://example.com/" + dots(tooLong) })).toThrow(message);
    });

    // Find the longest pathname that parses. It must come back whole: the
    // End token counts against the bound too, and without it the parser
    // would drop the pending text instead of throwing.
    test("at the exact bound, and one code point below it parses whole", () => {
      let low = fits;
      let high = tooLong;
      while (low + 1 < high) {
        const length = (low + high) >>> 1;
        try {
          new URLPattern({ pathname: dots(length) });
          low = length;
        } catch {
          high = length;
        }
      }
      expect(new URLPattern({ pathname: dots(low) }).pathname).toBe(dots(low));
      expect(() => new URLPattern({ pathname: dots(high) })).toThrow(message);
    });
  });
});
