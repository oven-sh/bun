import { expect, test } from "bun:test";
import { Script } from "node:vm";

test("vm.Script throws SyntaxError for missing closing paren", () => {
  expect(() => {
    new Script("Math.max(a, b", { filename: "main" });
  }).toThrow(SyntaxError);
});

test("vm.Script throws SyntaxError for unterminated string", () => {
  expect(() => {
    new Script('"hello', { filename: "main" });
  }).toThrow(SyntaxError);
});

test("vm.Script throws SyntaxError for invalid token", () => {
  expect(() => {
    new Script("let @x = 1;", { filename: "main" });
  }).toThrow(SyntaxError);
});

test("vm.Script throws SyntaxError at construction, not at run time", () => {
  let reachedRun = false;
  try {
    const script = new Script("Math.max(a, b", { filename: "main" });
    reachedRun = true;
    script.runInThisContext();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SyntaxError);
  }
  expect(reachedRun).toBe(false);
});

test("vm.Script does not throw for valid syntax", () => {
  expect(() => {
    new Script("Math.max(1, 2)", { filename: "main" });
  }).not.toThrow();
});
