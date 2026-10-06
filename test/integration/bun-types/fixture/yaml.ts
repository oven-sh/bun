import { expectType } from "./utilities";

expectType(Bun.YAML.parse("")).is<unknown>();
// @ts-expect-error
expectType(Bun.YAML.parse({})).is<unknown>();
expectType(Bun.YAML.stringify({ abc: "def"})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", {})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", null, 123n)).is<string>();

expectType(Bun.YAML.parse("a: 1")).is<unknown>();
Bun.YAML.parse(Buffer.from("a: 1"));
Bun.YAML.parse(new Uint8Array(1));
Bun.YAML.parse(new ArrayBuffer(1));
Bun.YAML.parse(new SharedArrayBuffer(1));
Bun.YAML.parse(new DataView(new ArrayBuffer(1)));
Bun.YAML.parse(new Blob(["a: 1"]));
// @ts-expect-error
Bun.YAML.parse(1);
