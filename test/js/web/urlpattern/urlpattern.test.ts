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

  // The spec writes a repeated part as a quantifier around the part's regexp. For a wildcard that is a quantifier
  // inside a quantifier, and a backtracking matcher takes exponential time on it (whatwg/urlpattern#237). URLPattern
  // compiles these parts to one quantifier. The match and its groups must stay what the spec's regexp gives.
  describe("repeated wildcards", () => {
    // Every string of up to `maxLength` characters from `alphabet`.
    function allStrings(alphabet: string, maxLength: number): string[] {
      const strings = [""];
      for (let start = 0, length = 1; length <= maxLength; length++) {
        const end = strings.length;
        for (let i = start; i < end; i++) for (const character of alphabet) strings.push(strings[i] + character);
        start = end;
      }
      return strings;
    }

    // The regexp is what "generate a regular expression and name list" gives for the pattern, character for character.
    // URLPattern canonicalizes an input before it matches. The characters in the alphabet come through unchanged.
    // Most rows put a second wildcard after the repeated one. Then the input has more than one split, and the row
    // fails if the repeated wildcard does not try the longest match first.
    test.each<[component: Component, pattern: string, names: string[], specRegexp: string, alphabet: string]>([
      ["hostname", ":a+.:b*", ["a", "b"], String.raw`^((?:[^\.]+?)+)\.((?:[^\.]+?)*)$`, "a."],
      ["hostname", ":a*:b+", ["a", "b"], String.raw`^((?:[^\.]+?)*)((?:[^\.]+?)+)$`, "a."],
      ["hostname", "**.*", ["0", "1"], String.raw`^((?:.*)*)\.(.*)$`, "a."],
      ["hostname", "{*.}+*", ["0", "1"], String.raw`^(?:((?:.*)(?:\.(?:.*))*)\.)(.*)$`, "a."],
      ["search", ":a+-:b*", ["a", "b"], String.raw`^((?:[^]+?)+)-((?:[^]+?)*)$`, "a-"],
      ["search", "*+-**", ["0", "1"], String.raw`^((?:.*)+)-((?:.*)*)$`, "a-"],
      ["hash", "{-*}+-*", ["0", "1"], String.raw`^(?:-((?:.*)(?:-(?:.*))*))-(.*)$`, "a-"],
      ["hash", "{-*_}*:r", ["0", "r"], String.raw`^(?:-((?:.*)(?:_-(?:.*))*)_)?([^]+?)$`, "-_"],
      ["pathname", "/**/*", ["0", "1"], String.raw`^(?:\/((?:.*)(?:\/(?:.*))*))?(?:\/(.*))$`, "a/"],
      ["pathname", "/**/a", ["0"], String.raw`^(?:\/((?:.*)(?:\/(?:.*))*))?\/a$`, "a/"],
      ["pathname", "/*+/:b", ["0", "b"], String.raw`^(?:\/((?:.*)(?:\/(?:.*))*))(?:\/([^\/]+?))$`, "a/"],
      // A repeated named group with a prefix or suffix keeps the spec's regexp: `/:b*` here, `{-:x}+` in the next row.
      ["pathname", ":a+/:b*", ["a", "b"], String.raw`^((?:[^\/]+?)+)(?:\/((?:[^\/]+?)(?:\/(?:[^\/]+?))*))?$`, "a/"],
      ["hash", "{-:x}+-:y", ["x", "y"], String.raw`^(?:-((?:[^]+?)(?:-(?:[^]+?))*))-([^]+?)$`, "a-"],
    ])("%s %s gives the groups of the spec's regexp", (component, pattern, names, specRegexp, alphabet) => {
      const urlPattern = new URLPattern({ [component]: pattern });
      const regexp = new RegExp(specRegexp, "v");
      const inputs = allStrings(alphabet, 6);
      const actual: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      let matched = 0;
      for (const input of inputs) {
        actual[input] = urlPattern.exec({ [component]: input })?.[component].groups ?? null;
        const match = regexp.exec(input);
        expected[input] = match && Object.fromEntries(names.map((name, i) => [name, match[i + 1]]));
        if (match) matched++;
      }
      // The corpus must hold both outcomes, or the comparison proves little.
      expect({ actual, matched: matched > 0, unmatched: matched < inputs.length }).toEqual({
        actual: expected,
        matched: true,
        unmatched: true,
      });
    });

    const b30 = Buffer.alloc(30, "b").toString();
    const segments30 = Buffer.alloc(59, "b/").toString();
    const dotted30 = Buffer.alloc(89, "b./").toString();
    const dashed30 = Buffer.alloc(60, "b-").toString();

    // Each input matches only after the repeated wildcard gives back 30 or more characters. With a quantifier inside a
    // quantifier the matcher tries about 2^30 splits on the way there, runs out of its match limit, and reports no match.
    test.each<[component: Component, pattern: string, input: string, groups: Record<string, string>]>([
      ["search", ":a+-:b", `a-${b30}`, { a: "a", b: b30 }],
      ["search", ":a*-:b", `a-${b30}`, { a: "a", b: b30 }],
      ["hostname", ":a+-:b.example.com", `a-${b30}.example.com`, { a: "a", b: b30 }],
      ["hash", "**-*", `a-${b30}`, { "0": "a", "1": b30 }],
      ["hash", "*+-*", `a-${b30}`, { "0": "a", "1": b30 }],
      ["hash", "{*-}+x*", `a-x${dashed30}`, { "0": "a", "1": dashed30 }],
      ["pathname", "/**/x/*", `/a/x/${segments30}`, { "0": "a", "1": segments30 }],
      ["pathname", "/*+/x/*", `/a/x/${segments30}`, { "0": "a", "1": segments30 }],
      ["pathname", "{/*.}+x/*", `/a.x/${dotted30}`, { "0": "a", "1": dotted30 }],
    ])("%s %s matches after the wildcard gives back 30 characters", (component, pattern, input, groups) => {
      expect(new URLPattern({ [component]: pattern }).exec({ [component]: input })?.[component]).toEqual({
        input,
        groups,
      });
    });

    test("a URL string matches after each wildcard gives back 30 characters", () => {
      const result = new URLPattern("https://:sub+-:rest.example.com/**/x/*").exec(
        `https://a-${b30}.example.com/a/x/${segments30}`,
      );
      expect({ hostname: result?.hostname.groups, pathname: result?.pathname.groups }).toEqual({
        hostname: { sub: "a", rest: b30 },
        pathname: { "0": "a", "1": segments30 },
      });
    });

    // The spec's `((?:[^]+?)+)` runs one repeat of the outer group for each character. The matcher gives up on that
    // between one and two million repeats, and reports no match.
    test("a repeated named group matches two million characters", () => {
      const input = Buffer.alloc(2_000_000, "a").toString();
      expect(new URLPattern({ search: ":a+" }).exec({ search: input })?.search.groups.a === input).toBe(true);
    });

    // Not fixed: a repeated named group whose prefix and suffix have no delimiter. `[^]+?` also matches the `-`, so the
    // spec's regexp has about 2^30 splits here too, and exec() returns null after about 1 s. No single quantifier has
    // the match order of this regexp. https://github.com/oven-sh/bun/issues/42603
    const dashB30 = Buffer.alloc(60, "-b").toString();
    test.todo.each<[component: Component, pattern: string, input: string, groups: Record<string, string>]>([
      ["search", "{-:x}+-_:r", `-a-_${dashB30}`, { x: "a", r: dashB30 }],
      ["search", "{-:x}*-_:r", `-a-_${dashB30}`, { x: "a", r: dashB30 }],
    ])("%s %s matches after the repeat gives back 30 repeats", (component, pattern, input, groups) => {
      expect(new URLPattern({ [component]: pattern }).exec({ [component]: input })?.[component]).toEqual({
        input,
        groups,
      });
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
});
