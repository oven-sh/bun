// Test data from Web Platform Tests
// https://github.com/web-platform-tests/wpt/blob/master/LICENSE.md
import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { totalmem } from "node:os";
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
});

// URLPattern builds a pattern string, a regular expression and a canonical URL
// from input the caller sizes. Escaping adds a character per escaped character,
// and the base path is joined onto a relative pathname, so an input below the
// 2147483647 character string limit produces a result above it. Every one of
// those must throw a catchable error, not abort.
//
// setSyntheticAllocationLimitForTesting lowers the limit the code checks, which
// reaches each site with kilobytes instead of gigabytes.
describe("string above the synthetic string length limit", () => {
  const limit = 1024 * 1024;
  const long = "x".repeat(limit);

  function withLimit(fn: () => void) {
    const previousLimit = setSyntheticAllocationLimitForTesting(limit);
    try {
      expect(fn).toThrow(new RangeError("Out of memory"));
    } finally {
      setSyntheticAllocationLimitForTesting(previousLimit);
    }
  }

  test("a base path that escapes past the limit", () => {
    const escapes = "(".repeat(limit / 2 + 16);
    withLimit(() => new URLPattern({ baseURL: "https://e.com/" + escapes }));
  });

  test("a base path joined with a relative pathname past the limit", () => {
    withLimit(() => new URLPattern({ pathname: long, baseURL: "https://e.com/" + long + "/" }));
  });

  test("a generated regular expression past the limit", () => {
    // The group's value is repeated in the regexp, so half the limit is enough.
    withLimit(() => new URLPattern({ pathname: "{a(" + "x".repeat(limit / 2 + 16) + ")b}*" }));
  });

  // match() turns a URLPatternInit it cannot process into no match, per the
  // spec, so these report the failure as false and null instead of throwing.
  function noMatch(fn: () => unknown, expected: unknown) {
    const previousLimit = setSyntheticAllocationLimitForTesting(limit);
    try {
      expect(fn()).toEqual(expected);
    } finally {
      setSyntheticAllocationLimitForTesting(previousLimit);
    }
  }

  test("a protocol that canonicalizes past the limit", () => {
    const pattern = new URLPattern({ protocol: "*" });
    noMatch(() => pattern.test({ protocol: long }), false);
    noMatch(() => pattern.exec({ protocol: long }), null);
  });

  test("a pathname that canonicalizes past the limit", () => {
    const pattern = new URLPattern({ pathname: "*" });
    noMatch(() => pattern.test({ pathname: long }), false);
  });

  test("an opaque pathname that canonicalizes past the limit", () => {
    const pattern = new URLPattern({ pathname: "*" });
    noMatch(() => pattern.test({ protocol: "data", pathname: long }), false);
  });
});

// The same two sites at the real limit, which no synthetic limit can stand in for.
describe("pattern string above the string length limit", () => {
  async function run(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  const threw = { stdout: "RangeError Out of memory", stderr: "", exitCode: 0 };

  // The child holds a 2.1 GB pathname. repeat() is faster than Buffer.alloc().toString()
  // at this size even in a debug build, and it needs half the memory.
  test.skipIf(totalmem() < 8 * 1024 ** 3)(
    "the base path joined with a relative pathname throws",
    async () => {
      expect(
        await run(`
          const basePath = "/" + "x".repeat(1 << 20) + "/";
          const pathname = "b".repeat(2 ** 31 - (1 << 19));
          try {
            new URLPattern({ pathname, baseURL: "https://e.com" + basePath });
            console.log("no error");
          } catch (e) {
            console.log(e.name, e.message);
          }
        `),
      ).toEqual(threw);
    },
    60_000,
  );

  // The child commits about 6 GB, and escaping 2^30 characters takes minutes in
  // a debug or ASAN build.
  test.skipIf(isDebug || isASAN || totalmem() < 16 * 1024 ** 3)(
    "a base path that escapes past the limit throws",
    async () => {
      expect(
        await run(`
          const path = "(".repeat(2 ** 30 + 16);
          try {
            new URLPattern({ baseURL: "https://e.com/" + path });
            console.log("no error");
          } catch (e) {
            console.log(e.name, e.message);
          }
        `),
      ).toEqual(threw);
    },
    120_000,
  );
});
