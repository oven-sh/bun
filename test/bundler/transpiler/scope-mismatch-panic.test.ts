import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// The tests that use the two helpers below are not concurrent. Concurrent tests that follow
// each other run as one batch, across `describe` blocks too, and debug builds that start at
// the same time take seconds each.

// Runs `script` in one process, once. For each row it prints a line: "row " and a JSON pair
// of the name of the row and its result.
function inOneProcess(script: string) {
  let ran: Promise<{ results: Map<string, unknown>; stderr: string; exitCode: number }> | undefined;
  return () =>
    (ran ??= (async () => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe", stdout: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const pairs = stdout
        .split("\n")
        .filter(line => line.startsWith("row "))
        .map((line): [string, unknown] => JSON.parse(line.slice("row ".length)));
      return { results: new Map(pairs), stderr, exitCode };
    })());
}

// Runs `bun` with `args` in a directory that holds `files`. It has to report `error`, and no other error.
async function expectOneError(files: Record<string, string>, args: string[], error: string) {
  using dir = tempDir("misplaced-decorator", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stdout: "",
    errors: [`error: ${error}`],
    exitCode: 1,
  });
}

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

describe("the body of `declare global` does not take the decorators in front of it", () => {
  // `@dec declare global { ... }` reports `Expected "class"` and the parser goes on. The
  // body was parsed with the decorators of that statement. A `declare` statement in the body
  // then discarded the scopes from the index in front of the decorators, and the discard of
  // the `declare global` arm sliced past the end of the list: "range start index 3 out of
  // range for slice of length 1". With no scope in the decorator, each such statement
  // reported `Expected "class"` a second time.
  const expectedClass = (found: string) => `Expected "class" but found "${found}"`;
  const oneError = [expectedClass("global")];

  // Prints, for each row, the output of `transformSync` or the list of the error messages.
  const transformEach = (rows: [name: string, source: string, ...unknown[]][]) =>
    inOneProcess(`
      for (const [name, source] of ${JSON.stringify(rows)}) {
        let result;
        try {
          result = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
        } catch (e) {
          result = (e.errors ?? [e]).map(e => e.message);
        }
        console.log("row " + JSON.stringify([name, result]));
      }`);

  const rejected: [name: string, source: string, messages: string[]][] = [
    ["`global` in a module", "declare module 'm' { @dec(() => 0) global { declare const c: any } }", oneError],
    [
      "`declare global` in `global` in a module",
      "declare module 'm' { @dec(() => 0) global { declare global { declare const c: any } } }",
      oneError,
    ],
    [
      "`declare global` in `global` in a namespace",
      "declare namespace N { @dec(() => 0) global { declare global { declare const c: any } } }",
      oneError,
    ],
    ["no scope in the decorator", "@dec(0) declare global { declare const c: any }", oneError],
    ...[
      "declare const c: any",
      "declare let c: any",
      "declare var c: any",
      "declare function f(): void",
      "declare class C {}",
      "declare abstract class C {}",
      "declare namespace N {}",
      "declare type T = 1",
      "declare interface I {}",
      "declare enum E {}",
      "export declare const c: any",
      "declare global { declare const c: any }",
      // The other readers of the decorators of a statement: a label, `abstract` and `declare`.
      "label: 1",
      "abstract\nclass C {}",
      "declare\nlet c: number",
    ].map((body): [string, string, string[]] => [
      `a body of ${JSON.stringify(body)}`,
      `@dec(() => 0) declare global { ${body} }`,
      oneError,
    ]),
    ["behind export", "@dec(() => 0) export declare global { declare const c: any }", oneError],
    ["in a namespace", "namespace N { @dec(() => 0) declare global { declare const c: any } }", oneError],
    ["in a function", "function f() { @dec(() => 0) declare global { declare const c: any } }", oneError],
    ["a class in the decorator", "@dec(class { m() {} }) declare global { declare const c: any }", oneError],
    // Both tokens are of the decorated statement itself.
    [
      "`declare declare global`",
      "@dec(() => 0) declare declare global { declare const c: any }",
      [expectedClass("declare"), expectedClass("global")],
    ],
  ];
  const transformRejected = transformEach(rejected);

  test.each(rejected)("%s", async (name, _source, messages) => {
    const { results, stderr, exitCode } = await transformRejected();
    expect({ result: results.get(name), stderr, exitCode }).toEqual({ result: messages, stderr: "", exitCode: 0 });
  });

  const accepted: [name: string, source: string, output: string][] = [
    ["a decorated `declare class`", "@dec(() => 0) declare class C {}\nclass Foo {}", "class Foo {\n}\n"],
    [
      "a decorated `declare class` in the body",
      "declare global { @dec(() => 0) declare class C {} }\nclass Foo {}",
      "class Foo {\n}\n",
    ],
    [
      "an exported `declare global` in a namespace",
      "namespace N { export declare global { class C {} } }",
      "var N;\n((N) => {})(N ||= {});\n",
    ],
  ];
  const transformAccepted = transformEach(accepted);

  test.each(accepted)("%s is still accepted", async (name, _source, output) => {
    const { results, stderr, exitCode } = await transformAccepted();
    expect({ result: results.get(name), stderr, exitCode }).toEqual({ result: output, stderr: "", exitCode: 0 });
  });

  const files = {
    "declare-global.ts": `declare const dec: any;\n@dec(() => 0) declare global { declare const c: any }\nconsole.log("ran");\n`,
    "global.ts": `declare const dec: any;\ndeclare module "m" { @dec(() => 0) global { declare const c: any } }\nconsole.log("ran");\n`,
  };

  test.each([
    ["bun declare-global.ts", ["declare-global.ts"]],
    ["bun build --no-bundle declare-global.ts", ["build", "--no-bundle", "declare-global.ts"]],
    ["bun global.ts", ["global.ts"]],
    ["bun build --no-bundle global.ts", ["build", "--no-bundle", "global.ts"]],
  ])("%s", (_name, args) => expectOneError(files, args, expectedClass("global")));
});

