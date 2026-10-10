import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// A .json file that is both `import`ed (ESM) and `require`d in the same
// process must yield one shared object. Before this was fixed, the ESM loader
// built a synthetic namespace and a later require() handed that namespace back
// (with a self-referencing `default` key and no identity with the ESM default),
// while require() alone returned the plain data.

async function run(files: Record<string, string>, entry = "index.mjs") {
  using dir = tempDir("json-require-import", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, dir), stderr, exitCode };
}

test.concurrent(
  "require() of a .json already imported via ESM returns the parsed data (no spurious default key)",
  async () => {
    const { stdout, stderr, exitCode } = await run({
      "cfg.json": `{"a":1,"b":{"c":[1,2]}}`,
      "index.mjs": `
      import def from "./cfg.json" with { type: "json" };
      import { createRequire } from "node:module";
      const req = createRequire(import.meta.url)("./cfg.json");
      console.log(JSON.stringify(req));
      console.log("same:", req === def);
      console.log("own keys:", Object.getOwnPropertyNames(req).sort().join(","));
    `,
    });
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
    "{"a":1,"b":{"c":[1,2]}}
    same: true
    own keys: a,b"
  `);
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "require() of a .json array already imported via ESM returns the array, not a namespace wrapper",
  async () => {
    const { stdout, stderr, exitCode } = await run({
      "arr.json": `[1,2,3]`,
      "index.mjs": `
      import def from "./arr.json" with { type: "json" };
      import { createRequire } from "node:module";
      const req = createRequire(import.meta.url)("./arr.json");
      console.log(JSON.stringify(req));
      console.log("isArray:", Array.isArray(req));
      console.log("same:", req === def);
    `,
    });
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
    "[1,2,3]
    isArray: true
    same: true"
  `);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("import default of a .json already require()d returns the same object", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "cfg.json": `{"a":1}`,
      "index.cjs": `
        const req = require("./cfg.json");
        req.mutated = 42;
        (async () => {
          const def = (await import("./cfg.json", { with: { type: "json" } })).default;
          console.log("same:", req === def);
          console.log("mutation:", def.mutated);
          console.log(JSON.stringify(def));
        })();
      `,
    },
    "index.cjs",
  );
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "same: true
    mutation: 42
    {"a":1,"mutated":42}"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("require.cache[path].exports is the parsed JSON value after an ESM import", async () => {
  const { stdout, stderr, exitCode } = await run({
    "cfg.json": `{"a":1}`,
    "index.mjs": `
      import def from "./cfg.json" with { type: "json" };
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const key = require.resolve("./cfg.json");
      const entry = require.cache[key];
      console.log("exports === default:", entry.exports === def);
      console.log("loaded:", entry.loaded);
      console.log(JSON.stringify(entry.exports));
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "exports === default: true
    loaded: true
    {"a":1}"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("require() and import default of a .toml file share one object", async () => {
  const { stdout, stderr, exitCode } = await run({
    "cfg.toml": 'a = 1\nb = "hello"\n',
    "index.mjs": `
      import def from "./cfg.toml";
      import { createRequire } from "node:module";
      const req = createRequire(import.meta.url)("./cfg.toml");
      console.log(JSON.stringify(req));
      console.log("same:", req === def);
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "{"a":1,"b":"hello"}
    same: true"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("require() of a .json alone (no prior import) still returns the plain data", async () => {
  // regression guard: the CJS-only path was already correct.
  const { stdout, stderr, exitCode } = await run(
    {
      "cfg.json": `{"a":1,"b":{"c":[1,2]}}`,
      "index.cjs": `
        const req = require("./cfg.json");
        console.log(JSON.stringify(req));
        console.log("own keys:", Object.getOwnPropertyNames(req).sort().join(","));
      `,
    },
    "index.cjs",
  );
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "{"a":1,"b":{"c":[1,2]}}
    own keys: a,b"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "a require.extensions['.json'] override is not clobbered by a later ESM import of the same file",
  async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "cfg.json": `{"a":1}`,
        "index.cjs": `
          require.extensions[".json"] = (m, f) => { m.exports = { overridden: true }; };
          const r1 = require("./cfg.json");
          (async () => {
            await import("./cfg.json", { with: { type: "json" } });
            const r2 = require("./cfg.json");
            console.log("r1:", JSON.stringify(r1));
            console.log("r1 === r2:", r1 === r2);
          })();
        `,
      },
      "index.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "r1: {"overridden":true}
      r1 === r2: true"
    `);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("a plain-object require.cache entry for a .json is not clobbered by a later ESM import", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "cfg.json": `{"a":1}`,
      "index.cjs": `
        const key = require.resolve("./cfg.json");
        require.cache[key] = { exports: { mocked: true } };
        (async () => {
          const def = (await import("./cfg.json", { with: { type: "json" } })).default;
          console.log("def:", JSON.stringify(def));
          console.log("entry survived:", require.cache[key].exports.mocked === true);
          console.log("require:", JSON.stringify(require("./cfg.json")));
        })();
      `,
    },
    "index.cjs",
  );
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "def: {"a":1}
    entry survived: true
    require: {"mocked":true}"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("import * as ns from a .json has no extra synthetic export names", async () => {
  // the fix inserts into require.cache; it must not change the ESM namespace shape.
  const { stdout, stderr, exitCode } = await run({
    "cfg.json": `{"a":1,"b":2}`,
    "index.mjs": `
      import * as ns from "./cfg.json" with { type: "json" };
      console.log(Object.getOwnPropertyNames(ns).sort().join(","));
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`"a,b,default"`);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "delete require.cache[path] after ESM import lets a subsequent require() re-read from disk",
  async () => {
    const { stdout, stderr, exitCode } = await run({
      "cfg.json": `{"a":1}`,
      "index.mjs": `
      import def from "./cfg.json" with { type: "json" };
      import { createRequire } from "node:module";
      import { writeFileSync } from "node:fs";
      const require = createRequire(import.meta.url);
      const key = require.resolve("./cfg.json");
      const first = require("./cfg.json");
      console.log("first === default:", first === def);
      delete require.cache[key];
      writeFileSync(key, JSON.stringify({ a: 2 }));
      const second = require("./cfg.json");
      console.log("second.a:", second.a);
      console.log("second === first:", second === first);
    `,
    });
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
    "first === default: true
    second.a: 2
    second === first: false"
  `);
    expect(exitCode).toBe(0);
  },
);
