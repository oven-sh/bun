import { describe, expect, test } from "bun:test";
import { getFDCount, isBroken, isLinux, isPosix, isWindows, tempDir, withoutAggressiveGC } from "harness";
import { closeSync, fstatSync, openSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
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

// fetch() opens the file of a Bun.file() body. A window with nothing to send must
// not take the sendfile fast path (plain http, backing file >= 32 KiB):
// sendfile(2) reads a length of 0 as "until end of file" on macOS and FreeBSD.
describe.skipIf(!isPosix)("the file behind a Bun.file() upload", () => {
  const fileSize = 64 * 1024;
  const emptyWindows = [
    [0, 0],
    [100, 100],
  ];
  const nothingReceived = { contentLength: "0", received: 0 };

  // Answers with the Content-Length and the body size it received.
  const echoServer = () =>
    Bun.serve({
      port: 0,
      development: false,
      async fetch(req) {
        const received = (await req.arrayBuffer()).byteLength;
        return Response.json({ contentLength: req.headers.get("content-length"), received });
      },
    });

  describe("is closed after the request", () => {
    // A leak of one descriptor per call shows up as `iterations`.
    const iterations = 16;
    async function expectNoLeakedDescriptors(upload: () => Promise<void>) {
      // The keep-alive socket and anything opened lazily belong in the baseline.
      for (let i = 0; i < 2; i++) await upload();
      const before = getFDCount();
      for (let i = 0; i < iterations; i++) await upload();
      expect(getFDCount() - before).toBeLessThan(iterations / 4);
    }

    // The only case here that sendfile serves: the tasklet closes the file when the request ends.
    test("slice(0, 40000), which goes through sendfile", async () => {
      using dir = tempDir("fetch-file-slice-closed", { "f.bin": Buffer.alloc(fileSize, 7) });
      const p = join(String(dir), "f.bin");
      await using server = echoServer();

      await expectNoLeakedDescriptors(async () => {
        const res = await fetch(server.url, { method: "POST", body: Bun.file(p).slice(0, 40000) });
        expect(await res.json()).toEqual({ contentLength: "40000", received: 40000 });
      });
    });

    for (const [start, end] of emptyWindows) {
      test(`slice(${start}, ${end})`, async () => {
        using dir = tempDir("fetch-file-empty-slice", { "f.bin": Buffer.alloc(fileSize, 7) });
        const p = join(String(dir), "f.bin");
        await using server = echoServer();

        await expectNoLeakedDescriptors(async () => {
          const res = await fetch(server.url, { method: "POST", body: Bun.file(p).slice(start, end) });
          expect(await res.json()).toEqual(nothingReceived);
        });
      });
    }

    test("slice(0, 0) as the body of a Request", async () => {
      using dir = tempDir("fetch-file-empty-slice-request", { "f.bin": Buffer.alloc(fileSize, 7) });
      const p = join(String(dir), "f.bin");
      await using server = echoServer();

      await expectNoLeakedDescriptors(async () => {
        const res = await fetch(new Request(server.url.href, { method: "POST", body: Bun.file(p).slice(0, 0) }));
        expect(await res.json()).toEqual(nothingReceived);
      });
    });

    test("Bun.file(fd).slice(0, 0), and the caller's descriptor stays open", async () => {
      using dir = tempDir("fetch-file-empty-slice-fd", { "f.bin": Buffer.alloc(fileSize, 7) });
      await using server = echoServer();

      const fd = openSync(join(String(dir), "f.bin"), "r");
      try {
        await expectNoLeakedDescriptors(async () => {
          const res = await fetch(server.url, { method: "POST", body: Bun.file(fd).slice(0, 0) });
          expect(await res.json()).toEqual(nothingReceived);
        });
        expect(fstatSync(fd).size).toBe(fileSize);
      } finally {
        closeSync(fd);
      }
    });

    test("a handle whose size was read before the file was written", async () => {
      using dir = tempDir("fetch-file-stale-size", {});
      await using server = echoServer();

      let files = 0;
      await expectNoLeakedDescriptors(async () => {
        const file = Bun.file(join(String(dir), `f${files++}.bin`));
        expect(await file.exists()).toBe(false);
        await Bun.write(file, Buffer.alloc(fileSize, 7));
        // This is an empty window only while the handle keeps the size 0 it read (#4930),
        // so the size of the upload is not asserted.
        const res = await fetch(server.url, { method: "POST", body: file });
        const seen = (await res.json()) as typeof nothingReceived;
        expect(seen.received).toBe(Number(seen.contentLength));
      });
    });

    test("slice(0, 0) when the connection cannot be opened", async () => {
      using dir = tempDir("fetch-file-no-socket", { "f.bin": Buffer.alloc(fileSize, 7) });
      const p = join(String(dir), "f.bin");
      // Nothing listens on this path.
      const unix = join(String(dir), "no.sock");

      await expectNoLeakedDescriptors(async () => {
        const err = await fetch("http://localhost/", { unix, method: "POST", body: Bun.file(p).slice(0, 0) }).catch(
          e => e,
        );
        // `path` tells the failed connect from a failed open of the body file, which is ENOENT too.
        expect({ code: err.code, path: err.path }).toEqual({ code: "ENOENT", path: "http://localhost/" });
      });
    });
  });

  // Linux names the file behind every descriptor, so this count is exact. It is
  // taken before the event loop turns: no request has finished yet.
  test.skipIf(!isLinux)("is not held while a request with nothing to send is in flight", async () => {
    const bytes = Buffer.alloc(fileSize, 7);
    using dir = tempDir("fetch-file-empty-slice-in-flight", {
      "empty.bin": bytes,
      "empty-at-100.bin": bytes,
      "past-the-end.bin": bytes,
      "bytes.bin": bytes,
    });
    await using server = echoServer();

    const descriptorsOn = (path: string) =>
      readdirSync("/proc/self/fd").filter(fd => {
        try {
          return readlinkSync(`/proc/self/fd/${fd}`) === path;
        } catch {
          // The descriptor readdirSync listed the directory with is gone by now.
          return false;
        }
      }).length;

    const uploads = (
      [
        ["empty.bin", 0, 0],
        ["empty-at-100.bin", 100, 100],
        ["past-the-end.bin", 70000, 80000],
        ["bytes.bin", 0, 40000],
      ] as const
    ).map(([name, start, end]) => {
      const p = realpathSync(join(String(dir), name));
      const body = Bun.file(p).slice(start, end);
      const size = body.size;
      const response = fetch(server.url, { method: "POST", body });
      return { size, held: descriptorsOn(p), response };
    });
    const results = await Promise.all(
      uploads.map(async ({ size, held, response }) => ({ size, held, seen: await (await response).json() })),
    );

    expect(results).toEqual([
      { size: 0, held: 0, seen: nothingReceived },
      { size: 0, held: 0, seen: nothingReceived },
      // This window has a size. It is empty only after it is clamped to the file.
      { size: 10000, held: 0, seen: nothingReceived },
      // The control: it shows that the count sees an open file. It does not promise that sendfile holds one.
      { size: 40000, held: 1, seen: { contentLength: "40000", received: 40000 } },
    ]);
  });

  for (const [start, end] of emptyWindows) {
    test(`slice(${start}, ${end}) sends nothing after the request head`, async () => {
      using dir = tempDir("fetch-file-empty-slice-wire", { "f.bin": Buffer.alloc(fileSize, "x") });
      const p = join(String(dir), "f.bin");

      // Records every byte of the one connection and answers once the head is complete.
      let wire = "";
      const closed = Promise.withResolvers<void>();
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket, chunk) {
            const answered = wire.includes("\r\n\r\n");
            wire += chunk.toString("latin1");
            if (!answered && wire.includes("\r\n\r\n")) {
              socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
            }
          },
          close: () => closed.resolve(),
          error: (_, err) => closed.reject(err),
        },
      });

      const res = await fetch(`http://127.0.0.1:${listener.port}/`, {
        method: "POST",
        body: Bun.file(p).slice(start, end),
        keepalive: false,
      });
      expect(await res.text()).toBe("ok");
      // Without keep-alive the client closes the socket after the response, so the record is complete.
      await closed.promise;

      const headEnd = wire.indexOf("\r\n\r\n") + 4;
      expect({
        contentLength: /\r\ncontent-length: (\d+)\r\n/i.exec(wire.slice(0, headEnd))?.[1],
        bytesAfterHead: wire.length - headEnd,
      }).toEqual({ contentLength: "0", bytesAfterHead: 0 });
    });
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
