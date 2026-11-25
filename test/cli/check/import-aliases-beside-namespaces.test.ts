import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Each alias in the name of an `import a = b.c` is resolved, also one that is merged with a namespace. The errors are those of
// TypeScript 7.0.2, as "line,column:code".
const forms: [name: string, lines: string[], errors: string][] = [
  [
    "in the namespace, by its whole name",
    ["namespace N { export namespace b { export interface I { x: number } } export import b = N.b.I; }", "export {};"],
    "1,71:2303",
  ],
  [
    "in another part of the namespace",
    [
      "namespace N { export namespace b { export interface I { x: number } } }",
      "namespace N { export import b = N.b.I; }",
      "export {};",
    ],
    "2,15:2303",
  ],
  [
    "in two namespaces",
    [
      "namespace N { export namespace b { export interface I { x: number } } export import b = M.b.I; }",
      "namespace M { export import b = N.b; }",
      "export {};",
    ],
    "1,71:2303 2,15:2303",
  ],
  [
    "in the namespace, by its name",
    ["namespace N { export namespace b { export interface I { x: number } } export import b = b.I; }", "export {};"],
    "1,71:2303",
  ],
  [
    "an alias of something else",
    [
      "namespace M { export interface I { x: number } export namespace J { export interface K { y: number } } }",
      "namespace a { export interface L { z: number } }",
      "import a = M.J;",
      "import c = a.K;",
      "import d = a.L;",
      "let v: c = { y: '' };",
      "let w: d = { z: '' };",
      "export {};",
    ],
    "3,1:2440 6,14:2322 7,14:2322",
  ],
  [
    "an alias of an interface of another namespace",
    [
      "namespace M { export interface I { x: number } }",
      "namespace a { export interface L { z: number } }",
      "import a = M.I;",
      "import c = a.L;",
      "let w: c = { z: '' };",
      "let u: a = { x: '' };",
      "export {};",
    ],
    "5,14:2322 6,14:2322",
  ],
  [
    "two aliases, the first beside a namespace",
    ["namespace a { export interface I { x: number } }", "import a = b.I;", "import b = a.I;", "export {};"],
    "2,1:2303 3,1:2303",
  ],
  [
    "three aliases",
    [
      "namespace a { export interface I { x: number } }",
      "import a = c.I;",
      "namespace b { import c = a; export import I = c.I; }",
      "import c = b;",
      "export {};",
    ],
    "2,1:2303 3,15:2303 3,29:2303",
  ],
  [
    "beside a function and a namespace",
    ["function a() {}", "namespace a { export interface I { x: number } }", "import a = a.I;", "export {};"],
    "3,1:2303",
  ],
  [
    "exported beside a local namespace",
    ["namespace a { export interface I { x: number } }", "export import a = a.I;", "export {};"],
    "",
  ],
  [
    "exported beside an exported namespace",
    ["export namespace a { export interface I { x: number } }", "export import a = a.I;"],
    "2,1:2303",
  ],
  [
    "beside nested namespaces",
    ["namespace a.b { export interface I { x: number } }", "import a = a.b.I;", "let v: a = { x: '' };", "export {};"],
    "2,1:2303",
  ],
  [
    "a namespace with values",
    ["namespace a { export namespace I { export const x = 1 } }", "import a = a.I;", "a.x;", "export {};"],
    "2,1:2303 3,3:2339",
  ],
  [
    "in a namespace beside a local namespace",
    [
      "namespace N { namespace a { export interface I { x: number } } import a = a.I; export type T = a; }",
      "let v: N.T = { x: '' };",
      "export {};",
    ],
    "1,64:2303",
  ],
  [
    "in a namespace beside an exported namespace",
    [
      "namespace N { export namespace a { export interface I { x: number } } import a = N.a.I; export type T = a; }",
      "let v: N.T = { x: '' };",
      "export {};",
    ],
    "2,16:2322",
  ],
  [
    "aliases of each other",
    ["namespace a { export interface I { x: number } }", "import a = b;", "import b = a;", "export {};"],
    "2,1:2303 3,1:2303",
  ],
  [
    "aliases of each other, used",
    [
      "namespace a { export interface I { x: number } }",
      "import a = c;",
      "import c = a;",
      "let v: c.I = { x: '' };",
      "export {};",
    ],
    "2,1:2303 3,1:2303",
  ],
  [
    "the second beside a namespace",
    ["namespace b { export interface I { x: number } }", "import a = b.I;", "import b = a;", "export {};"],
    "2,1:2303 3,1:2303",
  ],
  [
    "the second beside a nested namespace",
    [
      "namespace b { export namespace I { export interface K { x: number } } }",
      "import a = b.I;",
      "import b = a.K;",
      "export {};",
    ],
    "2,1:2303 3,1:2303",
  ],
  [
    "an alias behind it",
    [
      "namespace a { export interface I { x: number } }",
      "import a = a.I;",
      "import b = a.I;",
      "let v: b = { x: '' };",
      "export {};",
    ],
    "2,1:2303 4,14:2322",
  ],
  [
    "members behind it",
    [
      "namespace a { export interface I { x: number } export namespace J { export interface K { y: number } } }",
      "import a = a.J;",
      "let v: a.K = { y: '' };",
      "let w: a.I = { x: '' };",
      "export {};",
    ],
    "2,1:2303 3,10:2694 4,16:2322",
  ],
  [
    "exported in a namespace",
    [
      "namespace M { export namespace a { export interface I { x: number } } export import a = M.a; }",
      "let v: M.a.I = { x: '' };",
      "export {};",
    ],
    "1,71:2303 2,18:2322",
  ],
  [
    "in another part, local",
    [
      "namespace M { export namespace a { export interface I { x: number } } }",
      "namespace M { import a = M.a; export type T = a.I; }",
      "let v: M.T = { x: '' };",
      "export {};",
    ],
    "3,16:2322",
  ],
  [
    "values behind it",
    [
      "namespace a { export const n = 1; export namespace b { export const m = 2; } }",
      "import a = a.b;",
      "a.m; a.n;",
      "export {};",
    ],
    "2,1:2303 3,3:2339",
  ],
  [
    "a class behind it",
    [
      "namespace a { export class I { x = 1 } }",
      "import a = a.I;",
      "class D extends a.I { y = '' }",
      "let d: D = new a.I();",
      "export {};",
    ],
    "2,1:2303 4,5:2741",
  ],
];

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
  },
  files: ["a.ts"],
});

test.concurrent.each(forms)("%s", async (_, lines, errors) => {
  using dir = tempDir("import-aliases-beside-namespaces", {
    "tsconfig.json": tsconfig,
    "a.ts": lines.join("\n") + "\n",
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--no-pretty"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  const reported = Array.from(
    (stdout + stderr).matchAll(/a\.ts\((\d+,\d+)\): error TS(\d+)/g),
    it => `${it[1]}:${it[2]}`,
  );
  expect(reported.sort()).toEqual(errors.split(" ").filter(Boolean).sort());
});
