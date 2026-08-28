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

/** One source statement and the statement the output must contain. */
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
      ["console.log(a.b);", "console.log(c);"],
      ["console.log(a?.b);", "console.log(c);"],
      ["console.log(a?.b.c);", "console.log(d);"],
      ["console.log(a.b?.c);", "console.log(d);"],
      ['console.log(a?.["b"]);', "console.log(c);"],
      ['console.log(a["b"]);', "console.log(c);"],
      ["console.log(process?.env?.NODE_ENV);", 'console.log("production");'],
      ['console.log(process.env["NODE_ENV"]);', 'console.log("production");'],
      ['console.log(process["env"]["NODE_ENV"]);', 'console.log("production");'],
      ['console.log(process["env"].NODE_ENV);', 'console.log("production");'],
      // The rest of a partly replaced optional chain continues on the new value
      ["console.log(a?.b.x);", "console.log(c.x);"],
      ["console.log(a?.b());", "console.log(c());"],
      ['console.log(a?.["b"].x);', "console.log(c.x);"],
      ["console.log(a.b?.x);", "console.log(c?.x);"],
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
      ["console.log(A);", "console.log(import.meta);"],
      ["console.log(B);", "console.log(import.meta.url);"],
      // A top-level `this` in a CommonJS file is `exports`
      ["console.log(C);", "console.log(exports.foo);"],
      // Inside a function `this` stays `this`
      ["console.log(function () { return C; });", "return this.foo;"],
      ["console.log(F);", "console.log(a.if);"],
      ["console.log(window.env);", "console.log(import.meta.env);"],
      ["console.log(N);", "console.log(null);"],
      ["console.log(U);", "console.log(undefined);"],
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
      ["((g) => console.log(g))(this);", "((g) => console.log(g))(window);"],
      ["console.log(FOO);", "console.log(123n);"],
      ["console.log(HEX);", "console.log(0xffn);"],
      ['console.log(process.env["SOME-VAR"]);', "console.log(3);"],
      ["console.log(process.env['SOME-VAR']);", "console.log(3);"],
      ['console.log(process?.env?.["SOME-VAR"]);', "console.log(3);"],
      ['console.log(process.env["dotted.name"]);', "console.log(4);"],
      // Only a top-level `this` is replaced
      ["console.log(function () { return this; });", "return this;"],
    ],
  },
  {
    name: "a constant define is not substituted into an assignment target",
    defines: {
      FOO: "123",
      BAR: "a.b",
    },
    cases: [
      ["FOO = 1;", "FOO = 1;"],
      ["console.log(FOO);", "console.log(123);"],
      // An identifier or a member chain is a valid target
      ["BAR = 2;", "a.b = 2;"],
    ],
  },
];

describe.each(surfaces)("$name", surface => {
  for (const repro of repros) {
    describe(repro.name, () => {
      // One transpile per surface and repro. Every statement is its own line,
      // so each case can assert on its own output line.
      const source = repro.cases.map(([input]) => input).join("\n") + "\n";
      let output: Promise<string> | undefined;
      const getOutput = () => (output ??= surface.run(source, repro.defines));

      test.each(repro.cases)("%s => %s", async (_input, expected) => {
        const lines = (await getOutput()).split("\n").map(line => line.trim());
        expect(lines).toContain(expected);
      });
    });
  }
});

describe("define values are symbols, not text", () => {
  test("a member chain follows a renamed local and a renamed import", async () => {
    using dir = tempDir("bundler-define-link", {
      "entry.js": `
        import { x } from "./x.js";
        const local = { b: { c: 1 } };
        console.log(A, B.y);
      `,
      "x.js": `export const x = { y: 2 };`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
      define: { A: "local.b.c", B: "x" },
      minify: { identifiers: true },
    });
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);
    const output = await result.outputs[0].text();
    // `local` and `x` were renamed, so the define values must not print verbatim
    expect(output).not.toContain("local.b.c");
    expect(output).not.toContain("x.y");

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
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(message);
    expect(exitCode).not.toBe(0);
  });

  test("a keyword is a valid property name after the first part", async () => {
    const transpiler = new Bun.Transpiler({ define: { "a.if": "1", "this.x": "2", "import.meta.env.MODE": '"test"' } });
    expect(transpiler.transformSync("console.log(a.if, this.x, import.meta.env.MODE);", "js").trim()).toBe(
      'console.log(1, 2, "test");',
    );
  });
});
