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
  // Other ways to use `yield` as an identifier.
  ["(a = (b = { yield }) => b) => a", "Cannot use 'yield' as a shorthand property name in a generator function."],
  ["(a = (b = [yield] = []) => b) => a", yieldExpression],
  ["(a = (yi\\u0065ld) => 1) => a", "Unexpected escaped characters in keyword token: 'yi\\u0065ld'"],
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

// [text before the expression, text after it]
const generators = [
  ["(function* () { (", "); })"],
  ["(function* (p = ", ") { })"],
  ["({ *g() { (", "); } })"],
  ["(async function* () { (", "); })"],
];
// Strict mode code. `yield` is a reserved word there, so the message is not always about the generator.
const strictGenerator = ["(class { *g() { (", "); } })"];

describe("yield in the parameters of an arrow function", () => {
  test("the text around the expressions is valid", () => {
    for (const [before, after] of [...generators, strictGenerator])
      expect(syntaxErrorOf(before + "(a = (b) => b) => a" + after)).toBe("no SyntaxError");
  });

  test.each(invalid)("%s is a SyntaxError in a generator", (expression, message) => {
    // The message is the one that the parser gives with BUN_JSC_useSourceProviderCache=0.
    for (const [before, after] of generators) expect(syntaxErrorOf(before + expression + after)).toBe(message);
    const [before, after] = strictGenerator;
    expect(syntaxErrorOf(before + expression + after)).not.toBe("no SyntaxError");
  });

  test.each(invalid)("%s is valid where yield is an identifier", expression => {
    expect(syntaxErrorOf(`(function () { (${expression}); })`)).toBe("no SyntaxError");
    // The body of an arrow function and a function that is not an arrow function are not part of the generator.
    expect(syntaxErrorOf(`(function* () { () => { (${expression}); }; })`)).toBe("no SyntaxError");
    expect(syntaxErrorOf(`(function* () { (a = function () { (${expression}); }) => a; })`)).toBe("no SyntaxError");
  });

  // The parser takes these arrow functions from its cache. A version of the engine change that parsed them again
  // rejected the first three: that parse reads `await` in the body of the nested function as the async generator's.
  test.each([
    "(async function* () { ((...[a = () => await => 1]) => a); })",
    "(async function* () { ((...[a = () => (await) => 1]) => a); })",
    "(async function* () { (({ x = 1 }, a = () => { var await; }) => a); })",
    "(function* () { ((a = (await) => 1) => a); })",
    "(function* () { (({ x = 1 }, a = (b = await) => b) => a); })",
    // `yield` as a property name is not an identifier.
    "(function* () { ((a = ({ yield: b }) => b) => a); })",
    "(function* () { ((a = (b = { yield: 1, get yield() { return 1; }, yield() { } }.yield) => b) => a); })",
    "(function* () { ((a = (b = function yield() { }) => b) => a); })",
  ])("%s is valid", source => {
    expect(syntaxErrorOf(source)).toBe("no SyntaxError");
  });

  test("valid arrow functions keep what they capture", () => {
    // "{ x = 1 }" is not an expression, so the nested arrow functions are first parsed in the scope that is not a
    // generator. The parser takes them from its cache when it gets to them in the generator.
    const generator = (0, eval)(`(function* (p) {
      let local = 10;
      const sent = yield;
      return ({ x = 1 }, a = (b = (c = [x, local, p, sent, this.field, arguments.length]) => c) => b) => a;
    })`).call({ field: "field" }, 100, "second argument");
    generator.next();
    const arrow = generator.next(1000).value;
    expect(arrow({})()()).toEqual([1, 10, 100, 1000, "field", 2]);
    expect(arrow({ x: 2 })()()).toEqual([2, 10, 100, 1000, "field", 2]);

    // The default value captures N of the generator, and the body declares an N of its own.
    const shadowed = (0, eval)(`(function* () {
      let N = 40;
      return ({ x = 1 }, a = (b = N + x) => { var N = 7; return b; }) => a;
    })`);
    expect(shadowed().next().value({})()).toBe(41);

    // `yield` as a property name is valid in a generator, so the parser still takes this arrow function from its cache.
    const yieldAsPropertyName = (0, eval)(`(function* () {
      let N = 40;
      return ({ x = 1 }, a = ({ yield: b } = { yield: N }) => { var N = 7; return b; }) => a;
    })`);
    expect(yieldAsPropertyName().next().value({})()).toBe(40);

    // Where `yield` is an identifier, an arrow function with it in its parameters works as before.
    const yieldAsName = (0, eval)(`(function* () { return () => (a = (yield) => yield * 2) => a; })`);
    expect(yieldAsName().next().value()()(21)).toBe(42);
    const yieldAsVariable = (0, eval)(`(function () {
      var yield = 1;
      let N = 40;
      return ({ x = 1 }, a = (b = N + yield) => { var N = 7; return b; }) => a;
    })`);
    expect(yieldAsVariable()({})()).toBe(41);
  });
});
