import * as vercelFetch from "@vercel/fetch";
import * as iso from "isomorphic-fetch";
import fetch2, { fetch, Headers, Request, Response } from "node-fetch";
import assert from "node:assert";
import { constants, createPrivateKey } from "node:crypto";
import { once } from "node:events";
import { createReadStream, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import * as stream from "stream";

import { afterEach, describe, expect, test } from "bun:test";
import { tempDir, tls as tlsCert } from "harness";

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

// node-fetch pipes every network response into a stream, so a response without
// a body (204, HEAD) still has a stream body that ends at once, while a Response
// constructed with a null body has `body === null`.
test("node-fetch gives a fetched response without a body an empty stream", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/204") return new Response(null, { status: 204 });
      return new Response("hello world");
    },
  });
  const webBody = Object.getOwnPropertyDescriptor(originalResponse.prototype, "body").get;

  for (const [path, init, status] of [
    ["/204", {}, 204],
    ["/", { method: "HEAD" }, 200],
  ]) {
    const result = await fetch2(new URL(path, server.url), init);
    expect(result.status).toBe(status);
    expect(webBody.call(result)).toBeNull();
    const body = result.body;
    expect(body).toBeInstanceOf(stream.Readable);
    expect(result.body).toBe(body); // cached lazy getter
    expect(result.clone().body).toBeInstanceOf(stream.Readable);
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
    expect(await result.text()).toBe("");
  }

  expect(new Response(null, { status: 204 }).body).toBeNull();
  expect(new Response(null, { status: 204 }).clone().body).toBeNull();
});

// Starts `body` with `start` and resolves with what it emits until "close".
function eventsUntilClose(body, start) {
  const events = [];
  const { promise, resolve } = Promise.withResolvers();
  body.on("end", () => events.push("end"));
  body.on("error", error => events.push(error));
  body.on("close", () => {
    events.push("close");
    resolve(events);
  });
  start();
  return promise;
}

// Serves "first ", then "second" once `secondChunk` resolves.
function serveTwoChunks(secondChunk) {
  return Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first "));
            await secondChunk;
            controller.enqueue(new TextEncoder().encode("second"));
            controller.close();
          },
        }),
      );
    },
  });
}

const bodyActions = [
  ["resume", ["end", "close"]],
  ["destroy", ["close"]],
];

// A body method reads the web stream under `res.body` and keeps it locked. Nothing is
// left for the node stream, so it ends, as the already-read stream of node-fetch does.
test.each(["arrayBuffer", "blob", "buffer", "bytes", "formData", "json", "text"])(
  "node-fetch body stream ends without an error after %s() consumed the response",
  async method => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/formData") {
          return new Response("a=1", { headers: { "content-type": "application/x-www-form-urlencoded" } });
        }
        return Response.json({ a: 1 });
      },
    });
    const url = new URL(method, server.url);

    for (const [action, expected] of bodyActions) {
      const res = await fetch2(url);
      const body = res.body;
      await res[method]();
      expect(await eventsUntilClose(body, () => body[action]())).toEqual(expected);
    }
    {
      // `body` is read for the first time after the body method.
      const res = await fetch2(url);
      await res[method]();
      expect(await Array.fromAsync(res.body)).toEqual([]);
    }
  },
);

test.each(bodyActions)(
  "node-fetch body.%s() leaves a body method that is still reading alone",
  async (action, expected) => {
    const secondChunk = Promise.withResolvers();
    using server = serveTwoChunks(secondChunk.promise);

    const res = await fetch2(server.url);
    const body = res.body;
    const text = res.text();
    const events = await eventsUntilClose(body, () => body[action]());
    secondChunk.resolve();
    expect({ events, text: await text }).toEqual({ events: expected, text: "first second" });
  },
);

// A body method that rejects still took the stream.
test.each(bodyActions)(
  "node-fetch body.%s() after an aborted text() does not emit an error",
  async (action, expected) => {
    const secondChunk = Promise.withResolvers();
    using server = serveTwoChunks(secondChunk.promise);
    const controller = new AbortController();

    const res = await fetch2(server.url, { signal: controller.signal });
    const body = res.body;
    const text = res.text().then(
      () => "resolved",
      error => error.name,
    );
    controller.abort();
    const outcome = await text;
    const events = await eventsUntilClose(body, () => body[action]());
    secondChunk.resolve();
    expect({ outcome, events }).toEqual({ outcome: "AbortError", events: expected });
  },
);

