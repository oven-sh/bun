import { expectType } from "./utilities";

new ReadableStream({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    controller.close();
  },
});

// This will have type errors when lib.dom.d.ts is present
// Not fixable because ReadableStream has no ReadableStreamConstructor interface
// we can merge into. See https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1941
// for details about when/why/how TypeScript might support this.
new ReadableStream({
  type: "direct",
  async pull(controller) {
    controller.write(new TextEncoder().encode("Hello, world!"));
  },
});

declare const uint8stream: ReadableStream<Uint8Array<ArrayBuffer>>;

for await (const chunk of uint8stream) {
  expectType(chunk).is<Uint8Array<ArrayBuffer>>();
}

declare const uint8Array: Uint8Array<ArrayBuffer>;
expectType(uint8Array).is<Uint8Array<ArrayBuffer>>();

declare const uint8Writable: WritableStream<Uint8Array<ArrayBuffer>>;
declare const uint8Transform: TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>;

const writer = uint8Writable.getWriter();
await writer.write(uint8Array);
await writer.close();

for await (const chunk of uint8Transform.readable) {
  expectType(chunk).is<Uint8Array<ArrayBuffer>>();
}
