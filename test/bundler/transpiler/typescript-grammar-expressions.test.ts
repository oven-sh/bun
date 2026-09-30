import { describe, expect, test } from "bun:test";

// Every expected output is the JavaScript that tsc 6.0.2 writes for the source, as Bun prints it.

const ts = new Bun.Transpiler({ loader: "ts" });
const tsx = new Bun.Transpiler({ loader: "tsx" });

describe("a colon after an operand that ends with a parenthesis", () => {
  test.each([
    ["x = a ? 1 + async(b) : c;", "x = a ? 1 + async(b) : c;\n"],
    ["x = a ? -async(b) : c;", "x = a ? -async(b) : c;\n"],
    ["x = a ? y || async(b) : c;", "x = a ? y || async(b) : c;\n"],
    ["x = a ? typeof async() : c => d;", "x = a ? typeof async() : (c) => d;\n"],
    ["x = a ? 1 + async<T>(b) : c;", "x = a ? 1 + async(b) : c;\n"],
    ["switch (x) { case 1 + async(b): c; }", "switch (x) {\n  case 1 + async(b):\n    c;\n}\n"],
  ])("a call of async is no arrow function there: %s", (source, expected) => {
    expect(ts.transformSync(source)).toBe(expected);
  });

  test.each([
    ["x = a ? -<T>(b) : c;", "x = a ? -b : c;\n"],
    ["x = a ? !<T>(b) : c => d;", "x = a ? !b : (c) => d;\n"],
    ["x = a ? typeof <T>(b) : c;", "x = a ? typeof b : c;\n"],
    ["x = a ? 1 + <T>(b) : c;", "x = a ? 1 + b : c;\n"],
    ["async function f() { x = a ? await <T>(b) : c; }", "async function f() {\n  x = a ? await b : c;\n}\n"],
    ["switch (x) { case -<T>(b): c; }", "switch (x) {\n  case -b:\n    c;\n}\n"],
  ])("a type assertion before parentheses is no arrow function there: %s", (source, expected) => {
    expect(ts.transformSync(source)).toBe(expected);
  });

  test.each([
    ["x = a ? 1 + async(b) : c;", "x = a ? 1 + async(b) : c;\n"],
    ["switch (x) { case -async(b): c; }", "switch (x) {\n  case -async(b):\n    c;\n}\n"],
  ])("the same with the tsx loader: %s", (source, expected) => {
    expect(tsx.transformSync(source)).toBe(expected);
  });
});

