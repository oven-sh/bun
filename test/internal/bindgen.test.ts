import { bindgen as bindings } from "bun:internal-for-testing";
import { describe as describeAlways, expect, it as itAlways } from "bun:test";
import { rustIdent } from "../../src/codegen/bindgen-lib-internal.ts";
import * as b from "../../src/codegen/bindgen-lib.ts";

// bindgen_test.bind.ts is only in a build with assertions: a debug build, CI's ASAN lane.
const bindgen = bindings ?? ({} as NonNullable<typeof bindings>);
const describe = describeAlways.skipIf(!bindings);
const it = itAlways.skipIf(!bindings);

it("bindgen add example", () => {
  // Simple cases
  expect(bindgen.add(5, 3)).toBe(8);
  expect(bindgen.add(-2, 7)).toBe(5);
  expect(bindgen.add(0, 0)).toBe(0);
  // https://tc39.es/ecma262/multipage/bigint-object.html#sec-tonumber
  // 2. If argument is either a Symbol or a BigInt, throw a TypeError exception.
  expect(() => bindgen.add(1n, 0)).toThrow("Conversion from 'BigInt' to 'number' is not allowed");
  expect(() => bindgen.add(Symbol("1"), 0)).toThrow("Cannot convert a symbol to a number");
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 3. If argument is null or false, return +0.
  expect(bindgen.add(null, "32")).toBe(32);
  expect(bindgen.add(false, "32")).toBe(32);
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 3. If argument is undefined, return NaN.
  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  // 8. If x is NaN, +0, +∞, or −∞, then return +0.
  expect(bindgen.add(undefined, "32")).toBe(32);
  expect(bindgen.add(NaN, "32")).toBe(32);
  expect(bindgen.add(Infinity, "32")).toBe(32);
  expect(bindgen.add(-Infinity, "32")).toBe(32);
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 5. If argument is true, return 1.
  expect(bindgen.add(true, "32")).toBe(33);
  // https://tc39.es/ecma262/multipage/bigint-object.html#sec-tonumber
  // 6. If argument is a String, return StringToNumber(argument).
  expect(bindgen.add("1", "1")).toBe(2);
  // 8. Let primValue be ? ToPrimitive(argument, number).
  // 10. Return ? ToNumber(primValue).
  expect(bindgen.add({ [Symbol.toPrimitive]: () => "1" }, "1")).toBe(2);

  expect(bindgen.add(2147483647.9, 0)).toBe(2147483647);
  expect(bindgen.add(2147483647.1, 0)).toBe(2147483647);

  // Out of range wrapping behaviors. By adding `0`, this acts as an identity function.
  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  expect(bindgen.add(2147483648, 0)).toBe(-2147483648);
  expect(bindgen.add(5555555555, 0)).toBe(1260588259);
  expect(bindgen.add(-5555555555, 0)).toBe(-1260588259);
  expect(bindgen.add(55555555555, 0)).toBe(-279019293);
  expect(bindgen.add(-55555555555, 0)).toBe(279019293);
  expect(bindgen.add(555555555555, 0)).toBe(1504774371);
  expect(bindgen.add(-555555555555, 0)).toBe(-1504774371);
  expect(bindgen.add(5555555555555, 0)).toBe(-2132125469);
  expect(bindgen.add(-5555555555555, 0)).toBe(2132125469);

  expect(() => bindgen.add(2147483647, 1)).toThrow("Integer overflow while adding");
});

it("optional arguments / default arguments", () => {
  expect(bindgen.requiredAndOptionalArg(false)).toBe(123498);
  expect(bindgen.requiredAndOptionalArg(false, 10)).toBe(52);
  expect(bindgen.requiredAndOptionalArg(true, 10)).toBe(-52);
  expect(bindgen.requiredAndOptionalArg(1, 10, 5)).toBe(-15);
  expect(bindgen.requiredAndOptionalArg("coerce to true", 10, 5)).toBe(-15);
  expect(bindgen.requiredAndOptionalArg("", 10, 5)).toBe(15);
  expect(bindgen.requiredAndOptionalArg(true, 10, 5, 2)).toBe(-30);
  expect(bindgen.requiredAndOptionalArg(true, null, 5, 2)).toBe(123463);
});

it("length counts the arguments up to the last that is not optional, or is what the schema says", () => {
  expect(bindgen.utf8EchoLoose.length).toBe(1);
  expect(bindgen.utf8Optional.length).toBe(0);
  expect(bindgen.utf8Echo.length).toBe(3);
  // These take undefined, and are still arguments a caller writes.
  expect(bindgen.describeAnything.length).toBe(1);
  expect(bindgen.sumBeforeAndAfterCallback.length).toBe(2);
});

itAlways("mistakes in a schema are errors when it loads", () => {
  expect(() => b.i32.enforceRange(0, 5).loose).toThrow(".loose is another way");
  expect(() => b.i32.validateInteger().wrap).toThrow(".wrap is another way");
  for (const refuses of [() => b.i32.wrap, () => b.i32.enforceRange(0, 5), () => b.i32.validateInteger()]) {
    expect(() => refuses().allowBigInt).toThrow(
      ".allowBigInt is for the strict and the .loose conversion; the others are ToNumber, which refuses a BigInt",
    );
  }
  expect(() => b.i32.allowBigInt.wrap).toThrow(".wrap refuses a BigInt, which .allowBigInt asked for");
  expect(() => b.i32.allowBigInt.enforceRange(0, 5)).toThrow(".enforceRange() refuses a BigInt");
  expect(() => b.i32.loose.allowBigInt.validateInteger()).toThrow(".validateInteger() refuses a BigInt");
  expect(b.u16.allowBigInt.loose.idlType).toBe(b.u16.loose.allowBigInt.idlType);
  expect(() => b.string.utf8.owned.default("x")).toThrow("cannot have a default");
  expect(() => b.namespace({})).toThrow("a namespace with no functions");
  expect(() => b.namespace({ f: b.fn({ args: { x: b.i32 } }) as any })).toThrow(
    "f: write what b.fn takes, without b.fn",
  );
  expect(() => b.namespace({ "not-a-name": {} })).toThrow("not-a-name: a function is named by an identifier");
  expect(() => b.array(b.null)).toThrow("an array of nothing but null");
  expect(() => b.bufferSource.bytes.allowShared.optional).toThrow(
    ".allowShared is for an argument that is always there",
  );
  for (const bytes of [b.bufferSource.bytes.allowShared, b.bufferSource.bytes.allowShared.withValue]) {
    expect(() => b.fn({ args: { bytes }, capability: "js" })).toThrow(
      "bytes: JavaScript can detach a buffer; .allowShared is for a function that cannot run it",
    );
  }
  for (const bytes of [b.bufferSource.bytes, b.stringOrBuffer, b.stringOrBuffer.orBlob.loose]) {
    const onlyAnArgument =
      "the bytes of a buffer are only for an argument: they are read after everything else is converted";
    expect(() => b.array(bytes)).toThrow(onlyAnArgument);
    expect(() => b.dictionary({ bytes })).toThrow(onlyAnArgument);
    expect(() => b.union({ bytes })).toThrow(onlyAnArgument);
  }
  for (const absent of ["optional", "nullable", "falsyAsNull"] as const) {
    expect(() => b.stringOrBuffer[absent]).toThrow("b.stringOrBuffer is for an argument that is always there");
  }
  expect(() => b.stringOrBuffer.default("")).toThrow("cannot have a default");
  for (const data of [b.stringOrBuffer, b.stringOrBuffer.orBlob.loose.withValue]) {
    expect(() => b.fn({ args: { data }, capability: "js" })).toThrow(
      "data: JavaScript can detach a buffer; b.stringOrBuffer is for a function that cannot run it",
    );
  }
  expect(b.stringOrBuffer.orBlob.loose.idlType).toBe(b.stringOrBuffer.loose.orBlob.idlType);
  expect(b.stringOrBuffer.orBlob.loose.notNullish.idlType).toBe(b.stringOrBuffer.loose.notNullish.orBlob.idlType);
  expect(() => b.stringOrBuffer.notNullish).toThrow(".notNullish follows .loose: without it they are refused already");
  expect(() => b.u32.asBigInt).toThrow(".asBigInt follows b.u64");
  expect(() => b.u64.allowBigInt.asBigInt).toThrow(".asBigInt follows b.u64");
  for (const value of [
    b.u64.asBigInt,
    b.u64.asBigInt.optional,
    b.u64.asBigInt.withValue,
    b.array(b.u64.asBigInt),
    b.dictionary({ member: b.array(b.u64.asBigInt.nullable) }),
  ]) {
    expect(() => b.fn({ args: { value } })).toThrow("value: .asBigInt is a result; an argument is b.u64.allowBigInt");
  }
  expect(() => b.namespace({ f: {} }, { call: "g" })).toThrow("call: g is not one of its functions");
  for (const element of [b.any, b.bufferSource, b.dictionary({ value: b.any }), b.class({ rustPath: "T" })]) {
    expect(() => b.array(element)).toThrow("an array is a Vec, where the GC does not see JS values");
  }
  expect(() => b.dictionary({ fooBar: b.bool, foo_bar: b.bool })).toThrow("two fields are both foo_bar");
  expect(() => b.union({ "a-b": b.bool })).toThrow("an alternative is named in camelCase");
  expect(() => b.enumeration(["self"])).toThrow("Self cannot name anything in Rust");
  expect(["match", "final", "try", "name"].map(rustIdent)).toEqual(["r#match", "r#final", "r#try", "name"]);
  expect(() => b.dictionary({ default: b.bool })).toThrow("default is a C++ keyword: name the field with rustName");
  b.dictionary({ default: { type: b.bool, rustName: "default_value" } });
  expect(() => b.union({ int: b.i32, text: b.string })).toThrow("int is a C++ keyword");
  const elsewhere = Object.assign(b.dictionary({ flag: b.bool }), {
    name: "Elsewhere",
    origin: { stem: "a", namespace: "A", rustModule: "a", crate: "bun_jsc" },
  });
  expect(elsewhere.rustType({ crate: "bun_jsc", rustModule: "b" })).toBe("super::a::Elsewhere");
  expect(() => elsewhere.rustType({ crate: "bun_runtime", rustModule: "b" })).toThrow(
    "Elsewhere is declared in bun_jsc and used in bun_runtime",
  );
  expect(() => b.fn({ args: { fooBar: b.bool, foo_bar: b.bool } })).toThrow("two arguments are both foo_bar");
  expect(() => b.fn({ length: 1.5 })).toThrow("1.5 is not a count");
  expect(() => b.overloads({ args: { a: b.bool }, length: 1 }, { args: { a: b.f64 }, length: 2 })).toThrow(
    "length is given once",
  );
  const label = { getter: b.string, setter: true } as const;
  expect(() => b.class({ rustPath: "T", proto: { label, setLabel: {} } })).toThrow("are both set_label");
  b.class({ rustPath: "T", proto: { label: { getter: b.string }, setLabel: {}, getLabel: {} } });
  expect(() => b.class({ rustPath: "T", proto: { value: { getter: b.any } } })).toThrow('takes capability: "heap"');
  expect(() => b.class({ rustPath: "T", internalFields: ["a", "a"] })).toThrow("two internal fields are both a");
  // What takes undefined can come before what does not.
  b.fn({ args: { encoding: b.string.nullable, callback: b.any, length: b.f64 } });
});

