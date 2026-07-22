import { expectType } from "./utilities";

const buffer = new ArrayBuffer(1024, {
  maxByteLength: 2048,
});

console.log(buffer.byteLength); // 1024
buffer.resize(2048);
console.log(buffer.byteLength); // 2048

// resize() mutates the buffer in place and returns undefined (void) per the
// ECMAScript spec, not the ArrayBuffer.
const resizeResult: void = buffer.resize(1024);
void resizeResult;
TextDecoder;

const buf = new SharedArrayBuffer(1024);
buf.grow(2048);

expectType(buffer[Symbol.toStringTag]).extends<string>();
