import { expectType } from "./utilities";

const buffer = new ArrayBuffer(1024, {
  maxByteLength: 2048,
});

console.log(buffer.byteLength); // 1024
buffer.resize(2048);
console.log(buffer.byteLength); // 2048
TextDecoder;

const buf = new SharedArrayBuffer(1024);
buf.grow(2048);

expectType(buffer[Symbol.toStringTag]).extends<string>();

// SharedArrayBuffer.grow() returns void per ES spec, parameter is optional
expectType(buf.grow(2048)).is<void>();
expectType(buf.grow()).is<void>();

// ArrayBuffer.resize() returns void per ES spec, parameter is optional
expectType(buffer.resize(2048)).is<void>();
expectType(buffer.resize()).is<void>();

// Promise.withResolvers().resolve has a required parameter
const { resolve } = Promise.withResolvers<string>();
expectType(resolve).is<(value: string | PromiseLike<string>) => void>();
