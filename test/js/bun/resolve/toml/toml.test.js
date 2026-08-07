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

it("Bun.TOML.parse throws on deeply nested inline tables instead of crashing", () => {
  // Calibrated to exhaust the 18 MB main-thread stack at the smallest expected
  // per-recursion frame size (~100 B in release builds). Previously 25_000.
  const depth = 200_000;
  const deepToml =
    "a = " + Buffer.alloc(depth * 6, "{ b = ").toString() + "1" + Buffer.alloc(depth * 2, " }").toString();
  expect(() => Bun.TOML.parse(deepToml)).toThrow(RangeError);
});

// Dotted paths (table headers and keys) nest iteratively in the parser, so the
// depth limit is only hit when the parsed AST is converted to a JS object at
// import time.
const deepDottedToml = "[" + Buffer.alloc(250_000 * 2, "a.").toString() + "a]\nd = 1\n";
const deepDottedKeyToml = Buffer.alloc(250_000 * 2, "a.").toString() + "a = 1\n";

it.concurrent("importing a deeply nested table header throws instead of crashing", async () => {
  using dir = tempDir("toml-deep-import", {
    "deep.toml": deepDottedToml,
    "main.js": `import d from "./deep.toml";\nconsole.log("unreachable");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain("RangeError: Maximum call stack size exceeded");
  expect(exitCode).toBe(1);
});

it.concurrent("dynamic import of a deeply nested table header is catchable", async () => {
  using dir = tempDir("toml-deep-dynamic", {
    "deep.toml": deepDottedToml,
    "main.js": `
      try {
        await import("./deep.toml");
        console.log("no-throw");
      } catch (e) {
        console.log("caught:", e.name);
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("caught: RangeError\n");
  expect(exitCode).toBe(0);
});

it.concurrent("importing a deeply nested dotted key throws instead of crashing", async () => {
  using dir = tempDir("toml-deep-key", {
    "deep.toml": deepDottedKeyToml,
    "main.js": `import d from "./deep.toml";\nconsole.log("unreachable");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain("RangeError: Maximum call stack size exceeded");
  expect(exitCode).toBe(1);
});

it.concurrent("a moderately nested table header imports correctly", async () => {
  // 1000 segments: comfortably below every stack limit, far above any real
  // document. Pins the success side so a future parse-time cap can't regress
  // legitimate depth.
  const depth = 1000;
  using dir = tempDir("toml-deep-ok", {
    "deep.toml": "[" + Buffer.alloc((depth - 1) * 2, "a.").toString() + "a]\nd = 1\n",
    "main.js": `
      import root from "./deep.toml";
      let o = root;
      let hops = 0;
      while (o.a !== undefined) {
        o = o.a;
        hops++;
      }
      console.log(hops, o.d);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`${depth} 1\n`);
  expect(exitCode).toBe(0);
});