test.each(bodyActions)(
  "node-fetch body.%s() after formData() rejected the content type does not emit an error",
  async (action, expected) => {
    using server = Bun.serve({ port: 0, fetch: () => Response.json({ a: 1 }) });

    const res = await fetch2(server.url);
    const body = res.body;
    const outcome = await res.formData().then(
      () => "resolved",
      error => error.name,
    );
    const events = await eventsUntilClose(body, () => body[action]());
    expect({ outcome, events }).toEqual({ outcome: "TypeError", events: expected });
  },
);

// The lock that the node stream takes itself must not end it.
test("node-fetch body stream delivers every chunk of a streamed response", async () => {
  const secondChunk = Promise.withResolvers();
  using server = serveTwoChunks(secondChunk.promise);

  const res = await fetch2(server.url);
  const chunks = [];
  for await (const chunk of res.body) {
    chunks.push(chunk.toString());
    secondChunk.resolve();
  }
  expect(chunks.join("")).toBe("first second");
});

// clone() moves the body to a new web stream. As in node-fetch, `body` is a new node stream then.
test("node-fetch body taken before clone() does not break the body after clone()", async () => {
  using server = Bun.serve({ port: 0, fetch: () => new Response("hello world") });

  const res = await fetch2(server.url);
  const before = res.body;
  const cloned = res.clone();
  expect(res.body).not.toBe(before);
  expect({
    original: Buffer.concat(await Array.fromAsync(res.body)).toString(),
    clone: Buffer.concat(await Array.fromAsync(cloned.body)).toString(),
  }).toEqual({ original: "hello world", clone: "hello world" });
});

