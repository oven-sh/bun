import { expectType } from "./utilities";

expectType(Bun.YAML.parse("")).is<unknown>();
// @ts-expect-error
expectType(Bun.YAML.parse({})).is<unknown>();
expectType(Bun.YAML.stringify({ abc: "def" })).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", {})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", null, 123n)).is<string>();
expectType(Bun.YAML.stringify({ a: 1 }, null, { indent: 2, aliases: false })).is<string>();
expectType(Bun.YAML.stringify({ a: 1 }, null, { indent: "\t" })).is<string>();
expectType(Bun.YAML.stringify({ a: 1 }, null, {} satisfies Bun.YAML.StringifyOptions)).is<string>();
// @ts-expect-error
Bun.YAML.stringify({ a: 1 }, null, { aliases: "false" });
// @ts-expect-error
Bun.YAML.stringify({ a: 1 }, null, { indent: 2, alias: false });
expectType(Bun.JSON5.stringify({ a: 1 }, null, { indent: 2 })).is<string | undefined>();
// @ts-expect-error
Bun.JSON5.stringify({ a: 1 }, null, { aliases: false });

expectType(Bun.YAML.parse("a: 1")).is<unknown>();
Bun.YAML.parse(Buffer.from("a: 1"));
Bun.YAML.parse(new Uint8Array(1));
Bun.YAML.parse(new ArrayBuffer(1));
Bun.YAML.parse(new SharedArrayBuffer(1));
Bun.YAML.parse(new DataView(new ArrayBuffer(1)));
Bun.YAML.parse(new Blob(["a: 1"]));
// @ts-expect-error
Bun.YAML.parse(1);
