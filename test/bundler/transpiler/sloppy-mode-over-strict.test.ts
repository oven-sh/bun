// Valid sloppy-mode (Annex B / non-strict) constructs that Node accepts but
// Bun's transpiler used to hard-reject. A bare `.js` entry with no CJS/ESM
// markers is evaluated by Bun as a module (strict), so these tests force
// CommonJS via a `module.exports` marker, matching the real-world case of a
// legacy npm package loaded via `require`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(body: string, cjs = true) {
  const source = cjs ? body + "\nmodule.exports = {};\n" : body;
  using dir = tempDir("sloppy-mode", { "x.js": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "x.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("sloppy-mode constructs the transpiler must accept", () => {
  test("duplicate parameter names in a plain function declaration", async () => {
    const { stdout, stderr, exitCode } = await run(
      `function f(a, a) { return a }\nconsole.log(f(1, 2));`,
    );
    expect(stderr).not.toContain("cannot be bound multiple times");
    expect(stdout.trim()).toBe("2");
    expect(exitCode).toBe(0);
  });

  test("duplicate parameter names in a plain function expression", async () => {
    const { stdout, stderr, exitCode } = await run(
      `var e = function(b, b) { return b };\nconsole.log(e(1, 2));`,
    );
    expect(stderr).not.toContain("cannot be bound multiple times");
    expect(stdout.trim()).toBe("2");
    expect(exitCode).toBe(0);
  });

  test("nested function with duplicate parameter names", async () => {
    const { stdout, exitCode } = await run(
      `function outer() { function f(a, a) { return a } return f(3, 4) }\nconsole.log(outer());`,
    );
    expect(stdout.trim()).toBe("4");
    expect(exitCode).toBe(0);
  });

  test("assignment to eval and arguments", async () => {
    const { stdout, stderr, exitCode } = await run(
      `eval = 2; arguments = 3; eval++;\nconsole.log(eval, arguments);`,
    );
    expect(stderr).not.toContain("Invalid assignment target");
    expect(stdout.trim()).toBe("3 3");
    expect(exitCode).toBe(0);
  });

  test("var await as a top-level binding in a Script", async () => {
    const { stdout, stderr, exitCode } = await run(
      `var await = 42;\nfunction g() { return await; }\nconsole.log(g());`,
    );
    expect(stderr).not.toContain(`Cannot use "yield" or "await" here`);
    expect(stdout.trim()).toBe("42");
    expect(exitCode).toBe(0);
  });

  test("legacy octal escape at end of string (1 digit)", async () => {
    const { stdout, stderr, exitCode } = await run(
      `console.log("x\\7".charCodeAt(1));`,
    );
    expect(stderr).not.toContain("Syntax Error");
    expect(stdout.trim()).toBe("7");
    expect(exitCode).toBe(0);
  });

  test("legacy octal escape at end of string (2 digits)", async () => {
    const { stdout, exitCode } = await run(`console.log("x\\77".charCodeAt(1));`);
    expect(stdout.trim()).toBe("63");
    expect(exitCode).toBe(0);
  });

  test("legacy octal escape followed by 8/9", async () => {
    const { stdout, stderr, exitCode } = await run(
      `var a = "\\1".charCodeAt(0);\n` +
        `var b = "ab\\5".charCodeAt(2);\n` +
        `var c = "\\018x";\n` +
        `var d = "\\09x";\n` +
        `console.log(JSON.stringify([a, b, c.length, c.charCodeAt(0), c.charCodeAt(1), d.length, d.charCodeAt(0), d.charCodeAt(1)]));`,
    );
    expect(stderr).not.toContain("error");
    expect(stdout.trim()).toBe("[1,5,3,1,56,3,0,57]");
    expect(exitCode).toBe(0);
  });

  test("legacy octal escapes that already worked keep working", async () => {
    const { stdout, exitCode } = await run(
      `console.log(JSON.stringify(["\\010".charCodeAt(0), "\\101", "\\377".charCodeAt(0), "\\7x".charCodeAt(0)]));`,
    );
    expect(stdout.trim()).toBe(`[8,"A",255,7]`);
    expect(exitCode).toBe(0);
  });

  test("<!-- HTML open comment is a line comment", async () => {
    const { stdout, stderr, exitCode } = await run(
      `var h = 1 <!-- comment\nconsole.log("ok", h);`,
    );
    expect(stderr).not.toContain("Legacy HTML comments");
    expect(stdout.trim()).toBe("ok 1");
    expect(exitCode).toBe(0);
  });

  test("<!-- at start of line", async () => {
    const { stdout, exitCode } = await run(`<!-- this is ignored\nconsole.log("ok");`);
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("strict-mode / unique-formal-parameter rejections still fire", () => {
  test("duplicate parameters in a method", async () => {
    const { exitCode, stderr } = await run(`({ m(a, a) { return a } });`);
    expect(stderr).toContain("cannot be bound multiple times");
    expect(exitCode).not.toBe(0);
  });

  test("duplicate parameters in an arrow function", async () => {
    const { exitCode, stderr } = await run(`var f = (a, a) => a;`);
    expect(stderr).toContain("cannot be bound multiple times");
    expect(exitCode).not.toBe(0);
  });

  test('duplicate parameters under "use strict"', async () => {
    const { exitCode, stderr } = await run(
      `"use strict";\nfunction f(a, a) { return a }\nvoid f;`,
    );
    expect(stderr).toContain("cannot be bound multiple times");
    expect(exitCode).not.toBe(0);
  });

  test("duplicate parameters with non-simple parameter list", async () => {
    const { exitCode, stderr } = await run(`function f(a, a = 1) { return a }\nvoid f;`);
    expect(stderr).toContain("cannot be bound multiple times");
    expect(exitCode).not.toBe(0);
  });

  test("var await inside async function still rejected", async () => {
    const { exitCode, stderr } = await run(
      `async function f() { var await = 1; }\nf();`,
    );
    expect(stderr).toMatch(/await/);
    expect(exitCode).not.toBe(0);
  });

  test("assignment to eval in an ESM file still rejected", async () => {
    const { exitCode, stderr } = await run(`export {};\neval = 1;`, false);
    expect(stderr).toMatch(/eval/);
    expect(exitCode).not.toBe(0);
  });
});

describe("bun build accepts sloppy CommonJS", () => {
  test("duplicate params survive bundling to CJS", async () => {
    using dir = tempDir("sloppy-build", {
      "x.js": `function f(a, a) { return a }\nmodule.exports = f(1, 2);\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "x.js", "--format=cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).not.toContain("cannot be bound multiple times");
    expect(stdout).toContain("function f(a, a)");
    expect(exitCode).toBe(0);
  });
});
