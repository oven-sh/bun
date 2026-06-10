import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";

// S3 requests must resolve HTTP(S)_PROXY / NO_PROXY against the actual
// request URL, the same way fetch does.
// https://github.com/oven-sh/bun/issues/32045
describe.concurrent("s3 proxy env vars", () => {
  const childScript = `
    const endpoint = process.argv[1];
    const op = process.argv[2];
    const opts = {
      accessKeyId: "test",
      secretAccessKey: "test",
      region: "eu-west-3",
      bucket: "mybucket",
      endpoint,
    };
    switch (op) {
      case "write":
        await Bun.S3Client.file("key", opts).write("content");
        break;
      case "stream": {
        const body = await Bun.S3Client.file("key", opts).stream().text();
        if (body !== "ok") throw new Error("unexpected stream body: " + body);
        break;
      }
      case "list":
        await new Bun.S3Client(opts).list();
        break;
      case "writer": {
        const writer = Bun.S3Client.file("key", opts).writer();
        writer.write("content");
        await writer.end();
        break;
      }
      case "fetch-stream": {
        // Streaming body: the S3 multipart path, with fetch's explicit proxy option.
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("content"));
            controller.close();
          },
        });
        const res = await fetch("s3://mybucket/key", {
          method: "PUT",
          body,
          proxy: process.env.EXPLICIT_PROXY,
          s3: opts,
        });
        if (!res.ok) throw new Error("fetch-stream failed: " + res.status + " " + (await res.text()));
        break;
      }
      default:
        throw new Error("unknown op: " + op);
    }
    console.log("ok:" + op);
  `;

  function servers(tlsOptions?: typeof tls) {
    const endpointHits: string[] = [];
    const proxyHits: string[] = [];
    const endpoint = Bun.serve({
      port: 0,
      tls: tlsOptions,
      fetch(req) {
        endpointHits.push(`${req.method} ${new URL(req.url).pathname}`);
        if (req.method === "GET" && req.url.includes("list-type=2")) {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>mybucket</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>`,
            { headers: { "Content-Type": "application/xml" } },
          );
        }
        return new Response("ok");
      },
    });
    const proxy = Bun.serve({
      port: 0,
      fetch(req) {
        proxyHits.push(`${req.method} ${req.url}`);
        return new Response("ok");
      },
    });
    return { endpoint, proxy, endpointHits, proxyHits };
  }

  async function runChild(endpointUrl: string, op: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", childScript, endpointUrl, op],
      env: {
        ...bunEnv,
        http_proxy: undefined,
        HTTP_PROXY: undefined,
        https_proxy: undefined,
        HTTPS_PROXY: undefined,
        no_proxy: undefined,
        NO_PROXY: undefined,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  for (const op of ["write", "stream", "list", "writer"]) {
    it(`${op} bypasses HTTP_PROXY when the endpoint host is in NO_PROXY`, async () => {
      const { endpoint, proxy, endpointHits, proxyHits } = servers();
      using _endpoint = endpoint;
      using _proxy = proxy;

      const { stdout, stderr, exitCode } = await runChild(endpoint.url.href, op, {
        HTTP_PROXY: proxy.url.href,
        NO_PROXY: "localhost,127.0.0.1",
      });

      expect({ stdout, exitCode, stderr: exitCode === 0 ? "" : stderr, proxyHits }).toEqual({
        stdout: `ok:${op}\n`,
        exitCode: 0,
        stderr: "",
        proxyHits: [],
      });
      expect(endpointHits.length).toBeGreaterThanOrEqual(1);
    });
  }

  it("write goes through HTTP_PROXY when NO_PROXY does not match", async () => {
    const { endpoint, proxy, endpointHits, proxyHits } = servers();
    using _endpoint = endpoint;
    using _proxy = proxy;

    const { stdout, stderr, exitCode } = await runChild(endpoint.url.href, "write", {
      HTTP_PROXY: proxy.url.href,
      NO_PROXY: "example.com",
    });

    // The request is sent to the proxy in absolute-URI form.
    expect({ stdout, exitCode, stderr: exitCode === 0 ? "" : stderr, proxyHits, endpointHits }).toEqual({
      stdout: "ok:write\n",
      exitCode: 0,
      stderr: "",
      proxyHits: [`PUT ${endpoint.url.href}mybucket/key`],
      endpointHits: [],
    });
  });

  it("explicit fetch proxy is bypassed when the endpoint host is in NO_PROXY", async () => {
    const { endpoint, proxy, endpointHits, proxyHits } = servers();
    using _endpoint = endpoint;
    using _proxy = proxy;

    const { stdout, stderr, exitCode } = await runChild(endpoint.url.href, "fetch-stream", {
      EXPLICIT_PROXY: proxy.url.href,
      NO_PROXY: "localhost,127.0.0.1",
    });

    expect({ stdout, exitCode, stderr: exitCode === 0 ? "" : stderr, proxyHits }).toEqual({
      stdout: "ok:fetch-stream\n",
      exitCode: 0,
      stderr: "",
      proxyHits: [],
    });
    expect(endpointHits.length).toBeGreaterThanOrEqual(1);
  });

  it("explicit fetch proxy is used when NO_PROXY does not match", async () => {
    const { endpoint, proxy, endpointHits, proxyHits } = servers();
    using _endpoint = endpoint;
    using _proxy = proxy;

    const { stdout, stderr, exitCode } = await runChild(endpoint.url.href, "fetch-stream", {
      EXPLICIT_PROXY: proxy.url.href,
      NO_PROXY: "example.com",
    });

    expect({ stdout, exitCode, stderr: exitCode === 0 ? "" : stderr, endpointHits }).toEqual({
      stdout: "ok:fetch-stream\n",
      exitCode: 0,
      stderr: "",
      endpointHits: [],
    });
    expect(proxyHits.length).toBeGreaterThanOrEqual(1);
  });

  it("write to an https endpoint uses HTTPS_PROXY, not HTTP_PROXY", async () => {
    const { endpoint, proxy, endpointHits, proxyHits } = servers(tls);
    using _endpoint = endpoint;
    using _proxy = proxy;

    // Only HTTP_PROXY is set: an https endpoint must connect directly.
    const { stdout, stderr, exitCode } = await runChild(endpoint.url.href, "write", {
      HTTP_PROXY: proxy.url.href,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    });

    expect({ stdout, exitCode, stderr: exitCode === 0 ? "" : stderr, proxyHits, endpointHits }).toEqual({
      stdout: "ok:write\n",
      exitCode: 0,
      stderr: "",
      proxyHits: [],
      endpointHits: ["PUT /mybucket/key"],
    });
  });
});