describe("a colon after parentheses between the question mark and the colon of a conditional", () => {
  test.each([
    ["x = a ? <T>(b) : c => d;", "x = a ? b : (c) => d;\n"],
    ["x = a ? <T>(b, c) : d => e;", "x = a ? (b, c) : (d) => e;\n"],
    ["x = a ? async <T>(b) : c => d;", "x = a ? async(b) : (c) => d;\n"],
    ["x = a ? b ? c : <T>(d) : e => f;", "x = a ? b ? c : d : (e) => f;\n"],
    ["x = a ? b ? c : async <T>(d) : e => f;", "x = a ? b ? c : async(d) : (e) => f;\n"],
    ["for (const k of a ? <T>(b) : c => d) {}", "for (const k of a ? b : (c) => d) {}\n"],
    ["x = { [a ? <T>(b) : c => d]: 1 };", "x = { [a ? b : (c) => d]: 1 };\n"],
  ])("after type parameters it starts a return type only where a colon follows the body: %s", (source, expected) => {
    expect(ts.transformSync(source)).toBe(expected);
  });

  test.each([
    ["x = a ? y => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
    ["x = a ? y => ({ y }) : z => ({ z });", "x = a ? (y) => ({ y }) : (z) => ({ z });\n"],
    ["x = a ? y => ([y]) : z => z;", "x = a ? (y) => [y] : (z) => z;\n"],
    ["x = a ? y => (b, c) : d => e;", "x = a ? (y) => (b, c) : (d) => e;\n"],
    ["x = a ? y => (b = 1) : c => d;", "x = a ? (y) => b = 1 : (c) => d;\n"],
    ["x = a ? y => async (b) : c => d;", "x = a ? (y) => async(b) : (c) => d;\n"],
    ["x = a ? y => <T>(b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
    ["x = a ? y => z => (b) : c => d;", "x = a ? (y) => (z) => b : (c) => d;\n"],
    ["x = a ? y => q ? r : (b) : c => d;", "x = a ? (y) => q ? r : b : (c) => d;\n"],
    ["x = a ? async y => (b) : c => d;", "x = a ? async (y) => b : (c) => d;\n"],
    ["x = a ? async => (b) : c => d;", "x = a ? (async) => b : (c) => d;\n"],
    ["x = a ? b ? c : y => (d) : e => f;", "x = a ? b ? c : (y) => d : (e) => f;\n"],
    ["f(a ? y => (b) : c => d);", "f(a ? (y) => b : (c) => d);\n"],
  ])("in the body of an arrow function with one name it does the same: %s", (source, expected) => {
    expect(ts.transformSync(source)).toBe(expected);
  });

  test.each([
    ["x = a ? (y) => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
    ["x = a ? (y, z) => ({ y, z }) : c => ({ c });", "x = a ? (y, z) => ({ y, z }) : (c) => ({ c });\n"],
    ["x = a ? (y = 1) => (b) : c => d;", "x = a ? (y = 1) => b : (c) => d;\n"],
    ["x = a ? ({ y }) => (b) : c => d;", "x = a ? ({ y }) => b : (c) => d;\n"],
    ["x = a ? ({ y }: Y) => (b) : c => d;", "x = a ? ({ y }) => b : (c) => d;\n"],
    ["x = a ? ([y]: Y, z: Z) => (b) : c => d;", "x = a ? ([y], z) => b : (c) => d;\n"],
    ["x = a ? (y, ...z) => (b) : c => d;", "x = a ? (y, ...z) => b : (c) => d;\n"],
    ["x = a ? async (y) => (b) : c => d;", "x = a ? async (y) => b : (c) => d;\n"],
    ["x = a ? <T>(y) => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
    ["x = a ? <T,>(y) => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
  ])("in the body after parameters that an expression could start with as well: %s", (source, expected) => {
    expect(ts.transformSync(source)).toBe(expected);
  });

  test.each([
    ["x = a ? y => ({ y }) : z => ({ z });", "x = a ? (y) => ({ y }) : (z) => ({ z });\n"],
    ["x = a ? (y) => (b) : c => d;", "x = a ? (y) => b : (c) => d;\n"],
  ])("the same with the tsx loader: %s", (source, expected) => {
    expect(tsx.transformSync(source)).toBe(expected);
  });
});

describe("a type or type parameters where an expression starts or goes on", () => {
  test.each([
    ["const v = <out>x;", "const v = x;\n"],
    ["const v = <out>(x);", "const v = x;\n"],
    ["const v = <out>(x) => x;", "const v = (x) => x;\n"],
    ["const v = <out, T>(x) => x;", "const v = (x) => x;\n"],
    ["const v = <out = A>(x) => x;", "const v = (x) => x;\n"],
  ])("out is the name of a type and of a type parameter of an arrow function: %s", (source, expected) => {
    expect(ts.transformSync(source)).toBe(expected);
  });

  test.each([
    ["const v = x as T <= y;", "const v = x <= y;\n"],
    ["const v = x satisfies T <= y;", "const v = x <= y;\n"],
  ])("a comparison follows the type after as and satisfies: %s", (source, expected) => {
    expect(ts.transformSync(source)).toBe(expected);
  });

  test.each([
    ["f(<out, T>(x) => x);", "f((x) => x);\n"],
    ["f(<out = A>(x) => x);", "f((x) => x);\n"],
    ["const v = [x as T <= y];", "const v = [x <= y];\n"],
  ])("the same with the tsx loader: %s", (source, expected) => {
    expect(tsx.transformSync(source)).toBe(expected);
  });
});
