import { describe, expect, it } from "bun:test";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

describe("an exception that crosses the ShadowRealm boundary becomes a TypeError from the catching realm", () => {
  function catchError(fn) {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error("expected the call to throw");
  }

  // [source text of the thrown value, expected TypeError message]
  const cases = [
    [`Symbol("desc")`, "Symbol(desc)"],
    [`Symbol()`, "Symbol()"],
    [`Symbol.for("registered")`, "Symbol(registered)"],
    [`Symbol.iterator`, "Symbol(Symbol.iterator)"],
    [`Symbol.hasInstance`, "Symbol(Symbol.hasInstance)"],
    // An Error whose message is a Symbol has no description either. The caller gets the bare TypeError.
    [`Object.assign(new Error("x"), { message: Symbol("m") })`, "Type error"],
    [`"a string"`, "a string"],
    [`""`, "Type error"],
    [`42`, "42"],
    [`10n ** 30n`, "1000000000000000000000000000000"],
    [`undefined`, "undefined"],
    [`new RangeError("boom")`, "boom"],
    [`new Error("")`, "Type error"],
  ];
  // A JSFunction target and a Proxy target take different call paths in JSC.
  const targets = {
    arrow: body => `() => { ${body} }`,
    proxy: body => `new Proxy(() => { ${body} }, {})`,
    "proxy apply trap": body => `new Proxy(function () {}, { apply() { ${body} } })`,
  };
  const matrix = Object.entries(targets).flatMap(([kind, makeTarget]) =>
    cases.map(([thrown, message]) => [thrown, kind, makeTarget(`throw ${thrown};`), message]),
  );

  it.each(matrix)("realm function throws %s (%s target)", (thrown, kind, source, message) => {
    const realm = new ShadowRealm();
    const wrapped = realm.evaluate(source);
    const error = catchError(wrapped);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(message);
  });

  it.each(matrix)("function passed into the realm throws %s (%s target)", (thrown, kind, source, message) => {
    const realm = new ShadowRealm();
    const callAndDescribe = realm.evaluate(`(fn) => {
      try {
        fn();
      } catch (e) {
        return (e instanceof TypeError) + ":" + e.message;
      }
      return "did not throw";
    }`);
    const thrower = (0, eval)(source);
    expect(callAndDescribe(thrower)).toBe("true:" + message);
  });

  // evaluate() describes the thrown value the same way, with its own generic message when there is
  // nothing to say. It also reads the own "message" data property of any thrown object, but runs
  // none of the thrown value's code to do so and lets nothing from the realm out in its place.
  const genericEvaluateMessage = "Error encountered during evaluation";
  const evaluateCases = [
    ...cases.map(([thrown, message]) => [thrown, message === "Type error" ? genericEvaluateMessage : message]),
    [`{ message: "plain object" }`, "plain object"],
    [`{ message: 42 }`, "42"],
    [`{ get message() { throw new Error("getter ran"); } }`, genericEvaluateMessage],
    [`{ message: { toString() { throw new Error("toString ran"); } } }`, genericEvaluateMessage],
    [`{ message: { toString() { return "toString ran"; } } }`, genericEvaluateMessage],
    [
      `new Proxy(new Error("proxy"), { getOwnPropertyDescriptor() { throw new Error("trap ran"); } })`,
      genericEvaluateMessage,
    ],
  ];
  it.each(evaluateCases)("evaluate() of a script that throws %s", (thrown, message) => {
    const realm = new ShadowRealm();
    const error = catchError(() => realm.evaluate(`throw ${thrown}`));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(message);
  });
});
