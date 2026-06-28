import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// The module loader (`import x from "./f.toml"`, `with { type: "toml" }`) and
// `Bun.TOML.parse` share one parser but convert the AST to JS differently (the
// loader prints JS source; `Bun.TOML.parse` round-trips through JSON). This
// exercises the loader end to end for the value classes the parser used to
// silently corrupt (`\U` escapes, multiline-string trimming, line-ending
// backslashes, dotted float-looking keys) or reject (RFC 3339 date-times,
// which the loader surfaces as strings). The per-class coverage lives in
// toml-parse.test.ts.
it("the toml loader decodes escapes, multiline strings, dotted keys, and date-times", async () => {
  const specToml = [
    'unicode = "\\U000003B4 \\u03B4 \\U00010AF1"',
    'firstnl = """',
    'X"""',
    'joined = """a \\',
    '   b"""',
    '3.14159 = "pi"',
    "odt = 1979-05-27T07:32:00Z",
    "date = 1979-05-27",
    "time = 07:32:00",
    "",
  ].join("\n");
  using dir = tempDir("toml-loader-spec", {
    "spec.toml": specToml,
    // The same document reached via `with { type: "toml" }` on a non-.toml extension.
    "spec.txt": specToml,
    "index.ts": `
      import withExtension from "./spec.toml";
      import withAttribute from "./spec.txt" with { type: "toml" };
      if (!Bun.deepEquals(withExtension, withAttribute, true)) {
        throw new Error("extension and import-attribute loaders disagree");
      }
      console.log(JSON.stringify(withExtension));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode, toml: stdout.trim() && JSON.parse(stdout) }).toEqual({
    stderr: "",
    exitCode: 0,
    toml: {
      unicode: "δ δ \u{10AF1}",
      firstnl: "X",
      joined: "a b",
      "3": { "14159": "pi" },
      odt: "1979-05-27T07:32:00Z",
      date: "1979-05-27",
      time: "07:32:00",
    },
  });
});

it("Bun.TOML.parse throws on deeply nested inline tables instead of crashing", () => {
  // Calibrated to exhaust the 18 MB main-thread stack at the smallest expected
  // per-recursion frame size (~100 B in release builds). Previously 25_000.
  const depth = 200_000;
  const deepToml =
    "a = " + Buffer.alloc(depth * 6, "{ b = ").toString() + "1" + Buffer.alloc(depth * 2, " }").toString();
  expect(() => Bun.TOML.parse(deepToml)).toThrow(RangeError);
});