it("custom enforceRange boundaries", () => {
  expect(bindgen.requiredAndOptionalArg(false, 0, 5)).toBe(5);
  expect(() => bindgen.requiredAndOptionalArg(false, 0, -1)).toThrow("Value -1 is outside the range [0, 100]");
  expect(() => bindgen.requiredAndOptionalArg(false, 0, 101)).toThrow("Value 101 is outside the range [0, 100]");
  expect(bindgen.requiredAndOptionalArg(false, 0, 100)).toBe(100);
  expect(bindgen.requiredAndOptionalArg(false, 0, 0)).toBe(0);
});

// Not through the test schema, so on every build.
itAlways("unsigned integer dictionary fields reject negative values", () => {
  const listen = (tls: Record<string, number>) =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { data() {} } });

  for (const field of ["secureOptions", "clientRenegotiationLimit", "clientRenegotiationWindow"] as const) {
    let caught: any = undefined;
    try {
      using listener = listen({ [field]: -1 });
      void listener;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect(caught.code).toBe("ERR_OUT_OF_RANGE");
    expect(caught.message).toBe(`TLSOptions.${field} must be in the range [0, 4294967295] (received -1)`);
  }
});

describe("integers", () => {
  const outOfRange = (message: string) =>
    expect.objectContaining({ name: "RangeError", code: "ERR_OUT_OF_RANGE", message });
  const notANumber = (name: string) =>
    expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: `${name} must be a number` });
  const bigIntToNumber = expect.objectContaining({
    name: "TypeError",
    message: "Conversion from 'BigInt' to 'number' is not allowed.",
  });

  it("strict takes a number that is an integer in range", () => {
    for (const value of [5, 5.0]) expect(bindgen.makeToken(value).id).toBe(5);
    expect(bindgen.makeToken(-0).id).toBe(0);
    for (const value of [NaN, Infinity, -Infinity, 1.5, 2 ** 53]) {
      expect(() => bindgen.makeToken(value)).toThrow(outOfRange(`id must be an integer (received ${value})`));
    }
    for (const value of [-1, 2 ** 32]) {
      expect(() => bindgen.makeToken(value)).toThrow(
        outOfRange(`id must be in the range [0, 4294967295] (received ${value})`),
      );
    }
    for (const value of ["5", true, null, undefined, {}, 5n, 0n, -1n, 2n ** 70n, Object(5n)]) {
      expect(() => bindgen.makeToken(value)).toThrow(notANumber("id"));
    }
    expect(() => bindgen.sumArray([1, 2n])).toThrow(notANumber("element of numbers"));
  });

  it(".allowBigInt takes a BigInt in the same range too", () => {
    for (const value of [5, 5n, 5.0]) expect(bindgen.integerOrBigInt(value)).toBe(5);
    for (const value of [0n, -0]) expect(bindgen.integerOrBigInt(value)).toBe(0);
    for (const value of [2 ** 32 - 1, 2n ** 32n - 1n]) expect(bindgen.integerOrBigInt(value)).toBe(4294967295);
    for (const value of [-1, 2 ** 32, 2n ** 32n, 2n ** 40n]) {
      expect(() => bindgen.integerOrBigInt(value)).toThrow(
        outOfRange(`value must be in the range [0, 4294967295] (received ${value})`),
      );
    }
    for (const value of [-1n, 2n ** 70n]) {
      expect(() => bindgen.integerOrBigInt(value)).toThrow(outOfRange("value must be in the range [0, 4294967295]"));
    }
    for (const value of [1.5, NaN, 2 ** 53]) {
      expect(() => bindgen.integerOrBigInt(value)).toThrow(outOfRange(`value must be an integer (received ${value})`));
    }
    for (const value of ["5", true, null, undefined, {}, Object(5n)]) {
      expect(() => bindgen.integerOrBigInt(value)).toThrow(notANumber("value"));
    }
  });

  it(".allowBigInt is how a u64 above 2 ** 53 gets in", () => {
    for (const value of [0, 0n, 2 ** 53 - 1, 2n ** 53n, 2n ** 64n - 1n]) {
      expect(bindgen.wideIntegerOrBigInt(value)).toBe(String(value));
    }
    expect(() => bindgen.wideIntegerOrBigInt(2 ** 53)).toThrow(
      outOfRange("value must be an integer (received 9007199254740992)"),
    );
    for (const value of [-1n, 2n ** 64n]) {
      expect(() => bindgen.wideIntegerOrBigInt(value)).toThrow(
        outOfRange("value must be in the range [0, 18446744073709551615]"),
      );
    }
  });

  it(".loose is ToNumber, which refuses a BigInt", () => {
    for (const value of [80, "80", " 0x50 ", [80], { valueOf: () => 80 }, new Number(80)]) {
      expect(bindgen.looseInteger(value)).toBe(80);
    }
    for (const value of [null, false, "", []]) expect(bindgen.looseInteger(value)).toBe(0);
    for (const value of [80n, Object(80n), { valueOf: () => 80n }]) {
      expect(() => bindgen.looseInteger(value)).toThrow(bigIntToNumber);
    }
    expect(() => bindgen.looseInteger(undefined)).toThrow(outOfRange("value must be an integer (received NaN)"));
    expect(() => bindgen.looseInteger("65536")).toThrow(
      outOfRange("value must be in the range [0, 65535] (received 65536)"),
    );
  });

  it("a .loose.allowBigInt double is ToNumeric, and a BigInt is the double nearest to it", () => {
    for (const value of [1.5, "1.5", [1.5], { valueOf: () => 1.5 }])
      expect(bindgen.looseDoubleOrBigInt(value)).toBe(1.5);
    for (const value of [undefined, {}, "x", NaN]) expect(bindgen.looseDoubleOrBigInt(value)).toBeNaN();
    for (const value of [
      0n,
      5n,
      -5n,
      2n ** 31n,
      2n ** 53n,
      2n ** 53n + 1n,
      2n ** 64n + 5n,
      -(2n ** 70n),
      10n ** 400n,
    ]) {
      expect(bindgen.looseDoubleOrBigInt(value)).toBe(Number(value));
      expect(bindgen.looseDoubleOrBigInt(Object(value))).toBe(Number(value));
      expect(bindgen.looseDoubleOrBigInt({ valueOf: () => value })).toBe(Number(value));
    }
    expect(() => bindgen.looseDoubleOrBigInt(Symbol())).toThrow(
      expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a number" }),
    );
  });

  it(".loose.allowBigInt is ToNumeric", () => {
    for (const value of [80, "80", [80], { valueOf: () => 80 }, 80n, Object(80n), { valueOf: () => 80n }]) {
      expect(bindgen.looseIntegerOrBigInt(value)).toBe(80);
    }
    for (const value of [65536n, { valueOf: () => 65536n }, "65536"]) {
      expect(() => bindgen.looseIntegerOrBigInt(value)).toThrow(
        outOfRange("value must be in the range [0, 65535] (received 65536)"),
      );
    }
    expect(() => bindgen.looseIntegerOrBigInt(Symbol())).toThrow(
      expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a number" }),
    );
  });
});

