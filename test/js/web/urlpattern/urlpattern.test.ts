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
  });

  // "Canonicalize a hostname" parses the value alone, from the hostname state of the URL Standard
  // (https://urlpattern.spec.whatwg.org/#canonicalize-a-hostname). Node.js v26.3.0 gives the same results.
  describe("hostname canonicalization", () => {
    const group = (hostname: string) =>
      new URLPattern({ hostname: ":h" }).exec({ hostname })?.hostname.groups.h ?? null;

    test("a port after the host fails", () => {
      expect(group("[::1]")).toBe("[::1]");
      expect(group("[::1]:81")).toBeNull();
      expect(group("a:81")).toBeNull();
    });

    // The host parser refuses "09": it ends in a number and is not an IPv4 address. Node.js keeps "09".
    test("a host that the host parser refuses fails", () => {
      expect(group("09")).toBeNull();
      expect(group("a b")).toBeNull();
      expect(group("EX%41mple")).toBe("example");
      expect(group("[0:0::1]")).toBe("[::1]");
    });

    test("tab and newline are removed first", () => {
      expect(group("a\tb")).toBe("ab");
      expect(group("\t[::1]")).toBe("[::1]");
    });

    // IDNA maps U+FF20, U+FF0F and U+2100 to text with '@' and '/'.
    test("code points that IDNA maps to a delimiter do not become URL structure", () => {
      const trusted = new URLPattern({ hostname: "*.trusted.example" });
      expect(trusted.test({ hostname: "a.trusted.example" })).toBe(true);
      expect(trusted.test({ hostname: "evil.example\uFF20a.trusted.example" })).toBe(false);
      expect(trusted.test({ hostname: "a.trusted.example\uFF0Fevil.example" })).toBe(false);
      expect(group("a\uFF0Fb")).toBeNull();
      expect(() => new URLPattern({ hostname: "a\uFF20b" })).toThrow(TypeError);
      expect(() => new URLPattern({ hostname: "bad.c\u2100.good.com" })).toThrow(TypeError);
    });

    test("percent-decoding comes before domain to ASCII", () => {
      expect(new URLPattern({ hostname: "\u00DF%41.de" }).hostname).toBe("xn--a-pfa.de");
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
