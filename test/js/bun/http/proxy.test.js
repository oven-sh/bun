import { afterAll, beforeAll, expect, it } from "bun:test";
import fs from "fs";
import { bunExe, gc } from "harness";
import { tmpdir } from "os";
import path from "path";

let proxy, auth_proxy, server;
beforeAll(() => {
  proxy = Bun.serve({
    port: 0,
    async fetch(request) {
      // if is not an proxy connection just drop it
      if (!request.headers.has("proxy-connection")) {
        return new Response("Bad Request", { status: 400 });
      }

      // simple http proxy
      if (request.url.startsWith("http://")) {
        return await fetch(request.url, {
          method: request.method,
          body: await request.text(),
        });
      }

      // no TLS support here
      return new Response("Bad Request", { status: 400 });
    },
  });
  auth_proxy = Bun.serve({
    port: 0,
    async fetch(request) {
      // if is not an proxy connection just drop it
      if (!request.headers.has("proxy-connection")) {
        return new Response("Bad Request", { status: 400 });
      }

      if (!request.headers.has("proxy-authorization")) {
        return new Response("Proxy Authentication Required", { status: 407 });
      }

      const auth = Buffer.from(
        request.headers.get("proxy-authorization").replace("Basic ", "").trim(),
        "base64",
      ).toString("utf8");
      if (auth !== "squid_user:ASD123@123asd") {
        return new Response("Forbidden", { status: 403 });
      }

      // simple http proxy
      if (request.url.startsWith("http://")) {
        return await fetch(request.url, {
          method: request.method,
          body: await request.text(),
        });
      }

      // no TLS support here
      return new Response("Bad Request", { status: 400 });
    },
  });
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === "POST") {
        const text = await request.text();
        return new Response(text, { status: 200 });
      }
      return new Response("Hello, World", { status: 200 });
    },
  });
});

afterAll(() => {
  server.stop();
  proxy.stop();
  auth_proxy.stop();
});

const test = process.env.PROXY_URL ? it : it.skip;

test("should be able to post on TLS", async () => {
  const data = JSON.stringify({
    "name": "bun",
  });

  const result = await fetch("https://httpbin.org/post", {
    method: "POST",
    proxy: process.env.PROXY_URL,
    verbose: true,
    headers: {
      "Content-Type": "application/json",
    },
    body: data,
  }).then(res => res.json());

  expect(result.data).toBe(data);
});

test("should be able to post bigger on TLS", async () => {
  const data = fs.readFileSync(path.join(import.meta.dir, "fetch.json")).toString("utf8");
  const result = await fetch("https://httpbin.org/post", {
    method: "POST",
    proxy: process.env.PROXY_URL,
    verbose: true,
    headers: {
      "Content-Type": "application/json",
    },
    body: data,
  }).then(res => res.json());
  expect(result.data).toBe(data);
});

it("proxy non-TLS", async () => {
  const url = `http://localhost:${server.port}`;
  const auth_proxy_url = `http://squid_user:ASD123%40123asd@localhost:${auth_proxy.port}`;
  const proxy_url = `localhost:${proxy.port}`;
  const requests = [
    [new Request(url), auth_proxy_url],
    [
      new Request(url, {
        method: "POST",
        body: "Hello, World",
      }),
      auth_proxy_url,
    ],
    [url, auth_proxy_url],
    [new Request(url), proxy_url],
    [
      new Request(url, {
        method: "POST",
        body: "Hello, World",
      }),
      proxy_url,
    ],
    [url, proxy_url],
  ];
  for (let [request, proxy] of requests) {
    gc();
    const response = await fetch(request, { verbose: true, proxy });
    gc();
    const text = await response.text();
    gc();
    expect(text).toBe("Hello, World");
  }
});

it("proxy non-TLS auth can fail", async () => {
  const url = `http://localhost:${server.port}`;

  {
    try {
      const response = await fetch(url, { verbose: true, proxy: `http://localhost:${auth_proxy.port}` });
      expect(response.status).toBe(407);
    } catch (err) {
      expect(true).toBeFalsy();
    }
  }

  {
    try {
      const response = await fetch(url, {
        verbose: true,
        proxy: `http://squid_user:asdf123@localhost:${auth_proxy.port}`,
      });
      expect(response.status).toBe(403);
    } catch (err) {
      expect(true).toBeFalsy();
    }
  }
});

it.each([
  [undefined, undefined],
  ["", ""],
  ["''", "''"],
  ['""', '""'],
])("test proxy env, http_proxy=%s https_proxy=%s", async (http_proxy, https_proxy) => {
  const path = `${tmpdir()}/bun-test-http-proxy-env-${Date.now()}.ts`;
  fs.writeFileSync(path, 'await fetch("https://example.com");');

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", path],
    env: {
      http_proxy: http_proxy,
      https_proxy: https_proxy,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    expect(stderr.includes("FailedToOpenSocket: Was there a typo in the url or port?")).toBe(false);
    expect(exitCode).toBe(0);
  } finally {
    fs.unlinkSync(path);
  }
});