describe("strings", () => {
  const rope = (a: string, b: string) => a + b + a; // long enough that JSC keeps it a rope
  const texts = [
    "",
    "ascii",
    "latin1 éÿ",
    "utf16 你好 \u{1f600}",
    rope(Buffer.alloc(40, "a").toString(), Buffer.alloc(40, "b").toString()),
    rope(Buffer.alloc(80, "é").toString(), Buffer.alloc(120, "你").toString()),
    Buffer.alloc(1000, "x").toString(),
    Buffer.alloc(2000, "é").toString(),
    "nul \0 inside",
  ];

  it.each(texts)("round trips %j", text => {
    expect(bindgen.utf8Echo(text)).toBe(text);
    expect(bindgen.utf8EchoLoose(text)).toBe(text);
    expect(bindgen.utf8Optional(text)).toBe(text);
    expect(bindgen.utf8Owned(text)).toBe(text);
    expect(bindgen.stringEcho(text)).toBe(text);
  });

  it("replaces an unpaired surrogate", () => {
    expect(bindgen.utf8Echo("a\ud800b")).toBe("a�b");
    expect(bindgen.utf8Echo("\udc00")).toBe("�");
  });

  it("strict takes strings and String objects only", () => {
    expect(bindgen.utf8Echo(new String("boxed"))).toBe("boxed");
    class Path extends String {}
    expect(bindgen.utf8Echo(new Path("derived"))).toBe("derived");
    expect(bindgen.utf8Owned(new String("boxed"))).toBe("boxed");
    expect(bindgen.utf8Owned(new Path("derived"))).toBe("derived");
    for (const value of [1, true, null, undefined, {}, [], Symbol("s"), { toString: () => "no" }]) {
      for (const echo of [bindgen.utf8Echo, bindgen.utf8Owned]) {
        expect(() => echo(value)).toThrow(
          expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: "text must be a string" }),
        );
      }
    }
  });

  it("loose is ToString", () => {
    expect(bindgen.utf8EchoLoose(12)).toBe("12");
    expect(bindgen.utf8EchoLoose(null)).toBe("null");
    expect(bindgen.utf8EchoLoose({ toString: () => "custom" })).toBe("custom");
    expect(() => bindgen.utf8EchoLoose(Symbol("s"))).toThrow(new TypeError("Cannot convert a symbol to a string"));
    expect(() =>
      bindgen.utf8EchoLoose({
        toString() {
          throw new RangeError("from toString");
        },
      }),
    ).toThrow(new RangeError("from toString"));
  });

  it("tells an absent string from an empty one", () => {
    expect(bindgen.utf8Optional(null)).toBe(null);
    expect(bindgen.utf8Optional(undefined)).toBe(null);
    expect(bindgen.utf8Optional()).toBe(null);
    expect(bindgen.utf8Optional("")).toBe("");
  });

  it("an argument that was not passed is undefined", () => {
    for (const args of [[], [undefined]]) {
      expect(() => bindgen.utf8Echo(...args)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: "text must be a string" }),
      );
      expect(bindgen.utf8EchoLoose(...args)).toBe("undefined");
    }
  });
});

describe("enumerations", () => {
  it("parses and returns the canonical spelling", () => {
    expect(bindgen.nextColor("red")).toBe("green");
    expect(bindgen.nextColor("green")).toBe("blue");
    expect(bindgen.nextColor("lime")).toBe("blue");
    expect(bindgen.nextColor("blue")).toBe("red");
  });

  it("rejects anything else", () => {
    const invalid = (message: string) =>
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
    for (const value of ["Red", "", "purple"]) {
      expect(() => bindgen.nextColor(value)).toThrow(invalid('color must be "red", "green", or "blue"'));
    }
    for (const value of [0, null, undefined, {}]) {
      expect(() => bindgen.nextColor(value)).toThrow(invalid("color must be a string"));
    }
  });
});

