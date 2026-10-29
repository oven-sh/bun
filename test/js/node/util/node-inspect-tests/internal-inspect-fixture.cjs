// The inputs of the "util.inspect prints what Node.js v26.12.1 prints" tests of internal-inspect.test.js.
// Run as a script, this prints the result of every group as JSON: the test gives Node.js the same inputs that way.
"use strict";
const assert = require("node:assert");
const util = require("node:util");
const { inspect } = util;

// An Error made in `fn` has no stack frames, so it prints as "[Error: message]".
function withoutStackFrames(fn) {
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  try {
    return fn();
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
  }
}

// What `fn` returns, or what it throws as text.
function outcome(fn) {
  try {
    return fn();
  } catch (error) {
    return `throws ${error?.name}: ${error?.message}`;
  }
}

// An object whose `a` is a getter that returns `value`.
const returns = value => ({
  get a() {
    return value;
  },
});

// A getter for `key` on `target`, hidden unless `enumerable` is set, that throws `thrown`.
const throws = (target, key, thrown, enumerable = false) =>
  Object.defineProperty(target, key, {
    get() {
      throw thrown;
    },
    enumerable,
  });

// An Error with a hidden own `key` that holds `value`.
const hidden = (key, value) => Object.defineProperty(new Error("e"), key, { value, enumerable: false });

// A class named `name` whose instances have `tag` as their Symbol.toStringTag.
function tagged(name, tag, Base = Object) {
  const Class = { [name]: class extends Base {} }[name];
  Object.defineProperty(Class.prototype, Symbol.toStringTag, { get: () => tag });
  return Class;
}

// The second line of the colored stack of an error whose only frame is `text`.
const frame = text =>
  inspect(Object.assign(new Error("x"), { stack: `Error: x\n    at ${text}` }), { colors: true })
    .split("\n")[1]
    .slice("    at ".length);

