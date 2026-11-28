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

    // https://urlpattern.spec.whatwg.org/#canonicalize-a-port parses a port in the port state of the URL parser. The
    // parser removes tab and newline first, and the parse fails when no digit is left. Chrome gives these results too.
    // Node.js and Deno take such a port as the empty string.
    test("a port piece of only tab or newline is not a port", () => {
      const portOf = (input: string | { port: string }, baseURL?: string) => {
        try {
          return (baseURL === undefined ? new URLPattern(input) : new URLPattern(input, baseURL)).port;
        } catch (error) {
          return String(error);
        }
      };
      const refused = [{ port: "\t\n" }, { port: "*\n" }, { port: "\t:id" }, "http://localhost:*\r", "https://h:\n/p"];
      expect(refused.map(input => portOf(input))).toEqual(
        refused.map(() => "TypeError: Invalid input to canonicalize a URL port string."),
      );
      expect(new URLPattern({ port: "*" }).test({ port: "\r" })).toBe(false);
      expect(new URLPattern({ port: "" }).test({ port: "\t" })).toBe(false);

      // Digits with tab or newline around them are a port. A URL string is parsed whole, and there an empty port is no port.
      expect(portOf("http://localhost:3000\r\n")).toBe("3000");
      expect(portOf({ port: "8\t0" })).toBe("80");
      expect(portOf("/p", "https://h:\n/")).toBe("");
      expect(new URLPattern({ port: "" }).test("https://h:\t/")).toBe(true);
    });
  });

  describe("bindings", () => {
    const outcome = (run: () => unknown) => {
      try {
        return run();
      } catch (error: any) {
        return `${error.name}: ${error.message}`;
      }
    };
    const construct = (...args: unknown[]): URLPattern => Reflect.construct(URLPattern, args);

    test("the number of arguments chooses the constructor, then the kind of the second", () => {
      const relative = "TypeError: Relative constructor string must have additional baseURL argument.";
      const invalid = "TypeError: Invalid baseURL.";
      expect(
        [
          ["/a"],
          ["/a", undefined],
          ["/a", null],
          ["/a", new URL("https://example.com")],
          ["/a", "https://example.com"],
          ["/a", 1],
          ["/a", Symbol.iterator],
          ["/a", undefined, undefined],
          ["/a", new URL("https://example.com"), undefined],
          ["/a", "https://example.com", 1],
          [{}, "https://example.com"],
          [undefined, "https://example.com"],
        ].map(args => outcome(() => construct(...args).hostname)),
      ).toEqual([
        relative,
        relative,
        relative,
        relative,
        "example.com",
        invalid,
        "TypeError: Cannot convert a Symbol value to a string",
        invalid,
        "example.com",
        "TypeError: Type error",
        "TypeError: Constructor with a URLPatternInit should have a null baseURL argument.",
        "TypeError: Constructor with a URLPatternInit should have a null baseURL argument.",
      ]);
    });

    test("members refuse another receiver", () => {
      const { test, exec } = URLPattern.prototype;
      expect([
        outcome(() => test.call({})),
        outcome(() => exec.call(URLPattern.prototype)),
        outcome(() => Reflect.get(URLPattern.prototype, "pathname", {})),
        outcome(() => (URLPattern as any)()),
      ]).toEqual([
        "TypeError: Can only call URLPattern.test on instances of URLPattern",
        "TypeError: Can only call URLPattern.exec on instances of URLPattern",
        "TypeError: The URLPattern.pathname getter can only be used on instances of URLPattern",
        "TypeError: Use `new URLPattern(...)` instead of `URLPattern(...)`",
      ]);
    });

    test("an init is read in alphabetical order, Object.prototype included", () => {
      const reads: PropertyKey[] = [];
      construct(new Proxy({}, { get: (_, key) => void reads.push(key) }));
      expect(reads.join()).toBe("baseURL,hash,hostname,password,pathname,port,protocol,search,username");

      let hash: string;
      (Object.prototype as any).hash = "inherited";
      try {
        hash = construct([]).hash;
      } finally {
        delete (Object.prototype as any).hash;
      }
      expect(hash).toBe("inherited");
    });

    test("an unpaired surrogate becomes U+FFFD", () => {
      const result = new URLPattern({ hash: "\ud800" }).exec({ hash: "\udc00" })!;
      expect({ inputs: result.inputs, hash: result.hash }).toEqual({
        inputs: [{ hash: "\ufffd" }],
        hash: { input: "%EF%BF%BD", groups: {} },
      });
    });

    test("the keys of a result are in order", () => {
      const result = new URLPattern({ pathname: "/:b/(x)/:a/*" }).exec({ search: "q", pathname: "/1/x/2/3" })!;
      expect([result, result.inputs[0], result.pathname, result.pathname.groups].map(Object.keys).join(" ")).toBe(
        "inputs,protocol,username,password,hostname,port,pathname,search,hash pathname,search input,groups 0,1,b,a",
      );
    });

    test("a group can have any name, and a regular expression can add groups", () => {
      const groups = (hash: string, input: string) =>
        Object.entries(new URLPattern({ hash }).exec({ hash: input })!.hash.groups);
      expect(groups(":__proto__-:\u540d\u524d-:\u{20000}", "1-2-3")).toEqual([
        ["__proto__", "1"],
        ["\u540d\u524d", "2"],
        ["\u{20000}", "3"],
      ]);
      expect(groups(":a((?<x>1)(?<y>2))", "12")).toEqual([
        ["a", "12"],
        ["", "2"],
      ]);
      expect(groups(":a?-:b", "-1")).toEqual([
        ["a", undefined],
        ["b", "1"],
      ]);
    });

    test("more groups and longer text than fit on the stack", () => {
      const indexes = Array.from({ length: 100 }, (_, index) => index);
      const pathname = indexes.map(index => `/segment${index}/:name${index}`).join("");
      const pattern = new URLPattern({ pathname });
      expect(pattern.pathname).toBe(pathname);
      expect(pattern.exec({ pathname: pathname.replaceAll(":name", "") })!.pathname.groups).toEqual(
        Object.fromEntries(indexes.map(index => [`name${index}`, String(index)])),
      );
    });

    test("a 16-bit string of ASCII is as good as an 8-bit one", () => {
      const wide = (text: string) => Buffer.from(text, "utf16le").toString("utf16le");
      const [pattern, base] = ["posts/:id(\\d+)\\?q=*#:hash", "https://example.com:8443/a(b)/index"];
      const url = "https://user:pass@example.com:8443/a(b)/posts/12?q=x#y";
      const expected = new URLPattern(pattern, base);
      const actual = new URLPattern(wide(pattern), wide(base));
      expect(kComponents.map(component => actual[component])).toEqual(
        kComponents.map(component => expected[component]),
      );
      expect(expected.exec(url)).not.toBeNull();
      expect(actual.exec(wide(url))).toEqual(expected.exec(url));
    });

    test("a pattern keeps its regular expressions alive", () => {
      class Subclass extends URLPattern {}
      const patterns = Array.from({ length: 20 }, (_, index) => {
        const init = Object.fromEntries(kComponents.map(component => [component, `(${index}|${component})`]));
        return new (index % 2 ? Subclass : URLPattern)(init);
      });
      Bun.gc(true);
      // A regular expression that was collected leaves its cell to one of these.
      for (let index = 0; index < 500; index++) new RegExp(`other${index}`).test("");
      expect(
        patterns.map((pattern, index) => {
          const number = String(index);
          const init = Object.fromEntries(kComponents.map(component => [component, number]));
          return pattern.test({ ...init, protocol: "protocol", hostname: "hostname" });
        }),
      ).toEqual(patterns.map(() => true));
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

  test.each([
    [String.raw`[[\:\:1]]\:80/`, String.raw`[[\:\:1]]`, "80", "/", "*", "*"],
    [String.raw`[[\:\:1]\:80/`, String.raw`[[\:\:1]\:80`, "", "/", "*", "*"],
    [String.raw`[\:\:1]]\:80/`, String.raw`[\:\:1]]`, "80", "/", "*", "*"],
    [String.raw`[\:\:1/foo`, String.raw`[\:\:1`, "", "/foo", "*", "*"],
    [String.raw`[\:\:1?q`, String.raw`[\:\:1`, "", "/", "q", "*"],
    [String.raw`[\:\:1#h`, String.raw`[\:\:1`, "", "/", "", "h"],
  ])("brackets in the hostname of https://%s", (text, ...expected) => {
    const { hostname, port, pathname, search, hash } = new URLPattern(`https://${text}`);
    expect([hostname, port, pathname, search, hash]).toEqual(expected);
  });

  test("a timeout ends the search for the protocol of a constructor string", async () => {
    // What is before each `:` is compiled, and is no protocol. To try them all takes minutes.
    const script = String.raw`
      const input = Buffer.alloc(3 * 100_000, "!\\:").toString();
      try {
        require("node:vm").runInNewContext("new URLPattern(input)", { URLPattern, input }, { timeout: 50 });
      } catch (error) {
        console.log(error.code);
      }`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "ERR_SCRIPT_EXECUTION_TIMEOUT\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
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
