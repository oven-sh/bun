import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isBroken, isWindows, tempDir, tls as tlsCert, withoutAggressiveGC } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
import { tmpdir } from "os";
import { join } from "path";

test("uploads roundtrip", async () => {
  const body = Bun.file(import.meta.dir + "/fetch.js.txt");
  const bodyText = await body.text();

  using server = Bun.serve({
    port: 0,
    development: false,
    async fetch(req) {
      const text = await req.text();
      expect(text).toBe(bodyText);

      return new Response(Bun.file(import.meta.dir + "/fetch.js.txt"));
    },
  });

  // @ts-ignore
  const reqBody = new Request(`http://${server.hostname}:${server.port}`, {
    body,
    method: "POST",
  });
  const res = await fetch(reqBody);
  expect(res.status).toBe(200);

  // but it does for Response
  expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
  const resText = await res.text();
  expect(resText).toBe(bodyText);
});

// https://github.com/oven-sh/bun/issues/3969
test("formData uploads roundtrip, with a call to .body", async () => {
  const file = Bun.file(import.meta.dir + "/fetch.js.txt");
  const body = new FormData();
  body.append("file", file, "fetch.js.txt");

  using server = Bun.serve({
    port: 0,
    development: false,
    async fetch(req) {
      req.body;

      return new Response(await req.formData());
    },
  });

  // @ts-ignore
  const reqBody = new Request(`http://${server.hostname}:${server.port}`, {
    body,
    method: "POST",
  });
  const res = await fetch(reqBody);
  expect(res.status).toBe(200);

  // but it does for Response
  expect(res.headers.get("Content-Type")).toStartWith("multipart/form-data; boundary=");
  res.body;
  const resData = await res.formData();
  expect(await (resData.get("file") as Blob).arrayBuffer()).toEqual(await file.arrayBuffer());
});

test("req.formData throws error when stream is in use", async () => {
  const file = Bun.file(import.meta.dir + "/fetch.js.txt");
  const body = new FormData();
  body.append("file", file, "fetch.js.txt");
  var pass = false;
  using server = Bun.serve({
    port: 0,
    development: false,
    error(fail) {
      pass = true;
      if (fail.toString().includes("already used")) {
        return new Response("pass");
      }
      return new Response("fail");
    },
    async fetch(req) {
      var reader = req.body?.getReader();
      await reader?.read();
      await req.formData();
      throw new Error("should not reach here");
    },
  });

  // @ts-ignore
  const reqBody = new Request(`http://${server.hostname}:${server.port}`, {
    body,
    method: "POST",
  });
  const res = await fetch(reqBody);
  expect(res.status).toBe(200);

  // but it does for Response
  expect(await res.text()).toBe("pass");
  expect(pass).toBe(true);
});

test("formData uploads roundtrip, without a call to .body", async () => {
  const file = Bun.file(import.meta.dir + "/fetch.js.txt");
  const body = new FormData();
  body.append("file", file, "fetch.js.txt");

  using server = Bun.serve({
    port: 0,
    development: false,
    async fetch(req) {
      return new Response(await req.formData());
    },
  });

  // @ts-ignore
  const reqBody = new Request(`http://${server.hostname}:${server.port}`, {
    body,
    method: "POST",
  });
  const res = await fetch(reqBody);
  expect(res.status).toBe(200);

  // but it does for Response
  expect(res.headers.get("Content-Type")).toStartWith("multipart/form-data; boundary=");
  const resData = await res.formData();
  expect(await (resData.get("file") as Blob).arrayBuffer()).toEqual(await file.arrayBuffer());
});

test.todoIf(isBroken && isWindows)(
  "uploads roundtrip with sendfile()",
  async () => {
    const hugeTxt = Buffer.allocUnsafe(1024 * 1024 * 32 * "huge".length);
    hugeTxt.fill("huge");
    const hash = Bun.CryptoHasher.hash("sha256", hugeTxt, "hex");

    const path = join(tmpdir(), "huge.txt");
    require("fs").writeFileSync(path, hugeTxt);
    using server = Bun.serve({
      port: 0,
      development: false,
      maxRequestBodySize: hugeTxt.byteLength * 2,
      async fetch(req) {
        const hasher = new Bun.CryptoHasher("sha256");
        for await (let chunk of req.body!) {
          hasher.update(chunk);
        }
        return new Response(hasher.digest("hex"));
      },
    });

    const resp = await fetch(server.url, {
      body: Bun.file(path),
      method: "PUT",
    });

    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe(hash);
  },
  10_000,
);