const groups = {
  numericSeparator() {
    const options = { numericSeparator: true };
    return {
      array: inspect([-0], options),
      typedArray: inspect(new Float64Array([-0, 0, -0.5]), options),
      boxed: inspect(new Number(-0), options),
      format: util.formatWithOptions(options, "%d %i %f %s %o", -0, -0, -0, -0, -0),
    };
  },

  ownErrorKeys: () =>
    withoutStackFrames(() => {
      const suppressed = () => new SuppressedError(1, 2, "m");
      const withFrames = suppressed();
      withFrames.stack = "SuppressedError: m\n    at f (/a.js:1:1)";
      const circular = suppressed();
      Object.defineProperty(circular, "suppressed", { value: circular, enumerable: false });
      let fromUsing;
      try {
        using resource = {
          [Symbol.dispose]() {
            throw new Error("dispose");
          },
        };
        void resource;
        throw new Error("body");
      } catch (error) {
        fromUsing = error;
      }
      class WithCauseMethod extends Error {
        cause() {}
      }
      class WithErrorsGetter extends Error {
        get errors() {
          return [1];
        }
      }
      return {
        suppressedError: inspect(suppressed()),
        undefinedMembers: inspect(new SuppressedError(undefined, undefined, "m")),
        withFrames: inspect(withFrames),
        inObject: inspect({ a: suppressed() }),
        circular: inspect(circular),
        // The engine writes the message of this one, and each engine has its own text.
        fromUsing: inspect(fromUsing, { breakLength: Infinity }).replace(/^\[[^\]]*\]/, "[SuppressedError]"),
        hiddenError: inspect(hidden("error", 5)),
        hiddenSuppressed: inspect(hidden("suppressed", 6)),
        anyErrorClass: inspect(Object.defineProperty(new RangeError("r"), "error", { value: new TypeError("t") })),
        // An enumerable one is a regular key. It is not printed a second time.
        enumerable: inspect(Object.assign(new Error("e", { cause: 1 }), { suppressed: 6, error: 5 })),
        format: util.format("%s", suppressed()),
        // Past the depth limit an error that has keys to print is cut to its name.
        pastDepth: inspect({ a: { b: { c: suppressed() } } }),
        formatPastDepth: util.format("%s", { err: suppressed() }),
        // `cause` and `errors` are printed when they are own properties too.
        inheritedCause: inspect(new WithCauseMethod("m")),
        inheritedErrors: inspect(new WithErrorsGetter("m")),
      };
    }),

  // An own `error` or `suppressed` that is hard to print. Node.js prints all but the two that throw.
  hostileMembers: () =>
    withoutStackFrames(() => {
      const boom = () => new RangeError("boom");
      const errorWith = key => throws(new Error("x"), key, boom());
      class CauseThrows extends Error {
        get cause() {
          throw boom();
        }
      }
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const detached = new ArrayBuffer(8);
      const detachedView = new DataView(detached);
      detached.transfer();
      const self = new Error("e");
      Object.defineProperty(self, "error", { value: self, enumerable: false });
      const custom = {
        [inspect.custom]() {
          throw boom();
        },
      };
      const member = value => outcome(() => inspect(hidden("error", value)));
      return {
        toStringTagThrows: member(throws({}, Symbol.toStringTag, boom())),
        constructorThrows: member(throws({}, "constructor", boom())),
        stackThrows: member(errorWith("stack")),
        nameThrows: member(errorWith("name")),
        messageThrows: member(errorWith("message")),
        causeThrows: member(new CauseThrows("x")),
        errorsThrows: member(errorWith("errors")),
        revokedProxy: member(revoked.proxy),
        detachedDataView: member(detachedView),
        itself: outcome(() => inspect(self)),
        suppressedToStringTagThrows: outcome(() =>
          inspect(hidden("suppressed", throws({}, Symbol.toStringTag, boom()))),
        ),
        ofSuppressedError: outcome(() => inspect(new SuppressedError(throws({}, Symbol.toStringTag, boom()), 2, "m"))),
        // What an inspect.custom method throws is not caught: the caller gets that error.
        customThrows: member(custom),
        customGetterThrows: member(throws({}, inspect.custom, boom())),
        nestedCustomThrows: outcome(() => inspect({ a: custom })),
      };
    }),

  proxyMember: () =>
    withoutStackFrames(() => {
      const thrower = () => {
        throw new RangeError("boom");
      };
      const handler = { get: thrower, ownKeys: thrower, getOwnPropertyDescriptor: thrower, getPrototypeOf: thrower };
      return { throwingTraps: outcome(() => inspect(hidden("error", new Proxy({}, handler)))) };
    }),

  throwingGetters: () =>
    withoutStackFrames(() => {
      let assertMessage;
      try {
        // node:assert prints both operands with getters: true.
        assert.strictEqual(throws(new Error("e"), "error", null), 1);
      } catch (error) {
        assertMessage = error.message.split("\n")[0];
      }
      return {
        hiddenGettersTrue: inspect(throws(new Error("e"), "error", null), { getters: true }),
        hiddenGettersGet: inspect(throws(new Error("e"), "suppressed", undefined), { getters: "get" }),
        hiddenGettersOff: inspect(throws(new Error("e"), "error", null)),
        plainObject: inspect(throws({ b: 1 }, "a", null, true), { getters: true }),
        assertMessage,
      };
    }),

  getterReturnsFunction() {
    let assertMessage;
    try {
      assert.deepStrictEqual(
        returns(function foo() {}),
        {},
      );
    } catch (error) {
      assertMessage = error.message;
    }
    return {
      fn: inspect(
        returns(function foo() {}),
        { getters: true },
      ),
      class: inspect(returns(class K {}), { getters: true }),
      arrow: inspect(
        returns(() => 1),
        { getters: "get" },
      ),
      withProperty: inspect(returns(Object.assign(function foo() {}, { x: 1 })), { getters: true }),
      colors: inspect(
        returns(function foo() {}),
        { getters: true, colors: true },
      ),
      assertMessage,
    };
  },

  getterValueThrows() {
    const thrower = {
      [inspect.custom]() {
        throw new Error("boom");
      },
    };
    const text = inspect(Object.assign(returns(thrower), { b: 1 }), { getters: true, compact: false });
    // Inside the parentheses Node.js prints the thrown error with its stack, and Bun prints its message.
    return { entriesAfterIt: text.replace(/\(.*\)/s, "()") };
  },

  toStringTag: () => ({
    namespaced: inspect(new (tagged("Foo", "ns.Foo"))()),
    twoDots: inspect(new (tagged("Foo", "a.b.Foo"))()),
    otherLastPart: inspect(new (tagged("Foo", "Foo.b.Bar"))()),
    leadingDot: inspect(new (tagged("Foo", ".Foo"))()),
    trailingDot: inspect(new (tagged("Foo", "Foo."))()),
    sameAsName: inspect(new (tagged("Foo", "Foo"))()),
    otherTag: inspect(new (tagged("Bar", "baz"))()),
    tagIsPrefixOfName: inspect(new (tagged("FooBar", "Foo"))()),
    nameHasTheDot: inspect(new (tagged("ns.Foo", "ns.Foo"))()),
    map: inspect(new (tagged("MyMap", "ns.MyMap", Map))([[1, 2]])),
    set: inspect(new (tagged("MySet", "ns.MySet", Set))([1])),
    array: inspect(new (tagged("MyArray", "ns.MyArray", Array))(2)),
    typedArray: inspect(new (tagged("MyBytes", "ns.MyBytes", Uint8Array))(2)),
    error: withoutStackFrames(() => inspect(new (tagged("MyError", "ns.MyError", Error))("m"))),
    nullPrototype: inspect(Object.create(null, { [Symbol.toStringTag]: { value: "ns.Foo" } })),
    intl: inspect([new Intl.NumberFormat("en"), new Intl.Locale("en"), new Intl.Segmenter("en")]),
    webAssembly: inspect(new WebAssembly.Memory({ initial: 1 })),
  }),

  breakLengthInfinity() {
    const multi = { [inspect.custom]: () => "l1\nl2" };
    const error = Object.assign(new Error("x"), { stack: "Error: x\n    at y" });
    const options = { breakLength: Infinity, compact: true };
    return {
      object: inspect({ a: multi, b: 1 }, options),
      array: inspect([multi, 1], options),
      set: inspect(new Set([multi, 1]), options),
      map: inspect(new Map([[multi, 1]]), options),
      lastEntry: inspect({ a: 1, b: multi }, options),
      nested: inspect({ x: { a: multi, b: 1 }, y: 2 }, options),
      errorEntry: inspect({ e: error, b: 1 }, options),
      colors: inspect({ a: multi, b: 1 }, { ...options, colors: true }),
      format: util.formatWithOptions(options, "%o", [multi, 1]),
      // These have no line break in an entry. They stay on one line.
      oneLine: inspect({ a: 1, b: [1, 2], c: "x" }, options),
      escapedLineBreak: inspect({ a: "l1\nl2", b: 1 }, options),
      // Only Infinity itself has this effect.
      maxValue: inspect({ a: multi, b: 1 }, { breakLength: Number.MAX_VALUE, compact: true }),
      eighty: inspect({ a: multi, b: 1 }, { breakLength: 80, compact: true }),
      compactThree: inspect({ a: multi, b: 1 }, { breakLength: Infinity }),
    };
  },

  nodeModules: () => ({
    plain: frame("f (/a/node_modules/pkg/index.js:1:1)"),
    scoped: frame("f (/a/node_modules/@s/pkg/index.js:1:1)"),
    nested: frame("f (/a/node_modules/p1/node_modules/p2/i.js:1:1)"),
    twoPaths: frame("f (/a/node_modules/p/b.js) (/c/node_modules/q/d.js)"),
    backslash: frame("f (C:\\a\\node_modules\\pkg\\index.js:1:1)"),
    backslashScoped: frame("f (C:\\a\\node_modules\\@s\\pkg\\index.js:1:1)"),
    // The name ends at the next separator of the kind that is before node_modules.
    mixedSeparators: frame("f (C:\\a\\node_modules\\pkg/index.js:1:1)"),
    // With no separator after it the name runs to the end of the line.
    endOfLine: frame("f (/a/node_modules/pkg)"),
    scopedEndOfLine: frame("f (/a/node_modules/@s/pkg)"),
    scopeOnly: frame("f (/a/node_modules/@s)"),
    noName: frame("f (/a/node_modules/)"),
    // node_modules is a name only when a separator is on each side of it.
    longerBefore: frame("f (/a/my_node_modules/pkg/index.js:1:1)"),
    longerAfter: frame("f (/a/node_modules_x/pkg/index.js:1:1)"),
    longerThenReal: frame("f (/a/xnode_modules/p/node_modules/q/i.js:1:1)"),
    atLineStart: frame("node_modules/pkg/index.js:1:1"),
  }),

  dataView() {
    const detached = new ArrayBuffer(8);
    const detachedView = new DataView(detached);
    detached.transfer();
    const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
    const outOfBoundsView = new DataView(resizable, 4, 4);
    resizable.resize(2);
    return {
      detached: inspect([detachedView, { a: { b: 1 } }]),
      outOfBounds: inspect([outOfBoundsView, { a: 1 }]),
    };
  },
};

module.exports = groups;

if (require.main === module) {
  const results = {};
  for (const name of Object.keys(groups)) results[name] = groups[name]();
  process.stdout.write(JSON.stringify(results, null, 2));
}
