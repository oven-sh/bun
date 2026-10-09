import { expectType } from "./utilities";

expectType(Bun.YAML.parse("")).is<unknown>();
expectType(Bun.YAML.parse(Buffer.from("foo: bar"))).is<unknown>();
expectType(Bun.YAML.parse(new Uint8Array())).is<unknown>();
expectType(Bun.YAML.parse(new DataView(new ArrayBuffer(0)))).is<unknown>();
expectType(Bun.YAML.parse(new DataView(new SharedArrayBuffer(0)))).is<unknown>();
expectType(Bun.YAML.parse(new ArrayBuffer(0))).is<unknown>();
expectType(Bun.YAML.parse(new SharedArrayBuffer(0))).is<unknown>();
expectType(Bun.YAML.parse(new Blob())).is<unknown>();
// @ts-expect-error
expectType(Bun.YAML.parse({})).is<unknown>();
expectType(Bun.YAML.stringify({ abc: "def" })).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", {})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", null, 123n)).is<string>();
