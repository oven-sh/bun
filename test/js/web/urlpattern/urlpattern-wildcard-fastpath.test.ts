// Edge case tests for the URLPattern wildcard fast-path optimization.
//
// When a component pattern is a single `*`, the compiled regex `^(.*)$` always
// matches the full input (canonicalization strips or percent-encodes line
// terminators before matching). The fast path skips regex execution for these
// components. These tests pin the observable behavior so future changes don't
// introduce regressions.

import { describe, expect, test } from "bun:test";

const components = ["protocol", "username", "password", "hostname", "port", "pathname", "search", "hash"] as const;

describe("wildcard component matches any input", () => {
  for (const comp of components) {
    test(`${comp}="*" matches arbitrary input`, () => {
      const p = new URLPattern({ [comp]: "*" });
      expect(p[comp]).toBe("*");
      const result = p.exec("https://user:pass@sub.example.com:8080/path/to/page?q=1#frag");
      expect(result).not.toBeNull();
      expect(result![comp].groups).toHaveProperty("0");
    });
  }

  test("all components default to * when unspecified", () => {
    const p = new URLPattern({});
    for (const comp of components) {
      expect(p[comp]).toBe("*");
    }
    expect(p.test("https://any.example.com:1234/any?thing#here")).toBe(true);
    expect(p.test("ftp://x/y")).toBe(true);
  });
});

describe("line terminators are canonicalized before matching", () => {
  // `^(.*)$` would NOT match strings containing line terminators because `.`
  // excludes them. The fast path assumes canonicalization removes them — these
  // tests verify that assumption.
  const cases = [
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
    ["LS (U+2028)", "\u2028"],
    ["PS (U+2029)", "\u2029"],
  ] as const;

  for (const [name, ch] of cases) {
    test(`${name} in pathname is stripped or encoded`, () => {
      const p = new URLPattern({ pathname: "*" });
      const result = p.exec({ pathname: `foo${ch}bar` });
      expect(result).not.toBeNull();
      // After canonicalization, the input must not contain raw line terminators
      expect(result!.pathname.input).not.toContain("\n");
      expect(result!.pathname.input).not.toContain("\r");
      expect(result!.pathname.input).not.toContain("\u2028");
      expect(result!.pathname.input).not.toContain("\u2029");
      // groups["0"] must equal input (full-wildcard captures everything)
      expect(result!.pathname.groups["0"]).toBe(result!.pathname.input);
    });

    test(`${name} in search is stripped or encoded`, () => {
      const p = new URLPattern({ search: "*" });
      const result = p.exec({ search: `q=${ch}v` });
      expect(result).not.toBeNull();
      expect(result!.search.input).not.toContain("\n");
      expect(result!.search.input).not.toContain("\r");
      expect(result!.search.input).not.toContain("\u2028");
      expect(result!.search.input).not.toContain("\u2029");
      expect(result!.search.groups["0"]).toBe(result!.search.input);
    });
  }

  test("canonicalization preserves LF/CR stripping", () => {
    const p = new URLPattern({ pathname: "*" });
    expect(p.exec({ pathname: "foo\nbar" })!.pathname.input).toBe("foobar");
    expect(p.exec({ pathname: "foo\rbar" })!.pathname.input).toBe("foobar");
  });

  test("canonicalization percent-encodes U+2028/U+2029", () => {
    const p = new URLPattern({ pathname: "*" });
    expect(p.exec({ pathname: "a\u2028b" })!.pathname.input).toBe("a%E2%80%A8b");
    expect(p.exec({ pathname: "a\u2029b" })!.pathname.input).toBe("a%E2%80%A9b");
  });
});

