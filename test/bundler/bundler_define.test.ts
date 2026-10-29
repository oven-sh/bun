import type { BuildConfig, TranspilerOptions } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { itBundled } from "./expectBundled";

// `define` key matching and value parsing, on every surface that takes a
// define map: `bun build` (bundling and `--no-bundle`), `Bun.build`, and
// `Bun.Transpiler`. The expected output follows esbuild 0.28.2, with these
// differences:
// - Bun rewrites a top-level `this` (to `exports` in CommonJS), so a define
//   value that starts with `this` gets the same rewrite at a top-level use site.
// - A call through a key keeps the member chain as its callee, as before:
//   `F()` with `F=a.if` is `a.if()`. esbuild prints `(0, a.if)()`.
// - An assignment through a member chain is the assignment that the chain
//   spells: `FLAG = 1` with `FLAG=settings.flag` writes a property. esbuild
//   reports an assignment to the import `settings`.
// - The later of two spellings of one key wins. esbuild takes the spelling that
//   sorts last.
// - A BigInt value can be hexadecimal (`0xffn`). esbuild takes decimal only.
// - Bun defines `process.env.NODE_ENV`, `process.env.BUN_ENV` and `process.browser` by itself, and
//   `--compile` defines `process.platform`, `process.arch` and `process.versions.bun` for its target.
//   In a build for `bun` or `node` these defines replace the dotted spelling alone.

type Defines = Record<string, string>;

/** The text of a bundle without its `// path` comments, which hold the name of the temporary directory. */
const withoutPathComments = (code: string) => code.replace(/^(?:\/\/ .*|\/\* .* \*\/)\n/gm, "");

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
      return withoutPathComments(await result.outputs[0].text());
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
      // The cases of esbuild's `DefineOptionalChain`
      ['a["b"]["c"]', "d"],
      ['a?.["b"]["c"]', "d"],
      ['a["b"]?.["c"]', "d"],
      // An index that is not a string literal does not match
      ["a[b][c]", "a[b][c]"],
      ["a?.[b][c]", "a?.[b][c]"],
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
      // A call keeps the chain as its callee
      ["F()", "a.if()"],
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
      'process.env["with:colon=equals"]': "6",
      'process.env["MY-VÄR"]': "7",
      "labels.ключ": "8",
      THIS_FOO: "this.foo",
    },
    cases: [
      ["((g) => g)(this)", "((g) => g)(window)"],
      // The `this` of another define value takes the `this` define, as in esbuild
      ["THIS_FOO", "window.foo"],
      ["() => THIS_FOO", "() => window.foo"],
      ["function () { return THIS_FOO; }", "function() { return this.foo; }"],
      ["FOO", "123n"],
      ["HEX", "0xffn"],
      ['process.env["SOME-VAR"]', "3"],
      ["process.env['SOME-VAR']", "3"],
      ['process?.env?.["SOME-VAR"]', "3"],
      ['process.env["dotted.name"]', "4"],
      // An escaped quote in a key part
      ["process.env['quo\"te']", "5"],
      // The `--define` flag splits the key from the value after the quoted part
      ['process.env["with:colon=equals"]', "6"],
      // A non-ASCII name, as a quoted part and as an identifier
      ['process.env["MY-VÄR"]', "7"],
      ['labels["ключ"]', "8"],
      ["labels.ключ", "8"],
      ['labels?.["ключ"]', "8"],
      // Only a top-level `this` is replaced
      ["function () { return this; }", "function() { return this; }"],
    ],
  },
  {
    // The cases of esbuild's `DefineThis`
    name: "keys that start with `this`",
    defines: {
      this: "_replaced",
      "this.foo.bar": "_replaced_foo_bar",
      "this.foo": "_replaced_foo",
    },
    cases: [
      ["this", "_replaced"],
      ["this.foo", "_replaced_foo"],
      ["this.foo.bar", "_replaced_foo_bar"],
      // Only `this.foo` is a key
      ["this.foo.baz", "_replaced_foo.baz"],
      ["this.bar", "_replaced.bar"],
      // An arrow function has the `this` of the file
      [
        "() => [this, this.foo.bar, this.foo.baz, this.bar]",
        "() => [_replaced, _replaced_foo_bar, _replaced_foo.baz, _replaced.bar]",
      ],
      [
        "function () { return [this, this.foo, this.foo.bar, this.foo.baz, this.bar]; }",
        "function() { return [this, this.foo, this.foo.bar, this.foo.baz, this.bar]; }",
      ],
    ],
  },
  {
    // esbuild 0.28.2 overflows its stack on this input
    name: "the `this` of a `this` define is the `this` of the file",
    defines: {
      this: "this.self",
      THIS_X: "this.x",
    },
    cases: [
      ["this", "exports.self"],
      ["this.y", "exports.self.y"],
      ["THIS_X", "exports.self.x"],
      ["function () { return [this, THIS_X]; }", "function() { return [this, this.x]; }"],
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
      NAN: "NaN",
      "obj.limit": "Infinity",
    },
    cases: [
      ["FOO = 1", "FOO = 1"],
      ["FOO++", "FOO++"],
      ["FOO += 2", "FOO += 2"],
      ["FOO", "123"],
      // `NaN` and `Infinity` are numbers, not the names of globals
      ["NAN = 1", "NAN = 1"],
      ["NAN", "NaN"],
      ["obj.limit = 10", "obj.limit = 10"],
      ['obj["limit"]++', 'obj["limit"]++'],
      ["typeof obj.limit", '"number"'],
      // An identifier or a member chain is a valid target
      ["BAR = 2", "a.b = 2"],
      ["BAR++", "a.b++"],
      ["obj.key += 3", "c.d += 3"],
      ["obj.num--", "obj.num--"],
      ["obj.key = 3", "c.d = 3"],
      ['obj["key"] = 4', "c.d = 4"],
      ["obj.num = 5", "obj.num = 5"],
      ['obj["num"] = 6', 'obj["num"] = 6'],
      ["[obj.num, obj.key]", "[7, c.d]"],
    ],
  },
];

