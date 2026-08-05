import { expectType } from "./utilities";

expectType(Bun.JSON5.parse("")).is<unknown>();
expectType(Bun.JSON5.parse(Buffer.from("{ foo: 'bar' }"))).is<unknown>();
expectType(Bun.JSON5.parse(new Uint8Array())).is<unknown>();
expectType(Bun.JSON5.parse(new DataView(new ArrayBuffer(0)))).is<unknown>();
expectType(Bun.JSON5.parse(new DataView(new SharedArrayBuffer(0)))).is<unknown>();
expectType(Bun.JSON5.parse(new ArrayBuffer(0))).is<unknown>();
expectType(Bun.JSON5.parse(new SharedArrayBuffer(0))).is<unknown>();
expectType(Bun.JSON5.parse(new Blob())).is<unknown>();
