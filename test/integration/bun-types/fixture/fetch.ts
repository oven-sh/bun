// Valid body types
fetch("https://example.com", { body: "string body" });
fetch("https://example.com", { body: JSON.stringify({ key: "value" }) });
fetch("https://example.com", { body: new Blob(["blob content"]) });
fetch("https://example.com", { body: new File(["file content"], "file.txt") });
fetch("https://example.com", { body: new ArrayBuffer(8) });
fetch("https://example.com", { body: new Uint8Array([1, 2, 3, 4]) });
fetch("https://example.com", { body: new Int32Array([1, 2, 3, 4]) });
fetch("https://example.com", { body: new DataView(new ArrayBuffer(8)) });
fetch("https://example.com", { body: new URLSearchParams({ key: "value" }) });
fetch("https://example.com", { body: new FormData() });
fetch("https://example.com", { body: new ReadableStream() });
fetch("https://example.com", { body: Buffer.from("buffer content") });
fetch("https://example.com", { body: Bun.file("path") });
fetch("https://example.com", { body: Bun.file("hey").stream() });
fetch("https://example.com", { body: new Response("bun").body });
fetch("https://example.com", { body: Bun.s3.file("hey") });
fetch("https://example.com", { body: Bun.s3.file("hey").stream() });
fetch("https://example.com", { body: Bun.s3.file("hey").readable });

async function* asyncGenerator() {
  yield "chunk1";
  yield "chunk2";
}
fetch("https://example.com", { body: asyncGenerator() });

const asyncIterable = {
  async *[Symbol.asyncIterator]() {
    yield "data1";
    yield "data2";
  },
};
fetch("https://example.com", { body: asyncIterable });

fetch("https://example.com").then(res => {
  fetch("https://example.com", { body: res.body });
});

const req = new Request("https://example.com", { body: "request body" });
fetch("https://example.com", { body: req.body });

fetch("https://example.com", { body: null });
fetch("https://example.com", { body: undefined });
fetch("https://example.com", {}); // No body

{
  function* syncGenerator() {
    yield new Uint8Array([1, 2, 3]);
    yield new Uint8Array([4, 5, 6]);
  }
  // @ts-expect-error Unsupported
  fetch("https://example.com", { body: syncGenerator() });
}

{
  const iterable = {
    *[Symbol.iterator]() {
      yield new Uint8Array([7, 8, 9]);
    },
  };
  // @ts-expect-error normal iterators are not supported
  fetch("https://example.com", { body: iterable });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: 123 });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: true });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: false });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: { plain: "object" } });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: ["array", "of", "strings"] });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: new Date() });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: /regex/ });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: Symbol("symbol") });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: BigInt(123) });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: new Map() });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: new Set() });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: new WeakMap() });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: new WeakSet() });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: Promise.resolve("promise") });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: () => "function" });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: class MyClass {} });
}

{
  // @ts-expect-error
  fetch("https://example.com", { body: new Error("error") });
}

{
  fetch("https://example.com", { method: "GET", body: "should not have body but types should still allow it" });
  fetch("https://example.com", { method: "HEAD", body: "should not have body but types should still allow it" });
}

{
  const multipartForm = new FormData();
  multipartForm.append("field1", "value1");
  multipartForm.append("file", new File(["content"], "test.txt"));
  fetch("https://example.com", { body: multipartForm });
}
{
  const searchParams = new URLSearchParams();
  searchParams.append("key1", "value1");
  searchParams.append("key2", "value2");
  fetch("https://example.com", { body: searchParams });
}
{
  fetch("https://example.com", { body: new SharedArrayBuffer(16) });
}

{
  fetch("https://example.com", { body: new Float32Array([1.1, 2.2, 3.3]) });
  fetch("https://example.com", { body: new Float64Array([1.1, 2.2, 3.3]) });
  fetch("https://example.com", { body: new Int8Array([-128, 0, 127]) });
  fetch("https://example.com", { body: new Uint16Array([0, 32768, 65535]) });
  fetch("https://example.com", { body: new BigInt64Array([BigInt(1), BigInt(2)]) });
  fetch("https://example.com", { body: new BigUint64Array([BigInt(1), BigInt(2)]) });
}

{
  const textStream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("chunk1");
      controller.enqueue("chunk2");
      controller.close();
    },
  });
  fetch("https://example.com", { body: textStream });
}

{
  const byteStream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  });
  fetch("https://example.com", { body: byteStream });
}

{
  async function notGenerator() {
    return "not a generator";
  }
  // @ts-expect-error - Invalid async without generator
  fetch("https://example.com", { body: notGenerator() });
}

{
  const invalidIterable = {
    notAnIterator() {
      return "invalid";
    },
  };
  // @ts-expect-error - Invalid object without proper iterator
  fetch("https://example.com", { body: invalidIterable });
}

if (typeof process !== "undefined") {
  // @ts-expect-error - Node.js specific invalid types
  fetch("https://example.com", { body: process });
}

{
  // @ts-expect-error - Invalid number array (not typed)
  fetch("https://example.com", { body: [1, 2, 3, 4] });
}

{
  // @ts-expect-error - Invalid nested structure
  fetch("https://example.com", { body: { nested: { object: { structure: "invalid" } } } });
}

{
  // @ts-expect-error - NaN
  fetch("https://example.com", { body: NaN });
}

{
  // @ts-expect-error - Infinity
  fetch("https://example.com", { body: Infinity });
}

{
  // @ts-expect-error - -Infinity
  fetch("https://example.com", { body: -Infinity });
}

// Proxy option types
{
  // String proxy URL is valid
  fetch("https://example.com", { proxy: "http://proxy.example.com:8080" });
  fetch("https://example.com", { proxy: "https://user:pass@proxy.example.com:8080" });
}

{
  // Object proxy with url is valid
  fetch("https://example.com", {
    proxy: {
      url: "http://proxy.example.com:8080",
    },
  });
}

{
  // Object proxy with url and headers (plain object) is valid
  fetch("https://example.com", {
    proxy: {
      url: "http://proxy.example.com:8080",
      headers: {
        "Proxy-Authorization": "Bearer token",
        "X-Custom-Header": "value",
      },
    },
  });
}

{
  // Object proxy with url and headers (Headers instance) is valid
  fetch("https://example.com", {
    proxy: {
      url: "http://proxy.example.com:8080",
      headers: new Headers({ "Proxy-Authorization": "Bearer token" }),
    },
  });
}

{
  // Object proxy with url and headers (array of tuples) is valid
  fetch("https://example.com", {
    proxy: {
      url: "http://proxy.example.com:8080",
      headers: [
        ["Proxy-Authorization", "Bearer token"],
        ["X-Custom", "value"],
      ],
    },
  });
}

{
  // @ts-expect-error - Proxy object without url is invalid
  fetch("https://example.com", { proxy: { headers: { "X-Custom": "value" } } });
}

{
  // @ts-expect-error - Proxy url must be string, not number
  fetch("https://example.com", { proxy: { url: 8080 } });
}

{
  // @ts-expect-error - Proxy must be string or object, not number
  fetch("https://example.com", { proxy: 8080 });
}

{
  // @ts-expect-error - Proxy must be string or object, not boolean
  fetch("https://example.com", { proxy: true });
}

{
  // @ts-expect-error - Proxy must be string or object, not array
  fetch("https://example.com", { proxy: ["http://proxy.example.com"] });
}
