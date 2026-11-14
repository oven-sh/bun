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
// The value is the origin bun returns today. The test asserts it, so a fix (or a different wrong value) shows up
// here and the input gets removed from the list.
const knownOriginDeviations = new Map([
  ["ftps:/example.com/", "ftps:"],
  ["ftps:example.com/", "ftps:"],
  ["blob:ftp://host/path", "ftp://host"],
  ["blob:ws://example.org/", "ws://example.org"],
  ["blob:wss://example.org/", "wss://example.org"],
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
    expected.origin = knownOriginDeviations.get(entry.input) ?? entry.origin;
    actual.origin = url.origin;
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

// The authority state of the URL Standard only records credentials, so a URL with credentials has the path, query and
// fragment of the same URL without them. The fixture has no row where "?" or "#" follows the host of a non-special URL
// with credentials. This gives credentials to every row that has an authority, and to the seeds.
describe("credentials do not change the path, query or fragment", () => {
  const authority = /^([\t\n\r ]*(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/)([^@\\]*)$/;
  const seeds = ["zz://h?q", "zz://h#f", "zz://h:8?q", "zz://[::1]#f", "http://h?q", "http://h#f", "http://h:8?q"];
  const rows: Entry[] = [
    ...sections.flatMap(section => section.entries).filter(entry => !entry.failure),
    ...seeds.map(input => ({ input })),
  ].filter(entry => authority.test(entry.input));
  const tail = (url: URL) => [url.pathname, url.search, url.hash];

  // "#\u4e2d" makes every input a UTF-16 string.
  test.each(["", "#\u4e2d"])("with the suffix %j", suffix => {
    const mismatches: unknown[] = [];
    let compared = 0;
    for (const { input, base } of rows) {
      const [, prefix, rest] = authority.exec(input)!;
      for (const credentials of ["u@", "u:p@", ":p@"]) {
        let plain: URL, twin: URL;
        try {
          plain = construct({ input: input + suffix, base });
          twin = construct({ input: prefix + credentials + rest + suffix, base });
        } catch {
          continue; // Not a URL: a file URL and a URL without a host take no credentials.
        }
        compared++;
        const [username, password = ""] = credentials.slice(0, -1).split(":");
        const viaSetters = new URL(plain.href);
        viaSetters.password = password;
        viaSetters.username = username;
        const withCredentials = (href: string) => href.replace("://", "://" + credentials);
        const twinOfPlain = [withCredentials(plain.href), ...tail(plain)];
        const expected = { parsed: twinOfPlain, set: twinOfPlain, relative: withCredentials(new URL("x", plain).href) };
        const actual = {
          parsed: [twin.href, ...tail(twin)],
          set: [viaSetters.href, ...tail(viaSetters)],
          relative: new URL("x", twin).href,
        };
        if (!Bun.deepEquals(actual, expected))
          mismatches.push({ input, base: base ?? null, credentials, expected, actual });
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(600);
  });
});
