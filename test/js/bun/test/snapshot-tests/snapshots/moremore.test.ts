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

// JavaScriptCore binds an anonymous default export to the private name `*default*`, whose text is
// "starDefault". The name of the class or function is "default", and a snapshot has that name.
test("an anonymous default export is named default in a snapshot", async () => {
  const { default: Class } = await import("data:text/javascript,export default class {}");
  const { default: ClassWithField } = await import("data:text/javascript,export default class { a = 1 }");
  const { default: arrow } = await import("data:text/javascript,export default () => {}");
  // The text of a SourceTextModule reaches JavaScriptCore as it is written.
  const { SourceTextModule } = await import("node:vm");
  const module = new SourceTextModule("export default function () {}");
  await module.link(() => {});
  await module.evaluate();

  expect({
    class: Class,
    instance: new Class(),
    instanceWithField: new ClassWithField(),
    arrow,
    declaration: module.namespace.default,
    element: { $$typeof: Symbol.for("react.element"), type: Class, props: {}, key: null, ref: null },
    any: expect.any(Class),
  }).toMatchInlineSnapshot(`
    {
      "any": Any<default>,
      "arrow": [Function],
      "class": [class default],
      "declaration": [Function: default],
      "element": <default />,
      "instance": default {},
      "instanceWithField": default {
        "a": 1,
      },
    }
  `);
});
