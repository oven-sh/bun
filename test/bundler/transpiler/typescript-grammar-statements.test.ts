import { describe, expect, test } from "bun:test";

const transpilers = {
  js: new Bun.Transpiler({ loader: "js" }),
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

/** A transpiler, a source, and what Bun prints for the program that is read in the source. */
type Row = [transpiler: keyof typeof transpilers, source: string, expected: string];

// tsc 6.0.2 parses every source without a diagnostic, and the expected text is its program as Bun prints it.
describe("statements that tsc parses", () => {
  test.each<Row>([
    ["ts", "type as = 1; let x: as;", "let x;\n"],
    ["ts", "type as<T> = T;", ""],
    ["ts", "type /* c */ as = 1", ""],
    ["ts", "type as\n= 1", ""],
    ["ts", "let type: any; type as = 1;", "let type;\n"],
    ["ts", "function f() { type as = 1; return 1 as as }", "function f() {\n  return 1;\n}\n"],
    ["ts", "{ type satisfies = 1 }", "{}\n"],
    ["ts", "export declare type satisfies = 1", ""],
    ["tsx", "type as = 1; let x: as;", "let x;\n"],
  ])("as and satisfies name a type alias: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    ["ts", "interface as {}\nfoo()", "foo();\n"],
    ["ts", "interface as { a: 1 }\nconst x = 1;", "const x = 1;\n"],
    ["ts", "interface as {}; foo()", "foo();\n"],
    ["ts", "interface as {}\n[x] = y", "[x] = y;\n"],
    ["ts", "interface as<T> extends B<T> { a: T }", ""],
    ["ts", "interface satisfies extends B {}", ""],
    ["ts", "declare interface as { a: 1 }", ""],
    ["ts", "export declare interface as {}", ""],
    ["ts", "export default interface as {}", ""],
    ["ts", "function f() { interface as {} }", "function f() {}\n"],
    ["ts", "namespace N { export interface as {} }", ""],
    ["ts", "declare global { interface as {} }", ""],
    ["tsx", "interface as {}\nfoo()", "foo();\n"],
  ])("as and satisfies name an interface: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    ["ts", "namespace as {}\nfoo()", "foo();\n"],
    ["ts", "namespace as {};", ""],
    ["ts", "namespace as {}`x`", ""],
    ["ts", "module as.b {}", "var as;\n((as) => {})(as ||= {});\n"],
    [
      "ts",
      "namespace as.b.c { export const a = 1 }",
      "var as;\n((as) => {\n  let b;\n  ((b) => {\n    let c;\n    ((c) => {\n      c.a = 1;\n    })(c = b.c ||= {});\n  })(b = as.b ||= {});\n})(as ||= {});\n",
    ],
    ["ts", "export namespace as { export const a = 1 }", "export var as;\n((as) => {\n  as.a = 1;\n})(as ||= {});\n"],
    [
      "ts",
      "namespace N { namespace as { export const x = 1 } export const y = as.x }",
      "var N;\n((N) => {\n  let as;\n  ((as) => {\n    as.x = 1;\n  })(as ||= {});\n  N.y = as.x;\n})(N ||= {});\n",
    ],
    ["ts", "declare namespace as { const x: number; function f(): void }", ""],
    ["ts", "declare module as.b {}", ""],
    ["ts", "export declare namespace satisfies {}", ""],
    ["tsx", "namespace as { export const x = 1; }", "var as;\n((as) => {\n  as.x = 1;\n})(as ||= {});\n"],
  ])("as and satisfies name a namespace: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    ["ts", "abstract declare class C { m(): void }", ""],
    ["ts", "@d abstract declare class C {}", ""],
    ["tsx", "abstract declare class C {}", ""],
  ])("abstract stands before declare: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    [
      "ts",
      'enum E { ["x"], ["y"] }',
      'var E;\n((E) => {\n  E[E["x"] = 0] = "x";\n  E[E["y"] = 1] = "y";\n})(E ||= {});\n',
    ],
    ["ts", 'enum E { [ "x" ] = 1, }', 'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n})(E ||= {});\n'],
    ["ts", 'enum E { ["x"] = "s" }', 'var E;\n((E) => {\n  E["x"] = "s";\n})(E ||= {});\n'],
    [
      "ts",
      'enum E { ["x"] = 1, ["y"] = x + 1 }',
      'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n  E[E["y"] = 2] = "y";\n})(E ||= {});\n',
    ],
    [
      "ts",
      'enum E { ["a-b"] = 1, B = E["a-b"] }',
      'var E;\n((E) => {\n  E[E["a-b"] = 1] = "a-b";\n  E[E["B"] = 1] = "B";\n})(E ||= {});\n',
    ],
    [
      "ts",
      "enum E { [`x`] = 1, [`y`] }",
      'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n  E[E["y"] = 2] = "y";\n})(E ||= {});\n',
    ],
    [
      "ts",
      'const enum E { ["x"] = 1 } var v = E.x;',
      'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n})(E ||= {});\nvar v = 1 /* x */;\n',
    ],
    ["ts", 'export enum E { ["x"] = 1 }', 'export var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n})(E ||= {});\n'],
    ["ts", 'declare enum E { ["x"] = 1 }', ""],
    [
      "ts",
      'namespace N { export enum E { ["x"] = 1 } }',
      'var N;\n((N) => {\n  let E;\n  ((E) => {\n    E[E["x"] = 1] = "x";\n  })(E = N.E ||= {});\n})(N ||= {});\n',
    ],
    ["tsx", 'enum E { ["x"] = 1 }', 'var E;\n((E) => {\n  E[E["x"] = 1] = "x";\n})(E ||= {});\n'],
  ])("a string in brackets names an enum member: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    ["ts", 'namespace N { import("x").then(f); }', 'var N;\n((N) => {\n  import("x").then(f);\n})(N ||= {});\n'],
    ["ts", 'namespace N { import\n("x"); }', 'var N;\n((N) => {\n  import("x");\n})(N ||= {});\n'],
    ["ts", "namespace N { import.meta.url; }", "var N;\n((N) => {})(N ||= {});\n"],
    [
      "ts",
      'namespace N.M { import("x"); }',
      'var N;\n((N) => {\n  let M;\n  ((M) => {\n    import("x");\n  })(M = N.M ||= {});\n})(N ||= {});\n',
    ],
    ["ts", 'export namespace N { import("x"); }', 'export var N;\n((N) => {\n  import("x");\n})(N ||= {});\n'],
    ["tsx", 'namespace N { import("x"); }', 'var N;\n((N) => {\n  import("x");\n})(N ||= {});\n'],
  ])("import starts an expression in a namespace: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test.each<Row>([
    ["ts", 'import "x"\nwith { type: "json" };', 'import"x";\n'],
    ["ts", 'import type A from "x"\nwith { type: "json" };', ""],
    ["ts", 'export { a } from "x"\nwith { type: "json" };', 'export { a } from "x";\n'],
    ["ts", 'export * from "x"\nwith { type: "json" };', 'export * from "x";\n'],
    ["js", 'import A from "x"\nwith { type: "json" }; A;', 'import A from "x";\nA;\n'],
    ["js", 'export * from "x"\nwith { type: "json" };', 'export * from "x";\n'],
  ])("the attributes of a module path start on the next line: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });
});

// tsc rejects each source: as after the keyword always names a declaration. Bun keeps the cast in the second statement.
describe("a cast after a declaration that as names", () => {
  test.each<Row>([
    ["ts", "type as = 1\ntype as any", "type;\n"],
    ["ts", "type as = 1\ntype as <T>(x: T) => void", "type;\n"],
    ["ts", "interface as {}\ninterface as any\nfoo()", "interface;\nfoo();\n"],
    ["ts", "interface as {}\ninterface as {} | X\nfoo()", "interface;\nfoo();\n"],
    ["ts", "namespace as {}\nnamespace as any", "namespace;\n"],
    ["ts", "namespace as {}\nnamespace as { foo(): void }", "namespace;\n"],
  ])("stays the cast of type, interface or namespace: %s %j", (transpiler, source, expected) => {
    expect(transpilers[transpiler].transformSync(source)).toBe(expected);
  });

  test("with ( after a module path starts a statement", () => {
    const source = 'import A from "x"\nwith { type: "json" };\nimport B from "y"\nwith (A) {}';
    expect(transpilers.js.transformSync(source)).toBe('import A from "x";\nimport B from "y";\nwith (A) {}\n');
  });
});
