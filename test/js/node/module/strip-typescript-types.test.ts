// https://github.com/oven-sh/bun/issues/32196
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { stripTypeScriptTypes } from "node:module";

function errorFrom(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

test("named ESM import from node:module works (issue repro)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { stripTypeScriptTypes } from 'node:module'; console.log(typeof stripTypeScriptTypes);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("function\n");
  expect(exitCode).toBe(0);
});

test("is exported from require('node:module') and require('module')", () => {
  expect(require("node:module").stripTypeScriptTypes).toBe(stripTypeScriptTypes);
  expect(require("module").stripTypeScriptTypes).toBe(stripTypeScriptTypes);
  expect(typeof stripTypeScriptTypes).toBe("function");
});

test("strips type annotations", () => {
  expect(stripTypeScriptTypes("const x: number = 1;")).toBe("const x = 1;\n");
  expect(stripTypeScriptTypes("")).toBe("");
  expect(stripTypeScriptTypes("interface A { x: number }\nconst y = 1;")).toBe("const y = 1;\n");
  expect(stripTypeScriptTypes("function id<T>(x: T): T { return x satisfies T as T; }")).toBe(
    "function id(x) {\n  return x;\n}\n",
  );
});

test("stripped output evaluates", () => {
  const out = stripTypeScriptTypes("const x: number = 2;\nconst y = x * 21;\nresult(y);");
  let captured: unknown;
  new Function("result", out)((v: unknown) => (captured = v));
  expect(captured).toBe(42);
});

test("keeps value imports that are only used as types", () => {
  // Node's strip mode does not know T is type-only, so the import survives.
  expect(stripTypeScriptTypes('import { T } from "x"; const a: T = 1;')).toBe('import { T } from "x";\nconst a = 1;\n');
  // `import type` is erasable.
  expect(stripTypeScriptTypes('import type { T } from "x"; const a: T = 1;')).toBe("const a = 1;\n");
});

test("does not inline process.env", () => {
  expect(stripTypeScriptTypes("console.log(process.env.NODE_ENV);")).toBe("console.log(process.env.NODE_ENV);\n");
});

test("preserves a leading hashbang", () => {
  const src = "#!/usr/bin/env node\nconst x: number = 1;";
  expect(stripTypeScriptTypes(src)).toBe("#!/usr/bin/env node\nconst x = 1;\n");
  expect(stripTypeScriptTypes(src, { mode: "transform" })).toBe("#!/usr/bin/env node\nconst x = 1;\n");
  const withUrl = stripTypeScriptTypes(src, { sourceUrl: "cli.ts" });
  expect(withUrl).toBe("#!/usr/bin/env node\nconst x = 1;\n\n\n//# sourceURL=cli.ts");
});

test("source map accounts for the hashbang line", () => {
  const out = stripTypeScriptTypes("#!/usr/bin/env node\nconst x: number = 1;", {
    mode: "transform",
    sourceMap: true,
  });
  expect(out).toStartWith("#!/usr/bin/env node\nconst x = 1;\n");
  const base64 = out.split("base64,")[1];
  const map = JSON.parse(Buffer.from(base64, "base64").toString());
  // generated line 0 is the hashbang; mappings begin on line 1, matching
  // Node's output for the same input
  expect(map.mappings).toBe(";AACA,MAAM,IAAY");
});

