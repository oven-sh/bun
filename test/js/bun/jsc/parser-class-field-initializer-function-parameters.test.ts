import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Fixed in oven-sh/WebKit#711. A class field initializer has two early errors: "ContainsArguments of Initializer
// is true" and "Initializer Contains SuperCall is true". Both look into an arrow function and stop at any other
// function, which has its own `arguments`. JavaScriptCore stopped only at the body of such a function, so `arguments`
// and `super()` in its parameters were a SyntaxError. The text goes to `eval`, so that each case is parsed on its own.

const run = (source: string) => (0, eval)(source);
const parse = (source: string) => () => run(source);

// [a class `C` with the field `f`, how to read the field]
const fields = [
  ["class { f = INITIALIZER; }", "new C().f"],
  ["class { static f = INITIALIZER; }", "C.f"],
  ["class { #f = INITIALIZER; read() { return this.#f; } }", "new C().read()"],
  ["class { ['f'] = INITIALIZER; }", "new C().f"],
  ["class extends Object { f = INITIALIZER; }", "new C().f"],
];

// The values of `use` for each kind of field, where `f` is the value of a field with this initializer.
const inEachField = (initializer: string, use: string) =>
  Promise.all(
    fields.map(([classSource, read]) =>
      run(`(() => {
        const C = ${classSource.replace("INITIALIZER", () => initializer)};
        const f = ${read};
        return ${use};
      })()`),
    ),
  );

const base = "(class { constructor(value) { this.value = value; } })";

describe("arguments in the parameters of a function in a class field initializer", () => {
  test.each([
    ["function (p = arguments.length) { return p; }", "f(undefined, 2)", 2],
    ["function (p = arguments.length) { return p; }", "f(7, 2)", 7],
    ["function (p = arguments) { return p === arguments; }", "f()", true],
    ["function (p = () => arguments.length) { return p(); }", "f(undefined, 1, 2)", 3],
    ["function ({ p = arguments.length }) { return p; }", "f({}, 1)", 2],
    ["function ([p = arguments.length]) { return p; }", "f([], 1, 2)", 3],
    ["function (...[p = arguments.length]) { return p; }", "f(undefined, 1)", 2],
    ["function* (p = arguments.length) { yield p; }", "f(undefined, 1).next().value", 2],
    ["async function (p = arguments.length) { return p; }", "f(undefined, 1, 2)", 3],
    ["{ m(p = arguments.length) { return p; } }", "f.m(undefined, 1, 2)", 3],
    ["{ set m(p = arguments.length) { this.value = p; } }", "((f.m = undefined), f.value)", 1],
    ["new (class { constructor(p = arguments.length) { this.p = p; } })(undefined, 1)", "f.p", 2],
    ["class { m(p = arguments.length) { return p; } }", "new f().m(undefined, 1)", 2],
    ["class { static m(p = arguments.length) { return p; } }", "f.m(undefined, 1, 2)", 3],
    ["class { #m(p = arguments.length) { return p; } call() { return this.#m(undefined, 1); } }", "new f().call()", 2],
    // The function is in an arrow function in the initializer, or in the parameters of another function.
    ["() => function (p = arguments.length) { return p; }", "f()(undefined, 1)", 2],
    ["(a = function (p = arguments.length) { return p; }) => a", "f()(undefined, 1, 2)", 3],
    ["[() => 1, function (p = arguments.length) { return p; }]", "f[1](undefined, 1)", 2],
    ["function (p = function (q = arguments.length) { return q; }) { return p(undefined, 1, 2); }", "f()", 3],
    // A computed key and a class heritage in the parameters belong to the function too.
    [
      "function (p = class { [arguments.length]() { return 'key'; } }) { return new p()[2](); }",
      "f(undefined, 1)",
      "key",
    ],
    [
      "function (p = class extends arguments[1] { }) { return new p('heritage').value; }",
      `f(undefined, ${base})`,
      "heritage",
    ],
    // Direct eval in the parameters is code of the function.
    [
      "function (p = eval('arguments.length'), q = () => eval('arguments.length')) { return p + q(); }",
      "f(undefined, undefined, 1)",
      6,
    ],
  ])("f = %s; %s", async (initializer, use, expected) => {
    expect(await inEachField(initializer, use)).toEqual(fields.map(() => expected));
  });
});

