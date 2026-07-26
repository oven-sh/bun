import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// Bun accepts `import "./x.json"` without `with { type: "json" }`. Both forms
// load the same file with the same loader, so they must resolve to the same
// module record in JSC's registry. Before this was fixed the attribute-less
// form keyed on ScriptFetchParameters::Type::JavaScript and the attributed
// form on Type::JSON, so two module instances were created and a mutation via
// one was invisible via the other.

async function run(files: Record<string, string>) {
  using dir = tempDir("json-import-identity", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, dir), stderr, exitCode };
}

test.concurrent("static .json imports with and without the type attribute share one module across files", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "plain.mjs": `import a from "./cfg.json"; export default a;`,
    "attr.mjs": `import b from "./cfg.json" with { type: "json" }; export default b;`,
    "index.mjs": `
      const plain = (await import("./plain.mjs")).default;
      const attr = (await import("./attr.mjs")).default;
      console.log("same:", plain === attr);
      plain.n = 42;
      console.log("mutation:", attr.n);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`
"same: true
mutation: 42"
`);
  expect(exitCode).toBe(0);
});

test.concurrent("static .json imports share one module regardless of load order", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "plain.mjs": `import a from "./cfg.json"; export default a;`,
    "attr.mjs": `import b from "./cfg.json" with { type: "json" }; export default b;`,
    "index.mjs": `
      const attr = (await import("./attr.mjs")).default;
      const plain = (await import("./plain.mjs")).default;
      console.log("same:", plain === attr);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`"same: true"`);
  expect(exitCode).toBe(0);
});

test.concurrent("dynamic import() of a .json with and without the type attribute returns one module", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "index.mjs": `
      const plain = await import("./cfg.json");
      const attr = await import("./cfg.json", { with: { type: "json" } });
      console.log("ns:", plain === attr);
      console.log("default:", plain.default === attr.default);
      plain.default.n = 99;
      console.log("mutation:", attr.default.n);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`
"ns: true
default: true
mutation: 99"
`);
  expect(exitCode).toBe(0);
});

test.concurrent("dynamic import() of a .json shares one module regardless of order", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "index.mjs": `
      const attr = await import("./cfg.json", { with: { type: "json" } });
      const plain = await import("./cfg.json");
      console.log("ns:", plain === attr);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`"ns: true"`);
  expect(exitCode).toBe(0);
});

test.concurrent("a static attribute-less .json import and a dynamic attributed one share one module", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "plain.mjs": `import a from "./cfg.json"; export default a;`,
    "index.mjs": `
      const plain = (await import("./plain.mjs")).default;
      const attr = (await import("./cfg.json", { with: { type: "json" } })).default;
      console.log("same:", plain === attr);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`"same: true"`);
  expect(exitCode).toBe(0);
});

test.concurrent("export-from of a .json shares one module with an attributed import", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "reex.mjs": `export { default as cfg } from "./cfg.json";`,
    "imp.mjs": `import b from "./cfg.json" with { type: "json" }; export default b;`,
    "index.mjs": `
      const a = (await import("./reex.mjs")).cfg;
      const b = (await import("./imp.mjs")).default;
      console.log("same:", a === b);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`"same: true"`);
  expect(exitCode).toBe(0);
});

test.concurrent("export * as of a .json shares one module with an attributed import", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "reex.mjs": `export * as cfg from "./cfg.json";`,
    "imp.mjs": `import b from "./cfg.json" with { type: "json" }; export default b;`,
    "index.mjs": `
      const a = (await import("./reex.mjs")).cfg;
      const b = (await import("./imp.mjs")).default;
      console.log("same:", a.default === b);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`"same: true"`);
  expect(exitCode).toBe(0);
});

test('the bun-target transpiler emits `with { type: "json" }` for attribute-less .json specifiers', () => {
  // Static child imports go through `hostLoadImportedModule`, not the
  // dynamic-import hook, so the printer change is load bearing on its own.
  const t = new Bun.Transpiler({ target: "bun" });
  const out = t.transformSync(
    [
      `import a from "./cfg.json";`,
      `import b from "./package.json";`,
      `import c from "./data.json" with { type: "text" };`,
      `import d from "./cfg.json?raw";`,
      `import e from "pkg/data";`,
      `import f from "#cfg";`,
      `export { default as g } from "./other.json";`,
      `export * as h from "./more.json";`,
    ].join("\n"),
  );
  expect(out).toMatchInlineSnapshot(`
"import a from "./cfg.json" with { type: "json" };
import b from "./package.json";
import c from "./data.json" with { type: "text" };
import d from "./cfg.json?raw";
import e from "pkg/data";
import f from "#cfg";
export { default as g } from "./other.json" with { type: "json" };
export * as h from "./more.json" with { type: "json" };
"
`);
  // Other targets are untouched.
  for (const target of ["browser", "node"] as const) {
    expect(new Bun.Transpiler({ target }).transformSync(`import a from "./cfg.json";`)).toBe(
      `import a from "./cfg.json";\n`,
    );
  }
});

test.concurrent("an explicit non-json type attribute still produces a distinct module", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "index.mjs": `
      const asJson = (await import("./cfg.json", { with: { type: "json" } })).default;
      const asText = (await import("./cfg.json", { with: { type: "text" } })).default;
      console.log("json:", JSON.stringify(asJson));
      console.log("text:", asText);
      console.log("distinct:", asJson !== asText);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`
"json: {"n":1}
text: {"n":1}
distinct: true"
`);
  expect(exitCode).toBe(0);
});

