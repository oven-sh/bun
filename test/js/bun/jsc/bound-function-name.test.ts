import { describe, expect, test } from "bun:test";

// The name of a bound function is "bound " and the name that its target has when bind() runs. JavaScriptCore used to
// answer "bound " alone for a target that got its name while the program ran: from a key in brackets, or as the getter
// or setter function of a native accessor.
//
// The sources go through `new Function`, so that Bun's transpiler leaves the keys as they are written.
const run = (body: string) => new Function(body)();

describe("a bound function takes the name of its target", () => {
  test.each([
    ["a method under a key in brackets", "({ [key]() {} })[key]", "one"],
    ["a method under a literal in brackets", '({ ["one"]() {} }).one', "one"],
    ["a function under a key in brackets", "({ [key]: function () {} })[key]", "one"],
    ["an arrow function under a key in brackets", "({ [key]: () => {} })[key]", "one"],
    ["a class under a key in brackets", "({ [key]: class {} })[key]", "one"],
    ["a generator method under a key in brackets", "({ *[key]() {} })[key]", "one"],
    ["an async method under a key in brackets", "({ async [key]() {} })[key]", "one"],
    ["an async generator method under a key in brackets", "({ async *[key]() {} })[key]", "one"],
    [
      "a getter under a key in brackets",
      "Object.getOwnPropertyDescriptor({ get [key]() { return 1; } }, key).get",
      "get one",
    ],
    [
      "a setter under a key in brackets",
      "Object.getOwnPropertyDescriptor({ set [key](value) {} }, key).set",
      "set one",
    ],
    ["a method of a class under a key in brackets", "new (class { [key]() {} })()[key]", "one"],
    ["a static method under a key in brackets", "(class { static [key]() {} })[key]", "one"],
    ["a function in a class field under a key in brackets", "new (class { [key] = function () {} })()[key]", "one"],
    ["an arrow function in a class field under a key in brackets", "new (class { [key] = () => {} })()[key]", "one"],
    ["a method under a symbol", "({ [symbol]() {} })[symbol]", "[s]"],
    [
      "a getter under a symbol",
      "Object.getOwnPropertyDescriptor({ get [symbol]() { return 1; } }, symbol).get",
      "get [s]",
    ],
    // This name is in the code, and it was right before.
    ["a method under a plain key", "({ one() {} }).one", "one"],
  ])("%s", (_, target, name) => {
    const names = run(`
      const key = "one";
      const symbol = Symbol("s");
      const target = ${target};
      const bound = target.bind(null);
      return [bound.bind(null).name, bound.name, target.name, Function.prototype.bind.call(target).name, Reflect.apply(Function.prototype.bind, target, []).name];
    `);
    expect(names).toEqual([`bound bound ${name}`, `bound ${name}`, name, `bound ${name}`, `bound ${name}`]);
  });

  test.each([
    ["get url", Request.prototype],
    ["get status", Response.prototype],
    ["get size", Blob.prototype],
    ["set input", RegExp],
  ])('the function "%s" of a native accessor', (name, holder) => {
    const [kind, property] = name.split(" ") as ["get" | "set", string];
    const target: Function = Object.getOwnPropertyDescriptor(holder, property)![kind]!;
    expect([target.name, target.bind(null).name, target.bind(null).bind(null).name]).toEqual([
      name,
      `bound ${name}`,
      `bound bound ${name}`,
    ]);
  });

  test("with the name that the target has when bind() runs", () => {
    expect(
      run(`
        const key = "one";
        const make = () => ({ [key](a, b, c) {} })[key];
        const result = {};

        let target = make();
        let bound = target.bind(null);
        Object.defineProperty(target, "name", { value: "changed" });
        result.redefinedAfterBind = [bound.name, target.bind(null).name];

        target = make();
        bound = target.bind(null);
        delete target.name;
        result.deletedAfterBind = [bound.name, target.bind(null).name];

        target = make();
        let calls = 0;
        Object.defineProperty(target, "name", { get() { return "got" + ++calls; } });
        bound = target.bind(null);
        result.getter = [calls, bound.name, bound.name, calls];

        target = make();
        Object.defineProperty(target, "name", { value: 42 });
        result.notAString = target.bind(null).name;

        result.twoFunctionObjectsOfOneFunction = ["a", "b"].map(name => ({ [name]() {} })[name].bind(null).name);
        return result;
      `),
    ).toEqual({
      redefinedAfterBind: ["bound one", "bound changed"],
      deletedAfterBind: ["bound one", "bound "],
      getter: [1, "bound got1", "bound got1", 1],
      notAString: "bound ",
      twoFunctionObjectsOfOneFunction: ["bound a", "bound b"],
    });
  });

  test("and still gets the length of its target", () => {
    expect(
      run(`
        const key = "one";
        const make = () => ({ [key](a, b, c) {} })[key];
        const result = {};

        let target = make();
        result.asWritten = [target.bind(null).length, target.bind(null, 1).length, target.bind(null, 1, 2, 3, 4).length];

        let bound = target.bind(null, 1);
        Object.defineProperty(target, "length", { value: 10 });
        result.redefinedAfterBind = [bound.length, bound.name, target.bind(null, 1).length, target.bind(null, 1).name];

        target = make();
        bound = target.bind(null, 1);
        result.boundTwice = [bound.bind(null, 2).length, bound.bind(null, 2).name];
        return result;
      `),
    ).toEqual({
      asWritten: [3, 2, 0],
      redefinedAfterBind: [2, "bound one", 9, "bound one"],
      boundTwice: [1, "bound bound one"],
    });
  });
});
