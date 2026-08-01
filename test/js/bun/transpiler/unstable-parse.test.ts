import { describe, expect, test } from "bun:test";

// Bun.Transpiler.prototype.unstable_parse is an explicitly unstable API: the
// output shape is Bun's internal AST and may change between patch releases.
// These tests pin enough of the shape to catch accidental breakage of the
// serializer itself, not to freeze the AST format.

describe("Bun.Transpiler.unstable_parse", () => {
  const ts: any = new Bun.Transpiler({ loader: "ts" });
  const tsx: any = new Bun.Transpiler({ loader: "tsx" });
  const js: any = new Bun.Transpiler({ loader: "js" });

  test("exists on prototype", () => {
    expect(typeof Bun.Transpiler.prototype.unstable_parse).toBe("function");
    expect(Bun.Transpiler.prototype.unstable_parse.length).toBe(2);
  });

  test("top-level shape", () => {
    const ast = ts.unstable_parse(`#!/usr/bin/env bun\n"use strict";\nconst x = 1;`);
    expect(ast.kind).toBe("ast");
    expect(ast.hashbang).toBe("#!/usr/bin/env bun");
    expect(ast.directive).toBe("use strict");
    expect(typeof ast.exportsKind).toBe("string");
    expect(Array.isArray(ast.importRecords)).toBe(true);
    expect(Array.isArray(ast.symbols)).toBe(true);
    expect(Array.isArray(ast.stmts)).toBe(true);
    expect(ast.stmts.length).toBeGreaterThan(0);
  });

  test("empty source", () => {
    const ast = js.unstable_parse("");
    expect(ast.kind).toBe("ast");
    expect(ast.stmts).toEqual([]);
    expect(ast.hashbang).toBeNull();
    expect(ast.directive).toBeNull();
  });

  test("every object with a kind also has a loc", () => {
    const ast = ts.unstable_parse(`
      import { a } from "m";
      export const [x, { y: z = 1 }] = a;
      class C extends Object { m() { return this } get g() { return 1 } }
      for (const k of [1,2]) if (k) break; else continue;
      const o = { a: 1, ...b, get c() {} };
    `);
    let count = 0;
    const walk = (v: unknown): void => {
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.kind === "string") {
          count++;
          // Any object in the stmt tree with a `kind` string must also carry
          // `loc` (number | null) so generic walkers can rely on it.
          expect(o).toHaveProperty("loc");
          expect(o.loc === null || typeof o.loc === "number").toBe(true);
        }
        for (const child of Object.values(o)) walk(child);
      }
    };
    for (const s of ast.stmts) walk(s);
    expect(count).toBeGreaterThan(30);
  });

  test("s_local / e_binary / b_identifier", () => {
    const ast = ts.unstable_parse(`const x: number = 1 + 2;`);
    const s = ast.stmts[0];
    expect(s.kind).toBe("s_local");
    expect(s.declKind).toBe("k_const");
    expect(s.isExport).toBe(false);
    const d = s.decls[0];
    expect(d.binding).toEqual({ kind: "b_identifier", loc: 6, name: "x" });
    expect(d.value.kind).toBe("e_binary");
    expect(d.value.op).toBe("bin_add");
    expect(d.value.left).toEqual({ kind: "e_number", loc: 18, value: 1 });
    expect(d.value.right).toEqual({ kind: "e_number", loc: 22, value: 2 });
  });

  test("functions and arrows", () => {
    const ast = ts.unstable_parse(
      `export async function* foo(a, b = 5, ...rest) { return a }\n` + `const f = (x) => x + 1;`,
    );
    const sfn = ast.stmts.find((s: any) => s.kind === "s_function");
    expect(sfn.func.name.name).toBe("foo");
    expect(sfn.func.isAsync).toBe(true);
    expect(sfn.func.isGenerator).toBe(true);
    expect(sfn.func.hasRestArg).toBe(true);
    expect(sfn.func.isExport).toBe(true);
    expect(sfn.func.args.length).toBe(3);
    expect(sfn.func.args[1].default.value).toBe(5);
    expect(sfn.func.body.stmts[0].kind).toBe("s_return");

    const arrow = ast.stmts.find((s: any) => s.kind === "s_local").decls[0].value;
    expect(arrow.kind).toBe("e_arrow");
    expect(arrow.isAsync).toBe(false);
    expect(arrow.args[0].binding.name).toBe("x");
  });

  test("classes", () => {
    const ast = ts.unstable_parse(`
      export class Foo extends Bar {
        static x = 1;
        #p = 2;
        get z() { return 3 }
        static { this.x }
      }
    `);
    const s = ast.stmts.find((s: any) => s.kind === "s_class");
    expect(s.isExport).toBe(true);
    expect(s.class.name.name).toBe("Foo");
    expect(s.class.extends.kind).toBe("e_identifier");
    expect(s.class.extends.name).toBe("Bar");
    const props = s.class.properties;
    expect(props.length).toBe(4);
    expect(props[0].isStatic).toBe(true);
    expect(props[1].key.kind).toBe("e_private_identifier");
    expect(props[2].propertyKind).toBe("get");
    expect(props[3].propertyKind).toBe("class_static_block");
    expect(props[3].classStaticBlock.stmts.length).toBe(1);
  });

  test("destructuring bindings", () => {
    const ast = ts.unstable_parse(`const [a, b = 1, ...c] = x; const { d, e: f = 2, ...g } = y;`);
    const arr = ast.stmts[0].decls[0].binding;
    expect(arr.kind).toBe("b_array");
    expect(arr.hasSpread).toBe(true);
    expect(arr.items.length).toBe(3);
    expect(arr.items[0].binding.name).toBe("a");
    expect(arr.items[1].defaultValue.value).toBe(1);

    const obj = ast.stmts[1].decls[0].binding;
    expect(obj.kind).toBe("b_object");
    expect(obj.properties.length).toBe(3);
    expect(obj.properties[0].value.name).toBe("d");
    expect(obj.properties[1].value.name).toBe("f");
    expect(obj.properties[1].defaultValue.value).toBe(2);
    expect(obj.properties[2].isSpread).toBe(true);
  });

  test("imports, exports, and importRecords", () => {
    const ast = ts.unstable_parse(`
      import def, { a as b } from "pkg";
      import * as ns from "./ns";
      export { b };
      export * as all from "./all";
      export default 42;
    `);
    expect(ast.importRecords.map((r: any) => r.path)).toEqual(["pkg", "./ns", "./all"]);
    expect(ast.exportsKind).toBe("esm");

    const simp = ast.stmts.filter((s: any) => s.kind === "s_import");
    expect(simp[0].importRecord.path).toBe("pkg");
    expect(simp[0].defaultName.name).toBe("def");
    expect(simp[0].items[0].alias).toBe("a");
    expect(simp[0].items[0].name.name).toBe("b");

    const star = ast.stmts.find((s: any) => s.kind === "s_export_star");
    expect(star.alias.name).toBe("all");
    expect(star.importRecord.path).toBe("./all");

    const def = ast.stmts.find((s: any) => s.kind === "s_export_default");
    expect(def.value.kind).toBe("e_number");
    expect(def.value.value).toBe(42);
  });

  test("call, dot, index, optional chain", () => {
    const ast = ts.unstable_parse(`a.b?.c[0]?.(1, 2)`);
    const call = ast.stmts[0].value;
    expect(call.kind).toBe("e_call");
    expect(call.optionalChain).toBe("start");
    expect(call.args.length).toBe(2);
    const idx = call.target;
    expect(idx.kind).toBe("e_index");
    expect(idx.optionalChain).toBe("continuation");
    const dot = idx.target;
    expect(dot.kind).toBe("e_dot");
    expect(dot.name).toBe("c");
    expect(dot.optionalChain).toBe("start");
    expect(dot.target.kind).toBe("e_dot");
    expect(dot.target.optionalChain).toBeNull();
  });

  test("template literals", () => {
    const ast = ts.unstable_parse("const s = `a${1}b${x}c`;");
    const t = ast.stmts[0].decls[0].value;
    expect(t.kind).toBe("e_template");
    expect(t.tag).toBeNull();
    expect(t.head).toBe("a");
    expect(t.parts.length).toBe(2);
    expect(t.parts[0].value.value).toBe(1);
    expect(t.parts[0].tail).toBe("b");
    expect(t.parts[1].tail).toBe("c");
  });

  test("regex", () => {
    const ast = ts.unstable_parse(`const r = /fo\\/o/gim;`);
    const re = ast.stmts[0].decls[0].value;
    expect(re.kind).toBe("e_reg_exp");
    expect(re.pattern).toBe("fo\\/o");
    expect(re.flags).toBe("gim");
  });

  test("try / catch / finally / switch", () => {
    const ast = ts.unstable_parse(`
      try { a() } catch (e) { b() } finally { c() }
      switch (x) { case 1: y(); default: z(); }
    `);
    const t = ast.stmts.find((s: any) => s.kind === "s_try");
    expect(t.body.length).toBe(1);
    expect(t.catch.binding.name).toBe("e");
    expect(t.catch.body.length).toBe(1);
    expect(t.finally.stmts.length).toBe(1);

    const sw = ast.stmts.find((s: any) => s.kind === "s_switch");
    expect(sw.cases.length).toBe(2);
    expect(sw.cases[0].value.value).toBe(1);
    expect(sw.cases[1].value).toBeNull();
  });

  test("jsx is lowered before the AST is exposed", () => {
    // Bun's parser lowers JSX during parsing, so `unstable_parse` sees the
    // lowered `jsx(...)` / `createElement(...)` calls, not `e_jsx_element`.
    const ast = tsx.unstable_parse(`const el = <div id="x">{a}</div>;`);
    const v = ast.stmts[0].decls[0].value;
    expect(v.kind).toBe("e_call");
    expect(v.args.some((a: any) => a.kind === "e_string" && a.value === "div")).toBe(true);
  });

  test("string literal encoding round-trip", () => {
    const ast = ts.unstable_parse(`const s = "héllo 🎉\\v\\x07\\u{1F600}\\n\\t\\"\\\\";`);
    const v = ast.stmts[0].decls[0].value;
    expect(v.kind).toBe("e_string");
    expect(v.value).toBe('héllo 🎉\v\x07\u{1F600}\n\t"\\');
  });

  test("non-finite numbers become null", () => {
    // Bun's parser constant-folds `NaN` / `Infinity` identifiers to e_number
    // nodes with non-finite values; JSON has no literal for those.
    const ast = ts.unstable_parse(`const a = NaN; const b = Infinity;`);
    expect(ast.stmts[0].decls[0].value).toEqual({ kind: "e_number", loc: 10, value: null });
    expect(ast.stmts[1].decls[0].value).toEqual({ kind: "e_number", loc: 25, value: null });
  });

  test("loader argument overrides constructor default", () => {
    const t: any = new Bun.Transpiler({ loader: "js" });
    // `const x: number = 1` is a syntax error under the `js` loader
    expect(() => t.unstable_parse(`const x: number = 1`)).toThrow("Parse error");
    // but valid when the second argument selects `ts`
    const ast = t.unstable_parse(`const x: number = 1`, "ts");
    expect(ast.stmts[0].kind).toBe("s_local");
  });

  test("parse errors throw", () => {
    expect(() => ts.unstable_parse(`const x = `)).toThrow("Unexpected end of file");
    expect(() => ts.unstable_parse(`function (`)).toThrow("Parse error");
  });

  test("deeply nested input throws RangeError rather than crashing", () => {
    // `a+a+a+...` parses iteratively but produces an e_binary tree N deep,
    // which trips the serializer's StackCheck guard.
    const src = "const x = a" + Buffer.alloc(400000, "+a").toString();
    expect(() => ts.unstable_parse(src)).toThrow(RangeError);
  });

  test("accepts Uint8Array", () => {
    const ast = ts.unstable_parse(new TextEncoder().encode("let y = 7"));
    expect(ast.stmts[0].decls[0].value.value).toBe(7);
  });

  test("malformed UTF-8 in Uint8Array input becomes U+FFFD", () => {
    // "#!" + truncated 4-byte lead [F0 9F] + stray continuation [9F] + "\n1"
    const src = Uint8Array.of(0x23, 0x21, 0xf0, 0x9f, 0x9f, 0x0a, 0x31);
    const ast = js.unstable_parse(src);
    expect(ast.hashbang).toBe("#!\uFFFD\uFFFD\uFFFD");
  });

  test("symbols are resolvable by name", () => {
    const ast = ts.unstable_parse(`function foo(bar) { return bar }`);
    const names = ast.symbols.map((s: any) => s.name);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
  });

  test("result is JSON-serializable", () => {
    const ast = ts.unstable_parse(`class C { m() { return [1, {a: 2}] } }`);
    const round = JSON.parse(JSON.stringify(ast));
    expect(round).toEqual(ast);
  });
});
