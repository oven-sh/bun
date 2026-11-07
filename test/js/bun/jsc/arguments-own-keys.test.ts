import { describe, expect, test } from "bun:test";
import querystring from "node:querystring";
import util from "node:util";

// A test file is a strict module, and only a sloppy function has an arguments object that is bound to its parameters.
// `new Function` makes sloppy functions. JavaScriptCore has two classes for that object: one for a function whose
// parameters no closure reads ("direct"), and one for a function with such a closure ("scoped").
const kinds = {
  direct: (body: string) => new Function("a", "b", "c", `${body}; return arguments;`),
  scoped: (body: string) =>
    new Function("a", "b", "c", `var capture = function () { return a; }; ${body}; return arguments;`),
};

function forIn(object: object) {
  const keys: string[] = [];
  for (const key in object) keys.push(key);
  return keys;
}

function lists(args: IArguments) {
  return {
    keys: Object.keys(args),
    forIn: forIn(args),
    entries: Object.entries(args),
    json: JSON.stringify(args),
    names: Object.getOwnPropertyNames(args),
    ownKeys: Reflect.ownKeys(args),
  };
}

describe.each(Object.entries(kinds))("the own keys of a sloppy arguments object (%s)", (_, makeFunction) => {
  test("an index that is not enumerable is only in the lists of all keys", () => {
    const hidden = makeFunction(`Object.defineProperty(arguments, 0, { enumerable: false })`);
    const args = hidden("zero", "one");
    expect(Object.prototype.propertyIsEnumerable.call(args, 0)).toBe(false);
    expect(lists(args)).toEqual({
      keys: ["1"],
      forIn: ["1"],
      entries: [["1", "one"]],
      json: `{"1":"one"}`,
      // Node.js leaves "0" out of these two lists as well. ECMAScript lists every own key in them.
      names: ["0", "1", "length", "callee"],
      ownKeys: ["0", "1", "length", "callee", Symbol.iterator],
    });
  });

  test("an index that was deleted and stored again is at its place in ascending order", () => {
    const rewritten = makeFunction(`delete arguments[1]; arguments[1] = "again"`);
    expect(lists(rewritten("a", "b", "c"))).toEqual({
      keys: ["0", "1", "2"],
      forIn: ["0", "1", "2"],
      entries: [
        ["0", "a"],
        ["1", "again"],
        ["2", "c"],
      ],
      json: `{"0":"a","1":"again","2":"c"}`,
      names: ["0", "1", "2", "length", "callee"],
      ownKeys: ["0", "1", "2", "length", "callee", Symbol.iterator],
    });
  });

  test("an index that became a getter or read-only is at its place in ascending order", () => {
    const getter = makeFunction(
      `Object.defineProperty(arguments, 1, { get() { return "got"; }, enumerable: true, configurable: true })`,
    );
    expect(lists(getter("a", "b", "c"))).toMatchObject({
      keys: ["0", "1", "2"],
      forIn: ["0", "1", "2"],
      json: `{"0":"a","1":"got","2":"c"}`,
      ownKeys: ["0", "1", "2", "length", "callee", Symbol.iterator],
    });

    const readOnly = makeFunction(`Object.defineProperty(arguments, 0, { writable: false })`);
    expect(lists(readOnly("a", "b", "c"))).toMatchObject({
      keys: ["0", "1", "2"],
      forIn: ["0", "1", "2"],
      json: `{"0":"a","1":"b","2":"c"}`,
      ownKeys: ["0", "1", "2", "length", "callee", Symbol.iterator],
    });
  });

  test("stored, hidden and untouched indices together, below and past the argument count", () => {
    const mixed = makeFunction(
      `delete arguments[0]; arguments[4] = "past"; arguments[0] = "again"; Object.defineProperty(arguments, 2, { enumerable: false })`,
    );
    expect(lists(mixed("a", "b", "c"))).toEqual({
      keys: ["0", "1", "4"],
      forIn: ["0", "1", "4"],
      entries: [
        ["0", "again"],
        ["1", "b"],
        ["4", "past"],
      ],
      json: `{"0":"again","1":"b","4":"past"}`,
      names: ["0", "1", "2", "4", "length", "callee"],
      ownKeys: ["0", "1", "2", "4", "length", "callee", Symbol.iterator],
    });
  });

  test("the reviver walk of JSON.parse leaves an index that is not enumerable as it is", () => {
    const changed = makeFunction(
      `Object.defineProperty(arguments, 0, { enumerable: false }); delete arguments[1]; arguments[1] = "again"`,
    );
    const args = changed("a", "b", "c");
    // The walk lists the keys of each object it comes to, and stores what the reviver returns under each of them.
    const seen: string[] = [];
    JSON.parse('{"first":0,"second":0}', function (this: any, key: string, value: unknown) {
      if (key === "first") this.second = args;
      if (this === args) seen.push(key);
      return value;
    });
    expect(seen).toEqual(["1", "2"]);
    expect(Object.getOwnPropertyDescriptor(args, 0)).toEqual({
      value: "a",
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test("node:util and node:querystring go by the same keys", () => {
    const hidden = makeFunction(`Object.defineProperty(arguments, 0, { enumerable: false })`);
    const rewritten = makeFunction(`delete arguments[1]; arguments[1] = "again"`);

    expect(util.isDeepStrictEqual(hidden(1, 2), hidden(9, 2))).toBe(true);
    expect(util.isDeepStrictEqual(hidden(1, 2), hidden(1, 3))).toBe(false);
    expect(Bun.deepEquals(hidden(1, 2), hidden(9, 2))).toBe(true);
    expect(util.inspect(hidden("zero", "one"))).toBe(`[Arguments] { '1': 'one' }`);
    expect(util.inspect(rewritten("a", "b", "c"))).toBe(`[Arguments] { '0': 'a', '1': 'again', '2': 'c' }`);
    expect(querystring.stringify(hidden("zero", "one") as any)).toBe("1=one");
    expect(querystring.stringify(rewritten("a", "b", "c") as any)).toBe("0=a&1=again&2=c");
  });
});
