import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `define` key matching and value parsing, on every surface that takes a
// define map: `bun build` (bundling and `--no-bundle`), `Bun.build`, and
// `Bun.Transpiler`. The expected output follows esbuild, with one difference:
// Bun rewrites a top-level `this` (to `exports` in CommonJS), so a define value
// that starts with `this` gets the same rewrite at a top-level use site.

type Defines = Record<string, string>;

interface Surface {
  name: string;
  /** Transpile `source` with `defines`. Returns the output code. */
  run(source: string, defines: Defines): Promise<string>;
}

/** Runs `bun build` with `--define` flags and returns stdout. Fails on stderr. */
async function buildCli(source: string, defines: Defines, extraArgs: string[]): Promise<string> {
  using dir = tempDir("bundler-define", { "entry.js": source });
  const defineArgs = Object.entries(defines).flatMap(([key, value]) => ["--define", `${key}=${value}`]);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", ...extraArgs, ...defineArgs, join(String(dir), "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

const surfaces: Surface[] = [
  {
    name: "bun build --no-bundle",
    run: (source, defines) => buildCli(source, defines, ["--no-bundle"]),
  },
  {
    name: "bun build",
    run: (source, defines) => buildCli(source, defines, []),
  },
  {
    name: "Bun.build",
    async run(source, defines) {
      using dir = tempDir("bundler-define-api", { "entry.js": source });
      const result = await Bun.build({
        entrypoints: [join(String(dir), "entry.js")],
        define: defines,
      });
      expect(result.logs).toEqual([]);
      expect(result.success).toBe(true);
      return await result.outputs[0].text();
    },
  },
  {
    name: "Bun.Transpiler",
    async run(source, defines) {
      const transpiler = new Bun.Transpiler({ define: defines });
      return transpiler.transformSync(source, "js");
    },
  },
];

/** An expression and the expression it must transpile to. */
type Case = [input: string, output: string];

interface Repro {
  name: string;
  defines: Defines;
  cases: Case[];
}

const repros: Repro[] = [
  {
    name: "optional chains and string index keys match a dot define",
    defines: {
      "a.b": "c",
      "a.b.c": "d",
      "process.env.NODE_ENV": '"production"',
    },
    cases: [
      ["a.b", "c"],
      ["a?.b", "c"],
      ["a?.b.c", "d"],
      ["a.b?.c", "d"],
      ['a?.["b"]', "c"],
      ['a["b"]', "c"],
      ["process?.env?.NODE_ENV", '"production"'],
      ['process.env["NODE_ENV"]', '"production"'],
      ['process["env"]["NODE_ENV"]', '"production"'],
      ['process["env"].NODE_ENV', '"production"'],
      // The rest of a partly replaced optional chain continues on the new value
      ["a?.b.x", "c.x"],
      ["a?.b()", "c()"],
      ['a?.["b"].x', "c.x"],
      ["a.b?.x", "c?.x"],
    ],
  },
  {
    name: "values are member chains, not strings",
    defines: {
      A: "import.meta",
      B: "import.meta.url",
      C: "this.foo",
      F: "a.if",
      "window.env": "import.meta.env",
      N: "null",
      U: "undefined",
    },
    cases: [
      ["A", "import.meta"],
      ["B", "import.meta.url"],
      // A top-level `this` in a CommonJS file is `exports`
      ["C", "exports.foo"],
      // Inside a function `this` stays `this`
      ["function () { return C; }", "function() { return this.foo; }"],
      ["F", "a.if"],
      ["window.env", "import.meta.env"],
      ["N", "null"],
      ["U", "undefined"],
    ],
  },
  {
    name: "this as a key, BigInt values, quoted key parts",
    defines: {
      this: "window",
      FOO: "123n",
      HEX: "0xffn",
      'process.env["SOME-VAR"]': "3",
      'process.env["dotted.name"]': "4",
    },
    cases: [
      ["((g) => g)(this)", "((g) => g)(window)"],
      ["FOO", "123n"],
      ["HEX", "0xffn"],
      ['process.env["SOME-VAR"]', "3"],
      ["process.env['SOME-VAR']", "3"],
      ['process?.env?.["SOME-VAR"]', "3"],
      ['process.env["dotted.name"]', "4"],
      // Only a top-level `this` is replaced
      ["function () { return this; }", "function() { return this; }"],
    ],
  },
  {
    name: "a constant define is not substituted into an assignment target",
    defines: {
      FOO: "123",
      BAR: "a.b",
      "obj.key": "c.d",
      "obj.num": "7",
    },
    cases: [
      ["FOO = 1", "FOO = 1"],
      ["FOO", "123"],
      // An identifier or a member chain is a valid target
      ["BAR = 2", "a.b = 2"],
      ["obj.key = 3", "c.d = 3"],
      ['obj["key"] = 4', "c.d = 4"],
      ["obj.num = 5", "obj.num = 5"],
      ['obj["num"] = 6', 'obj["num"] = 6'],
      ["[obj.num, obj.key]", "[7, c.d]"],
    ],
  },
];

describe.each(surfaces)("$name", surface => {
  for (const repro of repros) {
    describe(repro.name, () => {
      // One transpile per surface and repro. Each expression is logged with its
      // own index, so an assertion can only match its own statement.
      const source = repro.cases.map(([input], i) => `console.log(${i}, ${input});`).join("\n") + "\n";
      let output: Promise<string> | undefined;
      const getOutput = async () => (await (output ??= surface.run(source, repro.defines))).replace(/\s+/g, " ");
      const cases = repro.cases.map(([input, expected], i) => [input, expected, i] as const);

      test.each(cases)("%s => %s", async (_input, expected, i) => {
        expect(await getOutput()).toContain(`console.log(${i}, ${expected});`);
      });
    });
  }
});

describe("define values are symbols, not text", () => {
  test("a member chain follows a renamed local and a renamed import", async () => {
    // Long names: the minifier generates short names, so these cannot come back.
    using dir = tempDir("bundler-define-link", {
      "entry.js": `
        import { importedObject } from "./imported.js";
        const localObject = { b: { c: 1 } };
        console.log(A, B.y);
      `,
      "imported.js": `export const importedObject = { y: 2 };`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
      define: { A: "localObject.b.c", B: "importedObject" },
      minify: { identifiers: true },
    });
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);
    const output = await result.outputs[0].text();
    // Both names were renamed, so the define values must not print verbatim
    expect(output).not.toContain("localObject");
    expect(output).not.toContain("importedObject");

    await using proc = Bun.spawn({
      cmd: [bunExe(), result.outputs[0].path],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1 2\n");
    expect(exitCode).toBe(0);
  });

  test("assigning through a member chain does not assign to the import at its head", async () => {
    using dir = tempDir("bundler-define-assign-import", {
      "entry.js": `
        import { settings } from "./settings.js";
        FLAG = 1;
        console.log(settings.flag);
      `,
      "settings.js": `export const settings = { flag: 0 };`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
      define: { FLAG: "settings.flag" },
    });
    // `settings.flag = 1` writes a property. The bundler must not report an assignment to `settings`.
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), result.outputs[0].path],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1\n");
    expect(exitCode).toBe(0);
  });

  test("assigning through a member chain to an import namespace member is an error", async () => {
    using dir = tempDir("bundler-define-assign-namespace", {
      "entry.js": `
        import * as ns from "./other.js";
        FLAG = 1;
        console.log(ns.member);
      `,
      "other.js": `export let member = 0;`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
      define: { FLAG: "ns.member" },
      throw: false,
    });
    // The same error as the literal `ns.member = 1`
    expect(result.success).toBe(false);
    expect(result.logs.map(log => log.message)).toEqual(['Cannot assign to import "member"']);
  });

  test("assigning through a member chain writes a property of an import namespace member", async () => {
    using dir = tempDir("bundler-define-assign-namespace-property", {
      "entry.js": `
        import * as ns from "./settings.js";
        FLAG = 1;
        console.log(ns.settings.flag);
      `,
      "settings.js": `export const settings = { flag: 0 };`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
      define: { FLAG: "ns.settings.flag" },
    });
    // Only the last link `flag` is the target. `ns.settings` is read, so the import is not reported.
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), result.outputs[0].path],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1\n");
    expect(exitCode).toBe(0);
  });

  test("assigning through a member chain to a CommonJS export converts the export", async () => {
    using dir = tempDir("bundler-define-assign-cjs-export", {
      "entry.js": `
        import * as lib from "./lib.cjs";
        console.log(lib.foo, lib.bar);
      `,
      "lib.cjs": `
        exports.bar = 1;
        FOO = 2;
      `,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
      define: { FOO: "exports.foo" },
    });
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);
    const output = await result.outputs[0].text();
    // `$foo = 2` is a named export like the literal `exports.foo = 2`, so the module needs no wrapper
    expect(output).not.toContain("__commonJS");
    expect(output).not.toContain("FOO");

    await using proc = Bun.spawn({
      cmd: [bunExe(), result.outputs[0].path],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("2 1\n");
    expect(exitCode).toBe(0);
  });
});

describe("define key errors", () => {
  test.each([
    ["a-b", 'define key "a-b" must be a valid identifier'],
    ["a.b-c", 'define key "a.b-c" contains invalid identifier "b-c"'],
    ["a.b.", 'define key "a.b." contains invalid identifier ""'],
    ["null.x", 'define key "null.x" contains invalid identifier "null"'],
    ["import.foo", 'define key "import.foo" contains invalid identifier "import"'],
    ["a[b]", 'define key "a[b]" must use a quoted string inside "[]"'],
    ['a["b"', 'define key "a["b"" must use a quoted string inside "[]"'],
    ['a["b"]c', 'define key "a["b"]c" must use a quoted string inside "[]"'],
  ])("%s is rejected", async (key, message) => {
    using dir = tempDir("bundler-define-key-error", { "entry.js": "console.log(1);\n" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--define", `${key}=1`, join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(message);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });

  test("a keyword is a valid property name after the first part", async () => {
    const transpiler = new Bun.Transpiler({ define: { "a.if": "1", "this.x": "2", "import.meta.env.MODE": '"test"' } });
    expect(transpiler.transformSync("console.log(a.if, this.x, import.meta.env.MODE);", "js").trim()).toBe(
      'console.log(1, 2, "test");',
    );
  });
});
