import { expectType } from "./utilities";

expectType(Bun.YAML.parse("")).is<unknown>();
// @ts-expect-error
expectType(Bun.YAML.parse({})).is<unknown>();
expectType(Bun.YAML.stringify({ abc: "def"})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", {})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", null, 123n)).is<string>();

expectType(Bun.YAML.parse("", {})).is<unknown>();
expectType(Bun.YAML.parse("", { maxAliasCount: 0, maxDepth: 64 })).is<unknown>();
const limits: Bun.YAML.ParseOptions = { maxDepth: 64 };
expectType(Bun.YAML.parse("", limits)).is<unknown>();
// @ts-expect-error
Bun.YAML.parse("", { maxAliasCount: "0" });
// @ts-expect-error
Bun.YAML.parse("", { maxDepth: null });
// @ts-expect-error
Bun.YAML.parse("", 64);
// `map` passes an index as the second argument. The overload without options takes it.
expectType(["a: 1"].map(Bun.YAML.parse)).is<unknown[]>();
expectType(Array.from(["a: 1"], Bun.YAML.parse)).is<unknown[]>();
expectType(Bun.YAML.parse("", { maxAliasCount: undefined, maxDepth: undefined })).is<unknown>();
