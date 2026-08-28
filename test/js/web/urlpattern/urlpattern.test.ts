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

  // For a non-special scheme, the pathname is canonicalized by parsing it as the path of a host-less dummy URL and
  // reading the pathname back, so a first segment starting with "." must survive that round trip (see the URL tests
  // for the "/." guard that a host-less URL serializes in front of a path starting with "//").
  describe("non-special scheme with a pathname whose first segment starts with a dot", () => {
    test("constructor string with a host", () => {
      const pattern = new URLPattern("myapp://host/.well-known/:file");
      expect(pattern.pathname).toBe("/.well-known/:file");
      expect(pattern.test("myapp://host/.well-known/assetlinks.json")).toBe(true);
      expect(pattern.exec("myapp://host/.well-known/assetlinks.json")!.pathname).toEqual({
        input: "/.well-known/assetlinks.json",
        groups: { file: "assetlinks.json" },
      });
      expect(pattern.test("myapp://host/well-known/assetlinks.json")).toBe(false);
    });

    test("wildcard after the dotted segment", () => {
      const pattern = new URLPattern("git://h/.git/:rest*");
      expect(pattern.pathname).toBe("/.git/:rest*");
      expect(pattern.test("git://h/.git/config")).toBe(true);
      expect(pattern.exec("git://h/.git/refs/heads/main")!.pathname.groups).toEqual({ rest: "refs/heads/main" });
    });

    test("URLPatternInit", () => {
      expect({
        wellKnown: new URLPattern({ protocol: "myapp", pathname: "/.well-known/*" }).pathname,
        doubleDot: new URLPattern({ protocol: "myapp", pathname: "/..a" }).pathname,
        dotSlashSlash: new URLPattern({ protocol: "myapp", pathname: "/.//a" }).pathname,
        laterSegment: new URLPattern({ protocol: "myapp", pathname: "/x/.a" }).pathname,
      }).toEqual({
        wellKnown: "/.well-known/*",
        doubleDot: "/..a",
        dotSlashSlash: "//a",
        laterSegment: "/x/.a",
      });
      const pattern = new URLPattern({ protocol: "foo", pathname: "/.a" });
      expect(pattern.test("foo:/.a")).toBe(true);
      expect(pattern.test("foo://h/.a")).toBe(true);
      expect(pattern.test({ protocol: "foo", pathname: "/.a" })).toBe(true);
      expect(pattern.test("foo:/a")).toBe(false);
    });

    test("baseURL", () => {
      expect({
        relativeString: new URLPattern("./c", "foo://h/.a/b").pathname,
        relativeInit: new URLPattern({ pathname: "c", baseURL: "foo:/.a/b" }).pathname,
        inheritedFromBase: new URLPattern({ baseURL: "foo:/.a/b" }).pathname,
      }).toEqual({
        relativeString: "/.a/c",
        relativeInit: "/.a/c",
        inheritedFromBase: "/.a/b",
      });
    });

    test("the matched input reports the full pathname", () => {
      expect(new URLPattern({ protocol: "foo" }).exec("foo:/.a/b")!.pathname).toEqual({
        input: "/.a/b",
        groups: { "0": "/.a/b" },
      });
    });

    test("unaffected patterns", () => {
      expect({
        special: new URLPattern("https://h/.well-known/:file").pathname,
        noProtocol: new URLPattern({ pathname: "/.well-known/*" }).pathname,
        hostAndLaterSegment: new URLPattern("foo://h/x/.b").pathname,
      }).toEqual({
        special: "/.well-known/:file",
        noProtocol: "/.well-known/*",
        hostAndLaterSegment: "/x/.b",
      });
      expect(new URLPattern("https://h/.well-known/:file").test("https://h/.well-known/x")).toBe(true);
      expect(new URLPattern("foo://h/x/.b").test("foo://h/x/.b")).toBe(true);
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