// node-fetch's json() is JSON.parse(await this.text()), so a body with nothing to parse rejects.
test.each([
  ["a body with Content-Length: 0", "/empty"],
  ["an empty chunked body", "/chunked"],
  ["a 204", "/204"],
])("node-fetch json() rejects on %s like JSON.parse('')", async (_, path) => {
  // node:http sends an empty chunked body as such. Bun.serve turns it into Content-Length: 0.
  await using server = http.createServer((req, res) => {
    if (req.url === "/chunked") res.setHeader("transfer-encoding", "chunked");
    else if (req.url === "/204") res.statusCode = 204;
    else res.setHeader("content-length", "0");
    res.end();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const url = `http://127.0.0.1:${server.address().port}${path}`;
  const outcome = promise =>
    promise.then(
      value => ({ value }),
      ({ name, message }) => ({ name, message }),
    );
  const expected = await outcome(Promise.try(JSON.parse, ""));
  expect(expected.name).toBe("SyntaxError");

  expect({
    json: await outcome(fetch2(url).then(res => res.json())),
    // The outcome does not depend on whether `body` was read before.
    bodyThenJson: await outcome(fetch2(url).then(res => (void res.body, res.json()))),
    cloneJson: await outcome(fetch2(url).then(res => res.clone().json())),
  }).toEqual({ json: expected, bodyThenJson: expected, cloneJson: expected });
});

test("node-fetch Response accepts an old-style Stream body", async () => {
  const legacy = new stream.Stream();
  const response = new Response(legacy);
  const text = response.text();
  legacy.emit("data", Buffer.from("hello "));
  legacy.emit("data", Buffer.from("world"));
  legacy.emit("end");
  expect(await text).toBe("hello world");
});

// Not expect(promise).rejects: it blocks on a promise that stays pending, so the test cannot time out (#14950).
test.each([true, false])(
  "node-fetch Response rejects the body read when an old-style Stream body fails (own error listener: %p)",
  async ownListener => {
    const legacy = new stream.Stream();
    // Without a listener of its own, the source throws out of emit("error") unless the body handles the error.
    if (ownListener) legacy.on("error", () => {});
    const response = new Response(legacy);
    const text = response.text();
    legacy.emit("data", Buffer.from("hello "));
    const error = new Error("integrity check failed");
    legacy.emit("error", error);
    expect(await text.catch(e => e)).toBe(error);
  },
);

test("node-fetch Response rejects the body read when an old-style Stream body failed before the read", async () => {
  const legacy = new stream.Stream();
  const response = new Response(legacy);
  const error = new Error("integrity check failed");
  legacy.emit("error", error);
  expect(await response.text().catch(e => e)).toBe(error);
});

test.each([true, false])(
  "node-fetch Response keeps a complete old-style Stream body when the source fails after its end (own error listener: %p)",
  async ownListener => {
    const legacy = new stream.Stream();
    if (ownListener) legacy.on("error", () => {});
    const response = new Response(legacy);
    legacy.emit("data", Buffer.from("hello world"));
    legacy.emit("end");
    legacy.emit("error", new Error("close failed"));
    expect(await response.text()).toBe("hello world");
  },
);

test("node-fetch Response body stream emits the error of an old-style Stream body", async () => {
  const legacy = new stream.Stream();
  const { body } = new Response(legacy);
  const failed = once(body, "error");
  body.resume();
  const error = new Error("integrity check failed");
  legacy.emit("error", error);
  expect((await failed)[0]).toBe(error);
});

const discard = () => new stream.Writable({ write: (chunk, encoding, callback) => callback() });

test("node-fetch Response rejects the body read for a Writable body", async () => {
  const response = new Response(discard());
  expect(await response.text().catch(e => e.code)).toBe("ERR_STREAM_CANNOT_PIPE");
});

function serveRequestBody() {
  return Bun.serve({ port: 0, fetch: async req => new Response(await req.text().catch(() => "aborted")) });
}

test.each([true, false])(
  "node-fetch fetch() rejects when an old-style Stream request body fails (own error listener: %p)",
  async ownListener => {
    using server = serveRequestBody();
    const legacy = new stream.Stream();
    if (ownListener) legacy.on("error", () => {});
    const response = fetch2(server.url, { method: "POST", body: legacy });
    legacy.emit("data", Buffer.from("hello "));
    const error = new Error("upload failed");
    legacy.emit("error", error);
    expect(await response.catch(e => e)).toBe(error);
  },
);

test.each([true, false])(
  "node-fetch fetch() sends a complete old-style Stream request body when the source fails after its end (own error listener: %p)",
  async ownListener => {
    using server = serveRequestBody();
    const legacy = new stream.Stream();
    if (ownListener) legacy.on("error", () => {});
    const response = fetch2(server.url, { method: "POST", body: legacy });
    legacy.emit("data", Buffer.from("hello world"));
    legacy.emit("end");
    legacy.emit("error", new Error("close failed"));
    expect(await (await response).text()).toBe("hello world");
  },
);

test("node-fetch fetch() rejects for a Writable request body", async () => {
  using server = serveRequestBody();
  const response = fetch2(server.url, { method: "POST", body: discard() });
  expect(await response.catch(e => e.code)).toBe("ERR_STREAM_CANNOT_PIPE");
});

test("node-fetch json() resolves null for a body that is the JSON text null", async () => {
  using server = Bun.serve({ port: 0, fetch: () => new Response("null") });
  expect(await (await fetch2(server.url)).json()).toBeNull();
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

// node-fetch pipes a stream body into the request inside fetch(), so a "data" listener that the caller
// attaches right after the call (eas-cli does this for upload progress) shares every chunk with the
// request. A request that reads the stream only once the connection is ready gets nothing.
// https://github.com/oven-sh/bun/issues/47865
describe("node-fetch fetch() subscribes to a stream body inside the call", () => {
  test.each([true, false])(
    "a 'data' listener attached after the call drains nothing (Content-Length: %p)",
    async declared => {
      using server = serveRequestBody();
      const body = new stream.Readable({ read() {} });
      const headers = declared ? { "Content-Length": "11" } : {};
      const response = fetch2(server.url, { method: "POST", body, headers });
      const seen = [];
      body.on("data", chunk => seen.push(chunk.toString()));
      body.push("hello ");
      body.push("world");
      body.push(null);
      expect(await (await response).text()).toBe("hello world");
      expect(seen.join("")).toBe("hello world");
    },
  );

  // Several high water marks, so the request pauses and resumes the file stream more than once.
  test.each(["PUT", "put"])(
    "an fs.ReadStream body with a progress listener arrives in full over TLS (%s)",
    async method => {
      const size = 8 * 64 * 1024;
      using dir = tempDir("node-fetch-upload", { "blob.bin": Buffer.alloc(size, 7) });
      using server = Bun.serve({
        port: 0,
        tls: tlsCert,
        fetch: async req => new Response(String((await req.arrayBuffer()).byteLength)),
      });
      const body = createReadStream(path.join(String(dir), "blob.bin"));
      const response = fetch2(server.url, {
        method,
        body,
        headers: { "Content-Length": String(size) },
        tls: { rejectUnauthorized: false },
      });
      let progress = 0;
      let chunks = 0;
      body.on("data", chunk => {
        progress += chunk.length;
        chunks++;
      });
      expect(await (await response).text()).toBe(String(size));
      expect(progress).toBe(size);
      expect(chunks).toBeGreaterThan(1);
    },
  );

  // node-fetch takes the method from the Request when init has none, and sends the body of a Request.
  test("the body and the method can come from a Request", async () => {
    using server = Bun.serve({ port: 0, fetch: async req => new Response(`${req.method}:${await req.text()}`) });
    const fromInit = new stream.Readable({ read() {} });
    const fromRequest = new stream.Readable({ read() {} });
    const headers = { "Content-Length": "11" };
    const responses = [
      fetch2(new Request(server.url, { method: "PUT" }), { body: fromInit, headers }),
      fetch2(new Request(server.url, { method: "PATCH", body: fromRequest, headers })),
    ];
    const seen = [];
    for (const body of [fromInit, fromRequest]) {
      body.on("data", chunk => seen.push(chunk.toString()));
      body.push("hello ");
      body.push("world");
      body.push(null);
    }
    const texts = await Promise.all(responses.map(async response => (await response).text()));
    expect(texts).toEqual(["PUT:hello world", "PATCH:hello world"]);
    expect(seen.join("")).toBe("hello worldhello world");
  });

  // The native fetch rejects a Request whose body stream was used by an earlier fetch() the same way.
  test("a second fetch() of a Request with a stream body rejects", async () => {
    using server = serveRequestBody();
    const body = new stream.Readable({ read() {} });
    const request = new Request(server.url, { method: "POST", body });
    const first = fetch2(request);
    body.push("hello world");
    body.push(null);
    expect(await (await first).text()).toBe("hello world");
    expect(await fetch2(request).catch(e => e.message)).toBe("Body object should not be disturbed or locked");
  });

  test("a setEncoding() body sends its bytes", async () => {
    using server = serveRequestBody();
    const body = new stream.Readable({ read() {} });
    body.setEncoding("utf8");
    const response = fetch2(server.url, { method: "POST", body });
    body.on("data", () => {});
    body.push("héllo ");
    body.push("wörld");
    body.push(null);
    expect(await (await response).text()).toBe("héllo wörld");
  });

  test("an objectMode body sends its string chunks", async () => {
    using server = serveRequestBody();
    const body = stream.Readable.from(["ab", "cd"]);
    const response = fetch2(server.url, { method: "POST", body });
    const seen = [];
    body.on("data", chunk => seen.push(chunk));
    expect(await (await response).text()).toBe("abcd");
    expect(seen).toEqual(["ab", "cd"]);
  });

  test("an objectMode body with an object chunk rejects", async () => {
    using server = serveRequestBody();
    const response = fetch2(server.url, { method: "POST", body: stream.Readable.from([{ a: 1 }]) });
    expect(await response.catch(e => e.constructor.name)).toBe("TypeError");
  });

  // minipass 3 to 5 (tar, fs-minipass): a Stream that is not a Readable, with Symbol.asyncIterator, that buffers
  // its writes until the first "data" listener and then hands every chunk to the listeners only.
  class BufferedLegacyStream extends stream.Stream {
    buffered = [];
    flowing = false;
    ended = false;
    write(chunk) {
      if (this.flowing) this.emit("data", chunk);
      else this.buffered.push(chunk);
      return true;
    }
    end() {
      this.ended = true;
      if (this.flowing) this.emit("end");
    }
    on(event, listener) {
      super.on(event, listener);
      if (event === "data" && !this.flowing) {
        this.flowing = true;
        for (const chunk of this.buffered.splice(0)) this.emit("data", chunk);
        if (this.ended) this.emit("end");
      } else if (event === "end" && this.ended && this.flowing) {
        listener();
      }
      return this;
    }
    async *[Symbol.asyncIterator]() {
      const chunks = [];
      let done = false;
      let wake;
      this.on("data", chunk => {
        chunks.push(chunk);
        wake?.();
      });
      this.on("end", () => {
        done = true;
        wake?.();
      });
      while (true) {
        if (chunks.length) yield chunks.shift();
        else if (done) return;
        else await new Promise(resolve => (wake = resolve));
      }
    }
  }

  test("a legacy Stream with Symbol.asyncIterator sends its bytes to the request and to a later listener", async () => {
    using server = serveRequestBody();
    const body = new BufferedLegacyStream();
    const response = fetch2(server.url, { method: "POST", body });
    const seen = [];
    body.on("data", chunk => seen.push(chunk.toString()));
    body.write(Buffer.from("hello "));
    body.write(Buffer.from("world"));
    body.end();
    expect(await (await response).text()).toBe("hello world");
    expect(seen.join("")).toBe("hello world");
  });

  test.each([true, false])(
    "a Readable body that fails after the call rejects (own error listener: %p)",
    async ownListener => {
      using server = serveRequestBody();
      const body = new stream.Readable({ read() {} });
      if (ownListener) body.on("error", () => {});
      const response = fetch2(server.url, { method: "POST", body });
      body.push("hello ");
      const error = new Error("upload failed");
      body.destroy(error);
      expect(await response.catch(e => e)).toBe(error);
    },
  );

  test("an fs.ReadStream body that cannot open rejects", async () => {
    using server = serveRequestBody();
    using dir = tempDir("node-fetch-missing", {});
    const response = fetch2(server.url, { method: "POST", body: createReadStream(path.join(String(dir), "missing")) });
    expect(await response.catch(e => e.code)).toBe("ENOENT");
  });

  // node-fetch destroys the body with the AbortError: https://github.com/node-fetch/node-fetch/blob/v2.7.0/src/index.js#L80-L92
  test("an abort after the call destroys the body with the AbortError", async () => {
    using server = serveRequestBody();
    const controller = new AbortController();
    const body = new stream.Readable({ read() {} });
    const response = fetch2(server.url, { method: "POST", body, signal: controller.signal });
    body.push("hello");
    const failed = new Promise(resolve => body.once("error", resolve));
    controller.abort();
    expect(await response.catch(e => e.name)).toBe("AbortError");
    expect((await failed).name).toBe("AbortError");
    expect(body.destroyed).toBe(true);
  });

  test.each([undefined, "HEAD", "head"])(
    "a request with a stream body and method %s rejects and leaves the stream alone",
    async method => {
      using server = serveRequestBody();
      const body = new stream.Readable({ read() {} });
      const response = fetch2(server.url, { method, body });
      expect(await response.catch(e => e.constructor.name)).toBe("TypeError");
      expect(body.listenerCount("data")).toBe(0);
    },
  );

  test("the bytes read before the connection is ready stay within the high water mark", async () => {
    // A server that accepts but never answers the TLS handshake: the request never pulls its body.
    const sockets = [];
    const server = net.createServer(socket => sockets.push(socket.on("error", () => {})));
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      let reads = 0;
      const body = new stream.Readable({
        highWaterMark: 64 * 1024,
        read() {
          reads++;
          setImmediate(() => this.push(Buffer.alloc(16 * 1024)));
        },
      });
      const response = fetch2(`https://127.0.0.1:${server.address().port}/`, { method: "POST", body });
      response.catch(() => {});
      // The web stream queues one high water mark, then the Readable fills its own buffer and stops.
      const limit = 2 * 4 + 1;
      const deadline = Date.now() + 2000;
      while (body.readableLength < body.readableHighWaterMark && reads <= limit && Date.now() < deadline) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(reads).toBeLessThanOrEqual(limit);
      expect(body.readableLength).toBe(body.readableHighWaterMark);
      expect(body.isPaused()).toBe(true);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    }
  });
});

// node-fetch's Response accepts a stream that emits strings, as an http.IncomingMessage with setEncoding() does.
test("node-fetch Response reads a setEncoding() body", async () => {
  const body = new stream.Readable({ read() {} });
  body.setEncoding("utf8");
  const response = new Response(body);
  body.push("héllo");
  body.push(null);
  // The web stream pulls the chunks before a reader is attached.
  await once(body, "end");
  expect(await response.text()).toBe("héllo");
});

// @kubernetes/client-node passes an https.Agent (with ca/cert/key) to node-fetch: https://github.com/oven-sh/bun/issues/19754
// The verdicts are those of Node.js v26.3.0 with node-fetch 2.6.13 and 3.3.2, but where a comment says what Node does.
describe("node-fetch applies the TLS options of the agent", () => {
  const read = name => readFileSync(path.join(import.meta.dirname, "..", "test", "fixtures", "keys", name));
  // ca1 signs agent1, ca2 signs agent3. No certificate has a SAN, so clients verify CN under `servername`.
  const ca = read("ca1-cert.pem");
  const key = read("agent1-key.pem");
  const cert = read("agent1-cert.pem");
  const servername = "agent1";

  async function serve(options = { key, cert }) {
    const server = https.createServer(options, (req, res) => {
      res.writeHead(200, { connection: "close" });
      res.end(`authorized=${req.socket.authorized}`);
    });
    server.on("tlsClientError", () => {});
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      port: server.address().port,
      async [Symbol.asyncDispose]() {
        server.close();
        await once(server, "close");
      },
    };
  }

  /** Answers each request with the protocol version and the cipher of its connection. */
  async function serveNegotiated(options) {
    const server = tls.createServer({ key, cert, ...options }, socket => {
      socket.on("error", () => {});
      socket.once("data", () => {
        const body = `${socket.getProtocol()} ${socket.getCipher().name}`;
        socket.end(`HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
      });
    });
    server.on("tlsClientError", () => {});
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      port: server.address().port,
      async [Symbol.asyncDispose]() {
        server.close();
        await once(server, "close");
      },
    };
  }

  /** The response body, or the code of the rejection. */
  async function outcome(port, options, init) {
    const agent = typeof options === "function" || options instanceof https.Agent ? options : new https.Agent(options);
    try {
      return await (await fetch2(`https://127.0.0.1:${port}/`, { agent, ...init })).text();
    } catch (err) {
      return String(err.code);
    } finally {
      if (typeof agent !== "function") agent.destroy();
    }
  }

  test("ca and servername", async () => {
    await using server = await serve();
    assert.strictEqual(await outcome(server.port, { ca, servername }), "authorized=false");
    assert.strictEqual(await outcome(server.port, { ca, servername, dhparam: "auto" }), "authorized=false");
    assert.strictEqual(await outcome(server.port, { ca }), "ERR_TLS_CERT_ALTNAME_INVALID");
    assert.strictEqual(await outcome(server.port, { servername }), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  test("the client identity, in every form", async () => {
    await using server = await serve({ key, cert, ca, requestCert: true, rejectUnauthorized: false });
    const trust = { ca, servername };
    const encryptedKey = createPrivateKey(key).export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: "sample",
    });
    assert.deepStrictEqual(
      {
        none: await outcome(server.port, trust),
        pem: await outcome(server.port, { ...trust, cert, key }),
        pemObject: await outcome(server.port, { ...trust, cert, key: [{ pem: key }] }),
        encrypted: await outcome(server.port, {
          ...trust,
          cert,
          key: encryptedKey,
          passphrase: "sample",
        }),
        pfx: await outcome(server.port, { ...trust, pfx: read("agent1.pfx"), passphrase: "sample" }),
        pfxObject: await outcome(server.port, { ...trust, pfx: [{ buf: read("agent1.pfx"), passphrase: "sample" }] }),
      },
      {
        none: "authorized=false",
        pem: "authorized=true",
        pemObject: "authorized=true",
        encrypted: "authorized=true",
        pfx: "authorized=true",
        pfxObject: "authorized=true",
      },
    );
  });

  test("rejectUnauthorized disables verification only when it is false", async () => {
    await using server = await serve();
    assert.strictEqual(await outcome(server.port, { rejectUnauthorized: false }), "authorized=false");
    for (const rejectUnauthorized of [0, null, "false", undefined, true]) {
      assert.strictEqual(await outcome(server.port, { rejectUnauthorized }), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    }
    // Node reads both through the prototype chain.
    const off = new https.Agent({ rejectUnauthorized: false });
    assert.strictEqual(await outcome(server.port, Object.create(off)), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    await assert.rejects(fetch2(`https://127.0.0.1:${server.port}/`, Object.create({ agent: off })), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    const tls = { rejectUnauthorized: true };
    assert.strictEqual(
      await outcome(server.port, { rejectUnauthorized: false }, { tls }),
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    );
  });

  test("crl", async () => {
    await using server = await serve({ key: read("agent3-key.pem"), cert: read("agent3-cert.pem") });
    const trust = { ca: read("ca2-cert.pem"), servername: "agent3" };
    // ca2-crl.pem revokes agent4 only.
    assert.strictEqual(await outcome(server.port, { ...trust, crl: read("ca2-crl.pem") }), "authorized=false");
    assert.strictEqual(await outcome(server.port, { ...trust, crl: read("ca2-crl-agent3.pem") }), "CERT_REVOKED");
  });

  test("checkServerIdentity", async () => {
    await using server = await serve();
    const seen = [];
    function accept(hostname, peer) {
      seen.push(hostname, peer.subject.CN);
      return undefined;
    }
    function refuse() {
      return Object.assign(new Error("not the pinned certificate"), { code: "ERR_TEST_PIN" });
    }
    assert.strictEqual(await outcome(server.port, { ca, checkServerIdentity: accept }), "authorized=false");
    assert.deepStrictEqual(seen, ["127.0.0.1", "agent1"]);
    assert.strictEqual(await outcome(server.port, { ca, servername, checkServerIdentity: refuse }), "ERR_TEST_PIN");
  });

  test("minVersion and maxVersion", async () => {
    await using server = await serve({ key, cert, minVersion: "TLSv1.3" });
    const trust = { ca, servername };
    assert.strictEqual(await outcome(server.port, { ...trust, minVersion: "TLSv1.2" }), "authorized=false");
    // Node reports the alert as EPROTO.
    assert.match(await outcome(server.port, { ...trust, maxVersion: "TLSv1.2" }), /EPROTO|PROTOCOL_VERSION/);
    assert.strictEqual(
      await outcome(server.port, { ...trust, minVersion: "TLSv9" }),
      "ERR_TLS_INVALID_PROTOCOL_VERSION",
    );
  });

  test("allowPartialTrustChain", async () => {
    // ca1 signs ca3, ca3 signs agent6. The server sends agent6 and ca3.
    await using server = await serve({ key: read("agent6-key.pem"), cert: read("agent6-cert.pem") });
    const trust = { ca: read("ca3-cert.pem"), checkServerIdentity: () => undefined };
    assert.strictEqual(await outcome(server.port, { ...trust, allowPartialTrustChain: true }), "authorized=false");
    assert.strictEqual(await outcome(server.port, trust), "UNABLE_TO_GET_ISSUER_CERT");
    // Node takes any truthy value.
    assert.strictEqual(
      await outcome(server.port, { ...trust, allowPartialTrustChain: 1 }),
      "UNABLE_TO_GET_ISSUER_CERT",
    );
  });

  test("ciphers, sigalgs, ecdhCurve and secureOptions", async () => {
    const trust = { ca, servername };
    const refused = /EPROTO|HANDSHAKE_FAILURE|PROTOCOL_VERSION|NO_PROTOCOLS_AVAILABLE/;
    await using aes256 = await serve({ key, cert, maxVersion: "TLSv1.2", ciphers: "ECDHE-RSA-AES256-GCM-SHA384" });
    await using sha512 = await serve({ key, cert, sigalgs: "rsa_pss_rsae_sha512" });
    await using p384 = await serve({ key, cert, ecdhCurve: "P-384" });
    await using tls13 = await serve({ key, cert, minVersion: "TLSv1.3" });
    for (const [port, accepted, rejected] of [
      [aes256.port, { ciphers: "ECDHE-RSA-AES256-GCM-SHA384" }, { ciphers: "ECDHE-RSA-AES128-GCM-SHA256" }],
      [sha512.port, { sigalgs: "rsa_pss_rsae_sha512" }, { sigalgs: "rsa_pss_rsae_sha256" }],
      [p384.port, { ecdhCurve: "P-384" }, { ecdhCurve: "X25519" }],
      [tls13.port, { secureOptions: constants.SSL_OP_NO_TLSv1_2 }, { secureOptions: constants.SSL_OP_NO_TLSv1_3 }],
    ]) {
      assert.strictEqual(await outcome(port, { ...trust, ...accepted }), "authorized=false");
      assert.match(await outcome(port, { ...trust, ...rejected }), refused, JSON.stringify(rejected));
    }
  });

  test("ciphers that name TLS 1.3 suites", async () => {
    await using server = await serveNegotiated();
    await using tls12 = await serveNegotiated({ maxVersion: "TLSv1.2" });
    const trust = { ca, servername };
    const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
    const refused = /EPROTO|PROTOCOL_VERSION|NO_CIPHERS_AVAILABLE|NO_PROTOCOLS_AVAILABLE/;
    // BoringSSL has no list of TLS 1.3 suites to restrict, so only Node negotiates the one that is named.
    assert.match(await outcome(server.port, { ...trust, ciphers: "TLS_AES_256_GCM_SHA384" }), /^TLSv1\.3 /);
    assert.match(await outcome(tls12.port, { ...trust, ciphers: "TLS_AES_256_GCM_SHA384" }), refused);
    assert.match(
      await outcome(server.port, { ...trust, ciphers: "TLS_AES_256_GCM_SHA384", maxVersion: "TLSv1.2" }),
      refused,
    );
    assert.match(await outcome(server.port, { ...trust, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` }), /^TLSv1\.3 /);
    assert.strictEqual(
      await outcome(tls12.port, { ...trust, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` }),
      `TLSv1.2 ${aes256}`,
    );
    assert.match(await outcome(server.port, { ...trust, ciphers: aes256 }), /^TLSv1\.3 /);
    assert.strictEqual(await outcome(tls12.port, { ...trust, ciphers: aes256 }), `TLSv1.2 ${aes256}`);
  });

  test("ciphers with an OpenSSL security level", async () => {
    await using server = await serveNegotiated();
    await using tls12 = await serveNegotiated({ maxVersion: "TLSv1.2" });
    const trust = { ca, servername };
    const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
    assert.match(await outcome(server.port, { ...trust, ciphers: "DEFAULT@SECLEVEL=0" }), /^TLSv1\.3 /);
    assert.match(await outcome(server.port, { ...trust, ciphers: "DEFAULT:@SECLEVEL=1" }), /^TLSv1\.3 /);
    assert.strictEqual(await outcome(tls12.port, { ...trust, ciphers: `${aes256}:@SECLEVEL=0` }), `TLSv1.2 ${aes256}`);
  });

  test("secureProtocol", async () => {
    await using server = await serveNegotiated();
    const trust = { ca, servername };
    assert.match(await outcome(server.port, { ...trust, secureProtocol: "TLSv1_2_method" }), /^TLSv1\.2 /);
    assert.match(await outcome(server.port, { ...trust, secureProtocol: "TLS_method" }), /^TLSv1\.3 /);
    // There is no such method.
    assert.strictEqual(
      await outcome(server.port, { ...trust, secureProtocol: "TLSv1_3_method" }),
      "ERR_TLS_INVALID_PROTOCOL_METHOD",
    );
    assert.strictEqual(
      await outcome(server.port, { ...trust, secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
      "ERR_TLS_PROTOCOL_VERSION_CONFLICT",
    );
  });

  test("an agent that is a function of the request URL", async () => {
    await using server = await serve();
    const agent = new https.Agent({ ca, servername });
    // node-fetch v2 passes a legacy url.parse() object and v3 a WHATWG URL. Both have these fields.
    let calledWith;
    try {
      assert.strictEqual(await outcome(server.port, url => ((calledWith = url), agent)), "authorized=false");
      assert.deepStrictEqual(
        { protocol: calledWith?.protocol, hostname: calledWith?.hostname, port: String(calledWith?.port) },
        { protocol: "https:", hostname: "127.0.0.1", port: String(server.port) },
      );
    } finally {
      agent.destroy();
    }
  });
});
