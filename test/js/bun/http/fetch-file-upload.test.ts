import { expect, test } from "bun:test";
import { isBroken, isWindows, tempDir, withoutAggressiveGC } from "harness";
import fs from "node:fs";
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

// The sendfile path is only taken on POSIX for a plain-HTTP file body
// >= 32 KB; on Windows the file is read fully into memory before the
// request is sent, so a later truncation is not observable.
test.skipIf(isWindows)("fetch rejects when the Bun.file body is truncated mid-upload", async () => {
  const size = 32 * 1024 * 1024;
  using dir = tempDir("fetch-sendfile-truncate", {});
  const p = join(String(dir), "body.bin");
  {
    const fd = fs.openSync(p, "w");
    const chunk = Buffer.alloc(1024 * 1024, 83);
    for (let i = 0; i < size / chunk.length; i++) fs.writeSync(fd, chunk);
    fs.closeSync(fd);
  }

  let head = "";
  let buf = "";
  let socket: net.Socket | undefined;
  const gotHead = Promise.withResolvers<void>();
  const socketClosed = Promise.withResolvers<void>();
  const server = net.createServer(s => {
    socket = s;
    s.once("close", () => {
      gotHead.reject(new Error("socket closed before request head"));
      socketClosed.resolve();
    });
    s.on("error", e => {
      gotHead.reject(e);
      socketClosed.resolve();
    });
    s.on("data", d => {
      if (head !== "") return;
      buf += d.toString("latin1");
      const i = buf.indexOf("\r\n\r\n");
      if (i === -1) return;
      head = buf.slice(0, i);
      s.pause();
      gotHead.resolve();
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as net.AddressInfo).port;
    const req = fetch(`http://127.0.0.1:${port}/upload`, {
      method: "POST",
      body: Bun.file(p),
      signal: AbortSignal.timeout(10_000),
    });

    await gotHead.promise;
    expect(head).toContain(`Content-Length: ${size}`);

    // With the server paused, sendfile fills the kernel send buffer and
    // then parks on EAGAIN with the file offset well short of `size`.
    // Truncating below that offset means the next sendfile(2) call returns
    // 0 with bytes still owed.
    fs.truncateSync(p, 64 * 1024);
    socket!.resume();

    let err: any;
    try {
      await req;
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err?.name).not.toBe("TimeoutError");
    expect(err?.code).toBe("RequestBodyTruncated");

    // The client must close the connection so the origin is not left
    // holding a half-sent body.
    await socketClosed.promise;
  } finally {
    socket?.destroy();
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
      expect(async () => await resp).toThrow("no such file or directory");
    }
  });
  Bun.gc(true);
});
