import { describe, expect, test } from "bun:test";

// oven-sh/bun#43477, fixed in oven-sh/WebKit#704. Bun's transpiler rejects these forms itself, so the text goes to
// JavaScriptCore through `eval`, which does not transpile.
//
// ClassStaticBlockBody: it is a Syntax Error if ContainsArguments of the statement list is true. ContainsArguments
// looks into arrow functions and stops at other functions. A static block is parsed with [+Await], and the
// parameters of an arrow function take the [Await] of the code around them, so `await` is not a parameter name
// there. The body of the arrow function is [~Await], so `await` is an identifier in it.

const parse = (source: string) => () => (0, eval)(source);

const argumentsError = new SyntaxError("Cannot use 'arguments' as an identifier in static block.");

describe("arguments in an arrow function in a class static block is a SyntaxError", () => {
  test.each([
    "(class { static { () => arguments; } })",
    "(class { static { () => { arguments; }; } })",
    "(class { static { () => arguments.length; } })",
    "(class { static { (c = arguments) => 1; } })",
    "(class { static { (x = () => arguments) => 1; } })",
    "(class { static { () => () => arguments; } })",
    "(class { static { async () => arguments; } })",
    "(class { static { () => { var arguments; }; } })",
    "(class { static { () => ({ arguments }); } })",
    "(class { static { if (true) { () => arguments; } } })",
    // The static block itself, as before, and the shorthand property there, which is new.
    "(class { static { arguments; } })",
    "(class { static { arguments.length; } })",
    "(class { static { ({ arguments }); } })",
  ])("%s", source => {
    expect(parse(source)).toThrow(argumentsError);
    expect(parse(`function f() { ${source} }`)).toThrow(argumentsError);
    expect(parse(`() => { ${source} }`)).toThrow(argumentsError);
  });

  test("a shorthand property in a class field initializer", () => {
    const error = new SyntaxError("Cannot reference 'arguments' in class field initializer.");
    expect(parse("(class { x = ({ arguments }); })")).toThrow(error);
    expect(parse("(class { x = () => ({ arguments }); })")).toThrow(error);
  });
});

describe("arguments in a function that is not an arrow function in a class static block is valid", () => {
  test.each([
    "(class { static { function f() { arguments; } } })",
    "(class { static { function f(a = arguments) {} } })",
    "(class { static { (function () { arguments; }); } })",
    "(class { static { ({ m() { arguments; } }); } })",
    "(class { static { (class { m() { arguments; } }); } })",
    "(class { static { () => { function f() { arguments; } }; } })",
    "(class { static { () => function () { arguments; }; } })",
    "(class { static { () => function (a = arguments) {}; } })",
    "(class { static { () => function () { ({ arguments }); }; } })",
    "(class { static { () => ({ m() { arguments; } }); } })",
    "(class { static { () => this.arguments; } })",
    "(class { static { () => ({ arguments: 1 }); } })",
  ])("%s", source => {
    expect(parse(source)).not.toThrow();
    expect(parse(`function f() { ${source} }`)).not.toThrow();
    expect(parse(`() => { ${source} }`)).not.toThrow();
  });

  test("the arrow function reads the arguments of the function around it", () => {
    const seen = (0, eval)(`
      let seen;
      (function () {
        class C {
          static {
            (function () { seen = (() => arguments)(); })(1, 2);
          }
        }
      })();
      seen;
    `);
    expect(Array.from(seen)).toEqual([1, 2]);
  });
});

const awaitParameterError = new SyntaxError("Cannot use 'await' as a parameter name in a static block.");
const awaitReferenceError = new SyntaxError(
  "The 'await' keyword is disallowed in the IdentifierReference position within static block.",
);

describe("await as a parameter name of an arrow function in a class static block is a SyntaxError", () => {
  test.each([
    "(class { static { ({ await }) => 1; } })",
    "(class { static { ({ await = 1 }) => 1; } })",
    "(class { static { ({ a: { await } }) => 1; } })",
    "(class { static { ([{ await }]) => 1; } })",
    "(class { static { (...await) => 1; } })",
    "(class { static { (a, ...await) => 1; } })",
    // The arrow function is first parsed, and cached, from a scope that is not the static block.
    "(class { static { [a = (b = ({ await }) => 1)] = []; } })",
    "(class { static { [a = (b = (...await) => 1)] = []; } })",
  ])("%s", source => {
    expect(parse(source)).toThrow(awaitParameterError);
    expect(parse(`function f() { ${source} }`)).toThrow(awaitParameterError);
    expect(parse(`async function f() { ${source} }`)).toThrow(awaitParameterError);
  });

  // An async arrow function reserves `await` itself.
  test("(class { static { async ({ await }) => 1; } })", () => {
    expect(parse("(class { static { async ({ await }) => 1; } })")).toThrow(
      new SyntaxError("Cannot use 'await' as a parameter name in an async function."),
    );
  });

  // The expression pass of the parser sees `await` in the static block itself and rejects it first. `(await) => 1`,
  // `([await]) => 1` and `(a = await) => 1` were rejected before as well.
  test.each([
    "(class { static { (await) => 1; } })",
    "(class { static { ([await]) => 1; } })",
    "(class { static { (a = await) => 1; } })",
    "(class { static { ({ a: await }) => 1; } })",
    "(class { static { ({ ...await }) => 1; } })",
    "(class { static { ([...await]) => 1; } })",
    "(class { static { async (...await) => 1; } })",
  ])("%s", source => {
    expect(parse(source)).toThrow(awaitReferenceError);
    expect(parse(`function f() { ${source} }`)).toThrow(awaitReferenceError);
  });
});

describe("await in the body of an arrow function in a class static block is an identifier", () => {
  test.each([
    "(class { static { () => await; } })",
    "(class { static { () => { var await; }; } })",
    "(class { static { () => ({ await }); } })",
    "(class { static { () => (await) => 1; } })",
    "(class { static { () => ({ await }) => 1; } })",
    "(class { static { () => (...await) => 1; } })",
    "(class { static { () => function ({ await }) {}; } })",
    "(class { static { (a = function (...await) {}) => 1; } })",
    "(class { static { (a = (a) => { var await; }) => 1; } })",
    "(class { static { function f({ await }) {} } })",
  ])("%s", source => {
    expect(parse(source)).not.toThrow();
    expect(parse(`function f() { ${source} }`)).not.toThrow();
    expect(parse(`async function f() { ${source} }`)).not.toThrow();
  });

  test("the body runs with await as a variable", () => {
    const result = (0, eval)(`
      let result;
      class C {
        static {
          result = (() => { var await = "body"; return ((await) => await)(await); })();
        }
      }
      result;
    `);
    expect(result).toBe("body");
  });
});
