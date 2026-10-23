import { describe, expect, test } from "bun:test";
import { isBroken, isWindows, tempDir, withoutAggressiveGC } from "harness";
import { once } from "node:events";
import { truncateSync } from "node:fs";
import net from "node:net";
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

      return new Response((await req.formData()) as FormData);
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
      return new Response((await req.formData()) as FormData);
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

// The request head announces the whole file in Content-Length. A file that gets shorter
// while sendfile(2) uploads it cannot fill that. The fetch used to stay pending: the
// request counted as sent, and the server waited for bytes that never came.
// Windows reads the file into memory before the request starts.
test.skipIf(isWindows)("a Bun.file() body that shrinks while it is uploaded rejects the fetch", async () => {
  // More than the socket buffers of a reader that stopped can hold. A sparse file: no data is written.
  const SIZE = 64 * 1024 * 1024;
  using dir = tempDir("fetch-file-upload-shrinks", { "body.bin": "" });
  const path = join(String(dir), "body.bin");
  truncateSync(path, SIZE);

  const sockets = new Set<net.Socket>();
  const { promise: uploadStarted, resolve: onUploadStarted } = Promise.withResolvers<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.once("data", () => {
      // Stop reading, so that the upload cannot finish before the file shrinks.
      socket.pause();
      onUploadStarted(socket);
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    const outcome = fetch(`http://127.0.0.1:${port}/`, { method: "PUT", body: Bun.file(path) }).then(
      res => ({ rejected: false as const, status: res.status }),
      e => ({ rejected: true as const, code: e.code, message: e.message }),
    );
    const socket = await uploadStarted;
    truncateSync(path, 1);
    socket.resume();
    expect(await outcome).toEqual({
      rejected: true,
      code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
      message: `Request body file is shorter than the Content-Length of ${SIZE}`,
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
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
      expect(resp).rejects.toThrow("no such file or directory");
    }
  });
  // The rejection tracker keeps each promise alive until the end of the tick
  // (a microtask is not enough), so yield one before forcing the collection.
  await Bun.sleep(0);
  Bun.gc(true);
});
