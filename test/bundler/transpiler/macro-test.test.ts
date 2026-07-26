import { escapeHTML } from "bun" assert { type: "macro" };
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import path from "node:path";
import defaultMacro, {
  addStrings,
  addStringsUTF16,
  default as defaultMacroAlias,
  escape,
  identity,
  identity as identity1,
  identity as identity2,
  ireturnapromise,
} from "./macro.ts" assert { type: "macro" };

import * as macros from "./macro.ts" assert { type: "macro" };

test("bun builtins can be used in macros", async () => {
  expect(escapeHTML("abc!")).toBe("abc!");
});

test("latin1 string", () => {
  expect(identity("©")).toBe("©");
});

test("ascii string", () => {
  expect(identity("abc")).toBe("abc");
});

test("type coercion", () => {
  expect(identity({ a: 1 })).toEqual({ a: 1 });
  expect(identity([1, 2, 3])).toEqual([1, 2, 3]);
  expect(identity(undefined)).toBe(undefined);
  expect(identity(null)).toBe(null);
  expect(identity(1.5)).toBe(1.5);
  expect(identity(1)).toBe(1);
  expect(identity(true)).toBe(true);
});

test("escaping", () => {
  expect(identity("\\")).toBe("\\");
  expect(identity("\f")).toBe("\f");
  expect(identity("\n")).toBe("\n");
  expect(identity("\r")).toBe("\r");
  expect(identity("\t")).toBe("\t");
  expect(identity("\v")).toBe("\v");
  expect(identity("\0")).toBe("\0");
  expect(identity("'")).toBe("'");
  expect(identity('"')).toBe('"');
  expect(identity("`")).toBe("`");
  // prettier-ignore
  expect(identity("\'")).toBe("\'");
  // prettier-ignore
  expect(identity('\"')).toBe('\"');
  // prettier-ignore
  expect(identity("\`")).toBe("\`");
  expect(identity("$")).toBe("$");
  expect(identity("\x00")).toBe("\x00");
  expect(identity("\x0B")).toBe("\x0B");
  expect(identity("\x0C")).toBe("\x0C");

  expect(identity("\\")).toBe("\\");

  expect(escape()).toBe("\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C");

  expect(addStrings("abc")).toBe("abc\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\n")).toBe("\n\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\r")).toBe("\r\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\t")).toBe("\t\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("©")).toBe("©\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\x00")).toBe("\x00\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\x0B")).toBe("\x0B\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\x0C")).toBe("\x0C\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\\")).toBe("\\\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\f")).toBe("\f\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\v")).toBe("\v\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("\0")).toBe("\0\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("'")).toBe("'\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings('"')).toBe('"\\\f\n\r\t\v\0\'"`$\x00\x0B\x0C©');
  expect(addStrings("`")).toBe("`\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");
  expect(addStrings("😊")).toBe("😊\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C©");

  expect(addStringsUTF16("abc")).toBe("abc\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\n")).toBe("\n\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\r")).toBe("\r\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\t")).toBe("\t\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("©")).toBe("©\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\x00")).toBe("\x00\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\x0B")).toBe("\x0B\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\x0C")).toBe("\x0C\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\\")).toBe("\\\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\f")).toBe("\f\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\v")).toBe("\v\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("\0")).toBe("\0\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("'")).toBe("'\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16('"')).toBe('"\\\f\n\r\t\v\0\'"`$\x00\x0B\x0C😊');
  expect(addStringsUTF16("`")).toBe("`\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
  expect(addStringsUTF16("😊")).toBe("😊\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C😊");
});

test("utf16 string", () => {
  expect(identity("😊 Smiling Face with Smiling Eyes Emoji")).toBe("😊 Smiling Face with Smiling Eyes Emoji");
});

test("import aliases", () => {
  expect(identity1({ a: 1 })).toEqual({ a: 1 });
  expect(identity1([1, 2, 3])).toEqual([1, 2, 3]);
  expect(identity2({ a: 1 })).toEqual({ a: 1 });
  expect(identity2([1, 2, 3])).toEqual([1, 2, 3]);
});

test("default import", () => {
  expect(defaultMacro()).toBe("defaultdefaultdefault");
  expect(defaultMacroAlias()).toBe("defaultdefaultdefault");
});

test("namespace import", () => {
  expect(macros.identity({ a: 1 })).toEqual({ a: 1 });
  expect(macros.identity([1, 2, 3])).toEqual([1, 2, 3]);
  expect(macros.escape()).toBe("\\\f\n\r\t\v\0'\"`$\x00\x0B\x0C");
});

test("template string ascii", () => {
  expect(identity(`A${""}`)).toBe("A");
});

