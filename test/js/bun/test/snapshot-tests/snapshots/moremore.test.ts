import { expect, test } from "bun:test";

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

test("functions without a name of their own print the way existing snapshots have them", () => {
  // A name inferred from the variable is not printed, and an anonymous async or generator
  // function is still labelled with its kind, so existing .snap files keep matching.
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
