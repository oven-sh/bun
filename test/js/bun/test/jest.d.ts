/// <reference path="../../../../packages/bun-types/test-globals.d.ts" />

// Eventually move these to @types/bun somehow
interface ReadableStream {
  text(): Promise<string>;
  json(): Promise<unknown>;
  blob(): Promise<Blob>;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
}

declare module "bun" {
  function jest(path: string): typeof import("bun:test");
}
