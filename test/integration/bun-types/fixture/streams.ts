import { expectType } from "./utilities";

new ReadableStream<string>({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    // @ts-expect-error
    controller.enqueue(2);
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

declare const stream: ReadableStream<Uint8Array>;

expectType(stream.json()).is<Promise<any>>();
expectType(stream.bytes()).is<Promise<Uint8Array<ArrayBuffer>>>();
expectType(stream.text()).is<Promise<string>>();
expectType(stream.blob()).is<Promise<Blob>>();

import { ReadableStream as NodeStreamReadableStream } from "node:stream/web";

declare const node_stream: NodeStreamReadableStream<Uint8Array>;

expectType(node_stream.json()).is<Promise<any>>();
expectType(node_stream.bytes()).is<Promise<Uint8Array<ArrayBuffer>>>();
expectType(node_stream.text()).is<Promise<string>>();
expectType(node_stream.blob()).is<Promise<Blob>>();

Bun.file("./foo.csv").stream().pipeThrough(new TextDecoderStream()).pipeThrough(new TextEncoderStream());

Bun.file("./foo.csv").stream().pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip"));
Bun.file("./foo.csv").stream().pipeThrough(new CompressionStream("brotli")).pipeThrough(new DecompressionStream("brotli"));
Bun.file("./foo.csv").stream().pipeThrough(new CompressionStream("zstd")).pipeThrough(new DecompressionStream("zstd"));

Bun.file("./foo.csv")
  .stream()
  .pipeThrough(new TextDecoderStream())
  .pipeTo(
    new WritableStream({
      write(chunk) {
        expectType(chunk).is<string>();
      },
    }),
  );

// @ts-expect-error These properties do not exist right now
expectType(new ReadableStream().arrayBuffer());
// @ts-expect-error These properties do not exist right now
expectType(new ReadableStream().formData());

expectType(new Blob([]).text()).is<Promise<string>>();
expectType(new Blob([]).arrayBuffer()).is<Promise<ArrayBuffer>>();
expectType(new Blob([]).bytes()).is<Promise<Uint8Array<ArrayBuffer>>>();
expectType(new Blob([]).json()).is<Promise<any>>();
expectType(new Blob([]).formData()).is<Promise<FormData>>();
expectType(new Blob([]).stream()).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
