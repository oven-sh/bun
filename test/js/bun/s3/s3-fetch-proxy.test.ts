import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import net from "node:net";

// fetch("s3://...", { proxy }) rebuilds url_proxy_buffer after signing the
// request. A wrong offset when copying the proxy href into that buffer left
// the proxy region pointing past the allocation (proxy longer than the signed
// URL → heap overflow) or at bytes that were never written (proxy shorter →
// uninitialized read). Either way the request could not reach the configured
// proxy.

async function createProxy() {
  const log: string[] = [];
  const server = net.createServer(client => {
    client.once("data", data => {
      const request = data.toString("latin1");
      const newline = request.indexOf("\r\n");
      const [method, target] = request.slice(0, newline).split(" ");
      log.push(`${method} ${target}`);

      const url = new URL(target);
      const upstream = net.connect(Number(url.port), url.hostname, () => {
        upstream.write(`${method} ${url.pathname}${url.search} HTTP/1.1\r\n`);
        upstream.write(data.subarray(newline + 2));
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => client.destroy());
    });
    client.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  return { server, port, log };
}

// The fetch runs in a subprocess so that (a) the heap-overflow case reports as
// a normal test failure instead of aborting the runner, and (b) NO_PROXY from
// the surrounding environment cannot suppress the explicit proxy for 127.0.0.1.
async function fetchS3ViaProxy(proxyUrl: string, endpointPort: number) {
  const script = `
    const res = await fetch("s3://bucket/key", {
      proxy: ${JSON.stringify(proxyUrl)},
      s3: {
        endpoint: "http://127.0.0.1:${endpointPort}",
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
    process.stdout.write(await res.text());
  `;
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      NO_PROXY: "",
      no_proxy: "",
      HTTP_PROXY: "",
      http_proxy: "",
      HTTPS_PROXY: "",
      https_proxy: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

describe("fetch s3:// through an HTTP proxy", () => {
  for (const [label, proxyPath] of [
    // Proxy href is shorter than the signed "http://127.0.0.1:PORT/bucket/key"
    // URL: the broken offset meant the bytes parsed as the proxy were never
    // written, so the HTTP thread tried to connect to garbage.
    ["shorter than the signed URL", ""],
    // Proxy href is longer than the signed URL: the broken offset produced a
    // destination slice shorter than the source and copied past the allocation.
    ["longer than the signed URL", "/" + Buffer.alloc(512, "p").toString()],
  ] as const) {
    test(`proxy URL ${label}`, async () => {
      let sawBucketKey = false;
      await using endpoint = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          if (new URL(req.url).pathname === "/bucket/key") sawBucketKey = true;
          return new Response("hello from s3", { headers: { "Content-Type": "text/plain" } });
        },
      });

      const proxy = await createProxy();
      try {
        const proxyUrl = `http://127.0.0.1:${proxy.port}${proxyPath}`;
        const { stdout, stderr, exitCode } = await fetchS3ViaProxy(proxyUrl, endpoint.port);

        expect(stderr).toBe("");
        expect(stdout).toBe("hello from s3");
        expect(exitCode).toBe(0);
        expect(sawBucketKey).toBe(true);
        expect(proxy.log).toEqual([`GET http://127.0.0.1:${endpoint.port}/bucket/key`]);
      } finally {
        proxy.server.close();
      }
    }, 30_000);
  }
});