describe("dictionaries", () => {
  const defaults = { count: 1, flag: false, color: "red", ratio: null, payload: undefined };

  it("fills in defaults and leaves out what is absent", () => {
    expect(bindgen.optionsEcho({})).toStrictEqual(defaults);
    expect(Object.keys(bindgen.optionsEcho({}))).toEqual(["count", "flag", "color", "ratio", "payload"]);
  });

  it("reads every member", () => {
    const payload = { any: "value" };
    const seen = bindgen.optionsEcho({
      count: 7,
      flag: "truthy",
      name: "né",
      color: "lime",
      ratio: 0.5,
      payload,
      renamed: 9,
    });
    expect(seen).toStrictEqual({
      count: 7,
      flag: true,
      name: "né",
      color: "green",
      ratio: 0.5,
      payload,
      renamed: 9,
    });
    expect(seen.payload).toBe(payload);
    expect(Object.keys(seen)).toEqual(["count", "flag", "name", "color", "ratio", "payload", "renamed"]);
  });

  it("a default written in the schema reaches every member, the nested ones included", () => {
    const defaults = "inner: a=true b=7 name=inner; value: undefined; choice: none; rest: undefined; counter: false";
    expect(bindgen.describeDefaults()).toBe(defaults);
    expect(bindgen.describeDefaults(undefined)).toBe(defaults);
    expect(bindgen.describeDefaults({ inner: {} })).toBe(defaults);
    expect(bindgen.describeDefaults({})).toBe(
      "inner: none; value: undefined; choice: none; rest: undefined; counter: false",
    );
    expect(
      bindgen.describeDefaults({
        inner: { a: false, name: "n" },
        value: null,
        choice: true,
        rest: "lime",
        counter: new (bindgen as any).TestCounter(),
      }),
    ).toBe("inner: a=false b=7 name=n; value: given; choice: true; rest: Green; counter: true");
  });

  it("a member that is absent is absent, whatever was on the stack before", () => {
    const counter = new (bindgen as any).TestCounter();
    for (let i = 0; i < 100; i++) {
      expect(bindgen.describeDefaults({ counter })).toEndWith("counter: true");
      expect(bindgen.describeDefaults({})).toEndWith("counter: false");
      expect(bindgen.describeDefaults({ counter: null })).toEndWith("counter: false");
    }
  });

  it("returns one that holds only strings", () => {
    expect(bindgen.names("ana bé c")).toStrictEqual({ first: "ana", nickname: "bé", all: ["ana", "bé", "c"] });
    expect(bindgen.names("")).toStrictEqual({ first: "", nickname: null, all: [] });
  });

  it("returns ordinary objects", () => {
    const seen = bindgen.optionsEcho({ name: "a", renamed: 1 });
    expect(Object.getPrototypeOf(seen)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(seen, "count")).toEqual({
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    seen.count = 2;
    seen.extra = 3;
    delete seen.flag;
    expect(bindgen.optionsEcho({ name: "a", renamed: 1 })).toStrictEqual({ ...defaults, name: "a", renamed: 1 });
  });

  it("falls back to the other spelling of a member", () => {
    expect(bindgen.optionsEcho({ oldName: 4 }).renamed).toBe(4);
    expect(bindgen.optionsEcho({ renamed: 5, oldName: 4 }).renamed).toBe(5);
    expect(bindgen.optionsEcho({ renamed: undefined, oldName: 4 }).renamed).toBe(4);
  });

  it("names the member in an error", () => {
    expect(() => bindgen.optionsEcho({ count: "1" })).toThrow("TestOptions.count must be");
    expect(() => bindgen.optionsEcho({ name: 1 })).toThrow("TestOptions.name must be a string");
    expect(() => bindgen.optionsEcho({ color: "mauve" })).toThrow("TestOptions.color must be");
    for (const value of [1, "s", null, undefined, true, [], Symbol("s")]) {
      expect(() => bindgen.optionsEcho(value)).toThrow("TestOptions must be an object");
    }
  });

  // The direct read of a plain object and the generic lookup must be indistinguishable.
  describe("every kind of object gives the same answer", () => {
    const members = { count: 3, flag: true, name: "x", color: "blue", ratio: 2, payload: "p", renamed: 8 };
    const expected = { ...members };
    const shapes: Record<string, () => object> = {
      "literal": () => ({ ...members }),
      "other order": () => Object.fromEntries(Object.entries(members).reverse()),
      "null prototype": () => Object.assign(Object.create(null), members),
      "extra members": () => ({ a: 1, ...members, z: 2, [Symbol("s")]: 3, 0: 4 }),
      "frozen": () => Object.freeze({ ...members }),
      "sealed": () => Object.seal({ ...members }),
      "non-enumerable": () =>
        Object.defineProperties(
          {},
          Object.fromEntries(Object.entries(members).map(([key, value]) => [key, { value, enumerable: false }])),
        ),
      "dictionary mode": () => {
        const object: Record<string, unknown> = {};
        for (let i = 0; i < 200; i++) object["k" + i] = i;
        Object.assign(object, members);
        for (let i = 0; i < 200; i++) delete object["k" + i];
        return object;
      },
      "getters": () =>
        Object.defineProperties(
          {},
          Object.fromEntries(Object.entries(members).map(([key, value]) => [key, { get: () => value }])),
        ),
      "one getter": () => Object.defineProperty({ ...members }, "ratio", { get: () => 2 }),
      "class instance": () => Object.assign(new (class Options {})(), members),
      "class getters": () =>
        new (class Options {
          get count() {
            return 3;
          }
          get flag() {
            return true;
          }
          get name() {
            return "x";
          }
          get color() {
            return "blue";
          }
          get ratio() {
            return 2;
          }
          get payload() {
            return "p";
          }
          get renamed() {
            return 8;
          }
        })(),
      "inherited": () => Object.create({ ...members }),
      "half inherited": () =>
        Object.assign(Object.create({ count: 3, flag: true, name: "x" }), {
          color: "blue",
          ratio: 2,
          payload: "p",
          renamed: 8,
        }),
      "proxy": () => new Proxy({ ...members }, {}),
      "proxy with a get trap": () => new Proxy({}, { get: (_, key) => (members as any)[key] }),
      "function": () => {
        const { name, ...rest } = members;
        return Object.assign({ x() {} }.x, rest);
      },
      "map with members": () => Object.assign(new Map(), members),
      "error with members": () => Object.assign(new Error("e"), members),
    };
    for (const [title, make] of Object.entries(shapes)) {
      it(title, () => {
        expect(bindgen.optionsEcho(make())).toStrictEqual(expected);
      });
    }
  });

  it("does not see Object.prototype", () => {
    const prototype = Object.prototype as any;
    try {
      prototype.count = 99;
      prototype.name = "polluted";
      Object.defineProperty(prototype, "ratio", { get: () => 99, configurable: true });
      expect(bindgen.optionsEcho({})).toStrictEqual(defaults);
      expect(bindgen.optionsEcho(new (class Options {})())).toStrictEqual(defaults);
      expect(bindgen.optionsEcho(Object.create({}))).toStrictEqual(defaults);
      // A proxy answers for itself: its target's lookup is not ours to cut short.
      expect(bindgen.optionsEcho(new Proxy({}, {}))).toMatchObject({ count: 99, name: "polluted", ratio: 99 });
    } finally {
      delete prototype.count;
      delete prototype.name;
      delete prototype.ratio;
    }
  });

  it("sees a change made after an earlier read", () => {
    const options: Record<string, unknown> = { count: 1, name: "a" };
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 1, name: "a" });
    options.count = 2;
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 2, name: "a" });
    delete options.name;
    expect(bindgen.optionsEcho(options)).toStrictEqual({ ...defaults, count: 2 });
    options.name = "b";
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 2, name: "b" });
    Object.defineProperty(options, "count", { get: () => 3 });
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 3, name: "b" });
    Object.setPrototypeOf(options, { renamed: 6 });
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 3, name: "b", renamed: 6 });
  });

  it("reads and converts members in declaration order, each once", () => {
    const log: string[] = [];
    const logged = (key: string, value: unknown) => ({
      get() {
        log.push(key);
        return value;
      },
      enumerable: true,
    });
    const flag = {
      valueOf() {
        log.push("never: ToBoolean calls nothing");
      },
    };
    bindgen.optionsEcho(
      Object.defineProperties(
        {},
        {
          renamed: logged("renamed", undefined),
          oldName: logged("oldName", 1),
          payload: logged("payload", 1),
          ratio: logged("ratio", 1),
          color: logged("color", "red"),
          name: logged("name", "n"),
          flag: logged("flag", flag),
          count: logged("count", 1),
        },
      ),
    );
    expect(log).toEqual(["count", "flag", "name", "color", "ratio", "payload", "renamed", "oldName"]);
  });

  it("stops at the first member that throws", () => {
    const log: string[] = [];
    expect(() =>
      bindgen.optionsEcho({
        get count() {
          log.push("count");
          return 1;
        },
        get flag() {
          log.push("flag");
          throw new RangeError("from a getter");
        },
        get name() {
          log.push("name");
          return "n";
        },
      }),
    ).toThrow(new RangeError("from a getter"));
    expect(log).toEqual(["count", "flag"]);
  });

  it("a getter that changes the object is seen by the members after it", () => {
    const options = {
      get count() {
        (this as any).name = "added";
        delete (this as any).ratio;
        return 1;
      },
      ratio: 5,
    };
    expect(bindgen.optionsEcho(options)).toStrictEqual({ ...defaults, name: "added" });
  });

  it("a conversion that changes the object is seen by the members after it", () => {
    const make = () => {
      const options: any = { payload: 0, color: "red", renamed: 1 };
      options.name = Object.assign(new String("x"), {
        toString() {
          options.color = "blue";
          options.renamed = 9;
          delete options.payload;
          options.payload = "late";
          return "n";
        },
      });
      return options;
    };
    const expected = { ...defaults, name: "n", color: "blue", payload: "late", renamed: 9 };
    expect(bindgen.optionsEcho(make())).toStrictEqual(expected);
    expect(bindgen.optionsEcho(Object.setPrototypeOf(make(), {}))).toStrictEqual(expected);
    expect(bindgen.optionsEcho(Object.defineProperty(make(), "count", { get: () => 1 }))).toStrictEqual(expected);
  });
});

