import { JSON5 } from "bun";
import { expectType } from "./utilities";

expectType(JSON5.parse("{a: 1}")).is<unknown>();
// `undefined` when the input is `undefined`, a function, or a symbol.
expectType(JSON5.stringify({ a: 1 })).is<string | undefined>();
expectType(Bun.JSON5.stringify({ a: 1 }, null, 2)).is<string | undefined>();
expectType(JSON5.stringify({ a: 1 }, (key, value) => (key === "a" ? undefined : value))).is<string | undefined>();
expectType(JSON5.stringify({ a: 1 }, ["a", 1], "\t")).is<string | undefined>();
// @ts-expect-error
JSON5.stringify({ a: 1 }, "a");
// @ts-expect-error
JSON5.stringify({ a: 1 }, [true]);