describe("a decorator in front of `declare` or `abstract` that is a name", () => {
  // `@dec declare(0);` is an expression statement, and so is `@dec export declare(0);`. The
  // parser reports nothing and drops the decorators. A scope in a decorator is then left
  // over, and the visit pass stops at the block of `f`: "Scope mismatch while visiting". In
  // front of a scope of the same kind a release build does not stop. It binds the names of
  // the next function in the left-over scope. With no scope in the decorator the file runs,
  // and the decorator is never called.
  test.todo.each([
    "@dec((d) => d) declare(0);",
    "@dec((d) => d) abstract = 2;",
    "@dec((d) => d) export declare(0);",
    "@dec((d) => d) export abstract = 2;",
    "@dec(0) declare(0);",
    "@dec(0) abstract = 2;",
  ])("%s is a syntax error", statement =>
    expectOneError(
      {
        "bad.ts": `function dec(...args: any[]): any {}\nvar declare: any = () => {};\nvar abstract: any = 1;\n${statement}\nfunction f() { { let x; } }\nconsole.log("ran");\n`,
      },
      ["bad.ts"],
      "Decorators are not valid here",
    ),
  );
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

describe("a decorator on a class static block is a syntax error", () => {
  // The parser took the static block and dropped the decorators in front of it. A decorator
  // with no scope was dropped and never called. The scopes of an arrow, function or class in
  // a decorator were never visited, and the scope of the block hit "Scope mismatch while
  // visiting".
  const message = "Decorators are not valid here";

  // `scanImports` does not parse decorators in a JavaScript file.
  const apisOf = (loader: string) => (loader === "js" ? ["transformSync"] : ["transformSync", "scanImports"]);

  // Prints, for each row and each of its APIs, "accepted" or the list of the errors.
  const probeEach = (rows: [name: string, loader: string, source: string, apis: string[]][]) =>
    inOneProcess(`
      for (const [name, loader, source, apis] of ${JSON.stringify(rows)}) {
        const result = {};
        for (const api of apis) {
          try {
            new Bun.Transpiler({ loader })[api](source);
            result[api] = "accepted";
          } catch (e) {
            result[api] = (e.errors ?? [e]).map(e => [e.constructor.name, e.message, e.position?.line, e.position?.column]);
          }
        }
        console.log("row " + JSON.stringify([name, result]));
      }`);

  // "^" marks the place of the error: the first decorator expression.
  const rejected: [name: string, loader: "ts" | "tsx" | "js", marked: string][] = [
    ["no scope in the decorator", "ts", "class A { @^dec static {} }"],
    ["a call with no scope", "ts", "class A { @^dec(0) static {} }"],
    ["in a `declare class`", "ts", "declare class A { @^dec static {} }"],
    ["js, no scope in the decorator", "js", "class A { @^dec static {} }"],
    ["an arrow in the decorator", "ts", "class A { @^dec(() => 0) static {} }"],
    ["a function in the decorator", "ts", "class A { @^dec(function () {}) static {} }"],
    ["a class in the decorator", "ts", "class A { @^dec(class {}) static {} }"],
    ["an arrow in parentheses", "ts", "class A { @(^()=>0)static{} }"],
    ["two decorators", "ts", "class A { @^a @b(() => 0) static {} }"],
    ...["public", "private", "protected", "readonly", "override", "static", "async"].map(
      (modifier): [string, "ts", string] => [
        `\`${modifier}\` in front of the block`,
        "ts",
        `class A { @^dec(() => 0) ${modifier} static {} }`,
      ],
    ),
    ["a line break in front of the brace", "ts", "class A { @^dec(() => 0) static\n{} }"],
    ["`declare` in front of the block", "ts", "class A { @^dec(() => 0) declare static {} }"],
    ["`abstract` in front of the block", "ts", "abstract class A { @^dec(() => 0) abstract static {} }"],
    ["in a class expression", "ts", "const A = class { @^dec(() => 0) static {} };"],
    ["in `export default class`", "ts", "export default class { @^dec(() => 0) static {} }"],
    ["in a nested class", "ts", "class A { m() { return class { @^dec(() => 0) static {} }; } }"],
    ["tsx", "tsx", "class A { @^dec(() => 0) static {} }"],
    ["js, an arrow in the decorator", "js", "class A { @^dec(() => 0) static {} }"],
    ["js, `static` in front of the block", "js", "class A { @^dec(() => 0) static static {} }"],
    ["js, `async` in front of the block", "js", "class A { @^dec(() => 0) async static {} }"],
    ["js, a line break in front of the brace", "js", "class A { @^dec(() => 0) static\n{} }"],
  ];
  const probeRejected = probeEach(
    rejected.map(([name, loader, marked]) => [name, loader, marked.replace("^", ""), apisOf(loader)]),
  );

  test.each(rejected)("%s", async (name, loader, marked) => {
    const errors = [["BuildMessage", message, 1, marked.indexOf("^") + 1]];
    const { results, stderr, exitCode } = await probeRejected();
    expect({ result: results.get(name), stderr, exitCode }).toEqual({
      result: Object.fromEntries(apisOf(loader).map(api => [api, errors])),
      stderr: "",
      exitCode: 0,
    });
  });

  const accepted: [name: string, source: string][] = [
    ["a static block", "class A { static {} }"],
    ["a static block with a line break in front of the brace", "class A { static\n{} }"],
    ["a decorated static field", "class A { @dec static x = 1 }"],
    ["a decorated field with the name static", "class A { @dec static; }"],
    ["a decorated static method", "class A { @dec static m() {} }"],
    ["a decorated method with the name static", "class A { @dec static() {} }"],
    ["a decorated static method with the name static", "class A { @dec static static() {} }"],
    ["a static block after a decorated method", "class A { @dec m() {} static {} }"],
    ["a static block after a decorated private field", "class A { @dec #p = 1; static {} }"],
  ];
  const probeAccepted = probeEach(accepted.map(([name, source]) => [name, "ts", source, ["transformSync"]]));

  test.each(accepted)("%s is still accepted", async name => {
    const { results, stderr, exitCode } = await probeAccepted();
    expect({ result: results.get(name), stderr, exitCode }).toEqual({
      result: { transformSync: "accepted" },
      stderr: "",
      exitCode: 0,
    });
  });

  const typescript = `function dec(...args: any[]): any {}\nclass A { @dec(() => 0) static {} }\nconsole.log("ran");\n`;
  const javascript = `function dec() {}\nclass A { @dec(() => 0) static {} }\nconsole.log("ran");\n`;
  const experimentalDecorators = JSON.stringify({ compilerOptions: { experimentalDecorators: true } });
  const fixtures: [name: string, files: Record<string, string>, args: string[]][] = [
    ["bun bad.ts", { "bad.ts": typescript }, ["bad.ts"]],
    ["bun build bad.ts", { "bad.ts": typescript }, ["build", "bad.ts"]],
    ["bun bad.js", { "bad.js": javascript }, ["bad.js"]],
    [
      "bun bad.ts with experimentalDecorators",
      { "bad.ts": typescript, "tsconfig.json": experimentalDecorators },
      ["bad.ts"],
    ],
  ];

  test.each(fixtures)("%s", (_name, files, args) => expectOneError(files, args, message));
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
