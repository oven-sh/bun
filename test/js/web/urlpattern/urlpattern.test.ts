// Test data from Web Platform Tests
// https://github.com/web-platform-tests/wpt/blob/master/LICENSE.md
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

  // The RegExp engine abandons a search that takes too many steps or too much backtracking memory.
  // That is not "no match": exec() returned null and test() returned false for input that matches.
  describe("a component whose RegExp search is abandoned", () => {
    const limitError = "RangeError: Regular expression backtracking limit exceeded";
    const memoryError = "RangeError: Maximum call stack size exceeded.";

    // Runs `body`, which logs one JSON value, in a process with the given engine options.
    async function run(env: Record<string, string>, body: string) {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const outcome = run => {
              try {
                return { value: run() };
              } catch (e) {
                return { threw: e.name + ": " + e.message };
              }
            };
            ${body}
          `,
        ],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { result: stdout.trim() ? JSON.parse(stdout) : undefined, stderr, exitCode };
    }

    test("exec() throws at the default limit", () => {
      const pattern = new URLPattern({ pathname: "/((?:a|aa)+b|a+c)" });
      expect(() => pattern.exec({ pathname: "/" + Buffer.alloc(37, "a").toString() + "c" })).toThrow(
        new RangeError("Regular expression backtracking limit exceeded"),
      );
      expect(pattern.exec({ pathname: "/aac" })?.pathname.groups).toEqual({ "0": "aac" });
    });

    test.concurrent("exec(), test() and the constructor throw at a lowered limit", async () => {
      const ran = await run(
        { BUN_JSC_regExpMatchLimit: "1000" },
        `
          const pattern = new URLPattern({ pathname: "/((?:a|aa)+b|a+c)" });
          const long = "/" + Buffer.alloc(37, "a").toString() + "c";
          // The constructor runs the protocol's RegExp on "https" and the other special schemes.
          // This many nested groups take more than 1,000 steps to fail on five characters.
          const nested = depth => "(" + "(?:".repeat(depth) + "[a-z]+" + ")+".repeat(depth) + "x|https)";
          console.log(JSON.stringify({
            exec: outcome(() => pattern.exec({ pathname: long })),
            test: outcome(() => pattern.test({ pathname: long })),
            execString: outcome(() => pattern.exec("https://example.com" + long)),
            short: outcome(() => pattern.test({ pathname: "/aac" })),
            constructor: outcome(() => new URLPattern({ protocol: nested(6), pathname: "/x" }).protocol),
            constructorString: outcome(() => new URLPattern(nested(6) + "://example.com/x").protocol),
            constructorUnderLimit: outcome(() => new URLPattern({ protocol: nested(1), pathname: "/x" }).test("https://example.com/x")),
          }));
        `,
      );
      expect(ran).toEqual({
        result: {
          exec: { threw: limitError },
          test: { threw: limitError },
          execString: { threw: limitError },
          short: { value: true },
          constructor: { threw: limitError },
          constructorString: { threw: limitError },
          constructorUnderLimit: { value: true },
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // The interpreter keeps one context for each iteration of the group in a pool, here of 1 MB.
    test.concurrent("exec() and test() throw when the backtracking memory runs out", async () => {
      const ran = await run(
        { BUN_JSC_useRegExpJIT: "0", BUN_JSC_maxRegExpStackSize: "1048576" },
        `
          const pattern = new URLPattern({ pathname: "/((?:a|b)+)" });
          const path = count => "/" + Buffer.alloc(count, "a").toString();
          console.log(JSON.stringify({
            fits: outcome(() => pattern.exec({ pathname: path(5000) }).pathname.groups[0].length),
            exec: outcome(() => pattern.exec({ pathname: path(20000) })),
            test: outcome(() => pattern.test({ pathname: path(20000) })),
            execString: outcome(() => pattern.exec("https://example.com" + path(20000))),
          }));
        `,
      );
      expect(ran).toEqual({
        result: {
          fits: { value: 5000 },
          exec: { threw: memoryError },
          test: { threw: memoryError },
          execString: { threw: memoryError },
        },
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
