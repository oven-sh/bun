import * as vercelFetch from "@vercel/fetch";
import * as iso from "isomorphic-fetch";
import fetch2, { fetch, FetchError, Headers, Request, Response } from "node-fetch";
import { once } from "node:events";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as zlib from "node:zlib";
import * as stream from "stream";

import { afterEach, describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";

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

// https://github.com/oven-sh/bun/issues/5686
describe("node-fetch honours the agent option", () => {
  function makeAgent() {
    let calls = 0;
    const agent = new (class extends http.Agent {
      createConnection(opts, cb) {
        calls++;
        return net.createConnection(opts, cb);
      }
    })({ keepAlive: false });
    return { agent, calls: () => calls };
  }

  async function withServer(handler, fn) {
    const server = http.createServer(handler);
    server.listen(0);
    await once(server, "listening");
    try {
      await fn(server.address().port);
    } finally {
      server.close();
    }
  }

  test("calls agent.createConnection", async () => {
    const { agent, calls } = makeAgent();
    try {
      await withServer(
        (req, res) => res.end("ok"),
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/`, { agent });
          expect(await res.text()).toBe("ok");
          expect(res.status).toBe(200);
          expect(res.url).toBe(`http://127.0.0.1:${port}/`);
          expect(res.body).toBeInstanceOf(stream.Readable);
        },
      );
      expect(calls()).toBe(1);
    } finally {
      agent.destroy();
    }
  });

  test("agent as a function receives the parsed URL", async () => {
    const { agent, calls } = makeAgent();
    try {
      let receivedHostname;
      await withServer(
        (req, res) => res.end("ok"),
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/`, {
            agent: parsed => {
              receivedHostname = parsed.hostname;
              return agent;
            },
          });
          expect(await res.text()).toBe("ok");
        },
      );
      expect(receivedHostname).toBe("127.0.0.1");
      expect(calls()).toBe(1);
    } finally {
      agent.destroy();
    }
  });

  test("forwards method, headers and body", async () => {
    const { agent, calls } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          let body = "";
          req.on("data", c => (body += c));
          req.on("end", () => {
            res.setHeader("x-echo", req.headers["x-foo"] ?? "");
            res.end(`${req.method}:${body}`);
          });
        },
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/`, {
            agent,
            method: "POST",
            headers: { "x-foo": "bar" },
            body: "hello",
          });
          expect(await res.text()).toBe("POST:hello");
          expect(res.headers.get("x-echo")).toBe("bar");
          expect(res.headers.raw()["x-echo"]).toEqual(["bar"]);
        },
      );
      expect(calls()).toBe(1);
    } finally {
      agent.destroy();
    }
  });

  test("serialises FormData and URLSearchParams bodies", async () => {
    const { agent } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          let body = "";
          req.on("data", c => (body += c));
          req.on("end", () => {
            res.setHeader("x-ct", req.headers["content-type"] ?? "");
            res.end(body);
          });
        },
        async port => {
          const fd = new FormData();
          fd.append("name", "value");
          let res = await fetch2(`http://127.0.0.1:${port}/`, { agent, method: "POST", body: fd });
          const ct = res.headers.get("x-ct");
          expect(ct).toStartWith("multipart/form-data; boundary=");
          const received = await res.text();
          expect(received).toContain('name="name"');
          expect(received).toContain("value");

          const sp = new URLSearchParams({ a: "1", b: "2" });
          res = await fetch2(`http://127.0.0.1:${port}/`, { agent, method: "POST", body: sp });
          expect(res.headers.get("x-ct")).toStartWith("application/x-www-form-urlencoded");
          expect(await res.text()).toBe("a=1&b=2");
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test.each([
    ["gzip", "gzip", b => zlib.gzipSync(b)],
    ["deflate (zlib-wrapped)", "deflate", b => zlib.deflateSync(b)],
    ["deflate (raw)", "deflate", b => zlib.deflateRawSync(b)],
    ["br", "br", b => zlib.brotliCompressSync(b)],
  ])("decompresses %s responses", async (_label, enc, encode) => {
    const { agent } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          res.writeHead(200, { "content-encoding": enc });
          res.end(encode("compressed body"));
        },
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/`, { agent });
          expect(await res.text()).toBe("compressed body");
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("sends Basic auth from URL userinfo", async () => {
    const { agent } = makeAgent();
    try {
      await withServer(
        (req, res) => res.end(req.headers.authorization ?? ""),
        async port => {
          const res = await fetch2(`http://alice:s%40cret@127.0.0.1:${port}/`, { agent });
          expect(await res.text()).toBe("Basic " + Buffer.from("alice:s@cret").toString("base64"));
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("clone() preserves url and redirected", async () => {
    const { agent } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          if (req.url === "/a") {
            res.writeHead(302, { location: "/b" });
            res.end();
          } else res.end("ok");
        },
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/a`, { agent });
          const c = res.clone();
          expect(c.url).toBe(res.url);
          expect(c.redirected).toBe(true);
          expect(await c.text()).toBe("ok");
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("honours the agent carried on a Request input", async () => {
    const { agent, calls } = makeAgent();
    try {
      await withServer(
        (req, res) => res.end("ok"),
        async port => {
          const request = new Request(`http://127.0.0.1:${port}/`, { agent });
          expect(request.agent).toBe(agent);
          const res = await fetch2(request);
          expect(await res.text()).toBe("ok");
        },
      );
      expect(calls()).toBe(1);
    } finally {
      agent.destroy();
    }
  });

  test("follows redirects through the agent", async () => {
    const { agent, calls } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          if (req.url === "/start") {
            res.writeHead(302, { location: "/end" });
            res.end();
          } else {
            res.end("landed");
          }
        },
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/start`, { agent });
          expect(await res.text()).toBe("landed");
          expect(res.status).toBe(200);
        },
      );
      expect(calls()).toBe(2);
    } finally {
      agent.destroy();
    }
  });

  test("redirect: 'manual' returns the 3xx response", async () => {
    const { agent } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          res.writeHead(302, { location: "/elsewhere" });
          res.end();
        },
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/`, { agent, redirect: "manual" });
          expect(res.status).toBe(302);
          expect(res.headers.get("location")).toBe("/elsewhere");
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("rejects with FetchError on connection failure", async () => {
    const { agent } = makeAgent();
    try {
      // Bind a socket to reserve a port, then close it so nothing is listening.
      const probe = net.createServer().listen(0);
      await once(probe, "listening");
      const port = probe.address().port;
      await new Promise(r => probe.close(r));

      await expect(fetch2(`http://127.0.0.1:${port}/`, { agent })).rejects.toThrow(FetchError);
    } finally {
      agent.destroy();
    }
  });

  test("aborts via signal", async () => {
    const { agent } = makeAgent();
    try {
      await withServer(
        () => {
          /* never respond */
        },
        async port => {
          const controller = new AbortController();
          const p = fetch2(`http://127.0.0.1:${port}/`, { agent, signal: controller.signal });
          controller.abort();
          await expect(p).rejects.toMatchObject({ name: "AbortError" });
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("HEAD response releases the abort listener", async () => {
    const { agent } = makeAgent();
    let uncaught = 0;
    const onUncaught = () => uncaught++;
    process.on("uncaughtException", onUncaught);
    try {
      const controller = new AbortController();
      await withServer(
        (req, res) => res.end(),
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/`, {
            agent,
            method: "HEAD",
            signal: controller.signal,
          });
          expect(res.status).toBe(200);
          expect(res.body).toBeNull();
        },
      );
      // The request has resolved and the underlying socket is closed; the
      // abort listener must have been removed and must not throw.
      await new Promise(r => setImmediate(r));
      controller.abort();
      await new Promise(r => setImmediate(r));
      expect(uncaught).toBe(0);
    } finally {
      process.off("uncaughtException", onUncaught);
      agent.destroy();
    }
  });

  test("accepts DataView and non-Uint8Array typed-array bodies", async () => {
    const { agent } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          const chunks = [];
          req.on("data", c => chunks.push(c));
          req.on("end", () => res.end(Buffer.concat(chunks).toString("hex")));
        },
        async port => {
          const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
          let res = await fetch2(`http://127.0.0.1:${port}/`, {
            agent,
            method: "POST",
            body: new DataView(bytes.buffer),
          });
          expect(await res.text()).toBe("deadbeef");

          res = await fetch2(`http://127.0.0.1:${port}/`, {
            agent,
            method: "POST",
            body: new Uint16Array(bytes.buffer),
          });
          expect(await res.text()).toBe("deadbeef");
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("rejects cleanly when signal is already aborted", async () => {
    const { agent } = makeAgent();
    let uncaught = 0;
    const onUncaught = () => uncaught++;
    process.on("uncaughtException", onUncaught);
    try {
      await expect(fetch2("http://127.0.0.1:1/", { agent, signal: AbortSignal.abort() })).rejects.toMatchObject({
        name: "AbortError",
      });
      await new Promise(r => setImmediate(r));
      expect(uncaught).toBe(0);
    } finally {
      process.off("uncaughtException", onUncaught);
      agent.destroy();
    }
  });

  test("picks https.request for https: URLs", async () => {
    let calls = 0;
    const agent = new (class extends https.Agent {
      createConnection(opts, cb) {
        calls++;
        return https.Agent.prototype.createConnection.call(this, opts, cb);
      }
    })({ keepAlive: false, rejectUnauthorized: false });

    const server = https.createServer({ ...tlsCert }, (req, res) => res.end("secure"));
    server.listen(0);
    await once(server, "listening");
    try {
      const port = server.address().port;
      const res = await fetch2(`https://127.0.0.1:${port}/`, { agent });
      expect(await res.text()).toBe("secure");
      expect(calls).toBe(1);
    } finally {
      server.close();
      agent.destroy();
    }
  });

  test("aborts after headers have arrived", async () => {
    const { agent } = makeAgent();
    try {
      let gotHeaders;
      const headersSent = new Promise(r => (gotHeaders = r));
      await withServer(
        (req, res) => {
          res.writeHead(200);
          res.write("x");
          res.flushHeaders();
          gotHeaders();
          // never end
        },
        async port => {
          const controller = new AbortController();
          const res = await fetch2(`http://127.0.0.1:${port}/`, { agent, signal: controller.signal });
          expect(res.status).toBe(200);
          await headersSent;
          const textP = res.text();
          controller.abort();
          await expect(textP).rejects.toMatchObject({ name: "AbortError" });
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("strips brackets from IPv6 literal hostnames", async () => {
    const { agent } = makeAgent();
    const server = http.createServer((req, res) => res.end("v6"));
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "::1", resolve);
      });
    } catch (err) {
      agent.destroy();
      if (err?.code === "EADDRNOTAVAIL" || err?.code === "EAFNOSUPPORT") return; // no IPv6 loopback in this environment
      throw err;
    }
    try {
      const port = server.address().port;
      const res = await fetch2(`http://[::1]:${port}/`, { agent });
      expect(await res.text()).toBe("v6");
    } finally {
      server.close();
      agent.destroy();
    }
  });

  test("accepts status codes outside [200, 599]", async () => {
    const { agent } = makeAgent();
    // http.ServerResponse.writeHead rejects 999, so speak raw TCP.
    const server = net.createServer(sock => {
      sock.end("HTTP/1.1 999 Custom\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
    });
    server.listen(0);
    await once(server, "listening");
    try {
      const port = server.address().port;
      const res = await fetch2(`http://127.0.0.1:${port}/`, { agent });
      expect(res.status).toBe(999);
      expect(res.ok).toBe(false);
      expect(await res.text()).toBe("ok");
    } finally {
      server.close();
      agent.destroy();
    }
  });

  test("request body stream error rejects with FetchError", async () => {
    const { agent } = makeAgent();
    try {
      await withServer(
        (req, res) => {
          req.resume();
          req.on("end", () => res.end("ok"));
        },
        async port => {
          const body = new stream.Readable({ read() {} });
          const p = fetch2(`http://127.0.0.1:${port}/`, { agent, method: "POST", body });
          body.destroy(new Error("boom"));
          await expect(p).rejects.toBeInstanceOf(FetchError);
        },
      );
    } finally {
      agent.destroy();
    }
  });

  test("tunnels via a CONNECT-proxy agent", async () => {
    // Minimal CONNECT proxy that records every CONNECT target.
    const targets = [];
    const proxy = net.createServer(client => {
      client.once("data", chunk => {
        const line = chunk.toString().split("\r\n")[0];
        const [, hostPort] = line.match(/^CONNECT (\S+) HTTP\/1\.1$/);
        targets.push(hostPort);
        const [host, port] = hostPort.split(":");
        const upstream = net.connect(+port, host, () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => client.destroy());
      });
    });
    proxy.listen(0);
    await once(proxy, "listening");

    // Agent whose createConnection establishes the tunnel first (what
    // socks-proxy-agent / https-proxy-agent do).
    const proxyPort = proxy.address().port;
    class TunnelAgent extends http.Agent {
      createConnection(opts, cb) {
        const sock = net.connect(proxyPort, "127.0.0.1", () => {
          sock.write(`CONNECT ${opts.host}:${opts.port} HTTP/1.1\r\n\r\n`);
          sock.once("data", () => cb(null, sock));
        });
        sock.on("error", cb);
      }
    }
    const agent = new TunnelAgent({ keepAlive: false });

    try {
      await withServer(
        (req, res) => res.end("via proxy"),
        async port => {
          const res = await fetch2(`http://127.0.0.1:${port}/`, { agent });
          expect(await res.text()).toBe("via proxy");
          expect(targets).toEqual([`127.0.0.1:${port}`]);
        },
      );
    } finally {
      agent.destroy();
      proxy.close();
    }
  });
});
