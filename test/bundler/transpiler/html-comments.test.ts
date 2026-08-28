import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Annex B (B.1.1 HTML-like Comments): in a script, `<!--` anywhere and `-->`
// at the start of a line start a single-line comment. Neither is allowed in an
// ECMAScript module.

// Bun.Transpiler throws on warnings unless the log level hides them.
const transpiler = new Bun.Transpiler({ loader: "js", logLevel: "error" });
const transpilerWithWarnings = new Bun.Transpiler({ loader: "js" });

function transform(code: string) {
  return transpiler.transformSync(code).trim();
}

function messages(code: string, t = transpiler): [string, string][] {
  try {
    t.transformSync(code);
  } catch (e) {
    const list = e instanceof AggregateError ? e.errors : [e];
    return list.map((m: { level: string; message: string }) => [m.level, m.message]);
  }
  throw new Error("Expected a parse error for:\n" + code);
}

const moduleError = "Legacy HTML single-line comments are not allowed in ECMAScript modules";
const warning = (opener: string) => `Treating "${opener}" as the start of a legacy HTML single-line comment`;

describe("script goal", () => {
  test("<!-- at the start of a line", () => {
    expect(transform("var x = 1;\n<!-- hidden\nf(x);")).toBe("var x = 1;\nf(x);");
    expect(transform("<!-- hidden\nvar x = 1;")).toBe("var x = 1;");
  });

  test("<!-- in the middle of a line", () => {
    expect(transform("var x = 1 <!-- comment to the end of the line\nf(x);")).toBe("var x = 1;\nf(x);");
    expect(transform("f(x) <!-- comment\nf(y)")).toBe("f(x);\nf(y);");
  });

  test("<!-- after return", () => {
    expect(transform("function f() {\n  return <!-- comment\n  g();\n}")).toBe("function f() {\n  return;\n  g();\n}");
  });

  test("<!-- at the end of the file", () => {
    expect(transform("var x = 1; <!-- no newline after")).toBe("var x = 1;");
  });

  test("<! without -- is still a less-than token", () => {
    expect(transform("var y = x <!a;")).toBe("var y = x < !a;");
    expect(transform("var y = x <!-a;")).toBe("var y = x < !-a;");
  });

  test("--> at the start of a line", () => {
    expect(transform("var x = 1;\n--> hidden\nf(x);")).toBe("var x = 1;\nf(x);");
    expect(transform("--> hidden at the start of the file\nvar x = 1;")).toBe("var x = 1;");
    expect(transform("var x = 1;\n   --> after whitespace\nf(x);")).toBe("var x = 1;\nf(x);");
    expect(transform("var x = 1;\n/* a\nb */ --> after a multi-line comment\nf(x);")).toBe("var x = 1;\nf(x);");
  });

  test("--> in the middle of a line is a decrement and a greater-than", () => {
    expect(transform("var y = x--> 0;")).toBe("var y = x-- > 0;");
  });

  test("each comment is reported as a warning", () => {
    expect(messages("var x = 1;\n<!-- hidden\nf(x);", transpilerWithWarnings)).toEqual([["warn", warning("<!--")]]);
    expect(messages("var x = 1;\n--> hidden\nf(x);", transpilerWithWarnings)).toEqual([["warn", warning("-->")]]);
  });
});

describe("module goal", () => {
  test("<!-- with an export", () => {
    expect(messages("export {};\n<!-- not allowed here")).toEqual([["error", moduleError]]);
    expect(messages("<!-- not allowed here\nexport {};")).toEqual([["error", moduleError]]);
  });

  test("--> with an export", () => {
    expect(messages("export {};\n--> not allowed here")).toEqual([["error", moduleError]]);
  });

  test("<!-- with an import", () => {
    expect(messages('import "x";\n<!-- not allowed here')).toEqual([["error", moduleError]]);
  });

  test("with top-level await", () => {
    expect(messages("await 1;\n<!-- not allowed here")).toEqual([["error", moduleError]]);
  });

  test("the warning comes before the error", () => {
    expect(messages("export {};\n<!-- not allowed here", transpilerWithWarnings)).toEqual([
      ["warn", warning("<!--")],
      ["error", moduleError],
    ]);
  });

  test("import() and require() do not make the file a module", () => {
    expect(transform('import("x");\n<!-- comment\nrequire("y");\n--> comment')).toBe('import("x");\nrequire("y");');
  });
});

describe("bun run", () => {
  const files = {
    "h.cjs": "var x = 1;\n<!-- hidden\nconsole.log(x) <!-- also a comment to end of line\n--> also hidden\n",
    "h.js": "var x = 1;\n<!-- hidden\nconsole.log(x) <!-- also a comment to end of line\n--> also hidden\n",
    "m.mjs": 'console.log("ran");\n--> not allowed here\n',
    "m.js": 'export {};\nconsole.log("ran");\n<!-- not allowed here\n',
    "type-module/package.json": '{ "type": "module" }',
    "type-module/index.js": 'console.log("ran");\n<!-- not allowed here\n',
  };

  async function run(dir: string, file: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", file],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("a script runs with the comments removed", async () => {
    using dir = tempDir("html-comments-script", files);
    for (const file of ["h.cjs", "h.js"]) {
      const { stdout, stderr, exitCode } = await run(String(dir), file);
      expect(stderr).toBe("");
      expect(stdout).toBe("1\n");
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("a module fails to parse", async () => {
    using dir = tempDir("html-comments-module", files);
    for (const file of ["m.mjs", "m.js", "type-module/index.js"]) {
      const { stdout, stderr, exitCode } = await run(String(dir), file);
      expect(stdout).toBe("");
      expect(stderr).toContain(moduleError);
      expect(exitCode).toBe(1);
    }
  });
});