describe("unions", () => {
  it("picks the alternative that takes the kind of the value", () => {
    expect(bindgen.describeValue(1.5)).toBe("number 1.5");
    expect(bindgen.describeValue(true)).toBe("flag true");
    expect(bindgen.describeValue("téxt")).toBe("text téxt");
    expect(bindgen.describeValue([1, 2, 3])).toBe("list [1, 2, 3]");
    expect(bindgen.describeValue([])).toBe("list []");
  });

  it("rejects what fits none", () => {
    for (const value of [null, undefined, {}, Symbol("s"), 1n]) {
      expect(() => bindgen.describeValue(value)).toThrow(
        "value must be of type number, boolean, string, or array of integer",
      );
    }
    expect(() => bindgen.describeValue(["not a number"])).toThrow("element of value must be a number");
  });

  it("sends each kind of value to the alternative that takes it", () => {
    const { TestCounter } = bindgen as any;
    class SubCounter extends TestCounter {}
    class SubArray extends Array {}
    const cases: [unknown, string][] = [
      [undefined, "nothing"],
      [null, "nothing"],
      [false, "flag false"],
      [5, "integer 5"],
      [-0, "integer 0"],
      [7n, "integer 7"],
      ["", "text "],
      ["téxt", "text téxt"],
      [new ArrayBuffer(3), "bytes 3"],
      [new Uint8Array(4), "bytes 4"],
      [new Float64Array(2), "bytes 16"],
      [new DataView(new ArrayBuffer(5)), "bytes 5"],
      [new DataView(new ArrayBuffer(5), 1, 2), "bytes 2"],
      [new Uint8Array(7).subarray(2), "bytes 5"],
      [new Uint16Array(new ArrayBuffer(8), 2, 1), "bytes 2"],
      [Buffer.alloc(6).buffer.slice(0, 6), "bytes 6"],
      [new Blob(["x"]), "blob"],
      [Bun.file("/nonexistent"), "blob"],
      [new TestCounter(3), "counter 3"],
      [new SubCounter(4), "counter 4"],
      [bindgen.makeToken(9), "token 9"],
      [[], "list []"],
      [[1, 2.5], "list [1.0, 2.5]"],
      [SubArray.of(1), "list [1.0]"],
      [{ count: 8 }, "options 8"],
    ];
    for (const [value, expected] of cases) expect(bindgen.describeAnything(value)).toBe(expected);
  });

  it("the last alternative gets what no other takes, and what another refuses", () => {
    const shared = new SharedArrayBuffer(2);
    for (const value of [
      shared,
      new Uint8Array(shared),
      new String("boxed"),
      new Number(1),
      function () {},
      new Date(0),
      new Map(),
      new Bun.Glob("x"),
      new URL("http://localhost/"),
      new Proxy({}, {}),
    ]) {
      expect(bindgen.describeAnything(value)).toBe("options 1");
    }
    for (const value of [Symbol("s"), new Proxy([], {})]) {
      expect(() => bindgen.describeAnything(value)).toThrow("TestOptions must be an object");
    }
  });

  it("the alternative that was chosen reports what is wrong with the value", () => {
    expect(() => bindgen.describeAnything(1.5)).toThrow("value must be an integer (received 1.5)");
    expect(() => bindgen.describeAnything(2n ** 40n)).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
        message: "value must be in the range [-2147483648, 2147483647] (received 1099511627776)",
      }),
    );
    expect(() => bindgen.describeAnything([1, "x"])).toThrow("element of value must be a number");
    expect(() => bindgen.describeAnything({ count: "x" })).toThrow("TestOptions.count must be a number");
  });

  it("choosing runs no JavaScript", () => {
    const calls: string[] = [];
    const trap =
      (name: string) =>
      (...args: unknown[]) => (calls.push(name), (Reflect as any)[name](...args));
    const handler = Object.fromEntries(Reflect.ownKeys(Reflect).map(name => [name, trap(name as string)]));
    expect(() => bindgen.describeValue(new Proxy({}, handler))).toThrow(
      "value must be of type number, boolean, string, or array of integer",
    );
    expect(() =>
      bindgen.describeValue({ toString: () => calls.push("toString"), valueOf: () => calls.push("valueOf") }),
    ).toThrow("value must be of type number, boolean, string, or array of integer");
    expect(calls).toEqual([]);
  });

  it("Array.prototype, which b.array refuses, is not of the array kind", () => {
    expect(() => bindgen.describeValue(Array.prototype)).toThrow(
      "value must be of type number, boolean, string, or array of integer",
    );
  });

  it("an enumeration takes strings, and b.any what nothing before it took", () => {
    const rest = (value: unknown) => bindgen.describeDefaults({ rest: value }).match(/rest: (.*);/)![1];
    expect(rest("blue")).toBe("Blue");
    expect(() => rest("purple")).toThrow('TestOuter.rest must be "red", "green", or "blue"');
    expect(rest(new Uint8Array([1, 2]))).toBe("[1, 2]");
    for (const value of [new SharedArrayBuffer(2), null, 5, {}, new String("blue")]) expect(rest(value)).toBe("given");
  });

  itAlways("an alternative that cannot be chosen is an error in the schema", () => {
    expect(() => b.union({ anything: b.any, text: b.string })).toThrow("text is never chosen");
    expect(() => b.union({ text: b.string.loose, flag: b.bool })).toThrow("flag is never chosen");
    expect(() => b.union({ text: b.string.utf8, other: b.string })).toThrow("other is never chosen");
    expect(() => b.union({ integer: b.i32, number: b.f64 })).toThrow("number is never chosen");
    expect(() => b.union({ none: b.null, inner: b.union({ text: b.string }) })).toThrow("list the alternatives");
    expect(() => b.union({ text: b.string.nullable, flag: b.bool })).toThrow("add b.null as an alternative");
    expect(() => b.union({ tag: b.bool, text: b.string })).toThrow("has a member of that name");
    const mode = b.enumeration(["on", "off"]);
    expect(() => b.union({ text: b.string, mode })).toThrow("mode is never chosen");
    b.union({ mode, options: b.dictionary({ flag: b.bool }) });
    // What one refuses, the next can take, unless it refuses the same.
    b.union({ bytes: b.bufferSource, rest: b.any });
    expect(() => b.union({ bytes: b.bufferSource, reference: b.bufferSource.arrayBuffer })).toThrow(
      "reference is never chosen",
    );
    expect(() => b.union({ one: b.blob, other: b.blob })).toThrow("other is never chosen");
    expect(() => b.union({ none: b.null, flag: b.bool }).nullable).toThrow("already takes undefined");
    b.union({ text: b.string, boxed: b.string.utf8 });
  });
});

