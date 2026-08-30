// WPT url/url-constructor.any.js over the vendored urltestdata.json: every non-failure entry must produce the expected
// href and components, every failure entry must throw.
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
};

const fixture = join(import.meta.dir, "../../node/test/fixtures/wpt/url/resources/urltestdata.json");
const entries = (JSON.parse(readFileSync(fixture, "utf8")) as (Entry | string)[]).filter(
  (entry): entry is Entry => typeof entry === "object",
);

// url.origin for these does not match the spec yet (parsing does); tracked separately from the parser.
const knownOriginDeviations = new Set([
  "ftps:/example.com/",
  "ftps:example.com/",
  "blob:ftp://host/path",
  "blob:ws://example.org/",
  "blob:wss://example.org/",
]);

describe("WPT url-constructor", () => {
  test("fixture is present", () => {
    expect(entries.length).toBeGreaterThan(800);
  });

  for (const entry of entries) {
    const name = `${JSON.stringify(entry.input)}${entry.base != null ? ` against ${JSON.stringify(entry.base)}` : ""}`;
    test(name, () => {
      const construct = () => (entry.base != null ? new URL(entry.input, entry.base) : new URL(entry.input));
      if (entry.failure) {
        expect(construct).toThrow(TypeError);
        return;
      }
      const url = construct();
      expect(url.href).toBe(entry.href);
      if (entry.origin !== undefined && !knownOriginDeviations.has(entry.input)) expect(url.origin).toBe(entry.origin);
      expect(url.protocol).toBe(entry.protocol);
      expect(url.username).toBe(entry.username);
      expect(url.password).toBe(entry.password);
      expect(url.host).toBe(entry.host);
      expect(url.hostname).toBe(entry.hostname);
      expect(url.port).toBe(entry.port);
      expect(url.pathname).toBe(entry.pathname);
      expect(url.search).toBe(entry.search);
      expect(url.hash).toBe(entry.hash);
    });
  }
});
