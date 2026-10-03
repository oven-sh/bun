import * as vercelFetch from "@vercel/fetch";
import * as iso from "isomorphic-fetch";
import fetch2, { fetch, Headers, Request, Response } from "node-fetch";
import { once } from "node:events";
import http from "node:http";
import * as stream from "stream";

import { afterEach, expect, test } from "bun:test";

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

test("node-fetch Response.json(), Response.redirect() and Response.error() return a node-fetch Response", async () => {
  const json = Response.json({ a: 1 });
  expect(json).toBeInstanceOf(Response);
  expect((await json.buffer()).toString()).toBe('{"a":1}');
  expect(Response.json({ a: 1 }).body).toBeInstanceOf(stream.Readable);

  const redirect = Response.redirect("http://example.test/next", 301);
  expect(redirect).toBeInstanceOf(Response);
  expect(redirect.status).toBe(301);
  expect(redirect.type).toBe("default");
  expect(redirect.headers.raw()).toEqual({ location: ["http://example.test/next"] });

  const error = Response.error();
  expect(error).toBeInstanceOf(Response);
  expect(error.status).toBe(0);
  expect(error.type).toBe("error");
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