describe("overloads", () => {
  it("are told apart by the kinds of their arguments", () => {
    const { TestCounter } = bindgen as any;
    const cases: [unknown[], string][] = [
      [["ab"], "text times ab"],
      [["ab", 2], "text times abab"],
      [["ab", undefined], "text times ab"],
      [["ab", true], "text upper AB"],
      [[new String("ab"), false], "text upper ab"],
      [[1], "number 1"],
      [[1, undefined], "number 1"],
      [[1, 2], "two numbers 1 2"],
      [[1, 2, 3], "two numbers 1 2"],
      [[[1]], "list [1.0]"],
      [[new TestCounter(6)], "counter 6"],
    ];
    for (const [args, expected] of cases) expect(bindgen.overloaded(...args)).toBe(expected);
    expect(bindgen.overloaded.length).toBe(1);
  });

  it("a signature ignores the arguments it does not have", () => {
    expect(bindgen.overloaded(1, "x")).toBe("number 1");
    expect(bindgen.overloaded([1], 5)).toBe("list [1.0]");
  });

  it("what fits none is reported by the first signature still in the running", () => {
    expect(() => bindgen.overloaded()).toThrow("text must be a string");
    expect(() => bindgen.overloaded({})).toThrow("text must be a string");
    expect(() => bindgen.overloaded(null, 1)).toThrow("text must be a string");
    expect(() => bindgen.overloaded("ab", "x")).toThrow("times must be a number");
    expect(() => bindgen.overloaded("ab", 2n)).toThrow("times must be a number");
  });

  itAlways("a signature that cannot be chosen is an error in the schema", () => {
    expect(() => b.overloads({ args: { a: b.string } }, { args: { b: b.string } })).toThrow(
      "overload 2 is never chosen",
    );
    expect(() => b.overloads({ args: { a: b.string.loose } }, { args: { b: b.bool } })).toThrow(
      "overload 2 is never chosen",
    );
    expect(() => b.overloads({ args: { a: b.i32, b: b.bool } }, { args: { a: b.f64, b: b.bool } })).toThrow(
      "overload 2 is never chosen",
    );
    // The shorter one ignores a second argument, so written first it takes every call.
    expect(() => b.overloads({ args: { a: b.string } }, { args: { a: b.string, b: b.bool } })).toThrow(
      "overload 2 is never chosen",
    );
    b.overloads({ args: { a: b.string, b: b.bool } }, { args: { a: b.string } });
    b.overloads({ args: { a: b.string, b: b.f64 } }, { args: { a: b.string, b: b.bool } });
    b.overloads({ args: { a: b.bool } }, { args: { a: b.any } });
  });
});

describe("arrays", () => {
  it("in", () => {
    expect(bindgen.sumArray([])).toBe(0);
    expect(bindgen.sumArray([1, 2, 3])).toBe(6);
    expect(bindgen.sumArray(Array.from({ length: 1000 }, (_, i) => i))).toBe(499500);
    expect(() => bindgen.sumArray(new Set([4, 5]))).toThrow("numbers must be an array of integer");
    expect(() => bindgen.sumArray([1, "2"])).toThrow("element of numbers must be a number");
    expect(() => bindgen.sumArray(5)).toThrow("numbers must be an array of integer");
  });

  it("out", () => {
    expect(bindgen.range(0)).toEqual([]);
    expect(bindgen.range(4)).toEqual([0, 1, 2, 3]);
    expect(bindgen.range(5000)).toEqual(Array.from({ length: 5000 }, (_, i) => i));
    for (const length of [7, 8, 9]) {
      expect(bindgen.range(length)).toEqual(Array.from({ length }, (_, i) => i));
      const words = Array.from({ length }, (_, i) => "word" + i);
      expect(bindgen.words(words.join(" "))).toEqual(words);
    }
    expect(bindgen.words("one twö 三")).toEqual(["one", "twö", "三"]);
    expect(Array.isArray(bindgen.range(1))).toBe(true);
  });
});

describe("buffers", () => {
  it("views every kind of buffer", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bindgen.sumBytes(bytes)).toBe(36);
    expect(bindgen.sumBytes(bytes.buffer)).toBe(36);
    expect(bindgen.sumBytes(bytes.subarray(2, 4))).toBe(7);
    expect(bindgen.sumBytes(new DataView(bytes.buffer, 6))).toBe(15);
    expect(bindgen.sumBytes(new Uint16Array(bytes.buffer, 0, 1))).toBe(3);
    expect(bindgen.sumBytes(Buffer.from([9, 9]))).toBe(18);
    expect(bindgen.sumBytes(new Uint8Array(0))).toBe(0);
    expect(bindgen.sumBytes(new ArrayBuffer(0))).toBe(0);
  });

  it("a detached or shrunk view is empty", () => {
    const detached = new Uint8Array([1, 2, 3]);
    detached.buffer.transfer();
    expect(bindgen.sumBytes(detached)).toBe(0);

    const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
    const tracking = new Uint8Array(resizable);
    const fixed = new Uint8Array(resizable, 2, 2);
    tracking.fill(1);
    expect(bindgen.sumBytes(tracking)).toBe(4);
    resizable.resize(3);
    expect(bindgen.sumBytes(tracking)).toBe(3);
    expect(bindgen.sumBytes(fixed)).toBe(0);
  });

  it("rejects shared memory and everything else", () => {
    for (const value of [new SharedArrayBuffer(4), new Uint8Array(new SharedArrayBuffer(4)), [1], "s", null, {}]) {
      expect(() => bindgen.sumBytes(value)).toThrow(
        "bytes must be an ArrayBuffer or ArrayBufferView that is not shared",
      );
      expect(() => bindgen.sumBeforeAndAfterCallback(value, () => {})).toThrow(
        "buffer must be an ArrayBuffer or ArrayBufferView that is not shared",
      );
    }
  });

  it("tells an absent buffer from an empty one", () => {
    expect(bindgen.sumBytesOptional(null)).toBe(null);
    expect(bindgen.sumBytesOptional(undefined)).toBe(null);
    expect(bindgen.sumBytesOptional()).toBe(null);
    expect(bindgen.sumBytesOptional(new Uint8Array(0))).toBe(0);
    expect(bindgen.sumBytesOptional(new Uint8Array([1, 2]))).toBe(3);
    const detached = new Uint8Array([1, 2]);
    detached.buffer.transfer();
    expect(bindgen.sumBytesOptional(detached)).toBe(0);
  });

  it("reads the bytes after every other argument is converted", () => {
    const transferred = new Uint8Array([1, 2, 3]);
    const transfers = { toString: () => (transferred.buffer.transfer(), "\x01") };
    expect(bindgen.sumBytesThenText(transferred, transfers)).toBe(1);

    const resizable = new ArrayBuffer(1 << 20, { maxByteLength: 1 << 20 });
    const view = new Uint8Array(resizable).fill(1);
    const shrinks = { toString: () => (resizable.resize(2), "") };
    expect(bindgen.sumBytesThenText(view, shrinks)).toBe(2);

    expect(() => bindgen.sumBytesThenText("no", { toString: () => expect.unreachable() })).toThrow(
      "bytes must be an ArrayBuffer or ArrayBufferView that is not shared",
    );
  });

  it("looks the bytes up again after JavaScript ran", () => {
    const same = new Uint8Array([1, 2, 3]);
    expect(bindgen.sumBeforeAndAfterCallback(same, () => {})).toEqual([6, 6]);
    expect(bindgen.sumBeforeAndAfterCallback(same, () => void same.fill(2))).toEqual([6, 6]);

    const transferred = new Uint8Array([1, 2, 3]);
    expect(bindgen.sumBeforeAndAfterCallback(transferred, () => void transferred.buffer.transfer())).toEqual([6, 0]);

    const resizable = new ArrayBuffer(4, { maxByteLength: 1 << 20 });
    const view = new Uint8Array(resizable).fill(1);
    expect(bindgen.sumBeforeAndAfterCallback(view, () => resizable.resize(1 << 20))).toEqual([4, 4]);
    expect(bindgen.sumBeforeAndAfterCallback(view, () => resizable.resize(1))).toEqual([4, 1]);

    expect(() =>
      bindgen.sumBeforeAndAfterCallback(same, () => {
        throw new RangeError("from the callback");
      }),
    ).toThrow(new RangeError("from the callback"));
  });
});

