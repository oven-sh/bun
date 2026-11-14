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

Bun.file("./foo.csv").stream().pipeThrough(new TextDecoderStream("utf-16le", { fatal: true, ignoreBOM: true }));

new ReadableStream({
  type: "bytes",
  autoAllocateChunkSize: 1024,
  pull(controller) {
    expectType(controller).is<ReadableByteStreamController>();
    controller.enqueue(new Uint8Array(1));
    controller.byobRequest?.respond(1);
    controller.close();
  },
});
expectType(new ReadableStream({ type: "bytes" })).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
expectType(new ReadableStream<Uint8Array>({ type: "bytes" })).is<ReadableStream<Uint8Array>>();
expectType(new ReadableStream<string>({} as any)).is<ReadableStream<string>>();

import { ReadableStreamDefaultReader as NodeStreamReadableStreamDefaultReader } from "node:stream/web";

// readMany() is a Bun-only method of ReadableStreamDefaultReader. Every default
// reader has it, whichever stream it reads.
{
  type Many<T> = Bun.ReadableStreamDefaultReadManyResult<T> | Promise<Bun.ReadableStreamDefaultReadManyResult<T>>;

  expectType(new ReadableStream<Uint8Array>().getReader().readMany()).is<Many<Uint8Array>>();
  expectType(new ReadableStreamDefaultReader(stream).readMany()).is<Many<Uint8Array>>();
  expectType(node_stream.getReader().readMany()).is<Many<Uint8Array>>();
  expectType(new NodeStreamReadableStreamDefaultReader(node_stream).readMany()).is<Many<Uint8Array>>();
  expectType(Bun.file("./foo.csv").stream().getReader().readMany()).is<Many<Uint8Array<ArrayBuffer>>>();
  expectType(Bun.spawn(["echo"], { stdout: "pipe" }).stdout.getReader().readMany()).is<Many<Uint8Array<ArrayBuffer>>>();
  expectType(uint8Transform.readable.getReader().readMany()).is<Many<Uint8Array<ArrayBuffer>>>();
  new Response("").body!.getReader().readMany();
  stream.tee()[0].getReader().readMany();
  uint8stream.pipeThrough(new TextDecoderStream()).getReader().readMany();

  // @ts-expect-error A BYOB reader has no readMany()
  stream.getReader({ mode: "byob" }).readMany();
}

// A lib that declares the web streams (lib.dom, lib.webworker) has a reader of its own.
// Without one, the global ReadableStreamDefaultReader is the reader of node:stream/web,
// which is the type that getReader() returns.
type LibDeclaresReader = Bun.__internal.LibDomOrWebWorkerIsLoaded;
declare function firstChunk<T>(reader: ReadableStreamDefaultReader<T>): T;
{
  type ModuleReader = NodeStreamReadableStreamDefaultReader<Uint8Array>;
  type GlobalReader = ReadableStreamDefaultReader<Uint8Array>;

  expectType(stream.getReader()).is<GlobalReader>();
  expectType(node_stream.getReader()).is<LibDeclaresReader extends true ? ModuleReader : GlobalReader>();
  expectType(firstChunk(stream.getReader())).is<Uint8Array>();

  const annotated: GlobalReader = stream.getReader();
  const aliased: Bun.ReadableStreamReader<Uint8Array> = stream.getReader();
  const untyped: ReadableStreamDefaultReader = Bun.spawn(["echo"], { stdout: "pipe" }).stdout.getReader();
  const asModuleReader: ModuleReader = new ReadableStreamDefaultReader(stream);

  // read() gives what read() of the node:stream/web reader gives. Beside the read() of a lib,
  // Bun's result type stays in front.
  const result = await annotated.read();
  type ModuleReadResult = Awaited<ReturnType<ModuleReader["read"]>>;
  expectType(result).is<
    LibDeclaresReader extends true ? Bun.ReadableStreamDefaultReadResult<Uint8Array> : ModuleReadResult
  >();
  if (!result.done) expectType(result.value).is<Uint8Array>();

  // instanceof keeps the type of the chunks.
  const guarded = stream.getReader();
  if (guarded instanceof ReadableStreamDefaultReader) expectType(guarded).is<GlobalReader>();
  const either = stream.getReader({});
  if (either instanceof ReadableStreamDefaultReader) {
    expectType(either).is<GlobalReader>();
  } else {
    expectType(either).is<ReadableStreamBYOBReader>();
  }
}

// The global reader extends the reader of node:stream/web and does not copy it:
// a member that only the module declares is a member of the global reader too.
declare module "stream/web" {
  interface ReadableStreamDefaultReader<R = any> {
    readonly fixtureOnlyMember?: R;
  }
}
{
  type GlobalReaderExtendsModuleReader = LibDeclaresReader extends true
    ? true
    : "fixtureOnlyMember" extends keyof ReadableStreamDefaultReader
      ? true
      : false;
  expectType<GlobalReaderExtendsModuleReader>().is<true>();
}
