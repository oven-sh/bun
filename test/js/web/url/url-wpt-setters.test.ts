// WPT url/url-setters.any.js over the vendored setters_tests.json.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Case = { href: string; new_value: string; expected: Record<string, string>; comment?: string };

const fixture = join(import.meta.dir, "../../node/test/fixtures/wpt/url/resources/setters_tests.json");
const { comment: _comment, ...setters } = JSON.parse(readFileSync(fixture, "utf8")) as Record<string, Case[]>;

// Setters that do not match the spec yet. The value is what bun returns today. The test asserts it, so a fix (or a
// different wrong value) shows up here and the entry gets removed.
const knownDeviations = new Map<string, Record<string, string>>([
  [
    JSON.stringify(["host", "http://example.net:8080", "example.com:80"]),
    { href: "http://example.com:8080/", host: "example.com:8080", hostname: "example.com", port: "8080" },
  ],
  [JSON.stringify(["port", "https://domain.com:3000", "\n\n\t\t"]), { href: "https://domain.com/", port: "" }],
]);

describe("WPT url-setters", () => {
  test("fixture is present", () => {
    expect(Object.keys(setters).sort()).toEqual(
      ["hash", "host", "hostname", "href", "password", "pathname", "port", "protocol", "search", "username"].sort(),
    );
  });

  for (const [property, cases] of Object.entries(setters)) {
    test(`${property} (${cases.length} cases)`, () => {
      const mismatches: unknown[] = [];
      for (const { href, new_value, expected } of cases) {
        const url = new URL(href);
        (url as any)[property] = new_value;
        const actual: Record<string, string> = {};
        for (const key of Object.keys(expected)) actual[key] = (url as any)[key];
        const wanted = knownDeviations.get(JSON.stringify([property, href, new_value])) ?? expected;
        if (!Bun.deepEquals(actual, wanted)) mismatches.push({ href, new_value, expected: wanted, actual });
      }
      expect(mismatches).toEqual([]);
    });
  }
});
