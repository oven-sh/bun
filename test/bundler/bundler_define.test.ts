import type { BuildConfig, TranspilerOptions } from "bun";
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
      'process.env["quo\\"te"]': "5",
    },
    cases: [
      ["((g) => g)(this)", "((g) => g)(window)"],
      ["FOO", "123n"],
      ["HEX", "0xffn"],
      ['process.env["SOME-VAR"]', "3"],
      ["process.env['SOME-VAR']", "3"],
      ['process?.env?.["SOME-VAR"]', "3"],
      ['process.env["dotted.name"]', "4"],
      // An escaped quote in a key part
      ["process.env['quo\"te']", "5"],
      // Only a top-level `this` is replaced
      ["function () { return this; }", "function() { return this; }"],
    ],
  },
  {
    name: "a bracket key is the same key as its dotted spelling",
    defines: {
      // Each of these keys also has a default value under its dotted spelling
      'process.env["NODE_ENV"]': '"production"',
      "process.env['BUN_ENV']": '"staging"',
    },
    cases: [
      ["process.env.NODE_ENV", '"production"'],
      ['process.env["NODE_ENV"]', '"production"'],
      ["process.env.BUN_ENV", '"staging"'],
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

  /** Runs `file` with `globals.js` of `dir` loaded first. */
  async function runWithGlobals(dir: string, file: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", join(dir, "globals.js"), file],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  /** Bundles `entry.js`, then runs the bundle. */
  async function bundleAndRun(files: Record<string, string>, options: Partial<BuildConfig>) {
    using dir = tempDir("bundler-define-head", files);
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
      ...options,
    });
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);
    const code = await result.outputs[0].text();
    return { code, run: await runWithGlobals(String(dir), result.outputs[0].path) };
  }

  /** Transpiles `entry.js` without a bundle, then runs the output. */
  async function transpileAndRun(files: Record<string, string>, options: TranspilerOptions) {
    using dir = tempDir("bundler-define-head", files);
    const code = new Bun.Transpiler(options).transformSync(files["entry.js"], "js");
    await Bun.write(join(String(dir), "out.js"), code);
    return { code, run: await runWithGlobals(String(dir), join(String(dir), "out.js")) };
  }

  // Every one-character name is the head of a define value, so each short name
  // that the minifier can hand out first is the name of a global that the file reads.
  const heads = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_"];
  const headDefines = Object.fromEntries(heads.map((head, i) => [`HEAD_${i}`, `${head}.url`]));
  const headReads = heads.map((_, i) => `HEAD_${i}`).join(", ");

  // The bundler and the transpiler each call the renamer on their own path
  describe.each([
    ["Bun.build", bundleAndRun],
    ["Bun.Transpiler", transpileAndRun],
  ])("%s", (_, minifyAndRun) => {
    test.each([
      [
        "the locals of a function",
        `
          function compute(firstLocal, secondLocal, thirdLocal) {
            var fourthLocal = firstLocal + secondLocal + thirdLocal;
            return [${headReads}, fourthLocal];
          }
          console.log(JSON.stringify(compute(1, 2, 3)));
        `,
      ],
      [
        "top-level variables",
        `
          let firstLocal = 1, secondLocal = 2, thirdLocal = 3;
          firstLocal += secondLocal + thirdLocal;
          console.log(JSON.stringify([${headReads}, firstLocal]));
        `,
      ],
    ])("the minifier does not rename %s to the global at the head of a member chain", async (_, source) => {
      const { code, run } = await minifyAndRun(
        {
          "entry.js": source,
          "globals.js": `for (const head of ${JSON.stringify(heads)}) globalThis[head] = { url: head };`,
        },
        { define: headDefines, minify: { identifiers: true } },
      );
      // The locals were renamed
      expect(code).not.toContain("Local");
      // Each define reads its global, not a local that took the name of the global
      expect(run).toEqual({ stdout: JSON.stringify([...heads, 6]) + "\n", stderr: "", exitCode: 0 });
    });
  });

  test("a top-level name in another module does not capture the global at the head of a member chain", async () => {
    // No minifier: the two modules share one scope in the bundle, so the module's `config` needs a new name
    const { run } = await bundleAndRun(
      {
        "entry.js": `
          import { touch } from "./declares.js";
          import { read } from "./reads.js";
          console.log(JSON.stringify([read(), touch().url]));
        `,
        "declares.js": `
          var config = { url: "module" };
          export function touch() { return config; }
        `,
        "reads.js": `export function read() { return CONFIG_URL; }`,
        "globals.js": `globalThis.config = { url: "global" };`,
      },
      { define: { CONFIG_URL: "config.url" } },
    );
    expect(run).toEqual({ stdout: '["global","module"]\n', stderr: "", exitCode: 0 });
  });

  test.each([
    ["a plain bundle", {}],
    ["a minified bundle", { minify: true }],
  ])("%s keeps an import that only the head of a member chain reads", async (_, options) => {
    const { run } = await bundleAndRun(
      {
        "entry.js": `
          import { config } from "./settings.js";
          console.log(CONFIG_URL);
        `,
        "settings.js": `export const config = { url: "import" };`,
        "globals.js": `globalThis.config = { url: "global" };`,
      },
      { define: { CONFIG_URL: "config.url" }, ...options },
    );
    // The value names the import that is in scope, not the global
    expect(run).toEqual({ stdout: "import\n", stderr: "", exitCode: 0 });
  });

  // The parser builds a define value at its use site. So the bundle must be
  // the one that the same files give with the value written there.
  test.each([
    {
      name: "`this` in a CommonJS export that is called as a method",
      key: "WHO_TAG",
      value: "this.tag",
      files: (read: string) => ({
        "entry.js": `
          import * as lib from "./lib.cjs";
          console.log(lib.readExpression(), lib.readDeclaration());
        `,
        "lib.cjs": `
          exports.tag = "exports";
          exports.readExpression = function () { return ${read}; };
          function readDeclaration() { return ${read}; }
          exports.readDeclaration = readDeclaration;
        `,
      }),
    },
    {
      name: "a call and a tagged template of a CommonJS method through an import namespace",
      key: "READ_TAG",
      value: "lib.readTag",
      files: (callee: string) => ({
        "entry.js": `
          import * as lib from "./lib.cjs";
          console.log(${callee}(), ${callee}\`\`);
        `,
        "lib.cjs": `
          exports.tag = "exports";
          exports.readTag = function () { return this.tag; };
        `,
      }),
    },
    {
      name: "a property of the default import of a CommonJS module",
      key: "LIB_FOO",
      value: "lib.foo",
      files: (read: string) => ({
        "entry.js": `
          import lib from "./lib.cjs";
          console.log(${read});
        `,
        "lib.cjs": `exports.foo = "foo";`,
      }),
    },
    {
      name: "`delete` of a property of the default import of a CommonJS module",
      key: "settings.gone",
      value: "lib.gone",
      files: (target: string) => ({
        "entry.js": `
          import lib from "./lib.cjs";
          delete ${target};
          console.log(Object.keys(lib));
        `,
        "lib.cjs": `exports.foo = "foo"; exports.gone = 1;`,
      }),
    },
  ])("$name bundles like the literal", async ({ key, value, files }) => {
    async function bundle(expression: string, define: Defines) {
      using dir = tempDir("bundler-define-literal", files(expression));
      const result = await Bun.build({ entrypoints: [join(String(dir), "entry.js")], define });
      expect(result.logs).toEqual([]);
      expect(result.success).toBe(true);
      // The `// path` comments hold the name of the temporary directory
      return (await result.outputs[0].text()).replace(/^\/\/ .*\n/gm, "");
    }
    expect(await bundle(key, { [key]: value })).toBe(await bundle(value, {}));
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

describe("a define key has one spelling", () => {
  test("the later of two spellings of one key wins", () => {
    const wrong: string[] = [];
    for (const object of ["a", "x", "cfg", "app", "settings", "env"]) {
      for (const property of ["b", "mode", "url", "a-b"]) {
        const spellings = [`${object}["${property}"]`, `${object}['${property}']`];
        if (!property.includes("-")) spellings.push(`${object}.${property}`);
        for (const first of spellings) {
          for (const second of spellings) {
            if (first === second) continue;
            const transpiler = new Bun.Transpiler({ define: { [first]: '"first"', [second]: '"second"' } });
            const output = transpiler.transformSync(`console.log(${first});`, "js").trim();
            if (output !== 'console.log("second");') wrong.push(`${first} then ${second}: ${output}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("the bracket spelling of process.env.NODE_ENV selects the JSX runtime like the dotted spelling", async () => {
    using dir = tempDir("bundler-define-node-env", {
      "app.jsx": `export const element = <div>{process.env.NODE_ENV}</div>;`,
    });
    const bundle = async (key: string) => {
      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.jsx")],
        define: { [key]: '"production"' },
        packages: "external",
      });
      expect(result.logs).toEqual([]);
      expect(result.success).toBe(true);
      return await result.outputs[0].text();
    };
    const dotted = await bundle("process.env.NODE_ENV");
    expect(dotted).toContain("react/jsx-runtime");
    expect(await bundle('process.env["NODE_ENV"]')).toBe(dotted);
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
