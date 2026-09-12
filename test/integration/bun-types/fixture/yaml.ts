import { expectType } from "./utilities";

expectType(Bun.YAML.parse("")).is<unknown>();
// @ts-expect-error
expectType(Bun.YAML.parse({})).is<unknown>();
// `undefined` when the input is `undefined`, a function, or a symbol, or when a replacer drops the root.
expectType(Bun.YAML.stringify({ abc: "def" })).is<string | undefined>();
expectType(Bun.YAML.stringify(undefined)).is<string | undefined>();
expectType(Bun.YAML.stringify(() => {})).is<string | undefined>();
expectType(Bun.YAML.stringify(Symbol("value"))).is<string | undefined>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", {})).is<string | undefined>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", null, 123n)).is<string | undefined>();

// replacer: a function called with the holder as `this`, or a list of property names
expectType(
  Bun.YAML.stringify({ abc: "def" }, function (key, value) {
    expectType(this).is<any>();
    expectType(key).is<string>();
    expectType(value).is<any>();
    return key === "abc" ? undefined : value;
  }),
).is<string | undefined>();
expectType(Bun.YAML.stringify({ abc: "def" }, ["abc", 0])).is<string | undefined>();
expectType(Bun.YAML.stringify({ abc: "def" }, undefined, "\t")).is<string | undefined>();
// @ts-expect-error
Bun.YAML.stringify({ abc: "def" }, "abc");
// @ts-expect-error
Bun.YAML.stringify({ abc: "def" }, [Symbol("abc")]);