describe("a string or a buffer, as bytes", () => {
  const utf8 = (text: string) => [...new TextEncoder().encode(text)];
  const buffers = (bytes: number[], ArrayBufferClass: typeof ArrayBuffer | typeof SharedArrayBuffer = ArrayBuffer) => {
    const padded = new Uint8Array(new ArrayBufferClass(bytes.length + 16));
    padded.set(bytes, 8);
    const whole = new Uint8Array(new ArrayBufferClass(bytes.length));
    whole.set(bytes);
    return [
      whole.buffer,
      whole,
      new Uint8Array(padded.buffer, 8, bytes.length),
      new DataView(padded.buffer, 8, bytes.length),
      new Int8Array(padded.buffer, 8, bytes.length),
      new Uint16Array(padded.buffer, 8, bytes.length / 2),
      new Float64Array(padded.buffer, 8, bytes.length / 8),
      new BigUint64Array(padded.buffer, 8, bytes.length / 8),
    ];
  };
  const eight = [1, 2, 3, 4, 250, 251, 252, 253];
  const notBytes = [
    undefined,
    null,
    1,
    1n,
    true,
    {},
    [],
    [1],
    () => {},
    Symbol("s"),
    new Date(0),
    { toString: () => "x" },
  ];

  const everyForm = [bindgen.bytesOf, bindgen.bytesOfOrBlob, bindgen.bytesOfLoose, bindgen.bytesOfLooseOrBlob];

  it("takes a string or a String object as UTF-8", () => {
    class Derived extends String {
      toString() {
        return "derived";
      }
    }
    for (const f of everyForm) {
      for (const text of [
        "",
        "abc",
        "h\xe9llo",
        "\u65e5\u672c",
        "\u{1f600}",
        Buffer.alloc(300, "a").toString(),
        Buffer.alloc(300, 0xe9).toString("latin1"),
        "a\0b",
      ]) {
        expect(f(text)).toEqual(utf8(text));
        expect(f(new String(text))).toEqual(utf8(text));
        expect(f(text + text.slice(0, 0) + "!")).toEqual(utf8(text + "!"));
      }
      expect(f("\ud800")).toEqual([0xef, 0xbf, 0xbd]);
      expect(f(new Derived("x"))).toEqual(utf8("derived"));
    }
  });

  it("takes the bytes that a buffer or a view shows, shared or not", () => {
    for (const f of everyForm) {
      for (const ArrayBufferClass of [ArrayBuffer, SharedArrayBuffer]) {
        for (const buffer of buffers(eight, ArrayBufferClass)) expect(f(buffer)).toEqual(eight);
        for (const buffer of buffers([], ArrayBufferClass)) expect(f(buffer)).toEqual([]);
      }
      expect(f(Buffer.from(eight))).toEqual(eight);
      const detached = new Uint8Array(eight);
      detached.buffer.transfer();
      expect(f(detached)).toEqual([]);
      expect(f(detached.buffer)).toEqual([]);
      const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
      const tracking = new Uint8Array(resizable);
      const fixed = new Uint8Array(resizable, 4, 4);
      tracking.set(eight);
      expect(f(tracking)).toEqual(eight);
      resizable.resize(6);
      expect(f(tracking)).toEqual(eight.slice(0, 6));
      expect(f(fixed)).toEqual([]);
      const growable = new SharedArrayBuffer(4, { maxByteLength: 8 });
      new Uint8Array(growable).set([9, 8, 7, 6]);
      expect(f(growable)).toEqual([9, 8, 7, 6]);
      growable.grow(6);
      expect(f(new Uint8Array(growable))).toEqual([9, 8, 7, 6, 0, 0]);
    }
  });

  it(".orBlob takes the bytes of a Blob, but not of one that is a file", () => {
    const s3 = new Bun.S3Client({ accessKeyId: "id", secretAccessKey: "secret", bucket: "bucket" });
    for (const f of [bindgen.bytesOfOrBlob, bindgen.bytesOfLooseOrBlob]) {
      expect(f(new Blob([new Uint8Array(eight)]))).toEqual(eight);
      expect(f(new Blob(["ab", "c"]))).toEqual(utf8("abc"));
      expect(f(new Blob([new Uint8Array(eight)]).slice(2, 5))).toEqual(eight.slice(2, 5));
      expect(f(new Blob([]))).toEqual([]);
      expect(f(new File(["abc"], "name.txt"))).toEqual(utf8("abc"));
      for (const file of [Bun.file(import.meta.path), s3.file("key")]) {
        expect(() => f(file)).toThrow(
          expect.objectContaining({
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: "File blob cannot be used here",
          }),
        );
      }
    }
    expect(bindgen.bytesOfLoose(new Blob(["abc"]))).toEqual(utf8("[object Blob]"));
  });

  it("refuses anything else, without converting it", () => {
    const refusal = (what: string) =>
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: `data must be ${what}` });
    for (const value of [...notBytes, new Blob(["abc"])]) {
      expect(() => bindgen.bytesOf(value)).toThrow(refusal("a string, ArrayBuffer or ArrayBufferView"));
    }
    for (const value of notBytes) {
      expect(() => bindgen.bytesOfOrBlob(value)).toThrow(refusal("a string, ArrayBuffer, ArrayBufferView or Blob"));
    }
  });

  it(".loose is ToString of anything else", () => {
    for (const f of [bindgen.bytesOfLoose, bindgen.bytesOfLooseOrBlob]) {
      for (const value of notBytes) {
        if (typeof value === "symbol") continue;
        expect(f(value)).toEqual(utf8(String(value)));
      }
      expect(() => f(Symbol("s"))).toThrow(
        expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a string" }),
      );
      expect(() =>
        f({
          toString() {
            throw new RangeError("from toString");
          },
        }),
      ).toThrow(new RangeError("from toString"));
    }
  });

  it("reads a buffer after every argument is converted", () => {
    const then = (buffer: ArrayBufferView | ArrayBufferLike, during: () => void) =>
      bindgen.bytesOfThen(buffer, {
        valueOf() {
          during();
          return 0;
        },
      });
    const written = new Uint8Array(eight);
    expect(then(written, () => written.fill(7))).toEqual(new Array(8).fill(7));
    const detached = new Uint8Array(eight);
    expect(then(detached, () => void detached.buffer.transfer())).toEqual([]);
    const collected = new Uint8Array(eight);
    expect(
      then(collected, () => {
        structuredClone(collected.buffer, { transfer: [collected.buffer] });
        Bun.gc(true);
      }),
    ).toEqual([]);
    const resizable = new ArrayBuffer(8, { maxByteLength: 4096 });
    new Uint8Array(resizable).set(eight);
    expect(then(new Uint8Array(resizable), () => resizable.resize(2))).toEqual([1, 2]);
    expect(then(resizable, () => resizable.resize(4))).toEqual([1, 2, 0, 0]);
    const growable = new SharedArrayBuffer(2, { maxByteLength: 4096 });
    expect(then(growable, () => growable.grow(4))).toEqual([0, 0, 0, 0]);
    // A string is converted in its turn: what it is cannot change.
    const log: string[] = [];
    const text = Object.assign(new String("x"), {
      toString() {
        log.push("data");
        return "text";
      },
    });
    expect(then(text as any, () => log.push("after"))).toEqual(utf8("text"));
    expect(log).toEqual(["data", "after"]);
    expect(() => bindgen.bytesOfThen(1, { valueOf: () => log.push("not reached") })).toThrow("data must be");
    expect(log).toEqual(["data", "after"]);
  });

  it("copies only what another thread could change", () => {
    const ownMemory = bindgen.bytesOfAreSameMemory;
    for (const buffer of buffers(eight)) expect(ownMemory(buffer, buffer)).toBe(true);
    for (const buffer of buffers(eight, SharedArrayBuffer)) expect(ownMemory(buffer, buffer)).toBe(false);
    const blob = new Blob([new Uint8Array(eight)]);
    expect(ownMemory(blob, blob)).toBe(true);
    // The characters of a string that is ASCII are its UTF-8.
    expect(ownMemory("ascii", "ascii")).toBe(true);
    expect(ownMemory("\xe9", "\xe9")).toBe(false);
  });
});

it("b.u64.asBigInt returns a BigInt, whatever the value", () => {
  for (const value of [0n, 1n, 2n ** 31n, 2n ** 53n + 1n, 2n ** 64n - 1n]) expect(bindgen.asBigInt(value)).toBe(value);
  expect(bindgen.asBigInt(5)).toBe(5n);
});

describe("withValue arguments", () => {
  it("hands back the very value that was converted", () => {
    const boxed = new String("boxed");
    const custom = { toString: () => "custom" };
    for (const value of ["plain", boxed, custom, 5]) expect(bindgen.withValueEcho(value)).toBe(value);
    expect(bindgen.withValueEcho("")).toBe(undefined);
  });
});