test("template string latin1", () => {
  expect(identity(`©${""}`)).toBe("©");
});

// The docs (bundler/macros.mdx, "Arguments") promise that a macro argument may
// reference a `const` whose value is statically known, including the result of
// another macro. Each shape is spawned as a fresh process so statement
// ordering at module scope is exactly what's written.
describe("const folding into macro arguments", () => {
  const macroModule = "export function identity(x) { return x; }\n" + "export function getText() { return 'foo'; }\n";

  async function runShape(name: string, entry: string, cmd: "run" | "build" | "build-minify" = "run") {
    using dir = tempDir(name, {
      "m.ts": macroModule,
      "entry.ts": entry,
    });
    const argv =
      cmd === "run"
        ? [bunExe(), "run", "entry.ts"]
        : cmd === "build"
          ? [bunExe(), "build", "--target=bun", "entry.ts"]
          : [bunExe(), "build", "--target=bun", "--minify-syntax", "entry.ts"];
    await using proc = Bun.spawn({
      cmd: argv,
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const importLine = 'import { identity, getText } from "./m.ts" with { type: "macro" };\n';

  test.concurrent("leading const", async () => {
    const r = await runShape("macro-const-a", importLine + "const N = 5;\nconsole.log(identity(N));\n");
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({ stdout: expect.stringMatching(/5\n$/) });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("const after an unrelated statement", async () => {
    const r = await runShape(
      "macro-const-b",
      importLine + 'console.log("x");\nconst N = 5;\nconsole.log(identity(N));\n',
    );
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({ stdout: expect.stringMatching(/x\n5\n$/) });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("const after an unrelated statement inside a function", async () => {
    const r = await runShape(
      "macro-const-b-fn",
      importLine + 'function go() {\n  console.log("x");\n  const N = 5;\n  console.log(identity(N));\n}\ngo();\n',
    );
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({ stdout: expect.stringMatching(/x\n5\n$/) });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("const from macro result", async () => {
    const r = await runShape("macro-const-c", importLine + "const foo = getText();\nconsole.log(identity(foo));\n");
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({ stdout: expect.stringMatching(/foo\n$/) });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("template literal with macro-result const", async () => {
    const r = await runShape(
      "macro-const-d",
      importLine + "const foo = getText();\nconsole.log(identity(`https://example.com/${foo}`));\n",
    );
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({
      stdout: expect.stringMatching(/https:\/\/example\.com\/foo\n$/),
    });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("template literal with non-ascii literal const", async () => {
    const r = await runShape(
      "macro-const-nonascii",
      importLine + 'const foo = "αβγ";\nconsole.log(identity(`prefix/${foo}`));\n',
    );
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({ stdout: expect.stringMatching(/prefix\/αβγ\n$/) });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("template literal with numeric const", async () => {
    const r = await runShape("macro-const-number", importLine + "const n = 42;\nconsole.log(identity(`n=${n}`));\n");
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({ stdout: expect.stringMatching(/n=42\n$/) });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("template literal after an unrelated statement, with macro-result const", async () => {
    const r = await runShape(
      "macro-const-combined",
      importLine + 'console.log("x");\nconst foo = getText();\nconsole.log(identity(`p/${foo}`));\n',
    );
    expect({ stdout: r.stdout, stderr: r.stderr }).toMatchObject({ stdout: expect.stringMatching(/x\np\/foo\n$/) });
    expect(r.exitCode).toBe(0);
  });

  test.concurrent("let bindings are still rejected", async () => {
    const r = await runShape("macro-const-let", importLine + "let N = 5;\nconsole.log(identity(N));\n");
    expect(r.stderr).toContain("Cannot convert identifier to JS");
    expect(r.exitCode).not.toBe(0);
  });

  test.concurrent("let bindings with a macro initialiser are still rejected", async () => {
    const r = await runShape(
      "macro-const-let-macroinit",
      importLine + "let x = getText();\nx = 'bar';\nconsole.log(identity(x));\n",
    );
    expect(r.stderr).toContain("Cannot convert identifier to JS");
    expect(r.exitCode).not.toBe(0);
  });

  test.concurrent("bun build: const after an unrelated statement", async () => {
    const r = await runShape(
      "macro-const-build-b",
      importLine + 'console.log("x");\nconst N = 5;\nconsole.log(identity(N));\n',
      "build",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toMatchObject({
      stdout: expect.stringContaining("console.log(5)"),
      exitCode: 0,
    });
  });

  test.concurrent("bun build: template literal with macro-result const", async () => {
    const r = await runShape(
      "macro-const-build-d",
      importLine + "const foo = getText();\nconsole.log(identity(`https://example.com/${foo}`));\n",
      "build",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toMatchObject({
      stdout: expect.stringContaining('"https://example.com/foo"'),
      exitCode: 0,
    });
  });

  // Tracking a past-prefix const for macro args must not leave a dead
  // declaration in minified output when all uses were inlined.
  test.concurrent("bun build --minify: past-prefix const is dropped after inlining", async () => {
    const r = await runShape(
      "macro-const-minify-dce",
      importLine + "export function foo() {\n  console.log(identity('x'));\n  const A = 1;\n  return A;\n}\n",
      "build-minify",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toMatchObject({
      stdout: expect.stringContaining("return"),
      exitCode: 0,
    });
    expect(r.stdout).not.toMatch(/\bA\s*=\s*1\b/);
  });

  // Regression guard: the macro-argument const folding must not collapse
  // `import()` / `require()` specifiers in the same file. Without minify the
  // bundler should still see the template as dynamic (`${x}` remains).
  test.concurrent("bun build: import()/require() specifiers stay dynamic", async () => {
    const r = await runShape(
      "macro-const-build-dyn",
      importLine +
        "const x = 'foo';\nconsole.log(identity(x));\nexport const p = import(`./a/${x}.js`);\nexport const q = () => require(`./b/${x}.js`);\n",
      "build",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toMatchObject({
      stdout: expect.stringMatching(/import\(`\.\/a\/\$\{x\}\.js`\)/),
      exitCode: 0,
    });
    expect(r.stdout).toMatch(/`\.\/b\/\$\{x\}\.js`/);
  });
});

test("ireturnapromise", async () => {
  expect(await ireturnapromise()).toEqual("aaa");
});

// A numeric key >= 100000 (JSC's MIN_SPARSE_ARRAY_INDEX) makes the property put inside
// JSC__JSValue__putToPropertyKey take a path that can throw, so the binding must check for
// an exception. BUN_JSC_validateExceptionChecks=1 aborts the child if the check is missing.
test("object argument with a sparse numeric key", async () => {
  using dir = tempDir("macro-sparse-key", {
    "take.ts": `export function take(o: any) {\n  return Object.keys(o).join(",");\n}\n`,
    "index.ts": `import { take } from "./take.ts" with { type: "macro" };\nconsole.log(take({ 200000: 1 }));\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // One combined assertion so stderr (where JSC prints the exception check failure) shows up in
  // the diff if the child aborts. Debug builds print "[macro] call take" to stdout before the
  // script's own output, so only the tail of stdout is matched.
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
    stdout: expect.stringMatching(/200000\n$/),
    exitCode: 0,
    signalCode: null,
  });
});

describe("--no-macros", () => {
  const files = {
    "macro.ts": `
      import { writeFileSync } from "node:fs";
      export function f() {
        writeFileSync("MACRO_RAN", "macro executed");
        return "INLINED_RESULT";
      }
    `,
    "entry.ts": `
      import { f } from "./macro.ts" with { type: "macro" };
      console.log(f());
    `,
  };

  test("bun build --no-macros refuses to run macros", async () => {
    using dir = tempDir("bundler-no-macros-cli", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-macros", "./entry.ts", "--outdir", "dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({
      stderr: expect.stringContaining("Macros are disabled"),
      exitCode: 1,
    });
    expect(existsSync(path.join(String(dir), "MACRO_RAN"))).toBe(false);
    expect(existsSync(path.join(String(dir), "dist", "entry.js"))).toBe(false);
  });

  test("Bun.build({ macros: false }) refuses to run macros", async () => {
    using dir = tempDir("bundler-no-macros-api", {
      ...files,
      "build.ts": `
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          outdir: "./dist",
          macros: false,
          throw: false,
        });
        console.log(JSON.stringify({
          success: result.success,
          logs: result.logs.map(l => l.message),
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "build.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const parsed = JSON.parse(stdout.trim().split("\n").pop()!);
    expect({ parsed, stderr, exitCode }).toMatchObject({
      parsed: {
        success: false,
        logs: expect.arrayContaining([expect.stringContaining("Macros are disabled")]),
      },
      exitCode: 0,
    });
    expect(existsSync(path.join(String(dir), "MACRO_RAN"))).toBe(false);
  });

  test("bun build without --no-macros still runs macros", async () => {
    using dir = tempDir("bundler-macros-enabled", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./entry.ts", "--outdir", "dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    const out = await Bun.file(path.join(String(dir), "dist", "entry.js")).text();
    expect(out).toContain("INLINED_RESULT");
    expect(existsSync(path.join(String(dir), "MACRO_RAN"))).toBe(true);
  });
});
