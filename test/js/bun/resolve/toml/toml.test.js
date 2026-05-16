import { expect, it } from "bun:test";
import emptyToml from "./toml-empty.toml";
import tomlFromCustomTypeAttribute from "./toml-fixture.toml.txt" with { type: "toml" };

function checkToml(toml) {
  expect(toml.framework).toBe("next");
  expect(toml.bundle.packages["@emotion/react"]).toBe(true);
  expect(toml.array[0].entry_one).toBe("one");
  expect(toml.array[0].entry_two).toBe("two");
  expect(toml.array[1].entry_one).toBe("three");
  expect(toml.array[1].entry_two).toBe(undefined);
  expect(toml.array[1].nested[0].entry_one).toBe("four");
  expect(toml.dev.one.two.three).toBe(4);
  expect(toml.dev.foo).toBe(123);
  expect(toml.inline.array[0]).toBe(1234);
  expect(toml.inline.array[1]).toBe(4);
  expect(toml.dev["foo.bar"]).toBe("baz");
  expect(toml.install.scopes["@mybigcompany"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany2"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany3"].three).toBe(4);
  expect(toml.install.cache.dir).toBe("C:\\Windows\\System32");
  expect(toml.install.cache.dir2).toBe("C:\\Windows\\System32\\🏳️‍🌈");
}

it("via dynamic import", async () => {
  const toml = (await import("./toml-fixture.toml")).default;
  checkToml(toml);
});

it("via import type toml", async () => {
  checkToml(tomlFromCustomTypeAttribute);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./toml-fixture.toml.txt")];
  const toml = (await import("./toml-fixture.toml.txt", { with: { type: "toml" } })).default;
  checkToml(toml);
});

it("empty via import statement", () => {
  expect(emptyToml).toEqual({});
});

it("inline table followed by table array", () => {
  const tomlContent = `
[global]
inline_table = { q1 = 1 }

[[items]]
q1 = 1
q2 = 2

[[items]]
q1 = 3
q2 = 4
`;

  // Test via Bun's internal TOML parser
  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    inline_table: { q1: 1 },
  });
  expect(parsed.items).toEqual([
    { q1: 1, q2: 2 },
    { q1: 3, q2: 4 },
  ]);
});

it("array followed by table array", () => {
  const tomlContent = `
[global]
array = [1, 2, 3]

[[items]]
q1 = 1
`;

  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    array: [1, 2, 3],
  });
  expect(parsed.items).toEqual([{ q1: 1 }]);
});

it("nested inline tables", () => {
  const tomlContent = `
[global]
nested = { outer = { inner = 1 } }

[[items]]
q1 = 1
`;

  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    nested: { outer: { inner: 1 } },
  });
  expect(parsed.items).toEqual([{ q1: 1 }]);
});

it("Bun.TOML.parse throws on deeply nested inline tables instead of crashing", () => {
  // Calibrated to exhaust the 18 MB main-thread stack at the smallest expected
  // per-recursion frame size (~100 B in release builds). Previously 25_000.
  const depth = 200_000;
  const deepToml =
    "a = " + Buffer.alloc(depth * 6, "{ b = ").toString() + "1" + Buffer.alloc(depth * 2, " }").toString();
  expect(() => Bun.TOML.parse(deepToml)).toThrow(RangeError);
});

// #28680 — TOML multi-line strings must trim the first newline after the
// opening delimiter and line-continuation backslashes must consume all
// subsequent whitespace.
it("TOML multi-line basic strings trim leading newline and handle line ending backslash", () => {
  const toml = `
str1 = "The quick brown fox jumps over the lazy dog."

str2 = """
The quick brown \\


  fox jumps over \\
    the lazy dog."""

str3 = """\\
       The quick brown \\
       fox jumps over \\
       the lazy dog.\\
       """
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str1).toBe("The quick brown fox jumps over the lazy dog.");
  expect(result.str2).toBe("The quick brown fox jumps over the lazy dog.");
  expect(result.str3).toBe("The quick brown fox jumps over the lazy dog.");
});

it("TOML multi-line literal strings trim leading newline", () => {
  const toml = `
str1 = 'The quick brown fox jumps over the lazy dog.'

str2 = '''
The quick brown fox jumps over the lazy dog.'''
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str1).toBe("The quick brown fox jumps over the lazy dog.");
  expect(result.str2).toBe("The quick brown fox jumps over the lazy dog.");
});

it("TOML multi-line basic string with only backslash continuation", () => {
  const toml = `
str = """\\
  hello\\
  world\\
  """
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str).toBe("helloworld");
});

// TOML v1.0.0 ABNF: `mlb-escaped-nl = escape ws newline *( wschar / newline )`
// — trailing spaces/tabs between the backslash and the newline are part of
// the line-ending continuation.
it("TOML multi-line basic string allows whitespace between backslash and newline", () => {
  const toml = 'str = """hello\\   \n   world"""';

  const result = Bun.TOML.parse(toml);
  expect(result.str).toBe("helloworld");
});

it("TOML multi-line strings without leading newline are unchanged", () => {
  const toml = `
str1 = """no leading newline"""
str2 = '''no leading newline'''
`;

  const result = Bun.TOML.parse(toml);
  expect(result.str1).toBe("no leading newline");
  expect(result.str2).toBe("no leading newline");
});

it("TOML escape sequences produce correct character codes", () => {
  const toml = `
tab = "hello\\tworld"
ff = "hello\\fworld"
`;

  const result = Bun.TOML.parse(toml);
  expect(result.tab).toBe("hello\tworld");
  expect(result.ff).toBe("hello\fworld");
});
