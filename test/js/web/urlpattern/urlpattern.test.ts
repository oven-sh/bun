// Test data from Web Platform Tests
// https://github.com/web-platform-tests/wpt/blob/master/LICENSE.md
import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
          expect(exec_result).toBe<null | undefined>(entry.expected_match);
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

    // A component compiles to one RegExp with the v flag. JavaScriptCore only syntax-checks a pattern of more than 64
    // characters when it creates the RegExp, so a group that the syntax check alone did not refuse made a URLPattern
    // that threw a SyntaxError from test() and exec(), or from the constructor on its first call only.
    describe.each([
      ["a negated class that holds an empty class string", "([^\\q{}])"],
      ["a count that JavaScriptCore's RegExp offsets cannot hold", "(x{4294967295})"],
    ])("a regexp group with %s", (_, group) => {
      const long = Buffer.alloc(70, "a").toString();
      const refused = "TypeError: Unable to create RegExp object regular expression from provided URLPattern string.";
      const errorOf = (init: { pathname?: string; protocol?: string }) => {
        try {
          new URLPattern(init);
        } catch (e) {
          return `${(e as Error).name}: ${(e as Error).message}`;
        }
        return "no error";
      };

      test("in a short pathname", () => {
        expect(errorOf({ pathname: "/:id" + group })).toBe(refused);
      });

      test("in a long pathname", () => {
        expect(errorOf({ pathname: "/" + long + "/:id" + group })).toBe(refused);
      });

      test("in a long protocol, every time", () => {
        const first = errorOf({ protocol: long + group });
        const second = errorOf({ protocol: long + group });
        expect([first, second]).toEqual([refused, refused]);
      });
    });

    test("a long pathname with a valid regexp group", () => {
      const long = Buffer.alloc(70, "a").toString();
      const pattern = new URLPattern({ pathname: "/" + long + "/:id([^\\q{a}])" });
      expect(pattern.test({ pathname: "/" + long + "/b" })).toBe(true);
      expect(pattern.test({ pathname: "/" + long + "/a" })).toBe(false);
    });

    // A regexp group is a `v` pattern, so its classes follow the class set grammar: a nested class is a class of its
    // own, and there is no operator after operands with nothing between them.
    test("a regexp group with a nested class after a range", () => {
      const pattern = new URLPattern({ pathname: "/:id([a-f[\\d--5]]+)" });
      expect(["/a4", "/a5", "/g"].map(pathname => pattern.test({ pathname }))).toEqual([true, false, false]);
    });

    test("a regexp group with an operator after a union", () => {
      expect(() => new URLPattern({ pathname: "/:id([a\\d--5]+)" })).toThrow(
        "Unable to create RegExp object regular expression from provided URLPattern string.",
      );
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

  // The tokenizer emits one token per code point, and the synthetic allocation limit caps the token list.
  test("throws for a pattern with more tokens than the token list allows", () => {
    const dots = (length: number) => Buffer.alloc(length, ".").toString();
    const message = "URLPattern constructor: Failed to create URLPattern (from input string)";
    const originalLimit = setSyntheticAllocationLimitForTesting(1024 * 1024);
    try {
      expect(() => new URLPattern({ pathname: dots(64 * 1024) })).toThrow(message);
      expect(() => new URLPattern("https://example.com/" + dots(64 * 1024))).toThrow(message);
      expect(new URLPattern({ pathname: dots(8 * 1024) }).pathname).toBe(dots(8 * 1024));
    } finally {
      setSyntheticAllocationLimitForTesting(originalLimit);
    }
  });

  test("throws when a generated string exceeds the string length limit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const long = "x".repeat(64 * 1024);
          const overHalf = "x".repeat(32 * 1024 + 16);
          const any = new URLPattern({});
          for (const init of [
            // The regular expression contains the group's value twice.
            { pathname: "{a(" + overHalf + ")b}*" },
            // The pattern string contains the group's name, but the regular expression doesn't.
            { pathname: ":" + long },
            // Escaping doubles each of these base URL characters.
            { baseURL: "https://e.com/" + overHalf.replaceAll("x", "(") },
          ]) {
            try {
              new URLPattern(init);
              console.log("no error");
            } catch (e) {
              console.log(e.name, e.message);
            }
          }
          // An input that can't be processed doesn't match.
          console.log(any.test({ protocol: long }), any.test({ pathname: long }), any.test({ protocol: "data", pathname: long }));
        `,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(64 * 1024) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "RangeError Out of memory\n".repeat(3) + "false false false\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
