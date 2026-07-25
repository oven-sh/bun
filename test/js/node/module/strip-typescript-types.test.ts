// module.stripTypeScriptTypes — Node v26 contract (strip-only mode).
// Every expected value in this file was captured from Node v26.3.0
// (amaro/swc_ts_fast_strip): strip mode blanks type syntax in place so
// line/column positions match the input exactly.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { stripTypeScriptTypes } from "node:module";

describe("stripTypeScriptTypes", () => {
  test("strips types in place, preserving positions", () => {
    expect(stripTypeScriptTypes("const x: number = 1;")).toBe("const x         = 1;");
    expect(stripTypeScriptTypes("let x: string = 1 as any;")).toBe("let x         = 1       ;");
    expect(stripTypeScriptTypes("let x: Ту = 1;")).toBe("let x     = 1;");
  });

  test("mode: 'strip' explicit", () => {
    expect(stripTypeScriptTypes("const x: number = 1;", { mode: "strip" })).toBe("const x         = 1;");
  });

  test("erased statements", () => {
    expect(stripTypeScriptTypes("interface A { x: string }\nlet y = 1;")).toBe(
      "                         \nlet y = 1;",
    );
    expect(stripTypeScriptTypes("type A = string;\nlet y = 1;")).toBe("                \nlet y = 1;");
    expect(stripTypeScriptTypes("declare function f(): void;\nlet y = 1;")).toBe(
      "                           \nlet y = 1;",
    );
    expect(stripTypeScriptTypes("export type { A };")).toBe("                  ");
    expect(stripTypeScriptTypes("declare enum E { A }")).toBe("                    ");
    expect(stripTypeScriptTypes("declare namespace N { const x: number }")).toBe(
      "                                       ",
    );
    expect(stripTypeScriptTypes('declare module "m" { const x: number }')).toBe(
      "                                      ",
    );
    expect(stripTypeScriptTypes("function f(): void;\nfunction f() {}")).toBe(
      "                   \nfunction f() {}",
    );
  });

  test("import/export type specifiers", () => {
    expect(stripTypeScriptTypes('import type { A } from "x";\nlet y = 1;')).toBe(
      "                           \nlet y = 1;",
    );
    expect(stripTypeScriptTypes('import { type A, B } from "x";')).toBe('import {         B } from "x";');
    // A specifier list that erases to nothing keeps the side-effect import.
    expect(stripTypeScriptTypes('import { type A } from "x";')).toBe('import {        } from "x";');
    expect(stripTypeScriptTypes("export { type A, B };")).toBe("export {         B };");
    expect(stripTypeScriptTypes("export { type A };")).toBe("export {        };");
    // `type` used as a real import name is kept.
    expect(stripTypeScriptTypes('import { type as xxx } from "m";')).toBe('import { type as xxx } from "m";');
  });

  test("functions and classes", () => {
    expect(stripTypeScriptTypes("function f<T>(a: T, b?: number): T { return a; }")).toBe(
      "function f   (a   , b         )    { return a; }",
    );
    expect(stripTypeScriptTypes("function f(this: void, a: number) {}")).toBe(
      "function f(            a        ) {}",
    );
    expect(stripTypeScriptTypes("class C<T> extends B<T> {}")).toBe("class C    extends B    {}");
    expect(stripTypeScriptTypes("class C extends B implements I, J {}")).toBe(
      "class C extends B                 {}",
    );
    expect(stripTypeScriptTypes("abstract class C { abstract foo(): void }")).toBe(
      "         class C {                      }",
    );
    expect(stripTypeScriptTypes("class C { declare x: number }")).toBe("class C {                   }");
    expect(stripTypeScriptTypes("class C { private readonly x: number = 1 }")).toBe(
      "class C {                  x         = 1 }",
    );
    expect(stripTypeScriptTypes("class C { x!: number }")).toBe("class C { x          }");
    expect(stripTypeScriptTypes("class C { m?(): void {} }")).toBe("class C { m ()       {} }");
    expect(stripTypeScriptTypes("class C { [k: string]: any }")).toBe("class C {                  }");
    // A modifier keyword used as a member name is not a modifier.
    expect(stripTypeScriptTypes("class C { public public() {} }")).toBe("class C {        public() {} }");
  });

  test("expressions", () => {
    expect(stripTypeScriptTypes("let a = x!;")).toBe("let a = x ;");
    expect(stripTypeScriptTypes("f<number>(1);")).toBe("f        (1);");
    expect(stripTypeScriptTypes("new C<number>();")).toBe("new C        ();");
    expect(stripTypeScriptTypes("let v = f<T>;")).toBe("let v = f   ;");
    expect(stripTypeScriptTypes("let x = a satisfies number;")).toBe("let x = a                 ;");
    expect(stripTypeScriptTypes("x as const;")).toBe("x         ;");
    expect(stripTypeScriptTypes("let x = `a${1 as number}b`;")).toBe("let x = `a${1          }b`;");
  });

  test("ASI protection", () => {
    // Removing an erased span must not fuse the next line onto the previous
    // statement; amaro writes a `;` into the blank.
    expect(stripTypeScriptTypes("let a = b as any\n(c);")).toBe("let a = b ;     \n(c);");
    expect(stripTypeScriptTypes("let a = b as any\n[c];")).toBe("let a = b ;     \n[c];");
    expect(stripTypeScriptTypes("let a = b as any\nc;")).toBe("let a = b       \nc;");
    expect(stripTypeScriptTypes("let x = 1\ntype A = string\n(f)()")).toBe("let x = 1\n;              \n(f)()");
    expect(stripTypeScriptTypes("let x = 1\ntype A = string\nlet y = 2")).toBe(
      "let x = 1\n               \nlet y = 2",
    );
    expect(stripTypeScriptTypes("type A=1;type B=2;let c=3;")).toBe("                  let c=3;");
  });

  test("generic arrows", () => {
    expect(stripTypeScriptTypes("let f = <T>(v: T) => v;")).toBe("let f =    (v   ) => v;");
    expect(stripTypeScriptTypes("let f = async <T>(v: T) => v;")).toBe("let f = async    (v   ) => v;");
    // Newline inside async generics: `<` is rewritten to `(`.
    expect(stripTypeScriptTypes("let f = async <\nT\n>(v: T) => v;")).toBe("let f = async (\n \n  v   ) => v;");
    expect(stripTypeScriptTypes("function g() { return <T>\n(v: T) => v; }")).toBe(
      "function g() { return (  \n v   ) => v; }",
    );
    // Return type spanning a newline: `)` is moved down to stay on the `=>` line.
    expect(stripTypeScriptTypes("let f = ()\n: any =>\n    1;")).toBe("let f = ( \n    ) =>\n    1;");
  });

  test("comments and hashbang survive", () => {
    expect(stripTypeScriptTypes("let x: number /*keep*/ = 1;")).toBe("let x         /*keep*/ = 1;");
    expect(stripTypeScriptTypes("let x: /*in*/ number = 1;")).toBe("let x                = 1;");
    expect(stripTypeScriptTypes("#!/usr/bin/env node\nlet x: number = 1;")).toBe(
      "#!/usr/bin/env node\nlet x         = 1;",
    );
  });

  test("sourceUrl appends a sourceURL comment", () => {
    expect(stripTypeScriptTypes("const x: number = 1;", { mode: "strip", sourceUrl: "foo.ts" })).toBe(
      "const x         = 1;\n\n//# sourceURL=foo.ts",
    );
    expect(stripTypeScriptTypes("", { sourceUrl: "foo.ts" })).toBe("\n\n//# sourceURL=foo.ts");
  });

  test("argument validation", () => {
    // @ts-expect-error invalid input
    expect(() => stripTypeScriptTypes({})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => stripTypeScriptTypes("const x: number = 1;", { mode: "invalid" as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    // Node v26 removed transform mode.
    expect(() => stripTypeScriptTypes("const x: number = 1;", { mode: "transform" as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => stripTypeScriptTypes("const x: number = 1;", { mode: "strip", sourceMap: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    // @ts-expect-error invalid input
    expect(() => stripTypeScriptTypes("x", { sourceUrl: 1 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    // sourceMap: undefined is explicitly allowed.
    expect(stripTypeScriptTypes("let x: number;", { sourceMap: undefined })).toBe("let x        ;");
  });

  test("unsupported syntax throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX", () => {
    const cases: [string, string][] = [
      ["enum E { A }", "TypeScript enum is not supported in strip-only mode"],
      ["const enum E { A }", "TypeScript enum is not supported in strip-only mode"],
      ["namespace N { export const x = 1 }", "TypeScript namespace declaration is not supported in strip-only mode"],
      ["module N { }", "`module` keyword is not supported. Use `namespace` instead."],
      ['import x = require("x");', "TypeScript import equals declaration is not supported in strip-only mode"],
      ["export = 1;", "TypeScript export assignment is not supported in strip-only mode"],
      ["class C { constructor(private a: number) {} }", "TypeScript parameter property is not supported in strip-only mode"],
      ["class C { constructor(readonly a) {} }", "TypeScript parameter property is not supported in strip-only mode"],
      [
        "let b = <string>y;",
        "The angle-bracket syntax for type assertions, `<T>expr`, is not supported in type strip mode. Instead, use the 'as' syntax: `expr as T`.",
      ],
      [
        "let x = 1 + 2 as any * 3;",
        "Type assertions that would change binary expression grouping are not supported in strip-only mode.",
      ],
    ];
    for (const [code, message] of cases) {
      expect(() => stripTypeScriptTypes(code)).toThrow(
        expect.objectContaining({
          code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
          name: "SyntaxError",
          message,
        }),
      );
    }
    // Ambient contexts suppress the error (the whole construct is erased).
    expect(stripTypeScriptTypes("declare namespace O { enum E {} }")).toBe(
      "                                 ",
    );
    // Parenthesized bases do not change grouping.
    expect(stripTypeScriptTypes("let x = (1 + 2) as any * 3;")).toBe("let x = (1 + 2)        * 3;");
  });

  test("invalid syntax throws ERR_INVALID_TYPESCRIPT_SYNTAX", () => {
    expect(() => stripTypeScriptTypes("let x: = 1;")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_TYPESCRIPT_SYNTAX", name: "SyntaxError" }),
    );
    expect(() => stripTypeScriptTypes("let x?: number;")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_TYPESCRIPT_SYNTAX" }),
    );
  });

  test("emits ExperimentalWarning once", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { stripTypeScriptTypes } = require('node:module');
         stripTypeScriptTypes('let a: number = 1;');
         stripTypeScriptTypes('let b: number = 2;');`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const warnings = stderr
      .split("\n")
      .filter(l => l.includes("stripTypeScriptTypes is an experimental feature and might change at any time"));
    expect(warnings).toHaveLength(1);
    expect(exitCode).toBe(0);
  });

  test("process.config.variables.node_use_amaro is true", () => {
    expect((process.config.variables as any).node_use_amaro).toBe(true);
  });
});
