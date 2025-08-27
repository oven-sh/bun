/// <reference path="../../../../packages/bun-types/test-globals.d.ts"" />

// Eventually move these to @types/bun somehow
interface ReadableStream {
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
}
