import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// A direct eval can declare a binding in the scope that contains it (sloppy
// `eval("var x = 1")`) and can read any name in the scopes that enclose it.
// So a scope that contains a direct eval must keep its `const` values as
// references, and none of the names visible from a direct eval may be
// renamed, including the top-level names of the file.
//
// Every fixture is sloppy CommonJS. `expected` is what Node prints. `keep`
// lists source text that every transpiled output must still contain.
const fixtures = {
  "const shadowed by eval var, one function deep": {
    source: /* js */ `
      const variable = false;
      (function () {
        eval("var variable = true");
        console.log(variable);
      })();
      console.log(variable);
    `,
    expected: "true\nfalse",
    keep: ["console.log(variable)"],
  },
  "const shadowed by eval var, two functions deep": {
    source: /* js */ `
      const variable = false;
      (function () {
        (function () {
          eval("var variable = true");
          console.log(variable);
        })();
        console.log(variable);
      })();
      console.log(variable);
    `,
    expected: "true\nfalse\nfalse",
    keep: ["console.log(variable)"],
  },
  "eval reads top-level names, at module scope": {
    source: /* js */ `
      var outerVariable = 123;
      var inner = 1;
      console.log(eval("outerVariable + inner"));
    `,
    expected: "124",
    keep: ["outerVariable", "inner"],
  },
  "eval reads top-level names, one function deep": {
    source: /* js */ `
      var outerVariable = 123;
      var r = function (code) { var inner = 1; return eval(code) }("outerVariable + inner");
      console.log(r);
    `,
    expected: "124",
    keep: ["outerVariable", "inner"],
  },
  "eval reads top-level names, two functions deep": {
    source: /* js */ `
      var outerVariable = 123;
      function outer() {
        var middle = 1;
        return function () { var inner = 1; return eval("outerVariable + middle + inner"); }();
      }
      console.log(outer());
    `,
    expected: "125",
    keep: ["outerVariable", "middle", "inner"],
  },
};

type Fixture = (typeof fixtures)[keyof typeof fixtures];
const cases = Object.entries(fixtures) as [string, Fixture][];

async function runFile(cwd: string, file: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout.trim();
}

async function bunBuild(cwd: string, args: string[]): Promise<void> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}

function expectKept(output: string, fixture: Fixture) {
  for (const text of fixture.keep) {
    expect(output).toContain(text);
  }
}

describe("direct eval", () => {
  describe("bun run", () => {
    test.concurrent.each(cases)(".cjs: %s", async (_name, fixture) => {
      using dir = tempDir("direct-eval-run", { "entry.cjs": fixture.source });
      expect(await runFile(String(dir), "entry.cjs")).toBe(fixture.expected);
    });

    test.concurrent.each(cases)("sloppy .js: %s", async (_name, fixture) => {
      using dir = tempDir("direct-eval-run-js", {
        "package.json": JSON.stringify({ type: "commonjs" }),
        "entry.js": fixture.source,
      });
      expect(await runFile(String(dir), "entry.js")).toBe(fixture.expected);
    });
  });

  // The bundled output is CommonJS so that it runs in sloppy mode like the
  // input. In an ES module, `eval("var x")` cannot declare `x` in the
  // enclosing scope.
  describe("bun build", () => {
    const modes = [
      ["--minify", ["--minify", "--format=cjs"]],
      ["--minify-syntax", ["--minify-syntax", "--format=cjs"]],
      ["--no-bundle --minify-identifiers", ["--no-bundle", "--minify-identifiers"]],
      ["--no-bundle --minify-syntax --target=bun", ["--no-bundle", "--minify-syntax", "--target=bun"]],
    ] as const;

    for (const [label, args] of modes) {
      test.concurrent.each(cases)(`${label}: %s`, async (_name, fixture) => {
        using dir = tempDir("direct-eval-build", { "entry.cjs": fixture.source });
        await bunBuild(String(dir), ["entry.cjs", "--outfile=out.cjs", ...args]);
        expectKept(await Bun.file(join(String(dir), "out.cjs")).text(), fixture);
        expect(await runFile(String(dir), "out.cjs")).toBe(fixture.expected);
      });
    }
  });

  describe("Bun.Transpiler", () => {
    const modes = [
      ["minify.identifiers", { minify: { identifiers: true } }],
      ["inline + minify.syntax", { inline: true, minify: { syntax: true } }],
    ] as const;

    for (const [label, options] of modes) {
      test.concurrent.each(cases)(`${label}: %s`, async (_name, fixture) => {
        const output = new Bun.Transpiler({ loader: "js", target: "bun", ...options }).transformSync(fixture.source);
        expectKept(output, fixture);
        using dir = tempDir("direct-eval-transpiler", { "out.cjs": output });
        expect(await runFile(String(dir), "out.cjs")).toBe(fixture.expected);
      });
    }
  });

  describe("Bun.build", () => {
    test.concurrent.each(cases)("minify: %s", async (_name, fixture) => {
      using dir = tempDir("direct-eval-api", { "entry.cjs": fixture.source });
      const result = await Bun.build({
        entrypoints: [join(String(dir), "entry.cjs")],
        minify: true,
        format: "cjs",
        write: false,
      });
      expect(result.success).toBe(true);
      const output = await result.outputs[0].text();
      expectKept(output, fixture);
      await Bun.write(join(String(dir), "out.cjs"), output);
      expect(await runFile(String(dir), "out.cjs")).toBe(fixture.expected);
    });
  });
});