describe("patterns that must NOT take the wildcard fast path", () => {
  // These look similar to `*` but have modifiers, prefixes, or custom regexes.
  // They must still go through full regex matching.

  test("`*?` (optional wildcard)", () => {
    const p = new URLPattern({ pathname: "*?" });
    expect(p.pathname).toBe("*?");
    expect(p.test({ pathname: "" })).toBe(true);
    expect(p.test({ pathname: "/foo" })).toBe(true);
  });

  test("`*+` (one-or-more wildcard)", () => {
    const p = new URLPattern({ pathname: "*+" });
    expect(p.pathname).toBe("*+");
    // `(.*)+` matches empty too since `.*` can be empty
    expect(p.test({ pathname: "/foo" })).toBe(true);
  });

  // NOTE: `(.*)` and `:name(.*)` are parsed as FullWildcard (not Regexp) because
  // the parser recognizes `.*` as the full-wildcard regex. They DO take the fast
  // path, which is correct — they compile to the same `^(.*)$` regex.
  test("`(.*)` is treated as FullWildcard, not Regexp", () => {
    const p = new URLPattern({ pathname: "(.*)" });
    expect(p.hasRegExpGroups).toBe(false);
    expect(p.exec({ pathname: "/foo" })!.pathname.groups["0"]).toBe("/foo");
  });

  test("`:name(.*)` preserves custom group name", () => {
    const p = new URLPattern({ pathname: ":name(.*)" });
    expect(p.hasRegExpGroups).toBe(false);
    const r = p.exec({ pathname: "/foo" });
    expect(r!.pathname.groups.name).toBe("/foo");
    expect(r!.pathname.groups["0"]).toBeUndefined();
  });

  test("`(.+)` is a real regex group", () => {
    const p = new URLPattern({ pathname: "(.+)" });
    expect(p.hasRegExpGroups).toBe(true);
    expect(p.test({ pathname: "" })).toBe(false);
    expect(p.exec({ pathname: "/foo" })!.pathname.groups["0"]).toBe("/foo");
  });

  test("`/a*` (prefix before wildcard)", () => {
    const p = new URLPattern({ pathname: "/a*" });
    expect(p.test({ pathname: "/a/foo" })).toBe(true);
    expect(p.test({ pathname: "/b/foo" })).toBe(false);
  });

  test("`*/` (suffix after wildcard)", () => {
    const p = new URLPattern({ pathname: "*/" });
    expect(p.test({ pathname: "/foo/" })).toBe(true);
    expect(p.test({ pathname: "/foo" })).toBe(false);
  });

  test("`**` (wildcard with zero-or-more modifier)", () => {
    // `**` parses as `*` with a `*` modifier (ZeroOrMore), which is a single
    // FullWildcard with Modifier::ZeroOrMore — NOT two separate wildcards.
    // This does NOT take the fast path (modifier != None).
    const p = new URLPattern({ pathname: "**" });
    expect(p.pathname).toBe("**");
    const r = p.exec({ pathname: "/foo" });
    expect(r).not.toBeNull();
    expect(Object.keys(r!.pathname.groups)).toEqual(["0"]);
    expect(r!.pathname.groups["0"]).toBe("/foo");
  });

  test("`*.*` (wildcard dot wildcard)", () => {
    const p = new URLPattern({ pathname: "*.*" });
    expect(p.test({ pathname: "a.b" })).toBe(true);
    expect(p.test({ pathname: "ab" })).toBe(false);
  });

  test('empty pattern `""`', () => {
    const p = new URLPattern({ pathname: "" });
    expect(p.pathname).toBe("");
    expect(p.test({ pathname: "" })).toBe(true);
    expect(p.test({ pathname: "/foo" })).toBe(false);
  });
});

describe("wildcard fast path preserves groups structure", () => {
  test("group name is '0' for bare `*`", () => {
    const p = new URLPattern({ pathname: "*" });
    const r = p.exec({ pathname: "/abc" });
    expect(Object.keys(r!.pathname.groups)).toEqual(["0"]);
    expect(r!.pathname.groups["0"]).toBe("/abc");
  });

  test("group value equals input for full wildcard", () => {
    const p = new URLPattern({ pathname: "*" });
    for (const input of ["/", "/foo", "/foo/bar/baz", "", "/%20"]) {
      const r = p.exec({ pathname: input });
      expect(r!.pathname.groups["0"]).toBe(r!.pathname.input);
    }
  });

  test("empty input produces empty string group, not undefined", () => {
    const p = new URLPattern({ pathname: "*" });
    const r = p.exec({ pathname: "" });
    expect(r).not.toBeNull();
    expect(r!.pathname.input).toBe("");
    expect(r!.pathname.groups["0"]).toBe("");
    expect(r!.pathname.groups["0"]).not.toBeUndefined();
  });

  test("hasRegExpGroups is false for wildcard-only pattern", () => {
    expect(new URLPattern({ pathname: "*" }).hasRegExpGroups).toBe(false);
    expect(new URLPattern({}).hasRegExpGroups).toBe(false);
  });
});

