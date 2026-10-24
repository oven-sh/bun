import { expectType } from "./utilities";

expectType(Bun.JSON5.parse("")).is<unknown>();
expectType(Bun.JSON5.parse("{a: 1}", null)).is<unknown>();
expectType(Bun.JSON5.parse("{a: 1}", undefined)).is<unknown>();
expectType(
  Bun.JSON5.parse("{a: 1}", function (key, value) {
    expectType(key).is<string>();
    expectType(this).is<any>();
    return value;
  }),
).is<unknown>();
// @ts-expect-error
Bun.JSON5.parse("{a: 1}", ["a"]);
// @ts-expect-error
Bun.JSON5.parse("{a: 1}", {});

expectType(Bun.JSON5.stringify({ abc: "def" })).is<string | undefined>();
expectType(Bun.JSON5.stringify({ abc: "def" }, null, 2)).is<string | undefined>();
expectType(Bun.JSON5.stringify({ abc: "def" }, undefined, "\t")).is<string | undefined>();
expectType(Bun.JSON5.stringify({ abc: "def" }, ["abc", 1])).is<string | undefined>();
expectType(
  Bun.JSON5.stringify({ abc: "def" }, function (key, value) {
    expectType(key).is<string>();
    expectType(this).is<any>();
    return value;
  }),
).is<string | undefined>();
// @ts-expect-error
Bun.JSON5.stringify("hi", {});
// @ts-expect-error
Bun.JSON5.stringify("hi", [true]);
// @ts-expect-error
Bun.JSON5.stringify("hi", null, 123n);