describe("super() in the parameters of a derived class constructor in a class field initializer", () => {
  test.each([
    [`class extends ${base} { constructor(p = super('parameters')) { } }`, "new f().value", "parameters"],
    [`class extends ${base} { constructor(p = () => super('arrow')) { p(); } }`, "new f().value", "arrow"],
    [
      `class extends ${base} { constructor(p = arguments.length, q = super(p)) { } }`,
      "new f(undefined, undefined, 2).value",
      3,
    ],
    [`class extends ${base} { constructor({ p = super('pattern') } = {}) { } }`, "new f().value", "pattern"],
    [`class extends ${base} { constructor(p = { [super('key').value]: 1 }) { this.p = p; } }`, "new f().p.key", 1],
  ])("f = %s; %s", async (initializer, use, expected) => {
    expect(await inEachField(initializer, use)).toEqual(fields.map(() => expected));
  });
});

describe("still a SyntaxError in a class field initializer", () => {
  // The initializer itself, an arrow function, a computed key and a class heritage are part of the initializer.
  test.each([
    "arguments",
    "arguments.length",
    "() => arguments",
    "(p = arguments.length) => p",
    "([p = arguments]) => p",
    "async (p = arguments) => p",
    "{ [arguments]() { } }",
    "class { [arguments]() { } }",
    "class extends arguments { }",
    // A class field initializer in the parameters is an initializer again.
    "function (p = class { g = arguments; }) { }",
    "function (p = class { g = () => arguments; }) { }",
    "{ m(p = class { static g = arguments.length; }) { } }",
    // After the function, the rest of the initializer is checked as before.
    "[function (p = arguments) { }, arguments]",
    "(a = function (p = arguments) { }, b = arguments) => a",
    "{ m(p = arguments) { }, [arguments]: 1 }",
    "() => { (function (p = arguments) { }); return arguments; }",
  ])("f = %s", initializer => {
    const error = new SyntaxError(
      "Unexpected identifier 'arguments'. Cannot reference 'arguments' in class field initializer.",
    );
    for (const [classSource] of fields)
      expect(parse(`(${classSource.replace("INITIALIZER", () => initializer)})`)).toThrow(error);
  });

  test.each([
    "super()",
    "() => super()",
    "(p = super()) => p",
    "{ [super()]: 1 }",
    "class extends super() { }",
    "class extends Object { constructor(p = class { g = super(); }) { } }",
    // After the constructor, the rest of the initializer is checked as before.
    "[class extends Object { constructor(p = super()) { } }, super()]",
    "[class extends Object { constructor(p = super()) { } }, () => super()]",
  ])("f = %s", initializer => {
    const error = new SyntaxError("Unexpected token '('. super call is not valid in class field initializer context.");
    expect(parse(`(class extends Object { f = ${initializer}; })`)).toThrow(error);
    expect(parse(`(class extends Object { static f = ${initializer}; })`)).toThrow(error);
  });

  // Only the constructor of a derived class can call super(). The message is the one that the same function gets
  // outside a class field.
  test.each([
    "function (p = super()) { }",
    "{ m(p = super()) { } }",
    "class { constructor(p = super()) { } }",
    "class extends Object { m(p = super()) { } }",
    "class extends Object { constructor(p = function () { super(); }) { } }",
  ])("f = %s", initializer => {
    const error = new SyntaxError("super is not valid in this context.");
    expect(parse(`(class extends Object { f = ${initializer}; })`)).toThrow(error);
    expect(parse(`(class extends Object { f() { return ${initializer}; } })`)).toThrow(error);
  });
});

test("a script with `arguments` in the parameters of a function in a class field initializer runs", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "class A { f = function (p = arguments.length) { return p; }; }\nconsole.log(new A().f(undefined, 2));",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
});