test.concurrent("a .json specifier with a query string still normalizes to one module", async () => {
  const { stdout, exitCode } = await run({
    "cfg.json": `{"n":1}`,
    "index.mjs": `
      const plain = await import("./cfg.json?v=1");
      const attr = await import("./cfg.json?v=1", { with: { type: "json" } });
      console.log("same:", plain.default === attr.default);
    `,
  });
  expect(stdout).toMatchInlineSnapshot(`"same: true"`);
  expect(exitCode).toBe(0);
});

describe("specifiers that resolve to a .json but don't end in one keep a shared module", () => {
  // The normalization keys on the as-written specifier in both the printer and
  // `moduleLoaderImportModule`; keying on the resolved path on only one side
  // would fork static vs dynamic for these.
  test.concurrent("package exports: `pkg/data` -> data.json, static vs dynamic", async () => {
    const { stdout, exitCode } = await run({
      "node_modules/pkg/package.json": `{"name":"pkg","exports":{"./data":"./data.json"}}`,
      "node_modules/pkg/data.json": `{"n":1}`,
      "a.mjs": `import a from "pkg/data"; export default a;`,
      "index.mjs": `
        const s = (await import("./a.mjs")).default;
        const d = (await import("pkg/data")).default;
        console.log("same:", s === d);
      `,
    });
    expect(stdout).toMatchInlineSnapshot(`"same: true"`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("subpath import: `#cfg` -> cfg.json, static vs dynamic", async () => {
    const { stdout, exitCode } = await run({
      "package.json": `{"imports":{"#cfg":"./cfg.json"}}`,
      "cfg.json": `{"n":1}`,
      "a.mjs": `import a from "#cfg"; export default a;`,
      "index.mjs": `
        const s = (await import("./a.mjs")).default;
        const d = (await import("#cfg")).default;
        console.log("same:", s === d);
      `,
    });
    expect(stdout).toMatchInlineSnapshot(`"same: true"`);
    expect(exitCode).toBe(0);
  });
});

describe("the ?raw query on a .json specifier still selects the text loader", () => {
  test.concurrent("static", async () => {
    const { stdout, exitCode } = await run({
      "cfg.json": `{"n":1}`,
      "a.mjs": `import a from "./cfg.json?raw"; export default a;`,
      "index.mjs": `
        const a = (await import("./a.mjs")).default;
        console.log(typeof a, a.trimEnd());
      `,
    });
    expect(stdout).toMatchInlineSnapshot(`"string {"n":1}"`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("dynamic", async () => {
    const { stdout, exitCode } = await run({
      "cfg.json": `{"n":1}`,
      "index.mjs": `
        const a = (await import("./cfg.json?raw")).default;
        console.log(typeof a, a.trimEnd());
      `,
    });
    expect(stdout).toMatchInlineSnapshot(`"string {"n":1}"`);
    expect(exitCode).toBe(0);
  });
});

describe("jsonc-loaded filenames are left alone", () => {
  // package.json / tsconfig.json / jsconfig.json use Bun's jsonc loader even
  // though the extension is `.json`. The normalization must not synthesize
  // `with { type: "json" }` for them: that would reach the fetch hook as an
  // explicit `type` override and force strict JSON, breaking Bun's lenient
  // handling of empty / commented config files.
  for (const name of ["package.json", "tsconfig.json", "jsconfig.json"]) {
    test.concurrent(`static import of an empty ${name} still works`, async () => {
      const { stdout, stderr, exitCode } = await run({
        [name]: ``,
        "plain.mjs": `import a from "./${name}"; export default a;`,
        "index.mjs": `
          const a = (await import("./plain.mjs")).default;
          console.log(JSON.stringify(a));
        `,
      });
      expect(stderr).not.toContain("JSON Parse error");
      expect(stdout).toMatchInlineSnapshot(`"{}"`);
      expect(exitCode).toBe(0);
    });

    test.concurrent(`dynamic import of an empty ${name} still works`, async () => {
      const { stdout, stderr, exitCode } = await run({
        [name]: ``,
        "index.mjs": `
          const a = (await import("./${name}")).default;
          console.log(JSON.stringify(a));
        `,
      });
      expect(stderr).not.toContain("JSON Parse error");
      expect(stdout).toMatchInlineSnapshot(`"{}"`);
      expect(exitCode).toBe(0);
    });
  }
});