describe("special characters in wildcard inputs", () => {
  const p = new URLPattern({ pathname: "*" });

  test("emoji", () => {
    const r = p.exec({ pathname: "/🎉🚀" });
    expect(r!.pathname.groups["0"]).toBe(r!.pathname.input);
  });

  test("surrogate pairs", () => {
    const r = p.exec({ pathname: "/𝕳𝖊𝖑𝖑𝖔" });
    expect(r!.pathname.groups["0"]).toBe(r!.pathname.input);
  });

  test("null byte", () => {
    const r = p.exec({ pathname: "/a\0b" });
    expect(r).not.toBeNull();
    expect(r!.pathname.groups["0"]).toBe(r!.pathname.input);
  });

  test("percent-encoded", () => {
    const r = p.exec({ pathname: "/a%20b" });
    expect(r!.pathname.input).toBe("/a%20b");
    expect(r!.pathname.groups["0"]).toBe("/a%20b");
  });

  test("CJK", () => {
    const r = p.exec({ pathname: "/日本語" });
    expect(r!.pathname.groups["0"]).toBe(r!.pathname.input);
  });

  test("control characters are stripped", () => {
    const r = p.exec({ pathname: "/a\x01\x02b" });
    expect(r).not.toBeNull();
    // Control chars may be stripped by canonicalization
    expect(r!.pathname.groups["0"]).toBe(r!.pathname.input);
  });

  test("tab is stripped", () => {
    const r = p.exec({ pathname: "/a\tb" });
    expect(r!.pathname.input).toBe("/ab");
  });
});

describe("wildcard with ignoreCase option", () => {
  test("ignoreCase does not affect wildcard matching", () => {
    const p1 = new URLPattern({ pathname: "*" });
    const p2 = new URLPattern({ pathname: "*" }, { ignoreCase: true });
    const r1 = p1.exec({ pathname: "/FOO" });
    const r2 = p2.exec({ pathname: "/FOO" });
    expect(r1!.pathname).toEqual(r2!.pathname);
  });
});

describe("protocol wildcard affects special scheme detection", () => {
  // When protocol is `*`, it matches special schemes (http, https, ws, wss, ftp, file),
  // which affects how pathname is encoded (segment-delimited vs opaque).
  test("protocol=* uses special-scheme pathname encoding", () => {
    const p = new URLPattern({ protocol: "*", pathname: "/foo/:bar" });
    expect(p.protocol).toBe("*");
    expect(p.pathname).toBe("/foo/:bar");
    expect(p.test("https://example.com/foo/baz")).toBe(true);
  });

  test("protocol=* matches all special schemes", () => {
    const p = new URLPattern({ protocol: "*" });
    for (const scheme of ["http", "https", "ws", "wss", "ftp", "file"]) {
      expect(p.test(`${scheme}://example.com/`)).toBe(true);
    }
  });
});

describe("large inputs", () => {
  test("1MB pathname", () => {
    const p = new URLPattern({ pathname: "*" });
    const big = "/" + "a".repeat(1024 * 1024);
    const r = p.exec({ pathname: big });
    expect(r).not.toBeNull();
    expect(r!.pathname.input.length).toBe(big.length);
    expect(r!.pathname.groups["0"]).toBe(r!.pathname.input);
  });

  test("large search query", () => {
    const p = new URLPattern({ search: "*" });
    const big = "q=" + "x".repeat(100000);
    const r = p.exec({ search: big });
    expect(r).not.toBeNull();
    expect(r!.search.groups["0"]).toBe(r!.search.input);
  });
});

describe("repeated matching on same pattern instance", () => {
  // Verify no state leaks between calls (ovector reuse safety).
  test("different inputs produce independent results", () => {
    const p = new URLPattern({ pathname: "*" });
    const r1 = p.exec({ pathname: "/first" });
    const r2 = p.exec({ pathname: "/second/longer/path" });
    const r3 = p.exec({ pathname: "/" });
    expect(r1!.pathname.groups["0"]).toBe("/first");
    expect(r2!.pathname.groups["0"]).toBe("/second/longer/path");
    expect(r3!.pathname.groups["0"]).toBe("/");
  });

  test("stress: 10000 iterations", () => {
    const p = new URLPattern({ pathname: "*" });
    for (let i = 0; i < 10000; i++) {
      const path = `/item/${i}`;
      const r = p.exec({ pathname: path });
      if (r!.pathname.groups["0"] !== path) {
        throw new Error(`mismatch at ${i}: got ${r!.pathname.groups["0"]}`);
      }
    }
  });
});

describe("wildcard in each component individually", () => {
  const url = "https://user:pass@sub.example.com:8080/path/page?q=1&r=2#section";
  const expected = {
    protocol: "https",
    username: "user",
    password: "pass",
    hostname: "sub.example.com",
    port: "8080",
    pathname: "/path/page",
    search: "q=1&r=2",
    hash: "section",
  };

  for (const comp of components) {
    test(`${comp} wildcard captures full component`, () => {
      const p = new URLPattern({ [comp]: "*" });
      const r = p.exec(url);
      expect(r).not.toBeNull();
      expect(r![comp].input).toBe(expected[comp]);
      expect(r![comp].groups["0"]).toBe(expected[comp]);
    });
  }
});
