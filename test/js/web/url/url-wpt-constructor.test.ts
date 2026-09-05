// WPT url/url-constructor.any.js over the vendored urltestdata.json: every non-failure entry must produce the expected
// href and components, every failure entry must throw and fail URL.canParse().
//
// The fixture is a flat array. A string entry is a section label, the objects after it belong to that section.
// One bun:test test runs per section (one test per entry spent most of the wall time in runner overhead).
// A failing test lists every mismatching entry of its section, with the input and base, so nothing is hidden.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Entry = {
  input: string;
  base?: string | null;
  href?: string;
  failure?: boolean;
  origin?: string;
  protocol?: string;
  username?: string;
  password?: string;
  host?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  searchParams?: string;
};

type Section = { label: string; entries: Entry[] };

const fixture = join(import.meta.dir, "../../node/test/fixtures/wpt/url/resources/urltestdata.json");
const sections: Section[] = [];
let entryCount = 0;
for (const item of JSON.parse(readFileSync(fixture, "utf8")) as (Entry | string)[]) {
  if (typeof item === "string") {
    sections.push({ label: item, entries: [] });
    continue;
  }
  if (sections.length === 0) sections.push({ label: "(no section)", entries: [] });
  sections[sections.length - 1].entries.push(item);
  entryCount++;
}

// url.origin for these does not match the spec yet (parsing does); tracked separately from the parser.
// The test asserts that each one still deviates, so a fix shows up here and the input gets removed from the list.
const knownOriginDeviations = new Set([
  "ftps:/example.com/",
  "ftps:example.com/",
  "blob:ftp://host/path",
  "blob:ws://example.org/",
  "blob:wss://example.org/",
]);

const componentKeys = [
  "href",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
] as const;

function construct(entry: Entry) {
  return entry.base != null ? new URL(entry.input, entry.base) : new URL(entry.input);
}

function canParse(entry: Entry) {
  return entry.base != null ? URL.canParse(entry.input, entry.base) : URL.canParse(entry.input);
}

type Mismatch = { input: string; base: string | null; expected: unknown; actual: unknown };

// Returns the mismatch for one entry, or null when the entry matches the fixture.
function check(entry: Entry): Mismatch | null {
  const mismatch = (expected: unknown, actual: unknown): Mismatch => ({
    input: entry.input,
    base: entry.base ?? null,
    expected,
    actual,
  });

  if (entry.failure) {
    let thrown: unknown = null;
    try {
      construct(entry);
    } catch (error) {
      thrown = error;
    }
    const expected = { throws: "TypeError", canParse: false };
    const actual = { throws: thrown instanceof TypeError ? "TypeError" : String(thrown), canParse: canParse(entry) };
    return Bun.deepEquals(actual, expected) ? null : mismatch(expected, actual);
  }

  let url: URL;
  try {
    url = construct(entry);
  } catch (error) {
    return mismatch({ href: entry.href }, { throws: String(error) });
  }

  const expected: Record<string, string | boolean> = {};
  const actual: Record<string, string | boolean> = {};
  for (const key of componentKeys) {
    expected[key] = entry[key]!;
    actual[key] = url[key];
  }
  expected.canParse = true;
  actual.canParse = canParse(entry);
  if (entry.searchParams !== undefined) {
    expected.searchParams = entry.searchParams;
    actual.searchParams = url.searchParams.toString();
  }
  if (entry.origin !== undefined) {
    if (knownOriginDeviations.has(entry.input)) {
      expected.originStillDeviates = true;
      actual.originStillDeviates = url.origin !== entry.origin;
    } else {
      expected.origin = entry.origin;
      actual.origin = url.origin;
    }
  }

  return Bun.deepEquals(actual, expected) ? null : mismatch(expected, actual);
}

describe("WPT url-constructor", () => {
  test("fixture is present", () => {
    expect(entryCount).toBeGreaterThan(800);
    expect(sections.length).toBeGreaterThan(100);
  });

  for (const [index, section] of sections.entries()) {
    if (section.entries.length === 0) continue;
    test(`section ${index}: ${section.label} (${section.entries.length} entries)`, () => {
      const mismatches: Mismatch[] = [];
      for (const entry of section.entries) {
        const mismatch = check(entry);
        if (mismatch) mismatches.push(mismatch);
      }
      expect(mismatches).toEqual([]);
    });
  }
});
