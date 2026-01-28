import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, gc } from "harness";
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
        const response = await fetch(request.url, {
          method: request.method,
          body: await request.text(),
        });
        // Add marker header to indicate request went through proxy
        const headers = new Headers(response.headers);
        headers.set("x-proxy-used", "1");
        return new Response(response.body, {
          status: response.status,
          headers,
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
  server.stop(true);
  proxy.stop(true);
  auth_proxy.stop(true);
});

const test = process.env.PROXY_URL ? it : it.skip;
describe.concurrent(() => {
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

  describe("proxy non-TLS", async () => {
    let url;
    let auth_proxy_url;
    let proxy_url;
    const requests = [
      () => [new Request(url), auth_proxy_url],
      () => [
        new Request(url, {
          method: "POST",
          body: "Hello, World",
        }),
        auth_proxy_url,
      ],
      () => [url, auth_proxy_url],
      () => [new Request(url), proxy_url],
      () => [
        new Request(url, {
          method: "POST",
          body: "Hello, World",
        }),
        proxy_url,
      ],
      () => [url, proxy_url],
    ];
    beforeAll(() => {
      url = `http://localhost:${server.port}`;
      auth_proxy_url = `http://squid_user:ASD123%40123asd@localhost:${auth_proxy.port}`;
      proxy_url = `localhost:${proxy.port}`;
    });

    for (let callback of requests) {
      test(async () => {
        const [request, proxy] = callback();
        gc();
        const response = await fetch(request, { verbose: true, proxy });
        gc();
        const text = await response.text();
        gc();
        expect(text).toBe("Hello, World");
      });
    }
  });

  it("proxy non-TLS auth can fail", async () => {
    const url = `http://localhost:${server.port}`;

    {
      try {
        const response = await fetch(url, {
          verbose: true,
          proxy: `http://localhost:${auth_proxy.port}`,
        });
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

  it("simultaneous proxy auth failures should not hang", async () => {
    const url = `http://localhost:${server.port}`;
    const invalidProxy = `http://localhost:${auth_proxy.port}`;

    // First batch: 5 simultaneous fetches with invalid credentials
    const firstBatch = await Promise.all([
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
    ]);
    expect(firstBatch.map(r => r.status)).toEqual([407, 407, 407, 407, 407]);
    await Promise.all(firstBatch.map(r => r.text())).catch(() => {});

    // Second batch: immediately send another 5
    // Before the fix, these would hang due to keep-alive on failed proxy connections
    const secondBatch = await Promise.all([
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
      fetch(url, { proxy: invalidProxy }),
    ]);
    expect(secondBatch.map(r => r.status)).toEqual([407, 407, 407, 407, 407]);
    await Promise.all(secondBatch.map(r => r.text())).catch(() => {});
  });

  it.each([
    [undefined, undefined],
    ["", ""],
    ["''", "''"],
    ['""', '""'],
  ])("test proxy env, http_proxy=%s https_proxy=%s", async (http_proxy, https_proxy) => {
    const { exited, stderr: stream } = Bun.spawn({
      cmd: [bunExe(), "-e", 'await fetch("https://example.com")'],
      env: {
        ...bunEnv,
        http_proxy: http_proxy,
        https_proxy: https_proxy,
      },
      stdout: "inherit",
      stderr: "pipe",
    });

    const [exitCode, stderr] = await Promise.all([exited, stream.text()]);

    expect(stderr.includes("FailedToOpenSocket: Was there a typo in the url or port?")).toBe(false);
    expect(exitCode).toBe(0);
  });

  it.each([
    // Empty entries in NO_PROXY should not cause out-of-bounds access
    ["localhost, , example.com"],
    [",localhost,example.com"],
    ["localhost,example.com,"],
    ["  ,  ,  "],
    [",,,"],
    [". , .. , ..."],
  ])("NO_PROXY with empty entries does not crash: %s", async no_proxy => {
    // We just need to verify parsing NO_PROXY doesn't crash.
    // The fetch target doesn't matter - NO_PROXY parsing happens before the connection.
    const { exited, stderr: stream } = Bun.spawn({
      cmd: [bunExe(), "-e", `fetch("http://localhost:1").catch(() => {})`],
      env: {
        ...bunEnv,
        http_proxy: "http://127.0.0.1:1",
        NO_PROXY: no_proxy,
      },
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([exited, stream.text()]);
    if (exitCode !== 0) {
      console.error("stderr:", stderr);
    }
    expect(exitCode).toBe(0);
  });

  // Test that NO_PROXY respects port numbers like Node.js and curl do
  describe("NO_PROXY port handling", () => {
    it("should bypass proxy when NO_PROXY matches host:port exactly", async () => {
      // NO_PROXY includes the exact host:port, should bypass proxy
      const {
        exited,
        stdout,
        stderr: stderrStream,
      } = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const resp = await fetch("http://localhost:${server.port}/test"); console.log(resp.headers.get("x-proxy-used") || "no-proxy");`,
        ],
        env: {
          ...bunEnv,
          http_proxy: `http://localhost:${proxy.port}`,
          NO_PROXY: `localhost:${server.port}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, out, stderr] = await Promise.all([exited, stdout.text(), stderrStream.text()]);
      if (exitCode !== 0) {
        console.error("stderr:", stderr);
      }
      // Should connect directly, not through proxy (no x-proxy-used header)
      expect(out.trim()).toBe("no-proxy");
      expect(exitCode).toBe(0);
    });

    it("should use proxy when NO_PROXY has different port", async () => {
      const differentPort = server.port + 1000;
      // NO_PROXY includes a different port, should NOT bypass proxy
      const {
        exited,
        stdout,
        stderr: stderrStream,
      } = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const resp = await fetch("http://localhost:${server.port}/test"); console.log(resp.headers.get("x-proxy-used") || "no-proxy");`,
        ],
        env: {
          ...bunEnv,
          http_proxy: `http://localhost:${proxy.port}`,
          NO_PROXY: `localhost:${differentPort}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, out, stderr] = await Promise.all([exited, stdout.text(), stderrStream.text()]);
      if (exitCode !== 0) {
        console.error("stderr:", stderr);
      }
      // The proxy adds x-proxy-used header, verify it was used
      expect(out.trim()).toBe("1");
      expect(exitCode).toBe(0);
    });

    it("should bypass proxy when NO_PROXY has host only (no port)", async () => {
      // NO_PROXY includes just the host (no port), should bypass proxy for all ports
      const {
        exited,
        stdout,
        stderr: stderrStream,
      } = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const resp = await fetch("http://localhost:${server.port}/test"); console.log(resp.headers.get("x-proxy-used") || "no-proxy");`,
        ],
        env: {
          ...bunEnv,
          http_proxy: `http://localhost:${proxy.port}`,
          NO_PROXY: `localhost`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, out, stderr] = await Promise.all([exited, stdout.text(), stderrStream.text()]);
      if (exitCode !== 0) {
        console.error("stderr:", stderr);
      }
      // Should connect directly, not through proxy (no x-proxy-used header)
      expect(out.trim()).toBe("no-proxy");
      expect(exitCode).toBe(0);
    });

    it("should handle NO_PROXY with multiple entries including port", async () => {
      const differentPort = server.port + 1000;
      // NO_PROXY includes multiple entries, one of which matches exactly
      const {
        exited,
        stdout,
        stderr: stderrStream,
      } = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const resp = await fetch("http://localhost:${server.port}/test"); console.log(resp.headers.get("x-proxy-used") || "no-proxy");`,
        ],
        env: {
          ...bunEnv,
          http_proxy: `http://localhost:${proxy.port}`,
          NO_PROXY: `example.com, localhost:${differentPort}, localhost:${server.port}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, out, stderr] = await Promise.all([exited, stdout.text(), stderrStream.text()]);
      if (exitCode !== 0) {
        console.error("stderr:", stderr);
      }
      // Should connect directly, not through proxy (no x-proxy-used header)
      expect(out.trim()).toBe("no-proxy");
      expect(exitCode).toBe(0);
    });
  });
});
