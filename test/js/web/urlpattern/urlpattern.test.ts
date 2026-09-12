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

  // A named group that is followed by fixed text and then another named group, as in "/:a-:b", compiles to a regexp
  // that is not the one the spec writes down. It has to match the same inputs with the same groups.
  describe("named groups separated by fixed text", () => {
    // Every string over `alphabet` that is at most `maxLength` long.
    function words(alphabet: string, maxLength: number): string[] {
      const result = [""];
      let start = 0;
      for (let length = 0; length < maxLength; length++) {
        const end = result.length;
        for (let i = start; i < end; i++) {
          for (const character of alphabet) result.push(result[i] + character);
        }
        start = end;
      }
      return result;
    }

    // `spec` is the regexp the URLPattern spec generates for the component.
    const cases: {
      init: URLPatternInit;
      options?: URLPatternOptions;
      component: Component;
      spec: RegExp;
      names: string[];
      inputs: string[];
    }[] = [
      {
        init: { pathname: "/:a-:b-:c" },
        component: "pathname",
        spec: /^(?:\/([^\/]+?))-([^\/]+?)-([^\/]+?)$/v,
        names: ["a", "b", "c"],
        inputs: words("a-", 7).map(word => "/" + word),
      },
      {
        init: { pathname: "/:a-:b/:c-:d/x" },
        component: "pathname",
        spec: /^(?:\/([^\/]+?))-([^\/]+?)(?:\/([^\/]+?))-([^\/]+?)\/x$/v,
        names: ["a", "b", "c", "d"],
        inputs: words("a-", 3).flatMap(first => words("a-", 3).map(second => "/" + first + "/" + second + "/x")),
      },
      {
        // The separator after :a starts with the separator after :b.
        init: { pathname: "/:a--:b-:c" },
        component: "pathname",
        spec: /^(?:\/([^\/]+?))--([^\/]+?)-([^\/]+?)$/v,
        names: ["a", "b", "c"],
        inputs: words("a-", 7).map(word => "/" + word),
      },
      {
        init: { pathname: "/:a{x}:b{x}:c" },
        options: { ignoreCase: true },
        component: "pathname",
        spec: /^(?:\/([^\/]+?))x([^\/]+?)x([^\/]+?)$/iv,
        names: ["a", "b", "c"],
        inputs: words("aX", 6).map(word => "/" + word),
      },
      {
        // The search component has no delimiter, so a group matches any character.
        init: { search: ":a-:b-:c,x" },
        component: "search",
        spec: /^([^]+?)-([^]+?)-([^]+?),x$/v,
        names: ["a", "b", "c"],
        inputs: words("a-", 6).map(word => word + ",x"),
      },
      {
        init: { hostname: ":a-:b.:c-:d" },
        component: "hostname",
        spec: /^([^\.]+?)-([^\.]+?)(?:\.([^\.]+?))-([^\.]+?)$/v,
        names: ["a", "b", "c", "d"],
        inputs: words("a-", 3).flatMap(first => words("a-", 2).map(second => "a" + first + "." + second + "a")),
      },
    ];

    for (const { init, options, component, spec, names, inputs } of cases) {
      test(`${JSON.stringify(init)} matches like the spec regexp`, () => {
        const pattern = new URLPattern(init, options);
        const mismatches: unknown[] = [];
        let matched = 0;
        for (const input of inputs) {
          const match = spec.exec(input);
          const expected = match && Object.fromEntries(names.map((name, i) => [name, match[i + 1]]));
          const actual = pattern.exec({ [component]: input })?.[component].groups ?? null;
          if (match) matched++;
          if (!Bun.deepEquals(actual, expected)) mismatches.push({ input, actual, expected });
        }
        expect({ mismatches, matchedSome: matched > 0 }).toEqual({ mismatches: [], matchedSome: true });
      });
    }

    test("a group keeps a separator it has to contain", () => {
      const pattern = new URLPattern({ pathname: "/:a-:b-:c" });
      expect([
        pattern.exec({ pathname: "/x-y-z-w" })?.pathname.groups,
        pattern.exec({ pathname: "/x--y-z" })?.pathname.groups,
        pattern.exec({ pathname: "/--x-y" })?.pathname.groups,
        pattern.exec({ pathname: "/x-y-" }),
      ]).toEqual([{ a: "x", b: "y", c: "z-w" }, { a: "x", b: "-y", c: "z" }, { a: "-", b: "x", c: "y" }, null]);
    });

    test("a backreference in a later regexp group sees every split", () => {
      // Only a = "x-y" lets \1 match, and the regexp finds it after a = "x" fails.
      const pattern = new URLPattern({ pathname: "/:a-:b/(\\1)" });
      expect(pattern.exec({ pathname: "/x-y-z/x-y" })?.pathname.groups).toEqual({ a: "x-y", b: "z", "0": "x-y" });
    });

    test("matching a long input is not polynomial", () => {
      // Every input fails to match only at its end. The spec regexp then retries every way to split the input over the
      // groups: with three groups, 2048 separators take about 4 s and 3072 take about 13 s. The compiled regexp looks
      // at each character a fixed number of times, which takes a few milliseconds in a debug build.
      const budgetMs = 1000;
      const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();

      for (const [init, input] of [
        [{ pathname: "/:owner-:repo-:ref" }, { pathname: "/" + repeat("a-", 3072) + "/x" }],
        [{ pathname: "/:a--:b--:c" }, { pathname: "/" + repeat("a--", 2048) + "/x" }],
        [{ search: ":a-:b-:c,x" }, { search: repeat("a-", 2048) }],
        [{ hostname: ":a-:b-:c.example.com" }, { hostname: repeat("a-", 2048) + "a.example.org" }],
      ] as [URLPatternInit, URLPatternInit][]) {
        const pattern = new URLPattern(init);
        const start = performance.now();
        const result = pattern.test(input);
        const elapsed = performance.now() - start;
        if (result || elapsed >= budgetMs) {
          throw new Error(
            `${JSON.stringify(init)}: test() returned ${result} after ${elapsed.toFixed(0)} ms (budget ${budgetMs} ms)`,
          );
        }
      }
    });
  });
});
