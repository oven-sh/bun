import { describe, expect, test } from "bun:test";

// Every expectation is what tsc 6.0.2 writes for the same class with experimentalDecorators and
// emitDecoratorMetadata, strictNullChecks off. Where tsc writes a guarded reference to a name that it
// cannot resolve, the expectation is the guard of Bun around the same name.

const transpiler = new Bun.Transpiler({
  loader: "ts",
  tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }),
});

/** The expression that the transpiled `source` passes for the metadata `key`. */
function design(source: string, key: "type" | "returntype"): string {
  const code = transpiler.transformSync(source);
  const match = new RegExp(`\\("design:${key}", (.*?)\\),?\\n`).exec(code);
  if (!match) throw new Error(`no design:${key} in\n${code}`);
  return match[1];
}

const ofProperty = (type: string) => design(`class C { @d p: ${type}; }`, "type");
const ofReturnType = (type: string) => design(`class C { @d m(): ${type} { throw 0 } }`, "returntype");

describe("emitDecoratorMetadata of a type that is read with the tree of tsc", () => {
  test.each([
    ["number | A extends B ? string : string", "String"],
    ["number | A extends B ? string : never", "String"],
    ["K & A extends B ? string : never", "String"],
    ["string & A extends B ? never : string", "String"],
    ["K | A extends B ? string[] : number[]", "Array"],
    ["string | A extends B ? () => void : () => void", "Function"],
    ["K | A extends B ? null : K", "Object"],
  ])("the operands of | and & are the check type of a conditional type: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });

  test.each([
    ["keyof A extends B ? string : never", "String"],
    ["keyof A extends B ? () => void : () => void", "Function"],
    ["readonly A[] extends B ? string : number", "Object"],
    ["readonly A[] extends B ? unknown : string", "Object"],
    ["unique symbol extends B ? string : never", "String"],
  ])("keyof, readonly and unique end before extends: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });

  test.each([
    ["A extends B ? string : never | number", "Object"],
    ["A extends B ? never : string | number", "Object"],
    ["A extends B ? string : unknown | null", "Object"],
    ["A extends B ? unknown : string & string", "Object"],
    ["A extends B ? string : never & K", "Object"],
  ])("the type after the colon of a conditional type takes | and &: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });

  test.each([
    ["any.b", 'typeof any === "undefined" || typeof any.b === "undefined" ? Object : any.b'],
    ["string.b", 'typeof string === "undefined" || typeof string.b === "undefined" ? Object : string.b'],
    ["never.b", 'typeof never === "undefined" || typeof never.b === "undefined" ? Object : never.b'],
    ["bigint.b<T>", 'typeof bigint === "undefined" || typeof bigint.b === "undefined" ? Object : bigint.b'],
    ["undefined.b", "Object"],
  ])("a keyword before a dot is the first name of a type reference: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });

  test.each([
    ["unique symbol[]", "Object"],
    ["unique [A]", "Object"],
  ])("unique takes the whole type after it: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });
});

describe("emitDecoratorMetadata of a type that tsc serializes in another way than Bun did", () => {
  test.each([
    ["X extends Y ? number : never", "Number"],
    ["X extends Y ? never : string & string", "String"],
    ["X extends Y ? string : never & string", "Object"],
    ["X extends Y ? K : K", "Object"],
    ["X extends Y ? never : A.B", "Object"],
    ["X extends Y ? A : (A | null)", "Object"],
    ["X extends Y ? A<B> : null", "Object"],
    ["(X extends Y ? string : unknown)", "Object"],
    ["X extends infer U extends V ? string : never", "String"],
  ])("the branches of a conditional type merge as the operands of | do: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });

  test.each([
    ["A | unique symbol", "Object"],
    ["unique symbol & A", "Object"],
    ['A | import("x")', "Object"],
    ['import("x") | A', "Object"],
    ['import("x")["y"]', "Object"],
  ])("an import type and unique symbol are Object: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });

  test.each([
    ["this is B", "Boolean"],
    ["this is this", "Boolean"],
  ])("a predicate on this is Boolean: %s", (type, expected) => {
    expect(ofProperty(type)).toBe(expected);
  });

  test.each([
    ["a is B", "Boolean"],
    ["a is B | C", "Boolean"],
    ["a is B extends C ? D : E", "Boolean"],
    ["string is B", "Boolean"],
    ["this is B", "Boolean"],
    ["asserts a", "undefined"],
    ["asserts a is B", "undefined"],
    ["asserts this", "undefined"],
    ["asserts this is B", "undefined"],
    ["asserts a | B", "Object"],
    ["A | asserts a", "Object"],
  ])("a predicate in a return type is Boolean and an assertion is undefined: %s", (type, expected) => {
    expect(ofReturnType(type)).toBe(expected);
  });
});
