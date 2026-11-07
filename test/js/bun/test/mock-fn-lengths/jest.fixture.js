// Jest 30.5.2 wrote __snapshots__/jest.fixture.js.snap. To add a row, run this file under Jest. Never update the snapshots with Bun.
function three(a, b, c) {}

// Functions of every kind whose `length` the language fixes, so it is the same in every engine.
const originals = {
  "a function": () => three,
  "an arrow function": () => (a, b) => {},
  "a function of 9 parameters": () => function (a, b, c, d, e, f, g, h, i) {},
  "a class": () => class { constructor(a, b) {} }, // prettier-ignore
  "a class that extends another": () => class extends Map {},
  "an async function": () => async function (a) {},
  "a generator function": () => function* (a, b, c, d) {},
  "a function with a default": () => function (a, b = 1, c) {},
  "a function with a rest": () => function (a, ...rest) {},
  "a bound function": () => three.bind(null, 1),
  "a mock of a function": () => jest.fn(three),
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

const show = value =>
  typeof value === "string" ? "the string " + value : typeof value === "bigint" ? value + "n" : String(value);
// The value of the own `length`, and each attribute that it has.
const lengthOf = mock => {
  const own = Object.getOwnPropertyDescriptor(mock, "length");
  if (!own) return "no own length";
  const attributes = ["writable", "enumerable", "configurable"].filter(attribute => own[attribute]);
  return [show(own.value), ...attributes].join(", ");
};
const withLength = value => Object.defineProperty(function (a, b) {}, "length", { value });

describe("lengths", () => {
  test("jest.fn()", () => {
    const lengths = Object.entries(originals).map(([kind, original]) => [kind, lengthOf(jest.fn(original()))]);
    expect(Object.fromEntries(lengths)).toMatchSnapshot();
  });

  test("no function to replace", () => {
    expect({
      "jest.fn()": lengthOf(jest.fn()),
      "jest.fn(undefined)": lengthOf(jest.fn(undefined)),
    }).toMatchSnapshot();
  });

  // In Bun a spy has the `length` of a JS function, and in Jest it has 0. The two agree in these rows.
  test("jest.spyOn()", () => {
    expect({
      "Date": lengthOf(jest.spyOn({ key: Date }, "key")),
      "a Proxy of a function": lengthOf(jest.spyOn({ key: new Proxy(three, {}) }, "key")),
      "a Proxy of Date": lengthOf(jest.spyOn({ key: new Proxy(Date, {}) }, "key")),
      "a function of no parameters": lengthOf(jest.spyOn({ key() {} }, "key")),
    }).toMatchSnapshot();
  });

  test("a length that is not a count", () => {
    const values = ["abc", "3", true, 10n, Symbol("length"), null, undefined];
    const inherits = Object.setPrototypeOf(function (a, b) {}, withLength(9));
    delete inherits.length;
    const deleted = function (a, b) {};
    delete deleted.length;
    expect({
      ...Object.fromEntries(values.map(value => [show(value), lengthOf(jest.fn(withLength(value)))])),
      "a getter that returns 5": lengthOf(jest.fn(Object.defineProperty(function () {}, "length", { get: () => 5 }))),
      "deleted": lengthOf(jest.fn(deleted)),
      "deleted, and 9 in the prototype": lengthOf(jest.fn(inherits)),
    }).toMatchSnapshot();
  });

  test("afterwards", () => {
    const assigned = jest.fn(three);
    const isAssigned = Reflect.set(assigned, "length", 11);
    const deleted = jest.fn(three);
    delete deleted.length;
    expect({
      "mockImplementation()": lengthOf(jest.fn(three).mockImplementation((a, b) => {})),
      "mockImplementation() of jest.fn()": lengthOf(jest.fn().mockImplementation((a, b) => {})),
      "mockReset()": lengthOf(jest.fn(three).mockReset()),
      "an assignment of 11": [isAssigned, lengthOf(assigned)],
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
    const readsOf = make => ((reads = 0), make(counting()), reads);
    expect({
      "jest.fn()": readsOf(original => jest.fn(original)),
      "jest.spyOn()": readsOf(original => jest.spyOn({ key: original }, "key")),
      "a call, mockReset() and a read of the mock's length": readsOf(original => {
        const mock = jest.fn(original);
        reads = 0;
        mock();
        mock.mockReset();
        mock.length;
      }),
    }).toMatchSnapshot();
  });
});
