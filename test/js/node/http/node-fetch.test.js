import * as vercelFetch from "@vercel/fetch";
import * as iso from "isomorphic-fetch";
import fetch2, { fetch, Headers, Request, Response } from "node-fetch";
import * as stream from "stream";

import { afterEach, describe, expect, test } from "bun:test";

const originalResponse = globalThis.Response;
const originalRequest = globalThis.Request;
const originalHeaders = globalThis.Headers;
afterEach(() => {
  globalThis.Response = originalResponse;
  globalThis.Request = originalRequest;
  globalThis.Headers = originalHeaders;
  globalThis.fetch = Bun.fetch;
});

test("node-fetch", () => {
  expect(Response.prototype).toBeInstanceOf(globalThis.Response);
  expect(Request.prototype).toBeInstanceOf(globalThis.Request);
  expect(Headers.prototype).toBeInstanceOf(globalThis.Headers);
  expect(fetch2.default).toBe(fetch2);
  expect(fetch2.Response).toBe(Response);
});

test("node-fetch Headers.raw()", () => {
  const headers = new Headers({ "a": "1" });
  headers.append("Set-Cookie", "b=1");
  headers.append("Set-Cookie", "c=1");

  expect(headers.raw()).toEqual({
    "set-cookie": ["b=1", "c=1"],
    "a": ["1"],
  });
});

for (const [impl, name] of [
  [fetch, "node-fetch.fetch"],
  [fetch2, "node-fetch.default"],
  [fetch2.default, "node-fetch.default.default"],
  [iso.fetch, "isomorphic-fetch.fetch"],
  [iso.default.fetch, "isomorphic-fetch.default.fetch"],
  [iso.default, "isomorphic-fetch.default"],
  [vercelFetch.default(fetch), "@vercel/fetch.default"],
]) {
  test(name + " fetches", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.stop();
        return new Response("it works");
      },
    });
    expect(await impl("http://" + server.hostname + ":" + server.port)).toBeInstanceOf(globalThis.Response);
  });
}

test("node-fetch uses node streams instead of web streams", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req, server) {
      const body = await req.text();
      expect(body).toBe("the input text");
      return new Response("hello world");
    },
  });

  {
    const result = await fetch2("http://" + server.hostname + ":" + server.port, {
      body: new stream.Readable({
        read() {
          this.push("the input text");
          this.push(null);
        },
      }),
      method: "POST",
    });
    expect(result.body).toBeInstanceOf(stream.Readable);
    expect(result.body === result.body).toBe(true); // cached lazy getter
    const headersJSON = result.headers.toJSON();
    for (const key of Object.keys(headersJSON)) {
      const value = headersJSON[key];
      headersJSON[key] = Array.isArray(value) ? value : [value];
    }
    expect(result.headers.raw()).toEqual(headersJSON);
    const chunks = [];
    for await (const chunk of result.body) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe("hello world");
  }
});

test("node-fetch request body streams properly", async () => {
  let responseResolve;
  const responsePromise = new Promise(resolve => {
    responseResolve = resolve;
  });

  let receivedChunks = [];
  let requestBodyComplete = false;

  using server = Bun.serve({
    port: 0,
    async fetch(req, server) {
      const reader = req.body.getReader();

      // Read first chunk
      const { value: firstChunk } = await reader.read();
      receivedChunks.push(firstChunk);

      // Signal that response can be sent
      responseResolve();

      // Continue reading remaining chunks
      let result;
      while (!(result = await reader.read()).done) {
        receivedChunks.push(result.value);
      }

      requestBodyComplete = true;
      return new Response("response sent");
    },
  });

  const requestBody = new stream.Readable({
    read() {
      // Will be controlled manually
    },
  });

  // Start the fetch request
  const fetchPromise = fetch2(server.url.href, {
    body: requestBody,
    method: "POST",
  });

  // Send first chunk
  requestBody.push("first chunk");

  // Wait for response to be available (server has read first chunk)
  await responsePromise;

  // Response is available, but request body should still be streaming
  expect(requestBodyComplete).toBe(false);

  // Send more data after response is available
  requestBody.push("second chunk");
  requestBody.push("third chunk");
  requestBody.push(null); // End the stream

  // Now wait for the fetch to complete
  const result = await fetchPromise;
  expect(await result.text()).toBe("response sent");

  // Verify all chunks were received
  const allData = Buffer.concat(receivedChunks).toString();
  expect(allData).toBe("first chunksecond chunkthird chunk");
  expect(requestBodyComplete).toBe(true);
});

// https://github.com/oven-sh/bun/issues/14481
// https://github.com/oven-sh/bun/issues/13390
describe("node-fetch Response accepts legacy Stream bodies", () => {
  // Minimal stand-in for minipass / minipass-pipeline: extends the legacy Stream base
  // class, implements pipe() and Symbol.asyncIterator, but has no _readableState.
  class MinipassLike extends stream.Stream {
    #chunks;
    constructor(chunks) {
      super();
      this.#chunks = chunks;
    }
    pipe(dest) {
      for (const chunk of this.#chunks) dest.write(chunk);
      dest.end();
      return dest;
    }
    async *[Symbol.asyncIterator]() {
      for (const chunk of this.#chunks) yield chunk;
    }
  }

  // Minimal stand-in for combined-stream: extends the legacy Stream base class and
  // implements pipe(), but provides neither _readableState nor Symbol.asyncIterator.
  class LegacyStream extends stream.Stream {
    #chunks;
    constructor(chunks) {
      super();
      this.#chunks = chunks;
    }
    pipe(dest) {
      for (const chunk of this.#chunks) dest.write(chunk);
      dest.end();
      return dest;
    }
  }

  test("minipass-style stream (async iterable, no _readableState)", async () => {
    const body = new MinipassLike([Buffer.from("hello "), Buffer.from("world")]);
    expect(body instanceof stream.Stream).toBe(true);
    expect(body instanceof stream.Readable).toBe(false);
    expect(typeof body._readableState).toBe("undefined");
    expect(typeof body[Symbol.asyncIterator]).toBe("function");

    const res = new Response(body);
    expect(await res.text()).toBe("hello world");
  });

  test("legacy stream (pipe only, no async iterator)", async () => {
    const body = new LegacyStream([Buffer.from("abc"), Buffer.from("def")]);
    expect(body instanceof stream.Stream).toBe(true);
    expect(typeof body._readableState).toBe("undefined");
    expect(body[Symbol.asyncIterator]).toBeUndefined();

    const res = new Response(body);
    expect(await res.text()).toBe("abcdef");
  });

  test("proper Readable body still works", async () => {
    const body = stream.Readable.from([Buffer.from("proper "), Buffer.from("readable")]);
    expect(typeof body._readableState).toBe("object");

    const res = new Response(body);
    expect(await res.text()).toBe("proper readable");
  });
});
