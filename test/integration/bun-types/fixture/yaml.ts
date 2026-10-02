import { expectType } from "./utilities";

expectType(Bun.YAML.parse("")).is<unknown>();
// @ts-expect-error
expectType(Bun.YAML.parse({})).is<unknown>();
expectType(Bun.YAML.stringify({ abc: "def" })).is<string | undefined>();
expectType(Bun.YAML.stringify(undefined)).is<string | undefined>();
expectType(Bun.YAML.stringify(() => {})).is<string | undefined>();
expectType(Bun.YAML.stringify(Symbol("value"))).is<string | undefined>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", {})).is<string | undefined>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", null, 123n)).is<string | undefined>();
