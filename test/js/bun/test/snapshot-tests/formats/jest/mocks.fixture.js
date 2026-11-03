const target = {
  method(a) {
    return a + 1;
  },
  get prop() {
    return 1;
  },
};
const cases = {
  "jest.fn()": () => jest.fn(),
  "jest.fn(arrow)": () => jest.fn(() => 1),
  "jest.fn(named function)": () => jest.fn(function impl() {}),
  "jest.fn(class)": () => jest.fn(class Impl {}),
  "jest.fn() with mockName": () => jest.fn().mockName("renamed"),
  "jest.fn() with empty mockName": () => jest.fn().mockName(""),
  "jest.fn() with odd mockName": () => jest.fn().mockName("a `b` ${c} \\"),
  "jest.fn() that was called": () => {
    const f = jest.fn();
    f(1, "two");
    f({ a: 1 });
    return f;
  },
  "jest.fn(impl) that was called": () => {
    const f = jest.fn(x => x * 2);
    f(2);
    return f;
  },
  "jest.fn() that threw": () => {
    const f = jest.fn(() => {
      throw new Error("x");
    });
    try {
      f();
    } catch {}
    return f;
  },
  "jest.fn() after mockClear": () => {
    const f = jest.fn().mockName("n");
    f();
    f.mockClear();
    return f;
  },
  "jest.fn() after mockReset": () => {
    const f = jest.fn().mockName("n");
    f();
    f.mockReset();
    return f;
  },
  "jest.fn() after mockRestore": () => {
    const f = jest.fn().mockName("n");
    f();
    f.mockRestore();
    return f;
  },
  "jest.spyOn method": () => {
    const s = jest.spyOn(target, "method");
    const r = s;
    s.mockRestore();
    return r;
  },
  "jest.spyOn method, live": () => jest.spyOn({ m() {} }, "m"),
  "jest.spyOn getter": () =>
    jest.spyOn(
      {
        get g() {
          return 1;
        },
      },
      "g",
      "get",
    ),
  "jest.spyOn with mockName": () => jest.spyOn({ m() {} }, "m").mockName("spy name"),
  "jest.spyOn symbol": () => {
    const s = Symbol("sm");
    return jest.spyOn({ [s]() {} }, s);
  },
  "in an object": () => ({ onClick: jest.fn(), onNamed: jest.fn().mockName("named"), plain: () => {} }),
  "in an array": () => [jest.fn(), jest.fn().mockName("x")],
  "in a Map": () => new Map([["f", jest.fn()]]),
  "the object spied on": () => {
    const o = { m() {}, n: 1 };
    jest.spyOn(o, "m");
    return o;
  },
  "mock.calls": () => {
    const f = jest.fn();
    f(1, "a");
    f();
    return f.mock.calls;
  },
  "mock.results": () => {
    const f = jest.fn(x => {
      if (x) throw new Error("e");
      return "ok";
    });
    f(0);
    try {
      f(1);
    } catch {}
    return f.mock.results;
  },
  names: () => [
    jest.fn().getMockName(),
    jest.fn(function impl() {}).getMockName(),
    jest.fn(() => {}).getMockName(),
    jest.fn().mockName("x").getMockName(),
    jest.fn().mockName("").getMockName(),
    jest.spyOn({ m() {} }, "m").getMockName(),
    jest
      .spyOn(
        {
          get g() {
            return 1;
          },
        },
        "g",
        "get",
      )
      .getMockName(),
    jest
      .spyOn({ m() {} }, "m")
      .mockName("y")
      .getMockName(),
    jest.fn().mockName("x").mockClear().getMockName(),
    jest.fn().mockName("x").mockReset().getMockName(),
  ],
};
describe("mocks", () => {
  for (const [name, make] of Object.entries(cases)) {
    test(name, () => {
      expect(make()).toMatchSnapshot();
    });
  }
});