describe("Bun.file().slice() upload sends the slice's Content-Length", () => {
  // The sendfile fast path is entered when the backing file is >= 32 KiB.
  // It previously advertised the whole file's stat size as Content-Length,
  // while sending only the slice bytes, so the origin waited forever.
  for (const fileSize of [32 * 1024 - 1, 32 * 1024, 64 * 1024, 1024 * 1024]) {
    test.concurrent(`file size ${fileSize}`, async () => {
      const bytes = Buffer.alloc(fileSize);
      for (let i = 0; i < fileSize; i++) bytes[i] = i & 0xff;
      using dir = tempDir("fetch-file-slice-upload", { "f.bin": bytes });
      const p = join(String(dir), "f.bin");

      let contentLength: string | null = "?";
      let received = Buffer.alloc(0);
      await using server = Bun.serve({
        port: 0,
        development: false,
        async fetch(req) {
          contentLength = req.headers.get("content-length");
          received = Buffer.from(await req.arrayBuffer());
          return new Response("ok");
        },
      });

      const body = Bun.file(p).slice(10, 110);
      expect(body.size).toBe(100);

      const res = await fetch(server.url, { method: "POST", body });
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
      expect({ contentLength, received: received.length, firstByte: received[0], lastByte: received[99] }).toEqual({
        contentLength: "100",
        received: 100,
        firstByte: 10,
        lastByte: 109,
      });
    });
  }

  test.concurrent("open-ended slice(10)", async () => {
    const fileSize = 64 * 1024;
    using dir = tempDir("fetch-file-slice-upload-open", { "f.bin": Buffer.alloc(fileSize, 7) });
    const p = join(String(dir), "f.bin");

    let contentLength: string | null = "?";
    let received = 0;
    await using server = Bun.serve({
      port: 0,
      development: false,
      maxRequestBodySize: fileSize * 2,
      async fetch(req) {
        contentLength = req.headers.get("content-length");
        for await (const c of req.body!) received += c.length;
        return new Response("ok");
      },
    });

    const res = await fetch(server.url, { method: "POST", body: Bun.file(p).slice(10) });
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
    expect({ contentLength, received }).toEqual({ contentLength: String(fileSize - 10), received: fileSize - 10 });
  });
});

// A Bun.file() body of 32 KiB or more going to an http:// URL is uploaded with
// sendfile(2), which only works on a plain socket straight to the origin. The
// decision used to look at the explicit `proxy` option only; a proxy from the
// environment was applied afterwards, so http_proxy=https://... made the HTTP
// client hit "sendfile is only supported without SSL" and abort the process.
describe("Bun.file() upload through a proxy", () => {
  const fileSize = 64 * 1024;
  const fileBytes = Buffer.alloc(fileSize, "a");
  const fileSha256 = Bun.CryptoHasher.hash("sha256", fileBytes, "hex");
  const PROXY_ENV_KEYS = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"];

  // Absolute-form forward proxy (the shape an http:// request takes through a
  // proxy): rewrites the request line to origin-form and pipes the rest through.
  async function startProxy(secure: boolean) {
    const onClient = (client: net.Socket) => {
      client.on("error", () => {});
      client.once("data", head => {
        // Hold the rest of the request until the upstream connection is up;
        // pipe() below resumes the socket and flushes what was held.
        client.pause();
        const text = head.toString("latin1");
        const eol = text.indexOf("\r\n");
        const [method, target, version] = text.slice(0, eol).split(" ");
        const url = new URL(target);
        const upstream = net.connect(Number(url.port), url.hostname, () => {
          upstream.write(`${method} ${url.pathname}${url.search} ${version}\r\n`);
          upstream.write(head.subarray(eol + 2));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => client.destroy());
        client.on("close", () => upstream.destroy());
      });
    };
    const server = secure ? tls.createServer({ ...tlsCert }, onClient) : net.createServer(onClient);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    return {
      url: `${secure ? "https" : "http"}://127.0.0.1:${port}`,
      async [Symbol.asyncDispose]() {
        server.close();
        await once(server, "close");
      },
    };
  }

  // The proxy environment is read by the process doing the fetch, so the
  // upload runs in a child with exactly the proxy variables under test.
  async function uploadFromChild(proxyEnv: Record<string, string>, fetchInit: Record<string, unknown>) {
    using dir = tempDir("fetch-file-upload-proxy", { "body.bin": fileBytes });
    await using origin = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      maxRequestBodySize: fileSize * 2,
      async fetch(req) {
        return new Response(Bun.CryptoHasher.hash("sha256", await req.bytes(), "hex"));
      },
    });
    const env = { ...bunEnv };
    for (const key of PROXY_ENV_KEYS) delete env[key];
    const init = { ...fetchInit, method: "POST", tls: { rejectUnauthorized: false } };
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const res = await fetch(${JSON.stringify(String(origin.url))}, {
          ...${JSON.stringify(init)},
          body: Bun.file(${JSON.stringify(join(String(dir), "body.bin"))}),
        });
        console.log(res.status, await res.text());`,
      ],
      env: { ...env, ...proxyEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const uploaded = { stdout: `200 ${fileSha256}\n`, stderr: "", exitCode: 0 };

  for (const envKey of ["http_proxy", "HTTP_PROXY"]) {
    test.concurrent(`${envKey}=https://... (TLS to the proxy)`, async () => {
      await using proxy = await startProxy(true);
      expect(await uploadFromChild({ [envKey]: proxy.url }, {})).toEqual(uploaded);
    });
  }

  test.concurrent("http_proxy=http://...", async () => {
    await using proxy = await startProxy(false);
    expect(await uploadFromChild({ http_proxy: proxy.url }, {})).toEqual(uploaded);
  });

  test.concurrent("proxy option pointing at an https:// proxy", async () => {
    await using proxy = await startProxy(true);
    expect(await uploadFromChild({}, { proxy: proxy.url })).toEqual(uploaded);
  });
});

test("missing file throws the expected error", async () => {
  Bun.gc(true);
  // Run this 1000 times to check for GC bugs
  withoutAggressiveGC(() => {
    const body = Bun.file(import.meta.dir + "/fetch123123231123.js.txt");
    for (let i = 0; i < 1000; i++) {
      const resp = fetch(`http://example.com`, {
        body,
        method: "POST",
        proxy: "http://localhost:3000",
      });
      expect(Bun.peek.status(resp)).toBe("rejected");
      expect(async () => await resp).toThrow("no such file or directory");
    }
  });
  Bun.gc(true);
});