describe.concurrent.each(surfaces)("$name", surface => {
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

describe.concurrent("define values are symbols, not text", () => {
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
    const output = withoutPathComments(await result.outputs[0].text());
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
    const code = withoutPathComments(await result.outputs[0].text());
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

  test("a define behind an inlined single-use value keeps the import that its value names", async () => {
    // `e` is used one time, so the minifier puts `process.env` in its place and visits `process.env.API` again
    const { run } = await bundleAndRun(
      {
        "entry.js": `
          import { config } from "./settings.js";
          function read() {
            const e = process.env;
            return e.API + "!";
          }
          console.log(read());
        `,
        "settings.js": `export const config = { url: "import" };`,
        "globals.js": `globalThis.config = { url: "global" };`,
      },
      { define: { "process.env.API": "config.url" }, minify: { syntax: true } },
    );
    expect(run).toEqual({ stdout: "import!\n", stderr: "", exitCode: 0 });
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
      name: "the default import of a CommonJS module as a one-part value",
      key: "LIB_OBJECT",
      value: "lib",
      files: (object: string) => ({
        "entry.js": `
          import lib from "./lib.cjs";
          console.log(${object}.foo, ${object}["bar"]);
        `,
        "lib.cjs": `exports.foo = "foo"; exports.bar = "bar";`,
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
      return withoutPathComments(await result.outputs[0].text());
    }
    expect(await bundle(key, { [key]: value })).toBe(await bundle(value, {}));
  });

  test("the minifier does not read a value a second time as a key when it inlines a local", async () => {
    // `b.c` is the value of `FIRST` and the key of another define. The import that the other value names stays unread.
    const { run } = await bundleAndRun(
      {
        "entry.js": `
          import { imported } from "./imported.js";
          function add(x) { let local = FIRST; return local + x; }
          console.log(add(1));
        `,
        "imported.js": `export const imported = { e: 10 };`,
        "globals.js": `globalThis.b = { c: 1 };`,
      },
      { define: { FIRST: "b.c", "b.c": "imported.e" }, minify: { syntax: true } },
    );
    expect(run).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
  });

  test.each(["COUNTER", "state.COUNTER", 'state["COUNTER"]'])(
    "an assignment through %s to a module binding is an assignment to the binding",
    async key => {
      const { run } = await bundleAndRun(
        {
          "entry.js": `
            import { set } from "./counter.js";
            const { counter: before } = await import("./counter.js");
            set(50);
            console.log(before);
          `,
          "counter.js": `
            export let counter = 0;
            export function set(value) { ${key} = value; }
          `,
          "globals.js": ``,
        },
        { define: { [key]: "counter" } },
      );
      // `before` is a copy of the value. It is not the binding `counter`.
      expect(run).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
    },
  );

  test("an assignment through a key to `exports` is an assignment to `exports`", async () => {
    const { run } = await bundleAndRun(
      {
        "entry.js": `
          import lib from "./lib.cjs";
          console.log(JSON.stringify(lib));
        `,
        "lib.cjs": `
          obj.key = {};
          module.exports.a = 1;
        `,
        "globals.js": ``,
      },
      { define: { "obj.key": "exports" } },
    );
    // `exports = {}` does not replace `module.exports`
    expect(run).toEqual({ stdout: '{"a":1}\n', stderr: "", exitCode: 0 });
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
    const output = withoutPathComments(await result.outputs[0].text());
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

// `minify.syntax` inlines a local that is used one time and then visits the statement a second time.
// The runtime transpiler does the same. The second visit must not read a define value as a define key.
describe.concurrent("a define value is not matched against the defines again", () => {
  const defines = {
    "a.b": "b.c",
    "b.c": "c.a",
    "c.a": "a.b",
    "k.m": "k.m.n",
    "import.meta.env": "process.env",
    'q["x-y"]': "q.z",
    "q.z": "1",
  };

  test.each([
    ["a.b", "b.c"],
    ["k.m", "k.m.n"],
    ['q["x-y"]', "q.z"],
    // `process.env.NODE_ENV` has a default define
    ["import.meta.env.NODE_ENV", "process.env.NODE_ENV"],
    ["import.meta.env", "process.env"],
  ])("%s => %s with minify.syntax", (input, expected) => {
    const transpiler = new Bun.Transpiler({ define: defines, minify: { syntax: true } });
    const source = `
      export function viaLocal() { const local = g(); return local + ${input}; }
      export function direct() { return g() + ${input}; }
    `;
    expect(transpiler.transformSync(source, "js").replace(/\s+/g, " ").trim()).toBe(
      `export function viaLocal() { return g() + ${expected}; } export function direct() { return g() + ${expected}; }`,
    );
  });

  test('a key is replaced when minify.syntax rewrites a["b"] to a.b', () => {
    const transpiler = new Bun.Transpiler({
      define: { "a.b": "7", 'process.env["SOME-VAR"]': "3" },
      minify: { syntax: true },
    });
    expect(transpiler.transformSync(`x(a["b"], process.env["SOME-VAR"]);`, "js").trim()).toBe("x(7, 3);");
  });

  test.each(["run.js", "run.ts"])("the runtime transpiler on %s", async file => {
    using dir = tempDir("bundler-define-once", {
      [file]: `
        globalThis.k = { m: { n: { label: "k.m.n", n: { label: "k.m.n.n" } } } };
        function viaLocal() { let local = k.m; return local.label + "!"; }
        function direct() { return k.m.label + "!"; }
        console.log(viaLocal(), direct());
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--define", "k.m=k.m.n", file],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("k.m.n! k.m.n!\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("a define key has one spelling", () => {
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
      // A child process: `bun test` sets NODE_ENV in this one, and then the define key does not decide the runtime
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--packages=external", "--define", `${key}="production"`, "app.jsx"],
        env: { ...bunEnv, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return stdout;
    };
    const dotted = await bundle("process.env.NODE_ENV");
    expect(dotted).toContain("react/jsx-runtime");
    expect(await bundle('process.env["NODE_ENV"]')).toBe(dotted);
  });
});

// A server has the real `process.env` where it runs, and a program reads it there with
// `process.env["NODE_ENV"]` or `process.env?.NODE_ENV`. So the defines that Bun adds by itself
// replace, in a build for a server, what they replaced before keys matched in brackets and behind `?.`.
describe.concurrent("the defines that Bun adds by itself", () => {
  const source = `x(
    process.env.NODE_ENV, process["env"].NODE_ENV, process.env["NODE_ENV"], process.env?.NODE_ENV, process?.env?.NODE_ENV,
    process.env.BUN_ENV, process.env["BUN_ENV"],
    process.browser, process["browser"], process?.browser,
  );`;
  const onOneLine = (code: string) => withoutPathComments(code).replace(/\s+/g, " ").trim();

  /** `bun build` in a child process, whose NODE_ENV is not the one of `bun test`. */
  async function build(args: string[], text = source) {
    using dir = tempDir("bundler-define-defaults", { "entry.js": text });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...args, "entry.js"],
      env: { ...bunEnv, NODE_ENV: "staging", BUN_ENV: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return onOneLine(stdout);
  }

  /** What the default define of NODE_ENV is in this process: `bun test` has one of its own. */
  const modeOf = (output: string) => /^x\(("\w+"),/.exec(output)?.[1] ?? "";
  const dottedAlone = (mode: string) =>
    `x(${mode}, ${mode}, process.env["NODE_ENV"], process.env?.NODE_ENV, process?.env?.NODE_ENV, ${mode}, process.env["BUN_ENV"], false, process["browser"], process?.browser);`;
  const everySpelling = (mode: string, browser: string) =>
    `x(${mode}, ${mode}, ${mode}, ${mode}, ${mode}, ${mode}, ${mode}, ${browser}, ${browser}, ${browser});`;

  const modes: [string, string[]][] = [
    ["--no-bundle", ["--no-bundle"]],
    ["a bundle", []],
  ];

  describe.each(["bun", "node"])("--target=%s", target => {
    test.each(modes)("bun build, %s, replaces the dotted spelling alone", async (_, mode) => {
      expect(await build([...mode, `--target=${target}`])).toBe(dottedAlone('"staging"'));
    });

    test('--minify-syntax has ["NODE_ENV"] as .NODE_ENV first', async () => {
      expect(await build(["--no-bundle", "--minify-syntax", `--target=${target}`])).toBe(
        `x("staging", "staging", "staging", process.env?.NODE_ENV, process?.env?.NODE_ENV, "staging", "staging", !1, !1, process?.browser);`,
      );
    });

    test("a key that --define gives replaces every spelling", async () => {
      const defines = ["--define", 'process.env.NODE_ENV="mine"', "--define", "process.browser=1"];
      expect(await build(["--no-bundle", `--target=${target}`, ...defines])).toBe(
        `x("mine", "mine", "mine", "mine", "mine", "staging", process.env["BUN_ENV"], 1, 1, 1);`,
      );
    });

    test('--production replaces ["NODE_ENV"] the same way, and no optional chain', async () => {
      expect(await build(["--no-bundle", "--production", `--target=${target}`])).toBe(
        `x("staging","staging","staging",process.env?.NODE_ENV,process?.env?.NODE_ENV,"staging","staging",!1,!1,process?.browser);`,
      );
    });

    test("--env=inline replaces every spelling of a variable that is set", async () => {
      expect(await build(["--no-bundle", "--env=inline", `--target=${target}`])).toBe(
        `x("staging", "staging", "staging", "staging", "staging", "staging", process.env["BUN_ENV"], false, process["browser"], process?.browser);`,
      );
    });

    test("--drop of one of the names drops a call in every spelling", async () => {
      const calls = `x(process.browser(a()), process["browser"](b()), process?.browser(c()));`;
      expect(await build(["--no-bundle", `--target=${target}`, "--drop=process.browser"], calls)).toBe(
        "x(undefined, undefined, undefined);",
      );
    });

    test("Bun.build replaces the dotted spelling alone", async () => {
      using dir = tempDir("bundler-define-defaults-api", { "entry.js": source });
      const result = await Bun.build({ entrypoints: [join(String(dir), "entry.js")], target });
      expect(result.logs).toEqual([]);
      const output = onOneLine(await result.outputs[0].text());
      expect(output).toBe(dottedAlone(modeOf(output)));
    });
  });

  test.each(modes)("bun build, %s, --target=browser replaces every spelling", async (_, mode) => {
    expect(await build([...mode, "--target=browser"])).toBe(everySpelling('"staging"', "true"));
  });

  test("Bun.Transpiler replaces every spelling for a browser, and the dotted spelling alone for node", () => {
    const transform = (options: TranspilerOptions) =>
      onOneLine(new Bun.Transpiler(options).transformSync(source, "js"));
    const outputs = {
      default: transform({}),
      browser: transform({ target: "browser" }),
      node: transform({ target: "node" }),
    };
    const mode = modeOf(outputs.node);
    expect(outputs).toEqual({
      default: everySpelling(mode, "true"),
      browser: everySpelling(mode, "true"),
      node: dottedAlone(mode),
    });
  });
});

describe("bundler", () => {
  // The executable reads the real `process` through the other spellings. `process.arch` is here the program's own define.
  itBundled("define/CompileTargetDefinesReplaceDottedSpellingAlone", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.js": /* js */ `
        Object.defineProperty(process, "platform", { value: "made up" });
        Object.defineProperty(process, "arch", { value: "made up" });
        console.log(process.platform === "made up", process["platform"], process?.platform);
        console.log(process.arch, process["arch"], process?.arch);
      `,
    },
    define: { "process.arch": '"mine"' },
    run: { stdout: "false made up made up\nmine mine mine" },
  });
});

describe.concurrent("define key errors", () => {
  test.each([
    ["a-b", 'define key "a-b" must be a valid identifier'],
    ["a.b-c", 'define key "a.b-c" contains invalid identifier "b-c"'],
    ["a.b.", 'define key "a.b." contains invalid identifier ""'],
    ["null.x", 'define key "null.x" contains invalid identifier "null"'],
    ["import.foo", 'define key "import.foo" contains invalid identifier "import"'],
    ["a[b]", 'define key "a[b]" must use a quoted string inside "[]"'],
    ['a["b"', 'define key "a["b"" must use a quoted string inside "[]"'],
    ['a["b"]c', 'define key "a["b"]c" must use a quoted string inside "[]"'],
    ['a["\\n"]', 'define key "a["\\n"]" has an escape that is not supported inside "[]"'],
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
