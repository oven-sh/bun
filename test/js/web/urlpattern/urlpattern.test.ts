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

  // With a non-special protocol, a dictionary or pattern pathname is canonicalized by parsing it
  // behind a dummy scheme. A value that starts with "/" takes the URL parser's path state there, like
  // the pathname of "foo://h/b", so it has to be parsed behind a host as well: otherwise a leading
  // "//" is read as an authority and a leading "/." is dropped.
  describe("non-special protocol pathname canonicalization", () => {
    test("dictionary input keeps a pathname that starts with //", () => {
      const any = new URLPattern({ pathname: "*" });
      expect(any.exec({ protocol: "foo", pathname: "//a" })!.pathname.input).toBe("//a");
      expect(any.exec({ pathname: "//a", baseURL: "about:blank" })!.pathname.input).toBe("//a");
      // The URL parser removes tabs and newlines before it looks at the first character.
      expect(any.exec({ protocol: "foo", pathname: "\t//a" })!.pathname.input).toBe("//a");
      // The string form of the same URL already reported "//a".
      expect(any.exec("foo://h//a")!.pathname.input).toBe("//a");
    });

    test("dictionary and string forms of the same URL match alike", () => {
      const pattern = new URLPattern({ pathname: "/{/*}+" });
      expect(pattern.test({ protocol: "foo", hostname: "[::1]", port: "8080", pathname: "//a/b/c" })).toBe(true);
      expect(pattern.test("foo://[::1]:8080//a/b/c")).toBe(true);
    });

    test("constructor string keeps // in the pathname", () => {
      const pattern = new URLPattern("foo://h//:x");
      expect(pattern.pathname).toBe("//:x");
      expect(pattern.exec("foo://h//y")!.pathname).toEqual({ input: "//y", groups: { x: "y" } });
      expect(pattern.test("foo://h/y")).toBe(false);
      expect(new URLPattern("foo://h/:a//:b").exec("foo://h/x//y")!.pathname.groups).toEqual({ a: "x", b: "y" });
    });

    test("a first segment that starts with a dot is kept", () => {
      const pattern = new URLPattern("myapp://host/.well-known/:file");
      expect(pattern.pathname).toBe("/.well-known/:file");
      expect(pattern.exec("myapp://host/.well-known/assetlinks.json")!.pathname).toEqual({
        input: "/.well-known/assetlinks.json",
        groups: { file: "assetlinks.json" },
      });
      expect(new URLPattern({ protocol: "foo", pathname: "/.a" }).pathname).toBe("/.a");
      expect(new URLPattern({ protocol: "foo", pathname: "/..a" }).pathname).toBe("/..a");
      // "/." is a single-dot segment here, so only "//a" is left.
      expect(new URLPattern({ protocol: "foo", pathname: "/.//a" }).pathname).toBe("//a");
    });

    test("a pathname that starts with / is canonicalized like the same pathname in a URL string", () => {
      const any = new URLPattern({ pathname: "*" });
      expect(any.exec({ protocol: "foo", pathname: "/z/../a" })!.pathname.input).toBe("/a");
      expect(any.exec("foo://h/z/../a")!.pathname.input).toBe("/a");
      expect(any.exec({ protocol: "foo", pathname: "/a b/{c}/\\/caf\u00e9" })!.pathname.input).toBe(
        "/a%20b/%7Bc%7D/\\/caf%C3%A9",
      );
      expect(any.exec("foo://h/a b/{c}/\\/caf\u00e9")!.pathname.input).toBe("/a%20b/%7Bc%7D/\\/caf%C3%A9");
      expect(new URLPattern({ protocol: "vscode", pathname: "/a b" }).test("vscode://ext/a b")).toBe(true);
      expect(new URLPattern("./c", "app://h/a/b").pathname).toBe("/a/c");
      expect(new URLPattern("./c", "app://h/a/b").test("app://h/a/c")).toBe(true);
      expect(new URLPattern("../c", "app://h/a/b/").test("app://h/a/c")).toBe(true);
    });

    test("a pathname that does not start with / stays opaque", () => {
      const any = new URLPattern({ pathname: "*" });
      expect(any.exec({ protocol: "foo", pathname: "z/../a b" })!.pathname.input).toBe("z/../a b");
      expect(any.exec({ protocol: "data", pathname: "text/plain,a b" })!.pathname.input).toBe("text/plain,a b");
      expect(new URLPattern("mailto\\::user@:host").exec("mailto:me@example.com")!.pathname.groups).toEqual({
        user: "me",
        host: "example.com",
      });
    });

    test("special schemes and protocol-less dictionaries are unchanged", () => {
      const any = new URLPattern({ pathname: "*" });
      expect(any.exec({ pathname: "//a" })!.pathname.input).toBe("//a");
      expect(any.exec({ pathname: "/z/../a" })!.pathname.input).toBe("/a");
      expect(any.exec({ protocol: "https", pathname: "/z/../a" })!.pathname.input).toBe("/a");
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
