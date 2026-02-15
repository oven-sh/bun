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

// ArrayBuffer.resize() should return void per the ECMAScript spec
expectType(buffer.resize(2048)).is<void>();

// Promise.withResolvers resolve parameter should be non-optional
const { resolve } = Promise.withResolvers<string>();
expectType(resolve).is<(value: string | PromiseLike<string>) => void>();
