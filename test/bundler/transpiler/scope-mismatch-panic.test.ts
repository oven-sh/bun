import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("scope mismatch panic regression test", () => {
  test("should not panic with scope mismatch when arrow function is followed by array literal", async () => {
    // This test reproduces the exact panic that was fixed
    // The bug caused: "panic(main thread): Scope mismatch while visiting"

    using dir = tempDir("scope-mismatch", {
      "index.tsx": `
const Layout = () => {
  return (
    <html>
    </html>
  )
}

['1', 'p'].forEach(i =>
  app.get(\`/\${i === 'home' ? '' : i}\`, c => c.html(
    <Layout selected={i}>
      Hello {i}
    </Layout>
  ))
)`,
    });

    // With the bug, this would panic with "Scope mismatch while visiting"
    // With the fix, it should fail with a normal ReferenceError for 'app'
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.tsx"],
      env: { ...bunEnv, NODE_PATH: join(import.meta.dir, "..", "..", "node_modules") },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The key assertion: should NOT panic with scope mismatch
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Scope mismatch");

    // Should fail with a normal error instead (ReferenceError for undefined 'app')
    expect(stderr).toContain("ReferenceError");
    expect(stderr).toContain("app is not defined");
    expect(exitCode).not.toBe(0);
  });

  test("should not panic with simpler arrow function followed by array", async () => {
    using dir = tempDir("scope-mismatch-simple", {
      "test.js": `
const fn = () => {
  return 1
}
['a', 'b'].forEach(x => console.log(x))`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should not panic
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Scope mismatch");

    // Should successfully execute
    expect(stdout).toBe("a\nb\n");
    expect(exitCode).toBe(0);
  });

  test("correctly rejects direct indexing into block body arrow function", async () => {
    using dir = tempDir("scope-mismatch-reject", {
      "test.js": `const fn = () => {return 1}['x']`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should fail with a parse error, not a panic
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Scope mismatch");
    expect(stderr).toContain("error"); // Parse error or similar
    expect(exitCode).not.toBe(0);
  });
});

describe("TypeScript 'declare' statements discard scopes of dropped statements", () => {
  // Each of these parses a statement after "declare" that records scopes during the
  // parse pass and is then dropped. The recorded scopes used to be left behind, so
  // visiting the following class statement hit "Scope mismatch while visiting".
  const cases: [name: string, source: string, expected: string[]][] = [
    [
      "declare const with an arrow function initializer followed by a class",
      "declare const x = () => {};\nclass Foo {}\n",
      ["class Foo"],
    ],
    [
      "declare global containing nested blocks followed by a class",
      "declare global { if (1) { let x = 1 } }\nclass Foo {}\n",
      ["class Foo"],
    ],
    [
      "export declare with an initializer inside a namespace",
      "namespace ns { export declare const x = () => {}; export function y() { return x } }\nclass Foo {}\n",
      ["function y", "class Foo"],
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, source, expected) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(new Bun.Transpiler({ loader: "tsx" }).transformSync(${JSON.stringify(source)}))`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    for (const substring of expected) {
      expect(stdout).toContain(substring);
    }
    expect(exitCode).toBe(0);
  });
});

describe("macro tagged templates visit their interpolations", () => {
  // When a tagged template's tag resolves to a macro import, the macro dispatch
  // replaces the whole expression (dead code, macros disabled, or the macro call
  // failing) without visiting the template parts. Scopes recorded during the parse
  // pass for arrows/functions inside the interpolations were then never consumed by
  // the visit pass, panicking with "Scope mismatch while visiting" on the next scope.
  const macroFile = `export function mac(...args: any[]) { return "from-macro"; }`;

  test.concurrent("tagged template macro with arrow interpolation reports the macro error", async () => {
    using dir = tempDir("macro-template-scope", {
      "macro.ts": macroFile,
      "index.ts": `
import { mac } from './macro.ts' with { type: 'macro' };
const r = mac\`a\${() => { let q = 1; }}b\`;
function g() { { let y = 1; } }
g();`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Must fail with the intended transpiler error, not a scope mismatch panic.
    expect(stderr).not.toContain("Scope mismatch");
    expect(stderr).toContain("template literal macro invocations are not supported");
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("tagged template macro with arrow interpolation in dead code is erased", async () => {
    using dir = tempDir("macro-template-scope-dead", {
      "macro.ts": macroFile,
      "index.ts": `
import { mac } from './macro.ts' with { type: 'macro' };
false && mac\`a\${() => { let q = 1; }}b\`;
function g() { { let y = 2; console.log("ran", y); } }
g();`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Scope mismatch");
    expect(stdout).toBe("ran 2\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("member-expression macro tag with function interpolation reports the macro error", async () => {
    using dir = tempDir("macro-template-scope-ns", {
      "macro.ts": macroFile,
      "index.ts": `
import * as macros from './macro.ts' with { type: 'macro' };
macros.mac\`x\${function inner() { let z = 3; }}y\`;
class C { m() { { let w = 4; } } }
new C().m();`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Scope mismatch");
    expect(stderr).toContain("template literal macro invocations are not supported");
    expect(exitCode).not.toBe(0);
  });
});

describe("dropped TypeScript class members discard scopes", () => {
  // Decorators and computed keys are parsed before the parser knows whether the class
  // member they belong to will be kept. When the member is then dropped (an overload
  // signature, abstract/declare method, or index signature), they are dropped too.
  // Scopes recorded while parsing them (e.g. arrow functions) used to be left behind,
  // so visiting a later scope of a different kind hit "Scope mismatch while visiting".
  const cases: [name: string, source: string, expected: string[]][] = [
    [
      "arrow decorator on a method overload signature plus an arrow parameter decorator",
      "class C {\r@((td) => { })oo(): oo;\n h(@(() => {})ny) {}}",
      ["class C"],
    ],
    [
      "arrow decorator on a method overload signature followed by a nested block",
      "class C { @((td) => { })oo(): oo; h() { { let x; } } }",
      ["class C"],
    ],
    [
      "arrow decorator on an abstract method",
      "abstract class C { @((td) => { })abstract oo(): void; h() { { let x; } } }",
      ["class C"],
    ],
    [
      "arrow decorator on a declare method",
      "class C { @((td) => { })declare oo(): void;\n h() { { let x; } } }",
      ["class C"],
    ],
    [
      "arrow decorator on an index signature",
      "class C { @((td) => { })[key: string]: any;\n h() { { let x; } } }",
      ["class C"],
    ],
    [
      "arrow decorator on a method overload signature followed by a function after the class",
      "class C { @((td) => { })oo(): oo; }\nfunction f() { { let x; } }",
      ["class C", "function f"],
    ],
    [
      "arrow function in the computed key of a method overload signature",
      "class C { [((x) => x)('foo')](): void; h() { { let x; } } }",
      ["class C"],
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, source, expected) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(new Bun.Transpiler({ loader: "tsx" }).transformSync(${JSON.stringify(source)}))`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    for (const substring of expected) {
      expect(stdout).toContain(substring);
    }
    expect(exitCode).toBe(0);
  });
});
