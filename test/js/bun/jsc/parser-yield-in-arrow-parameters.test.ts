import { describe, expect, test } from "bun:test";

// In a generator, `yield` is not an identifier in the parameters of an arrow function,
// and a YieldExpression there is an early error. JavaScriptCore parses "( ... )" again, in a scope that is never a
// generator, to see that it is a parameter list. An arrow function in there went to the parser's function cache with
// `yield` as an identifier, and the parse that knows about the generator skipped it from the cache. So all of this
// was accepted. The text goes to eval, so Bun's transpiler is not involved.

const parameterName = "Cannot use 'yield' as a parameter name in a generator function.";
const yieldExpression = "Unexpected keyword 'yield'. Cannot use yield expression out of generator.";

const invalid: [expression: string, message: string][] = [
  ["(a = (yield) => 1) => a", parameterName],
  ["(a = (b = yield) => b) => a", yieldExpression],
  ["(b = (yield) => 1, c) => b", parameterName],
  ["(a = (...yield) => 1) => a", parameterName],
  ["(a = ({ b = yield }) => 1) => a", yieldExpression],
  ["(a = async (yield) => 1) => a", parameterName],
  ["async (a = (yield) => 1) => a", parameterName],
  ["({ a = (yield) => 1 }) => a", parameterName],
  ["([a = (b = yield) => b]) => a", yieldExpression],
  ["(...[a = (yield) => 1]) => a", parameterName],
  ["(a = (b = (c = yield) => c) => b) => a", yieldExpression],
  // "( ... )" is not a parameter list here, but the parser has to try that to find out.
  ["[a = (b = (yield) => 1)] = []", parameterName],
  // One arrow function: rejected before too, with the same messages.
  ["(yield) => 1", parameterName],
  ["(a = yield) => a", yieldExpression],
  ["({ a = yield }) => a", yieldExpression],
];

const syntaxErrorOf = (source: string) => {
  try {
    (0, eval)(source);
  } catch (e) {
    if (e instanceof SyntaxError) return e.message;
    throw e;
  }
  return "no SyntaxError";
};

describe("yield in the parameters of an arrow function", () => {
  test.each(invalid)("%s is a SyntaxError in a generator", (expression, message) => {
    expect(syntaxErrorOf(`(function* () { (${expression}); })`)).toBe(message);
    for (const [before, after] of [
      ["(function* (p = ", ") { })"],
      ["({ *g() { (", "); } })"],
      ["(async function* () { (", "); })"],
      ["(class { *g() { (", "); } })"],
    ])
      expect(syntaxErrorOf(before + expression + after)).not.toBe("no SyntaxError");
  });

  test.each(invalid)("%s is valid where yield is an identifier", expression => {
    expect(syntaxErrorOf(`(function () { (${expression}); })`)).toBe("no SyntaxError");
    // The body of an arrow function and a function that is not an arrow function are not part of the generator.
    expect(syntaxErrorOf(`(function* () { () => { (${expression}); }; })`)).toBe("no SyntaxError");
    expect(syntaxErrorOf(`(function* () { (a = function () { (${expression}); }) => a; })`)).toBe("no SyntaxError");
  });

  test("arrow functions that the parser has to parse again for the generator keep what they capture", () => {
    // "{ x = 1 }" is not an expression, so the nested arrow functions are first parsed in the scope that is not a
    // generator, and parsed again when the parser gets to them in the generator.
    const generator = (0, eval)(`(function* (p) {
      let local = 10;
      const sent = yield;
      return ({ x = 1 }, a = (b = (c = [x, local, p, sent, this.field, arguments.length]) => c) => b) => a;
    })`).call({ field: "field" }, 100, "second argument");
    generator.next();
    const arrow = generator.next(1000).value;
    expect(arrow({})()()).toEqual([1, 10, 100, 1000, "field", 2]);
    expect(arrow({ x: 2 })()()).toEqual([2, 10, 100, 1000, "field", 2]);

    const yieldAsName = (0, eval)(`(function* () { return () => (a = (yield) => yield * 2) => a; })`);
    expect(yieldAsName().next().value()()(21)).toBe(42);
  });
});
