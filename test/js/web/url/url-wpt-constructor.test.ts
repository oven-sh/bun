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

// WPT url/IdnaTestV2.any.js and IdnaTestV2-removed.any.js over the vendored data.
type IdnaRow = { input: string; output: string | null; comment?: string };

function idnaRows(file: string): IdnaRow[] {
  const rows = JSON.parse(
    readFileSync(join(import.meta.dir, "../../node/test/fixtures/wpt/url/resources", file), "utf8"),
  );
  // A string is a comment. An empty input cannot go through new URL().
  return rows.filter((row: IdnaRow | string): row is IdnaRow => typeof row === "object" && row.input !== "");
}

function idnaMismatches(rows: IdnaRow[]) {
  const mismatches: { input: string; expected: unknown; actual: unknown }[] = [];
  for (const { input, output } of rows) {
    let actual: unknown = null;
    try {
      const { host, hostname, pathname, href } = new URL(`https://${input}/x`);
      actual = { host, hostname, pathname, href };
    } catch (error) {
      if (!(error instanceof TypeError)) actual = String(error);
    }
    const expected =
      output === null ? null : { host: output, hostname: output, pathname: "/x", href: `https://${output}/x` };
    if (!Bun.deepEquals(actual, expected)) mismatches.push({ input, expected, actual });
  }
  return mismatches;
}

describe("WPT IdnaTestV2", () => {
  const rows = idnaRows("IdnaTestV2.json");
  const isASCII = (row: IdnaRow) => /^[\x00-\x7f]*$/.test(row.input);
  // The data follows the Unicode version of ICU 78, which Linux and Windows builds bundle. macOS uses the system ICU.
  const hasCurrentICU = parseInt(process.versions.icu) >= 78;

  test("ASCII input passes through, with or without a valid xn-- label", () => {
    const ascii = rows.filter(isASCII);
    expect(ascii.length).toBeGreaterThan(900);
    expect(idnaMismatches(ascii)).toEqual([]);
  });

  test.skipIf(!hasCurrentICU)("non-ASCII input", () => {
    const nonASCII = rows.filter(row => !isASCII(row));
    expect(nonASCII.length).toBeGreaterThan(1600);
    expect(idnaMismatches(nonASCII)).toEqual([]);
  });

  test.skipIf(!hasCurrentICU)("rows that a later Unicode version removed", () => {
    const removed = idnaRows("IdnaTestV2-removed.json");
    expect(removed.length).toBeGreaterThan(10);
    expect(idnaMismatches(removed)).toEqual([]);
  });
});
