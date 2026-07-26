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

test("static .json imports with and without the type attribute share one module across files", async () => {
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

test("static .json imports share one module regardless of load order", async () => {
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

test("dynamic import() of a .json with and without the type attribute returns one module", async () => {
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

test("dynamic import() of a .json shares one module regardless of order", async () => {
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

test("a static attribute-less .json import and a dynamic attributed one share one module", async () => {
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

test("export-from of a .json shares one module with an attributed import", async () => {
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

test("an explicit non-json type attribute still produces a distinct module", async () => {
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

test("a .json specifier with a query string still normalizes to one module", async () => {
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

describe("jsonc-loaded filenames are left alone", () => {
  // package.json / tsconfig.json / jsconfig.json use Bun's jsonc loader even
  // though the extension is `.json`. The normalization must not synthesize
  // `with { type: "json" }` for them: that would reach the fetch hook as an
  // explicit `type` override and force strict JSON, breaking Bun's lenient
  // handling of empty / commented config files.
  for (const name of ["package.json", "tsconfig.json", "jsconfig.json"]) {
    test(`static import of an empty ${name} still works`, async () => {
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

    test(`dynamic import of an empty ${name} still works`, async () => {
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
