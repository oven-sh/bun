// Test data from Web Platform Tests
// https://github.com/web-platform-tests/wpt/blob/master/LICENSE.md
import { describe, expect, test } from "bun:test";
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

  // The encoding callbacks are https://urlpattern.spec.whatwg.org/#canonicalize-a-hash and
  // #canonicalize-a-search. Only #process-hash-for-init and #process-search-for-init remove a
  // single leading "#" or "?" from the whole component, never from fixed text inside the pattern.
  describe("fixed text that follows a token keeps a leading # or ?", () => {
    test("hash", () => {
      expect(new URLPattern("https://h/#a*#b").hash).toBe("a*#b");
      expect(new URLPattern("https://h/#:x#b").hash).toBe(":x#b");

      const p = new URLPattern("https://h/#v-*#end");
      expect(p.hash).toBe("v-*#end");
      expect(p.test("https://h/#v-1#end")).toBe(true);
      expect(p.test("https://h/#v-1")).toBe(false);
      expect(p.test("https://h/#v-1xend")).toBe(false);
      expect(new URLPattern({ hash: p.hash }).hash).toBe(p.hash);
      expect(new URLPattern({ hash: p.hash }).test("https://h/#v-1xend")).toBe(false);

      expect(new URLPattern({ hash: "\\#\\#b" }).hash).toBe("##b");
      // process hash for init removes one leading "#" from the component as a whole.
      expect(new URLPattern({ hash: "##b" }).hash).toBe("#b");
      expect(new URLPattern("https://h/#a#b").hash).toBe("a#b");
      expect(new URLPattern({ hash: "a#b" }).hash).toBe("a#b");

      const any = new URLPattern({ hash: "*" });
      expect(any.exec({ hash: "#b" })!.hash.input).toBe("b");
      expect(any.exec({ hash: "##b" })!.hash.input).toBe("#b");
    });

    // Chromium 152 drops one leading "?" from such fixed text because its callback goes through the
    // URL search setter. The spec's canonicalize a search runs the query state, which keeps it.
    test("search", () => {
      const p = new URLPattern({ search: "a:x\\?b" });
      expect(p.search).toBe("a:x\\?b");
      expect(p.test({ search: "av?b" })).toBe(true);
      expect(p.test("https://h/?av?b")).toBe(true);
      expect(p.test({ search: "avb" })).toBe(false);
      expect(new URLPattern({ search: p.search }).test({ search: "avb" })).toBe(false);

      expect(new URLPattern({ search: "\\?\\?b" }).search).toBe("\\?\\?b");
      // process search for init removes one leading "?" from the component as a whole.
      expect(new URLPattern({ search: "?\\?b" }).search).toBe("\\?b");
      expect(new URLPattern("https://h/x?\\?b").search).toBe("\\?b");

      const any = new URLPattern({ search: "*" });
      expect(any.exec({ search: "?b" })!.search.input).toBe("b");
      expect(any.exec({ search: "??b" })!.search.input).toBe("?b");
      expect(any.exec("https://h/??b")!.search.input).toBe("?b");
    });

    // With the query state override a "#" is part of the query and gets percent-encoded,
    // like the URL search setter does.
    test("# in a search pattern or dictionary input is percent-encoded", () => {
      const p = new URLPattern({ search: "q=a#b" });
      expect(p.search).toBe("q=a%23b");
      expect(p.test({ search: "q=a#b" })).toBe(true);
      expect(p.test("https://h/?q=a%23b")).toBe(true);
      expect(p.test("https://h/?q=a#b")).toBe(false);
      expect(new URLPattern({ search: "*" }).exec({ search: "q=a#b" })!.search.input).toBe("q=a%23b");
    });
  });

  // https://urlpattern.spec.whatwg.org/#tokenize treats a zero-length regexp group as a
  // tokenizing error regardless of where it appears in the input.
  test("empty regexp group is rejected wherever it appears", () => {
    for (const pathname of ["/()", "/:y()", "/x/()", "/a()", "()", "(\\d)()", "/a()b", "/()b"]) {
      expect(() => new URLPattern({ pathname })).toThrow(TypeError);
    }
    expect(() => new URLPattern({ hash: "a()" })).toThrow(TypeError);
    expect(() => new URLPattern("https://h/()")).toThrow(TypeError);
    expect(() => new URLPattern("https://h/x#()")).toThrow(TypeError);
    expect(new URLPattern({ pathname: "/\\(\\)" }).test({ pathname: "/()" })).toBe(true);
  });
});
