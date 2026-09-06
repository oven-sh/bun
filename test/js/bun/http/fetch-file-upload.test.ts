import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isBroken, isWindows, tempDir, tls, withoutAggressiveGC } from "harness";
import { mkfifo } from "mkfifo";
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

// A FIFO has no size, so its bytes cannot be read into memory up front.
// The body must be streamed with chunked transfer encoding, and the read
// must not block the JS thread.
describe.skipIf(isWindows)("Bun.file(fifo) upload", () => {
  const SIZE = 1024 * 1024;
  const payload = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) payload[i] = (i * 7) & 0xff;
  const payloadHash = Bun.CryptoHasher.hash("sha256", payload, "hex");

  function newSeen() {
    return { contentLength: "?" as string | null, transferEncoding: "?" as string | null, hash: "" };
  }

  function startOrigin(seen: ReturnType<typeof newSeen>, tlsOptions?: object) {
    return Bun.serve({
      port: 0,
      development: false,
      maxRequestBodySize: SIZE * 2,
      ...(tlsOptions ? { tls: tlsOptions } : {}),
      async fetch(req) {
        seen.contentLength = req.headers.get("content-length");
        seen.transferEncoding = req.headers.get("transfer-encoding");
        const hasher = new Bun.CryptoHasher("sha256");
        for await (const chunk of req.body!) hasher.update(chunk);
        seen.hash = hasher.digest("hex");
        return new Response("ok");
      },
    });
  }

  for (const scheme of ["http", "https"] as const) {
    test.concurrent(`${scheme}: every byte arrives, chunked`, async () => {
      using dir = tempDir("fetch-fifo-upload", { "payload.bin": payload });
      const fifo = join(String(dir), "fifo");
      mkfifo(fifo);

      await using writer = Bun.spawn({
        cmd: ["sh", "-c", `cat payload.bin > fifo`],
        cwd: String(dir),
        env: bunEnv,
      });

      const seen = newSeen();
      await using server = startOrigin(seen, scheme === "https" ? tls : undefined);
      const res = await fetch(server.url, {
        method: "POST",
        body: Bun.file(fifo),
        tls: { rejectUnauthorized: false },
      });
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
      expect(seen).toEqual({ contentLength: null, transferEncoding: "chunked", hash: payloadHash });
      expect(await writer.exited).toBe(0);
    });
  }

  // The writer opens the FIFO only after it reads a line from stdin, and the
  // fixture writes that line after fetch() returns. With the bug, fetch()
  // blocks the JS thread inside a read of the FIFO, so the line is never
  // written and the fixture never prints. It runs in a child process so the
  // hang cannot take the test runner with it.
  test.concurrent("fetch() returns before the writer has produced any bytes", async () => {
    using dir = tempDir("fetch-fifo-upload-wait", {
      "payload.bin": payload,
      "fixture.ts": `
        const writer = Bun.spawn({
          cmd: ["sh", "-c", "read go; cat payload.bin > fifo"],
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        });
        const seen = { contentLength: "?", transferEncoding: "?", hash: "" };
        using server = Bun.serve({
          port: 0,
          development: false,
          maxRequestBodySize: ${SIZE * 2},
          async fetch(req) {
            seen.contentLength = req.headers.get("content-length");
            seen.transferEncoding = req.headers.get("transfer-encoding");
            const hasher = new Bun.CryptoHasher("sha256");
            for await (const chunk of req.body) hasher.update(chunk);
            seen.hash = hasher.digest("hex");
            return new Response("ok");
          },
        });
        const pending = fetch(server.url, { method: "POST", body: Bun.file("fifo") });
        console.log("fetch-called");
        writer.stdin.write("go\\n");
        await writer.stdin.end();
        const res = await pending;
        console.log(JSON.stringify({ status: res.status, text: await res.text(), seen, writerExit: await writer.exited }));
      `,
    });
    mkfifo(join(String(dir), "fifo"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      "fetch-called\n" +
        JSON.stringify({
          status: 200,
          text: "ok",
          seen: { contentLength: null, transferEncoding: "chunked", hash: payloadHash },
          writerExit: 0,
        }) +
        "\n",
    );
    expect(exitCode).toBe(0);
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
