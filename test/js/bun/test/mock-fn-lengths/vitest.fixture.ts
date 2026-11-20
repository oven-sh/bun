// @ts-nocheck
// Vitest 5.0.3 wrote __snapshots__/vitest.fixture.ts.snap. To add a row, run this file under Vitest. Never update the snapshots with Bun.
import { describe, test, expect, vi } from "vitest";

function three(a, b, c) {}

// Functions of every kind whose `length` the language fixes, so it is the same in every engine.
const originals: Record<string, () => any> = {
  "a function": () => three,
  "an arrow function": () => (a, b) => {},
  "a class": () => class { constructor(a, b) {} }, // prettier-ignore
  "a class that extends another": () => class extends Map {},
  "an async function": () => async function (a) {},
  "a generator function": () => function* (a, b, c, d) {},
  "a function with a default": () => function (a, b = 1, c) {},
  "a function with a rest": () => function (a, ...rest) {},
  "a bound function": () => three.bind(null, 1),
  "a Proxy of a function": () => new Proxy(three, {}),
  "a Proxy whose get trap answers 8": () =>
    new Proxy(three, { get: (target, key, receiver) => (key === "length" ? 8 : Reflect.get(target, key, receiver)) }),
  "Date": () => Date,
  "a bound Date": () => Date.bind(null, 1),
  "a Proxy of Date": () => new Proxy(Date, {}),
  "Math.max": () => Math.max,
  "Map": () => Map,
  "Promise": () => Promise,
  "Array": () => Array,
  "Error": () => Error,
  "RegExp": () => RegExp,
  "Uint8Array": () => Uint8Array,
  "Symbol": () => Symbol,
};

const accessor = (half: PropertyDescriptor) => Object.defineProperty({}, "key", { ...half, configurable: true });
const routes: Record<string, (original: any) => any> = {
  "vi.fn()": original => vi.fn(original),
  "vi.spyOn()": original => vi.spyOn({ key: original }, "key"),
  "vi.spyOn() of what a getter returns": original => vi.spyOn(accessor({ get: () => original }), "key"),
  "vi.spyOn() of a getter": original => vi.spyOn(accessor({ get: original }), "key", "get"),
  "vi.spyOn() of a setter": original => vi.spyOn(accessor({ set: original }), "key", "set"),
  "vi.mockObject()": original => vi.mockObject({ key: original }).key,
  "vi.mockObject() of the function": original => vi.mockObject(original),
};

const show = (value: unknown) =>
  typeof value === "string" ? "the string " + value : typeof value === "bigint" ? value + "n" : String(value);
// The value of the own `length`, and each attribute that it has.
const lengthOf = (mock: any) => {
  const own = Object.getOwnPropertyDescriptor(mock, "length");
  if (!own) return "no own length";
  const attributes = ["writable", "enumerable", "configurable"].filter(attribute => own[attribute]);
  return [show(own.value), ...attributes].join(", ");
};
const withLength = (value: unknown) => Object.defineProperty(function (a, b) {}, "length", { value });

