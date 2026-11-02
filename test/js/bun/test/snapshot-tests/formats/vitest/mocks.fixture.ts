// @ts-nocheck
import { describe, test, expect, vi } from "vitest";

const target = {
  method(a: number) {
    return a + 1;
  },
  get prop() {
    return 1;
  },
};

const cases: Record<string, () => unknown> = {
  "vi.fn()": () => vi.fn(),
  "vi.fn(arrow)": () => vi.fn(() => 1),
  "vi.fn(named function)": () => vi.fn(function impl() {}),
  "vi.fn(class)": () => vi.fn(class Impl {}),
  "vi.fn() with mockName": () => vi.fn().mockName("renamed"),
  "vi.fn() with empty mockName": () => vi.fn().mockName(""),
  "vi.fn() with odd mockName": () => vi.fn().mockName("a `b` ${c} \\"),
  "vi.fn() that was called": () => {
    const f = vi.fn();
    f(1, "two");
    f({ a: 1 });
    return f;
  },
  "vi.fn(impl) that was called": () => {
    const f = vi.fn((x: number) => x * 2);
    f(2);
    return f;
  },
  "vi.fn() that threw": () => {
    const f = vi.fn(() => {
      throw new Error("x");
    });
    try {
      f();
    } catch {}
    return f;
  },
  "vi.fn() after mockClear": () => {
    const f = vi.fn().mockName("n");
    f();
    f.mockClear();
    return f;
  },
  "vi.fn() after mockReset": () => {
    const f = vi.fn().mockName("n");
    f();
    f.mockReset();
    return f;
  },
  "vi.fn() after mockRestore": () => {
    const f = vi.fn().mockName("n");
    f();
    f.mockRestore();
    return f;
  },
  "vi.spyOn method": () => {
    const s = vi.spyOn(target, "method");
    const r = s;
    s.mockRestore();
    return r;
  },
  "vi.spyOn method, live": () => vi.spyOn({ m() {} }, "m"),
  "vi.spyOn getter": () =>
    vi.spyOn(
      {
        get g() {
          return 1;
        },
      },
      "g",
      "get",
    ),
  "vi.spyOn with mockName": () => vi.spyOn({ m() {} }, "m").mockName("spy name"),
  "vi.spyOn symbol": () => {
    const s = Symbol("sm");
    return vi.spyOn({ [s]() {} }, s as any);
  },
  "in an object": () => ({ onClick: vi.fn(), onNamed: vi.fn().mockName("named"), plain: () => {} }),
  "in an array": () => [vi.fn(), vi.fn().mockName("x")],
  "in a Map": () => new Map([["f", vi.fn()]]),
  "the object spied on": () => {
    const o = { m() {}, n: 1 };
    vi.spyOn(o, "m");
    return o;
  },
  "mock.calls": () => {
    const f = vi.fn();
    f(1, "a");
    f();
    return f.mock.calls;
  },
  "mock.results": () => {
    const f = vi.fn((x: number) => {
      if (x) throw new Error("e");
      return "ok";
    });
    f(0);
    try {
      f(1);
    } catch {}
    return f.mock.results;
  },
  "names": () => [
    vi.fn().getMockName(),
    vi.fn(function impl() {}).getMockName(),
    vi.fn(() => {}).getMockName(),
    vi.fn().mockName("x").getMockName(),
    vi.fn().mockName("").getMockName(),
    vi.spyOn({ m() {} }, "m").getMockName(),
    vi
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
    vi
      .spyOn({ m() {} }, "m")
      .mockName("y")
      .getMockName(),
    vi.fn().mockName("x").mockClear().getMockName(),
    vi.fn().mockName("x").mockReset().getMockName(),
  ],
  "mockObject": () => vi.mockObject({ a() {}, b: { c() {} }, d: 1 }),
};

describe("mocks", () => {
  for (const [name, make] of Object.entries(cases)) {
    test(name, () => {
      expect(make()).toMatchSnapshot();
    });
  }
});