test("validates code argument", () => {
  for (const bad of [42, null, undefined, {}, Symbol()] as const) {
    const err = errorFrom(() => stripTypeScriptTypes(bad as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toStartWith('The "code" argument must be of type string.');
  }
  expect(errorFrom(() => stripTypeScriptTypes(42 as any)).message).toBe(
    'The "code" argument must be of type string. Received type number (42)',
  );
});

test("validates options argument", () => {
  for (const bad of [null, [], "strip", 42, () => {}] as const) {
    const err = errorFrom(() => stripTypeScriptTypes("", bad as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toStartWith('The "options" argument must be of type object.');
  }
  // undefined means "use defaults"
  expect(stripTypeScriptTypes("", undefined)).toBe("");
});

test("validates options.mode", () => {
  for (const bad of ["bogus", 42, null, true] as const) {
    const err = errorFrom(() => stripTypeScriptTypes("", { mode: bad as any }));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err.message).toStartWith("The property 'options.mode' must be one of: 'strip', 'transform'.");
  }
  expect(errorFrom(() => stripTypeScriptTypes("", { mode: "bogus" as any })).message).toBe(
    "The property 'options.mode' must be one of: 'strip', 'transform'. Received 'bogus'",
  );
  // undefined falls back to 'strip'
  expect(stripTypeScriptTypes("let a: string;", { mode: undefined })).toBe("let a;\n");
});

test("validates options.sourceMap", () => {
  const err = errorFrom(() => stripTypeScriptTypes("", { sourceMap: "yes" as any }));
  expect(err).toBeInstanceOf(TypeError);
  expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
  expect(err.message).toBe(`The "options.sourceMap" property must be of type boolean. Received type string ('yes')`);

  // sourceMap: true is rejected in strip mode
  const stripErr = errorFrom(() => stripTypeScriptTypes("", { sourceMap: true }));
  expect(stripErr).toBeInstanceOf(TypeError);
  expect(stripErr.code).toBe("ERR_INVALID_ARG_VALUE");
  expect(stripErr.message).toBe("The property 'options.sourceMap' must be one of: false, undefined. Received true");

  // false/undefined are fine in strip mode
  expect(stripTypeScriptTypes("let x: number = 1", { sourceMap: false })).toBe("let x = 1;\n");
  expect(stripTypeScriptTypes("let x: number = 1", { sourceMap: undefined })).toBe("let x = 1;\n");
});

test("validates options.sourceUrl", () => {
  const err = errorFrom(() => stripTypeScriptTypes("", { sourceUrl: 42 as any }));
  expect(err).toBeInstanceOf(TypeError);
  expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
  expect(err.message).toBe(`The "options.sourceUrl" property must be of type string. Received type number (42)`);
  expect(errorFrom(() => stripTypeScriptTypes("", { sourceUrl: null as any })).code).toBe("ERR_INVALID_ARG_TYPE");
});

test.each([
  ["enum", "enum E { A }", "TypeScript enum is not supported in strip-only mode"],
  ["const enum", "const enum E { A }", "TypeScript enum is not supported in strip-only mode"],
  [
    "namespace",
    "namespace N { export const x = 1 }",
    "TypeScript namespace declaration is not supported in strip-only mode",
  ],
  [
    "parameter properties",
    "class C { constructor(public x: number) {} }",
    "TypeScript parameter property is not supported in strip-only mode",
  ],
  [
    "import equals",
    'import x = require("y");',
    "TypeScript import equals declaration is not supported in strip-only mode",
  ],
  ["export assignment", "export = 1;", "TypeScript export assignment is not supported in strip-only mode"],
  ["module keyword", "module N { export const x = 1 }", "`module` keyword is not supported. Use `namespace` instead."],
])("strip mode rejects %s", (_label, code, message) => {
  const err = errorFrom(() => stripTypeScriptTypes(code));
  expect(err).toBeInstanceOf(SyntaxError);
  expect(err.code).toBe("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  expect(err.message).toBe(message);
});

test("module keyword is rejected in transform mode too", () => {
  const err = errorFrom(() => stripTypeScriptTypes("module N { export const x = 1 }", { mode: "transform" }));
  expect(err).toBeInstanceOf(SyntaxError);
  expect(err.code).toBe("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  expect(err.message).toBe("`module` keyword is not supported. Use `namespace` instead.");
});

test.each([
  ["declare enum", "declare enum E { A }"],
  ["declare namespace containing an enum", "declare namespace N { enum E { A } }"],
  ["type-only namespace", "namespace N { export type T = 1 }"],
  ['declare module "name"', 'declare module "foo" { export = 1 }'],
  ["declare class parameter properties", "declare class C { constructor(public x: number); }"],
  ["declare global", "declare global { interface W {} }"],
  ["import type equals", 'import type x = require("y");'],
])("strip mode allows ambient %s", (_label, code) => {
  expect(stripTypeScriptTypes(code)).toBe("");
});

test("strip mode reports invalid syntax as ERR_INVALID_TYPESCRIPT_SYNTAX", () => {
  for (const code of ["const const", "const x = <div/>;"]) {
    const err = errorFrom(() => stripTypeScriptTypes(code));
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.code).toBe("ERR_INVALID_TYPESCRIPT_SYNTAX");
  }
});

test("transform mode lowers enums", () => {
  const out = stripTypeScriptTypes("enum E { A, B }\nresult(E);", { mode: "transform" });
  let captured: any;
  new Function("result", out)((e: any) => (captured = e));
  expect(captured.A).toBe(0);
  expect(captured.B).toBe(1);
  expect(captured[0]).toBe("A");
});

test("transform mode lowers namespaces", () => {
  const out = stripTypeScriptTypes("namespace N { export const x = 42 }\nresult(N.x);", { mode: "transform" });
  let captured: unknown;
  new Function("result", out)((v: unknown) => (captured = v));
  expect(captured).toBe(42);
});

test("transform mode lowers parameter properties", () => {
  const out = stripTypeScriptTypes("class C { constructor(public x: number) {} }\nresult(new C(7).x);", {
    mode: "transform",
  });
  let captured: unknown;
  new Function("result", out)((v: unknown) => (captured = v));
  expect(captured).toBe(7);
});

test("transform mode lowers export assignment and import equals", () => {
  const out = stripTypeScriptTypes("import y = require('y');\nexport = y;", { mode: "transform" });
  const mod = { exports: {} as unknown };
  new Function("module", "exports", "require", out)(mod, mod.exports, (id: string) => `required:${id}`);
  expect(mod.exports).toBe("required:y");
});

test("sourceUrl appends a sourceURL comment", () => {
  const out = stripTypeScriptTypes("const x: number = 1;", { sourceUrl: "foo.ts" });
  expect(out).toBe("const x = 1;\n\n\n//# sourceURL=foo.ts");
  // empty sourceUrl appends nothing
  expect(stripTypeScriptTypes("const x: number = 1;", { sourceUrl: "" })).toBe("const x = 1;\n");
});

test("transform mode emits an inline source map", () => {
  const out = stripTypeScriptTypes("enum E { A }\nconst q: number = 1;", {
    mode: "transform",
    sourceMap: true,
    sourceUrl: "foo.ts",
  });
  const match = out.match(/\n\n\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)$/);
  expect(match).not.toBeNull();
  const map = JSON.parse(Buffer.from(match![1], "base64").toString());
  expect(map.version).toBe(3);
  expect(map.sources).toEqual(["foo.ts"]);
  expect(map.names).toEqual([]);
  expect(typeof map.mappings).toBe("string");
  expect(map.mappings.length).toBeGreaterThan(0);
  // when a source map is generated, no sourceURL comment is appended
  expect(out).not.toContain("//# sourceURL=");
});

test("source map without sourceUrl uses an empty source name", () => {
  const out = stripTypeScriptTypes("const x: number = 1;", { mode: "transform", sourceMap: true });
  const base64 = out.split("base64,")[1];
  const map = JSON.parse(Buffer.from(base64, "base64").toString());
  expect(map.sources).toEqual([""]);
});
