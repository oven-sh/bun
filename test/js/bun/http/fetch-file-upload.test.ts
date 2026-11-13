import { describe, expect, test } from "bun:test";
import { readdirSync, readlinkSync, realpathSync, writeFileSync } from "fs";
import { isBroken, isLinux, isWindows, tempDir, withoutAggressiveGC } from "harness";
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

// exists(), .size and structuredClone() stat the file. When that stat failed
// because the file was not there yet, the handle kept a size of 0 and fetch()
// sent it: status 200, Content-Length 0, no bytes.
describe("a Bun.file() that was asked before its file existed uploads the file", () => {
  const askers: Record<string, (file: ReturnType<typeof Bun.file>) => unknown> = {
    "exists()": file => file.exists(),
    ".size": file => file.size,
    "structuredClone()": file => structuredClone(file),
  };
  // Under 32 KiB fetch() reads the file into memory. From 32 KiB on it uses sendfile where it can.
  for (const fileSize of [1000, 64 * 1024]) {
    for (const [asker, ask] of Object.entries(askers)) {
      test.concurrent(`${asker}, then a file of ${fileSize} bytes`, async () => {
        using dir = tempDir("fetch-file-asked-upload", {});
        const p = join(String(dir), "f.txt");

        const seen: { contentLength: string | null; contentType: string | null; received: number }[] = [];
        await using server = Bun.serve({
          port: 0,
          development: false,
          async fetch(req) {
            seen.push({
              contentLength: req.headers.get("content-length"),
              contentType: req.headers.get("content-type"),
              received: (await req.arrayBuffer()).byteLength,
            });
            return new Response("ok");
          },
        });

        const asked = Bun.file(p);
        await ask(asked);
        writeFileSync(p, Buffer.alloc(fileSize, "a"));

        // The second upload, from a handle that nothing asked, is the reference.
        for (const body of [asked, Bun.file(p)]) {
          const res = await fetch(server.url, { method: "POST", body });
          expect(await res.text()).toBe("ok");
        }
        const [fromAsked, fromUnasked] = seen;
        expect(fromUnasked).toEqual({
          contentLength: String(fileSize),
          contentType: "text/plain;charset=utf-8",
          received: fileSize,
        });
        expect(fromAsked).toEqual(fromUnasked);

        if (isLinux) {
          // An upload of 0 bytes through sendfile left its descriptor for the file open.
          const target = realpathSync(p);
          const openOnFile = () =>
            readdirSync("/proc/self/fd").filter(fd => {
              try {
                return readlinkSync(`/proc/self/fd/${fd}`) === target;
              } catch {
                return false;
              }
            });
          // fetch() closes the descriptor when it drops the request. That can be one turn of the event loop after the response.
          const deadline = performance.now() + 5000;
          let open = openOnFile();
          while (open.length > 0 && performance.now() < deadline) {
            await new Promise<void>(resolve => setImmediate(resolve));
            open = openOnFile();
          }
          expect(open).toEqual([]);
        }

        // A handle with a file behind it is a body, so GET refuses it. The asked handle passed as "no body".
        expect(async () => {
          await fetch(server.url, { method: "GET", body: asked });
        }).toThrow("fetch() request with GET/HEAD method cannot have body.");

        // An empty window that the caller asked for is still an empty body.
        const res = await fetch(server.url, { method: "POST", body: asked.slice(0, 0) });
        expect(await res.text()).toBe("ok");
        expect({ contentLength: seen[2].contentLength, received: seen[2].received }).toEqual({
          contentLength: "0",
          received: 0,
        });
      });
    }
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
