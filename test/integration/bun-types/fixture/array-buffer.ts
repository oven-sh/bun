import { expectType } from "./utilities";

const buffer = new ArrayBuffer(1024, {
  maxByteLength: 2048,
});

console.log(buffer.byteLength); // 1024
buffer.resize(2048);
console.log(buffer.byteLength); // 2048
expectType(buffer.resize(1024)).is<void>();
TextDecoder;

const buf = new SharedArrayBuffer(1024);
buf.grow(2048);
expectType(buf.grow(1024)).is<void>();

expectType(buffer[Symbol.toStringTag]).extends<string>();
