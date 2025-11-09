import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("jsx:preserve", () => {
  const source = "console.log(<span>Hello</span>);";
  const tsconfig = '{\n  "compilerOptions": {\n    "jsx": "preserve",\n    "target": "ESNext"\n  }\n}';

  test("bun build --jsx-runtime=preserve emits raw JSX", () => {
    using dir = tempDir("bun-jsx-preserve", {
      "input.tsx": source,
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<span>");
    expect(out).not.toContain("React.createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("preserve + `--minify` still emits JSX", () => {
    using dir = tempDir("bun-jsx-preserve-minify", {
      "input.tsx": source,
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--minify", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<span>");
    const stderrStr2 = String(stderr ?? "");
    expect(stderrStr2).toBe("");
    expect(exitCode).toBe(0);
  });

  test("spread props are preserved", () => {
    using dir = tempDir("bun-jsx-preserve-spread", {
      "spread.tsx": 'console.log(<Comp {...{foo:1,bar:"baz"}} />);',
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "spread.tsx");
    const outfile = path.join(String(dir), "out-spread.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const outSpread = readFileSync(outfile, "utf8");
    expect(outSpread).toContain("<Comp {...");
    expect(outSpread).not.toContain("createElement");
    const errSpread = String(stderr ?? "");
    expect(errSpread).toBe("");
    expect(exitCode).toBe(0);
  });

  test("JS expressions inside preserve", () => {
    using dir = tempDir("bun-jsx-preserve-expr", {
      "expr.tsx": "console.log(<div>{1+2}</div>);",
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "expr.tsx");
    const outfile = path.join(String(dir), "out-expr.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const outExpr = readFileSync(outfile, "utf8");
    expect(outExpr).toMatch(/\{\s*1\s*\+\s*2\s*}/);
    expect(outExpr).toContain("</div>");
    const errExpr = String(stderr ?? "");
    expect(errExpr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("nested elements preserved", () => {
    using dir = tempDir("bun-jsx-preserve-nested", {
      "nested.tsx": "console.log(<div><span><em>Text</em></span></div>);",
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "nested.tsx");
    const outfile = path.join(String(dir), "out-nested.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const outNested = readFileSync(outfile, "utf8");
    expect(outNested).toContain("<div><span><em>Text</em></span></div>");
    const errNested = String(stderr ?? "");
    expect(errNested).toBe("");
    expect(exitCode).toBe(0);
  });

  test("string attribute with single quote", () => {
    using dir = tempDir("bun-jsx-preserve-single-quote", {
      "input.tsx": `console.log(<div title="It's working" />);`,
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<div");
    expect(out).toContain("It's");
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("string attribute with double quotes", () => {
    using dir = tempDir("bun-jsx-preserve-double-quote", {
      "input.tsx": `console.log(<div title='He said "hello"' />);`,
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<div");
    expect(out).toContain('"hello"');
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("string attribute with backtick", () => {
    using dir = tempDir("bun-jsx-preserve-backtick", {
      "input.tsx": 'console.log(<div title="Code: `example`" />);',
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<div");
    expect(out).toContain("`example`");
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("string attribute with triple backticks", () => {
    using dir = tempDir("bun-jsx-preserve-triple-backticks", {
      "input.tsx": 'console.log(<div title="```" />);',
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<div");
    expect(out).toContain('title="```"');
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("children text with quotes and triple backticks are preserved", () => {
    using dir = tempDir("bun-jsx-preserve-children-text", {
      "input.tsx": 'console.log(<div>I\'m `ok` with ``` fences</div>);',
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<div>");
    expect(out).toContain("I'm `ok` with ``` fences");
    expect(out).toContain("</div>");
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("string attribute with expression containing quotes", () => {
    using dir = tempDir("bun-jsx-preserve-mixed-quotes", {
      "input.tsx": `const msg = "It's a \\"test\\" with backticks";\nconsole.log(<div title={msg} />);`,
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<div");
    expect(out).toContain("title={");
    // The output should preserve the JSX with the expression
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("minify mangles identifiers in JSX expressions", () => {
    using dir = tempDir("bun-jsx-preserve-mangle-vars", {
      "input.tsx": 'let greeting = "Hello";\n' + "let elements = <h3>{greeting}</h3>;\n" + "console.log(elements);\n",
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--minify", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    // Should still have JSX syntax
    expect(out).toContain("<h3>");
    expect(out).toContain("</h3>");
    // The identifier "greeting" should be mangled in the JSX expression
    // It should NOT contain the original "greeting" identifier in the JSX
    expect(out).not.toContain("<h3>{greeting}</h3>");
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("minify mangles component names in JSX", () => {
    using dir = tempDir("bun-jsx-preserve-mangle-components", {
      "input.tsx":
        "function Comp() { return null; }\n" + "let elements = <><Comp /></>;\n" + "console.log(elements);\n",
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--minify", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    // Should still have JSX fragment syntax
    expect(out).toContain("<>");
    expect(out).toContain("</>");
    // The component name "Comp" should be mangled in the JSX
    // It should NOT contain the original "Comp" identifier in the JSX
    expect(out).not.toContain("<Comp");
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("minify with multiple identifiers in JSX", () => {
    using dir = tempDir("bun-jsx-preserve-mangle-multi", {
      "input.tsx":
        'let firstName = "John";\n' +
        'let lastName = "Doe";\n' +
        'let title = "Welcome";\n' +
        "let element = <div title={title}><h1>{firstName} {lastName}</h1></div>;\n" +
        "console.log(element);\n",
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--minify", "--jsx-runtime=preserve", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    // Should preserve JSX structure
    expect(out).toContain("<div");
    expect(out).toContain("<h1>");
    expect(out).toContain("</h1>");
    expect(out).toContain("</div>");
    // All identifiers should be mangled in the JSX
    expect(out).not.toContain("{firstName}");
    expect(out).not.toContain("{lastName}");
    expect(out).not.toContain("{title}");
    expect(out).not.toContain("createElement");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("minify-identifiers renames locals inside preserved JSX", () => {
    using dir = tempDir("bun-jsx-preserve-minify-identifiers-vars", {
      "input.tsx": 'let greeting = "Hello";\nconsole.log(<h3>{greeting}</h3>);',
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", "--minify-identifiers", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<h3>");
    expect(out).toContain("</h3>");
    expect(out).not.toContain("greeting");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("minify-identifiers renames component names inside preserved JSX", () => {
    using dir = tempDir("bun-jsx-preserve-minify-identifiers-comps", {
      "input.tsx": "function Comp(){ return null }\nconsole.log(<><Comp/></>);",
      "tsconfig.json": tsconfig,
    });

    const input = path.join(String(dir), "input.tsx");
    const outfile = path.join(String(dir), "out.js");

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "build", "--jsx-runtime=preserve", "--minify-identifiers", input, "--outfile", outfile],
      cwd: String(dir),
      env: bunEnv,
    });

    const out = readFileSync(outfile, "utf8");
    expect(out).toContain("<>");
    expect(out).toContain("</>");
    expect(out).not.toContain("<Comp");
    const stderrStr = String(stderr ?? "");
    expect(stderrStr).toBe("");
    expect(exitCode).toBe(0);
  });
});