describe("lengths", () => {
  for (const [route, make] of Object.entries(routes)) {
    test(route, () => {
      const lengths = Object.entries(originals).map(([kind, original]) => [kind, lengthOf(make(original()))]);
      expect(Object.fromEntries(lengths)).toMatchSnapshot();
    });
  }

  test("vi.mockObject() with spy", () => {
    const functions = { function: three, bound: three.bind(null, 1), proxy: new Proxy(three, {}) };
    const spied = vi.mockObject({ ...functions }, { spy: true });
    expect(Object.fromEntries(Object.keys(functions).map(key => [key, lengthOf(spied[key])]))).toMatchSnapshot();
  });

  test("no function to replace", () => {
    expect({
      "vi.fn()": lengthOf(vi.fn()),
      "vi.fn(undefined)": lengthOf(vi.fn(undefined)),
      "vi.spyOn(get) of a value": lengthOf(vi.spyOn({ key: 1 }, "key", "get")),
      "vi.spyOn(set) of a value": lengthOf(vi.spyOn({ key: 1 }, "key", "set")),
      "vi.spyOn(set) of a getter alone": lengthOf(vi.spyOn(accessor({ get: () => 1 }), "key", "set")),
    }).toMatchSnapshot();
  });

  test("a length that is not a count", () => {
    const values = ["abc", "3", true, 10n, Symbol("length"), null, undefined, 1.5, -1, Infinity, NaN];
    const inherits = Object.setPrototypeOf(function (a, b) {}, withLength(9));
    delete inherits.length;
    const deleted = function (a, b) {};
    delete deleted.length;
    expect({
      ...Object.fromEntries(values.map(value => [show(value), lengthOf(vi.fn(withLength(value)))])),
      "the string abc, of a spy": lengthOf(vi.spyOn({ key: withLength("abc") }, "key")),
      "null, of a spy": lengthOf(vi.spyOn({ key: withLength(null) }, "key")),
      "the string abc, of an automock": lengthOf(vi.mockObject({ key: withLength("abc") }).key),
      "a getter that returns 5": lengthOf(vi.fn(Object.defineProperty(function () {}, "length", { get: () => 5 }))),
      "deleted": lengthOf(vi.fn(deleted)),
      "deleted, and 9 in the prototype": lengthOf(vi.fn(inherits)),
      "deleted, and 9 in the prototype, automock": lengthOf(vi.mockObject({ key: inherits }).key),
    }).toMatchSnapshot();
  });

  test("afterwards", () => {
    const assigned = vi.fn(three);
    assigned.length = 11;
    const deleted = vi.fn(three);
    delete deleted.length;
    const restored = vi.spyOn({ key: three }, "key");
    restored.mockRestore();
    expect({
      "mockImplementation()": lengthOf(vi.fn(three).mockImplementation((a, b) => {})),
      "mockImplementation() of vi.fn()": lengthOf(vi.fn().mockImplementation((a, b) => {})),
      "mockReset()": lengthOf(vi.fn(three).mockReset()),
      "mockRestore() of a spy": lengthOf(restored),
      "an assignment of 11": lengthOf(assigned),
      "delete": lengthOf(deleted),
      "delete, then the length": deleted.length,
    }).toMatchSnapshot();
  });

  test("the reads of the length of a Proxy", () => {
    let reads = 0;
    const counting = () =>
      new Proxy(three, {
        get: (target, key, receiver) => (key === "length" && reads++, Reflect.get(target, key, receiver)),
      });
    const readsOf = (make: (original: any) => unknown) => ((reads = 0), make(counting()), reads);
    expect({
      "vi.fn()": readsOf(original => vi.fn(original)),
      "vi.spyOn()": readsOf(original => vi.spyOn({ key: original }, "key")),
      "a call, mockReset() and a read of the mock's length": readsOf(original => {
        const mock = vi.fn(original);
        reads = 0;
        mock();
        mock.mockReset();
        mock.length;
      }),
    }).toMatchSnapshot();
  });

  test("the mocks that an automocked class gives its instances", () => {
    const lengths = (options?: { spy: boolean }) => {
      class K {
        method(a, b, c, d) {}
      }
      const Mocked = vi.mockObject({ K }, options).K;
      const ofClass = [lengthOf(Mocked.prototype.method), lengthOf(new Mocked().method)];
      Mocked.prototype.method = vi.fn(three);
      const ofMockOfTest = lengthOf(new Mocked().method);
      Mocked.prototype.method = three;
      vi.spyOn(Mocked.prototype, "method");
      return {
        "the method": ofClass[0],
        "the method of an instance": ofClass[1],
        "of an instance, with vi.fn() on the prototype": ofMockOfTest,
        "of an instance, with a spy on the prototype": lengthOf(new Mocked().method),
      };
    };
    expect({ automock: lengths(), spy: lengths({ spy: true }) }).toMatchSnapshot();
  });
});
