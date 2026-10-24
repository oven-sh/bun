import { expect, jest, mock, test } from "bun:test";

class Number2 extends Number {
  constructor(value: number) {
    super(value);
  }
}
class Number3 extends Number2 {
  constructor(value: number) {
    super(value);
  }
}

class Boolean2 extends Boolean {
  constructor(value: boolean) {
    super(value);
  }
}

class Boolean3 extends Boolean2 {
  constructor(value: boolean) {
    super(value);
  }

  false = true;

  helloBoolean3() {
    return "true";
  }
}

test("test snapshots with Boolean and Number", () => {
  expect(1).toMatchSnapshot();
  expect(NaN).toMatchSnapshot();
  expect(Infinity).toMatchSnapshot();
  expect(-Infinity).toMatchSnapshot();
  expect(0).toMatchSnapshot();
  expect(-0).toMatchSnapshot();
  expect(1.1).toMatchSnapshot();
  expect(-1.1).toMatchSnapshot();
  expect(undefined).toMatchSnapshot();
  expect(null).toMatchSnapshot();
  expect("hello").toMatchSnapshot();
  expect("").toMatchSnapshot();

  expect(new Number(1)).toMatchSnapshot();
  expect(new Number2(1)).toMatchSnapshot();
  expect(new Number3(1)).toMatchSnapshot();
  expect(123348923.2341281).toMatchSnapshot();
  expect(false).toMatchSnapshot();
  expect(true).toMatchSnapshot();
  expect(new Boolean(false)).toMatchSnapshot();
  expect(new Boolean(true)).toMatchSnapshot();
  expect(new Boolean2(true)).toMatchSnapshot();
  expect(new Boolean2(false)).toMatchSnapshot();
  expect(new Boolean3(true)).toMatchSnapshot();
  expect(new Boolean3(false)).toMatchSnapshot();

  expect({
    first: new Boolean2(false),
    a: {
      j: new Date(),
      b: {
        c: {
          num: 1,
          d: {
            e: {
              bigint: 123n,
              f: {
                g: {
                  h: {
                    i: new Number3(2),
                    bool: true,
                  },
                  compare: "compare",
                },
              },
              ignore1: 234,
              ignore2: {
                ignore3: 23421,
                ignore4: {
                  ignore5: {
                    ignore6: "hello",
                    ignore7: "done",
                  },
                },
              },
            },
          },
          string: "hello",
        },
      },
    },
  }).toMatchSnapshot({
    first: expect.any(Boolean2),
    a: {
      j: expect.any(Date),
      b: {
        c: {
          num: expect.any(Number),
          string: expect.any(String),
          d: {
            e: {
              bigint: expect.any(BigInt),
              f: {
                g: {
                  compare: "compare",
                  h: {
                    i: expect.any(Number3),
                    bool: expect.any(Boolean),
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});

test("async and generator functions print their own name", () => {
  function plain() {}
  async function load() {}
  function* entries() {}
  async function* stream() {}
  const expression = async function save() {};
  const methods = { async get() {}, *keys() {} };
  class Tagged {
    static get [Symbol.toStringTag]() {
      return "NotTheClassName";
    }
  }

  expect({ plain, load, entries, stream, expression, bound: load.bind(null), methods, Tagged }).toMatchInlineSnapshot(`
    {
      "Tagged": [class Tagged],
      "bound": [Function: load],
      "entries": [Function: entries],
      "expression": [Function: save],
      "load": [Function: load],
      "methods": {
        "get": [Function: get],
        "keys": [Function: keys],
      },
      "plain": [Function: plain],
      "stream": [Function: stream],
    }
  `);

  expect(() => expect({ load }).toEqual({})).toThrow('"load": [Function: load]');

  const element = { $$typeof: Symbol.for("react.element"), type: load, props: {} };
  expect(element).toMatchInlineSnapshot(`<load />`);
});

test("an unbound function with only an inferred name keeps the text that existing snapshots have", () => {
  // To print an inferred name here is a separate snapshot format change. This pins the text until then.
  const arrow = () => {};
  const asyncArrow = async () => {};
  const generator = function* () {};
  const asyncGenerator = async function* () {};

  expect({ arrow, asyncArrow, generator, asyncGenerator }).toMatchInlineSnapshot(`
    {
      "arrow": [Function],
      "asyncArrow": [Function: AsyncFunction],
      "asyncGenerator": [Function: AsyncGeneratorFunction],
      "generator": [Function: GeneratorFunction],
    }
  `);
});

test("a bound function prints the name of its target, or the kind when the target has no name", () => {
  async function load() {}
  const asyncArrow = async () => {};
  const generator = function* () {};

  expect({
    boundAsyncArrow: asyncArrow.bind(null),
    boundGenerator: generator.bind(null),
    boundMock: jest.fn().bind(null),
    boundTwice: load.bind(null).bind(null),
  }).toMatchInlineSnapshot(`
    {
      "boundAsyncArrow": [Function: asyncArrow],
      "boundGenerator": [Function: generator],
      "boundMock": [Function: mockConstructor],
      "boundTwice": [Function: bound load],
    }
  `);

  expect([(() => {}).bind(null), (async () => {}).bind(null), function* () {}.bind(null)]).toMatchInlineSnapshot(`
    [
      [Function],
      [Function: AsyncFunction],
      [Function: GeneratorFunction],
    ]
  `);
});

test("a function made by the AsyncFunction constructor prints the name anonymous", () => {
  const AsyncFunction = (async () => {}).constructor as new (body: string) => Function;

  expect([new Function("return 1"), new AsyncFunction("return 1")]).toMatchInlineSnapshot(`
    [
      [Function: anonymous],
      [Function: anonymous],
    ]
  `);
});

test("a class with a static Symbol.toStringTag keeps its own name in matcher messages", () => {
  class Tagged {
    static get [Symbol.toStringTag]() {
      return "NotTheClassName";
    }
  }
  const messageOf = (fn: () => void) => {
    try {
      fn();
    } catch (e: any) {
      return Bun.stripANSI(e.message);
    }
    return "";
  };

  expect(messageOf(() => expect({ a: 1 }).toEqual({ a: expect.any(Tagged) }))).toContain('"a": Any<Tagged>,');
  expect(
    messageOf(() =>
      expect(() => {
        throw new Error("x");
      }).toThrow(Tagged),
    ),
  ).toContain("Expected constructor: Tagged");
});

test("a JSX element whose type is a mock prints the name of the mock", () => {
  const element = (type: unknown) => ({ $$typeof: Symbol.for("react.element"), type, props: {} });

  expect(element(jest.fn())).toMatchInlineSnapshot(`<mockConstructor />`);
  expect(element(mock(function Child() {}))).toMatchInlineSnapshot(`<Child />`);
  expect(element(mock(() => null))).toMatchInlineSnapshot(`<Mock />`);
  expect(Bun.inspect(element(jest.fn()))).toBe("<mockConstructor />");
});

test("toEqual diff prints the own name of async and generator functions", () => {
  async function asyncFn() {}
  function* genFn() {}
  async function* asyncGenFn() {}
  let message = "";
  try {
    expect({ a: asyncFn, b: genFn, c: asyncGenFn, d: function plain() {} }).toEqual({ a: 1 });
  } catch (e: any) {
    message = Bun.stripANSI(e.message);
  }
  expect(message).toContain('+   "a": [Function: asyncFn],');
  expect(message).toContain('+   "b": [Function: genFn],');
  expect(message).toContain('+   "c": [Function: asyncGenFn],');
  expect(message).toContain('+   "d": [Function: plain],');
});
