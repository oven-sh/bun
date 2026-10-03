import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isBroken, isLinux, isWindows, tempDir, withoutAggressiveGC } from "harness";
import { existsSync } from "node:fs";
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

async function runChild(script: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A procfs file is a regular file with st_size 0 and content. The upload reads
// it on the JS thread. The read must go to EOF, or to the end of a slice, and
// not stop at the 256 KiB scratch buffer. The child reads its own
// /proc/self/environ, which three 100 KB variables make larger than that.
test.skipIf(!isLinux)("uploads a procfs file and its slices, not the stat size", async () => {
  const big = Buffer.alloc(100_000, "x").toString();
  const { stdout, stderr, exitCode } = await runChild(
    `const { readFileSync, statSync } = require("node:fs");
     const path = "/proc/self/environ";
     const all = readFileSync(path);
     await using server = Bun.serve({
       port: 0,
       fetch: async req => {
         const bytes = await req.bytes();
         return Response.json({
           contentLength: Number(req.headers.get("content-length")),
           received: bytes.length,
           hash: String(Bun.hash(bytes)),
         });
       },
     });
     const file = Bun.file(path);
     const cases = {
       whole: [file, all],
       from1: [file.slice(1), all.subarray(1)],
       first270000: [file.slice(0, 270_000), all.subarray(0, 270_000)],
       window: [file.slice(5, 270_005), all.subarray(5, 270_005)],
     };
     const out = { stat: statSync(path).size, total: all.length };
     for (const [name, [body, expected]] of Object.entries(cases)) {
       const { hash, ...got } = await (await fetch(server.url, { method: "POST", body })).json();
       out[name] = { ...got, same: hash === String(Bun.hash(expected)) };
     }
     console.log(JSON.stringify(out));`,
    { ...bunEnv, BIG_ENV_A: big, BIG_ENV_B: big, BIG_ENV_C: big },
  );
  expect(stderr).toBe("");
  const result = JSON.parse(stdout);
  const total: number = result.total;
  expect(total).toBeGreaterThan(270_005);
  expect(result).toEqual({
    stat: 0,
    total,
    whole: { contentLength: total, received: total, same: true },
    from1: { contentLength: total - 1, received: total - 1, same: true },
    first270000: { contentLength: 270_000, received: 270_000, same: true },
    window: { contentLength: 270_000, received: 270_000, same: true },
  });
  expect(exitCode).toBe(0);
});

// /dev/zero has no EOF, so only a regular file is read past the bound. The
// body is read on the JS thread: a read with no bound never returns, so the
// upload runs in a child that this process can outlive.
test.skipIf(isWindows)("upload of a device with no EOF sends a bounded body", async () => {
  const { stdout, stderr, exitCode } = await runChild(
    `await using server = Bun.serve({
       port: 0,
       fetch: async req => new Response(String((await req.bytes()).length)),
     });
     const res = await fetch(server.url, { method: "POST", body: Bun.file("/dev/zero") });
     console.log(await res.text());`,
  );
  expect(stderr).toBe("");
  const received = Number(stdout);
  expect(received).toBeGreaterThan(0);
  expect(received).toBeLessThanOrEqual(1024 * 1024);
  expect(exitCode).toBe(0);
});

// /proc/self/pagemap is a regular file with st_size 0 that yields hundreds of
// GB. The read stops at the size limit of a JS buffer, which the child lowers.
test.skipIf(!isLinux || !existsSync("/proc/self/pagemap"))(
  "upload of a procfs file with no practical end fails at the size limit",
  async () => {
    const { stdout, stderr, exitCode } = await runChild(
      `require("bun:internal-for-testing").setSyntheticAllocationLimitForTesting(1024 * 1024);
       await using server = Bun.serve({
         port: 0,
         fetch: async req => new Response(String((await req.bytes()).length)),
       });
       try {
         const res = await fetch(server.url, { method: "POST", body: Bun.file("/proc/self/pagemap") });
         console.log(JSON.stringify({ received: Number(await res.text()) }));
       } catch (e) {
         console.log(JSON.stringify({ code: e.code, syscall: e.syscall }));
       }`,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ code: "ENOMEM", syscall: "read" });
    expect(exitCode).toBe(0);
  },
);