describe("errors", () => {
  it("throws what the function describes", () => {
    expect(() => bindgen.fail("type")).toThrow(new TypeError("a type error"));
    expect(() => bindgen.fail("range")).toThrow(new RangeError("a range error"));
    expect(() => bindgen.fail("plain")).toThrow(new Error("an error"));
    expect(() => bindgen.fail("code")).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE", message: "an error with a code" }),
    );
    expect(() => bindgen.fail("syscall")).toThrow(expect.objectContaining({ code: "ENOENT", syscall: "open" }));
    expect(() => bindgen.fail("outOfMemory")).toThrow(
      expect.objectContaining({ name: "RangeError", message: "Out of memory" }),
    );
    const value = { thrown: true };
    let caught;
    try {
      bindgen.fail("value", value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(value);
    for (const primitive of [1, "s", null, undefined]) {
      try {
        bindgen.fail("value", primitive);
        expect.unreachable();
      } catch (error) {
        expect(error).toBe(primitive);
      }
    }
  });
});

describe("classes", () => {
  const { TestCounter, TestHolder } = bindgen as any;

  it("looks like a class", () => {
    expect(typeof TestCounter).toBe("function");
    expect(TestCounter.name).toBe("TestCounter");
    expect(TestCounter.length).toBe(0);
    expect(TestCounter.prototype.constructor).toBe(TestCounter);
    expect(Object.prototype.toString.call(new TestCounter())).toBe("[object TestCounter]");
    expect(Object.getOwnPropertyNames(TestCounter.prototype).sort()).toEqual(
      ["constructor", "count", "increment", "label", "listen", "notify", "plus", "tag"].sort(),
    );
    expect(Object.getOwnPropertyNames(new TestCounter())).toEqual([]);
    expect(TestCounter.prototype.increment.length).toBe(0);
    expect(TestCounter.prototype.plus.length).toBe(1);
    expect(() => TestCounter()).toThrow("TestCounter constructor cannot be invoked without 'new'");
  });

  it("constructs, reads and mutates", () => {
    const counter = new TestCounter(5);
    expect(counter).toBeInstanceOf(TestCounter);
    expect(counter.count).toBe(5);
    expect(counter.increment()).toBe(6);
    expect(counter.increment(10)).toBe(16);
    expect(counter.count).toBe(16);
    expect(new TestCounter().count).toBe(0);
  });

  it("a constructor that throws makes nothing", () => {
    const before = TestCounter.alive();
    expect(() => new TestCounter(-1)).toThrow(new RangeError("start must not be negative"));
    expect(() => new TestCounter("1")).toThrow("start must be a number");
    // A collection in between can only lower it.
    expect(TestCounter.alive()).toBeLessThanOrEqual(before);
  });

  it("setters convert like arguments", () => {
    const counter = new TestCounter();
    expect(counter.label).toBe("");
    counter.label = "näme";
    expect(counter.label).toBe("näme");
    expect(() => {
      counter.label = 5;
    }).toThrow("TestCounter.label must be a string");
    expect(counter.label).toBe("näme");
    expect(() => {
      "use strict";
      counter.count = 1;
    }).toThrow(new TypeError("Attempted to assign to readonly property."));
  });

  it("a cached getter is computed once per object", () => {
    const counter = new TestCounter(3);
    const tag = counter.tag;
    expect(tag).toEqual([3]);
    counter.increment();
    expect(counter.tag).toBe(tag);
    Bun.gc(true);
    expect(counter.tag).toBe(tag);
    expect(new TestCounter(3).tag).not.toBe(tag);
  });

  it("checks the receiver", () => {
    const { increment } = TestCounter.prototype;
    const count = Object.getOwnPropertyDescriptor(TestCounter.prototype, "count")!.get!;
    const setLabel = Object.getOwnPropertyDescriptor(TestCounter.prototype, "label")!.set!;
    for (const receiver of [
      undefined,
      null,
      1,
      {},
      TestCounter.prototype,
      Object.create(new TestCounter()),
      new Bun.Glob("*"),
      bindgen.makeToken(1),
      new Blob([]),
      new URL("http://localhost/"),
      new Headers(),
      10n ** 30n,
    ]) {
      expect(() => increment.call(receiver)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_THIS",
          message: expect.stringMatching(/^Expected this to be instanceof TestCounter/),
        }),
      );
      expect(() => count.call(receiver)).toThrow(
        new TypeError("The TestCounter.count getter can only be used on instances of TestCounter"),
      );
      expect(() => setLabel.call(receiver, "x")).toThrow(
        new TypeError("The TestCounter.label setter can only be used on instances of TestCounter"),
      );
    }
    expect(() => new TestCounter().plus({})).toThrow("other must be an instance of TestCounter");
    expect(() => new TestCounter().plus(new Bun.Glob("*"))).toThrow("other must be an instance of TestCounter");
  });

  it("can be subclassed and made with Reflect.construct", () => {
    class Sub extends TestCounter {
      extra = 1;
      constructor(start: number) {
        super(start);
      }
      twice() {
        return this.increment() + this.increment();
      }
    }
    const sub = new Sub(1);
    expect(sub).toBeInstanceOf(Sub);
    expect(sub).toBeInstanceOf(TestCounter);
    expect(sub.extra).toBe(1);
    expect(sub.twice()).toBe(5);
    function Other() {}
    const other = Reflect.construct(TestCounter, [2], Other);
    expect(Object.getPrototypeOf(other)).toBe(Other.prototype);
    expect(TestCounter.prototype.increment.call(other)).toBe(3);
  });

  it("takes and returns instances", () => {
    const made = TestCounter.starting(40);
    expect(made).toBeInstanceOf(TestCounter);
    expect(made.plus(new TestCounter(2))).toBe(42);
    expect(made.plus(made)).toBe(80);
  });

  it("holds a value in an internal field and lets JavaScript re-enter", () => {
    const counter = new TestCounter(1);
    expect(counter.notify()).toBe(1);
    const receivers: unknown[] = [];
    counter.listen(function (this: unknown) {
      receivers.push(this);
      counter.increment(10);
      counter.label = "changed inside";
      if (receivers.length < 3) counter.notify();
    });
    Bun.gc(true);
    expect(counter.notify()).toBe(31);
    expect(receivers).toEqual([counter, counter, counter]);
    expect(counter.label).toBe("changed inside");
    counter.listen(() => {
      throw new RangeError("from the listener");
    });
    expect(() => counter.notify()).toThrow(new RangeError("from the listener"));
  });

  it("without `construct` there is no constructor", () => {
    const token = bindgen.makeToken(7);
    expect(token.id).toBe(7);
    expect(Object.prototype.toString.call(token)).toBe("[object TestToken]");
    const prototype = Object.getPrototypeOf(token);
    expect(Object.getOwnPropertyNames(prototype)).toEqual(["id"]);
    expect(token.constructor).toBe(Object);
    expect(Object.getPrototypeOf(bindgen.makeToken(8))).toBe(prototype);
  });

  it("a payload keeps another object alive with a Strong", () => {
    const holder = new TestHolder(new TestCounter(5));
    Bun.gc(true);
    expect(holder.counter).toBeInstanceOf(TestCounter);
    expect(holder.counter).toBe(holder.counter);
    expect(holder.incrementCounter()).toBe(6);
    expect(holder.counter.count).toBe(6);
    expect(() => new TestHolder({})).toThrow("counter must be an instance of TestCounter");
  });

  it("drops the Rust value when the object is collected", () => {
    const count = 1000;
    let counters: unknown[] | null = Array.from({ length: count }, (_, i) => {
      const counter = new TestCounter(i);
      counter.label = "label " + i;
      counter.listen(() => counter);
      counter.tag;
      return new TestHolder(counter);
    });
    Bun.gc(true);
    expect(TestCounter.alive()).toBeGreaterThanOrEqual(counters.length);
    counters = null;
    // The first collection drops the holders and their Strongs, the second the counters.
    Bun.gc(true);
    Bun.gc(true);
    expect(TestCounter.alive()).toBeLessThan(count);
  });
});
