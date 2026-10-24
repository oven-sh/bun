import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  getFDCount,
  isBroken,
  isLinux,
  isPosix,
  isWindows,
  tempDir,
  tls,
  withoutAggressiveGC,
} from "harness";
import { once } from "node:events";
import { closeSync, existsSync, openSync, readFileSync, truncateSync } from "node:fs";
import net from "node:net";
import { createServer as createTlsServer } from "node:tls";
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

describe.skipIf(isWindows)("Bun.stdin fed by a pipe uploads every byte", () => {
  test.concurrent.each(["the body", "a FormData part"])("as %s", async kind => {
    const payload = Buffer.alloc(1024 * 1024, "0123456789abcdef_");
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      maxRequestBodySize: payload.length * 2,
      async fetch(req) {
        const bytes =
          kind === "the body" ? await req.bytes() : await ((await req.formData()).get("file") as Blob).bytes();
        return new Response(`${bytes.length} ${Bun.SHA256.hash(bytes, "hex")}`);
      },
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let body = Bun.stdin;
        if (process.argv[1] !== "the body") {
          body = new FormData();
          body.append("file", Bun.stdin, "stdin.bin");
        }
        console.log(await (await fetch(process.argv[2], { method: "POST", body })).text());`,
        kind,
        server.url.href,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(payload);
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
      proc.stdin.end(),
    ]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `${payload.length} ${Bun.SHA256.hash(payload, "hex")}\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});

// A file of 32 KiB or more over plain http takes the sendfile path, where fetch() owns the descriptor.
describe.skipIf(!isPosix)("fetch() closes the file behind a Bun.file() body", () => {
  const bytes = Buffer.alloc(64 * 1024, 7);

  test.each([
    [0, 0, 0],
    [100, 100, 0],
    [0, 40000, 40000],
  ])("slice(%d, %d)", async (start, end, size) => {
    using dir = tempDir("fetch-file-slice-closed", { "f.bin": bytes });
    const path = join(String(dir), "f.bin");
    using server = Bun.serve({
      port: 0,
      development: false,
      async fetch(req) {
        const received = (await req.arrayBuffer()).byteLength;
        return Response.json({ contentLength: req.headers.get("content-length"), received });
      },
    });
    const upload = async () => {
      const res = await fetch(server.url, { method: "POST", body: Bun.file(path).slice(start, end) });
      expect(await res.json()).toEqual({ contentLength: String(size), received: size });
    };

    // The keep-alive socket belongs in the baseline.
    await upload();
    const before = getFDCount();
    for (let i = 0; i < 16; i++) await upload();
    expect(getFDCount() - before).toBeLessThan(4);
  });
});

// On Windows the body is read through libuv, which needs a C runtime descriptor for the duplicated handle.
test("fetch() releases the descriptor it duplicates for a Bun.file(fd) body", async () => {
  using dir = tempDir("fetch-file-fd-released", { "body.txt": "hello" });
  const path = join(String(dir), "body.txt");
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch: async req => new Response(await req.text()),
  });
  const fd = openSync(path, "r");
  try {
    const upload = async () => {
      const res = await fetch(server.url, { method: "POST", body: Bun.file(fd) });
      await res.text();
      expect(res.status).toBe(200);
    };
    // openSync() returns the lowest free descriptor.
    const lowestFreeFd = () => {
      const probe = openSync(path, "r");
      closeSync(probe);
      return probe;
    };

    // The keep-alive socket belongs in the baseline.
    await upload();
    const before = lowestFreeFd();
    for (let i = 0; i < 32; i++) await upload();
    expect(lowestFreeFd() - before).toBeLessThan(16);
  } finally {
    closeSync(fd);
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

describe("a body that can't be read rejects with a TypeError", () => {
  // The body is read before connecting, so an already-rejected promise means the body failed, not the connection.
  async function bodyError(promise: Promise<Response>) {
    expect(Bun.peek.status(promise)).toBe("rejected");
    const error = await promise.catch(e => e);
    expect(error).toBeInstanceOf(TypeError);
    return error;
  }
  const url = "http://127.0.0.1:1/";

  test("Bun.file() that doesn't exist", async () => {
    using dir = tempDir("fetch-unreadable-body", {});
    const path = join(String(dir), "missing.txt");
    const expected = { code: "ENOENT", errno: expect.any(Number), syscall: "open", path };
    expect(await bodyError(fetch(url, { method: "POST", body: Bun.file(path) }))).toMatchObject(expected);
    const request = new Request(url, { method: "POST", body: Bun.file(path) });
    expect(await bodyError(fetch(request))).toMatchObject(expected);
  });

  test.skipIf(isWindows)("Bun.file() of a directory", async () => {
    using dir = tempDir("fetch-unreadable-body", {});
    expect(await bodyError(fetch(url, { method: "POST", body: Bun.file(String(dir)) }))).toMatchObject({
      code: "EISDIR",
      syscall: "read",
    });
  });

  test("FormData with a Bun.file() that doesn't exist", async () => {
    using dir = tempDir("fetch-unreadable-body", { "present.txt": "present" });
    const path = join(String(dir), "missing.txt");
    const body = new FormData();
    body.append("field", "value");
    body.append("present", Bun.file(join(String(dir), "present.txt")));
    body.append("missing", Bun.file(path));
    const expected = { code: "ENOENT", errno: expect.any(Number), syscall: "open", path };
    expect(await bodyError(fetch(url, { method: "POST", body }))).toMatchObject(expected);
    expect(await bodyError(fetch({ url, method: "POST", body } as any))).toMatchObject(expected);

    for (const construct of [() => new Response(body), () => new Request(url, { method: "POST", body })]) {
      let error: unknown;
      try {
        construct();
      } catch (e) {
        error = e;
      }
      expect(error).toMatchObject({ name: "Error", ...expected });
    }
  });

  test.skipIf(isWindows)("Bun.file() of a closed file descriptor", async () => {
    const fd = 1 << 30;
    expect(await bodyError(fetch(url, { method: "POST", body: Bun.file(fd) }))).toMatchObject({ code: "EBADF", fd });
  });
});

// A unix socket, because its send buffer is small and has a known size.
test.skipIf(!isLinux)(
  "a Bun.file() body waits for the socket when the request head has filled the send buffer",
  async () => {
    using dir = tempDir("fetch-file-full-buffer", {});
    const content = Buffer.alloc(100_000, "0123456789");
    await Bun.write(join(String(dir), "body"), content);
    const sendBuffer = Number(readFileSync("/proc/sys/net/core/wmem_default", "utf8"));
    using other = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });

    for (const [i, extra] of [-2048, 0, 2048, 4096].entries()) {
      const unix = join(String(dir), `${i}.sock`);
      const { promise: accepted, resolve: onConnection } = Promise.withResolvers<net.Socket>();
      const server = net.createServer({ pauseOnConnect: true }, onConnection);
      await once(server.listen(unix), "listening");
      try {
        const headers = { "x-pad": Buffer.alloc(sendBuffer + extra, "a").latin1Slice() };
        const upload = fetch("http://localhost/", {
          unix,
          method: "PUT",
          body: Bun.file(join(String(dir), "body")),
          headers,
        });
        const socket = await accepted;
        // The HTTP thread has written what it can of the upload by the time it has finished a request that was queued later.
        await (await fetch(other.url)).text();

        let received = Buffer.alloc(0);
        socket.on("data", data => {
          received = Buffer.concat([received, data]);
          const headEnd = received.indexOf("\r\n\r\n");
          if (headEnd < 0 || received.length < headEnd + 4 + content.length) return;
          const whole = received.subarray(headEnd + 4).equals(content);
          socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${String(whole).length}\r\nConnection: close\r\n\r\n${whole}`);
        });
        socket.resume();
        expect(await (await upload).text()).toBe("true");
      } finally {
        server.close();
      }
    }
  },
);

// Windows reads the whole file before it sends the head.
describe.skipIf(isWindows)("a file that becomes shorter during the upload", () => {
  test.concurrent.each(["the first hop", "a redirected hop over TLS"])("rejects on %s", async hop => {
    using dir = tempDir("fetch-file-shorter", {});
    const path = join(String(dir), "body");
    // More than the socket buffers of both ends can take. Sparse, so it costs nothing to make.
    closeSync(openSync(path, "w"));
    truncateSync(path, 64 * 1024 * 1024);

    // Stops reading at the head, cuts the file, and reads on.
    const onConnection = (socket: net.Socket) => {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.pause();
        truncateSync(path, 0);
        socket.resume();
      });
    };
    const target = hop === "the first hop" ? net.createServer(onConnection) : createTlsServer(tls, onConnection);
    await once(target.listen(0, "127.0.0.1"), "listening");
    const { port } = target.address() as net.AddressInfo;
    using redirector = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(null, { status: 307, headers: { Location: `https://127.0.0.1:${port}/` } }),
    });
    try {
      const url = hop === "the first hop" ? `http://127.0.0.1:${port}/` : redirector.url;
      // The signal only ends a run in which the fetch would otherwise wait for its idle timeout.
      const init = { method: "PUT", body: Bun.file(path), tls: { ca: tls.cert }, signal: AbortSignal.timeout(4000) };
      await expect(fetch(url, init)).rejects.toMatchObject({ code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" });
    } finally {
      target.close();
    }
  });
});

describe.skipIf(!isLinux)("a procfs file, which is a regular file with st_size 0", () => {
  async function runChild(script: string, env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Three 100 KB variables make the child's /proc/self/environ larger than the 256 KiB the first read takes.
  test.concurrent("uploads the whole file and whole slices", async () => {
    const big = Buffer.alloc(100_000, "x").toString();
    const { stdout, stderr, exitCode } = await runChild(
      `const path = "/proc/self/environ";
       const all = require("node:fs").readFileSync(path);
       await using server = Bun.serve({
         port: 0,
         fetch: async req => {
           const bytes = await req.bytes();
           return Response.json({ received: bytes.length, hash: String(Bun.hash(bytes)) });
         },
       });
       const file = Bun.file(path);
       const cases = {
         whole: [file, all],
         from1: [file.slice(1), all.subarray(1)],
         first270000: [file.slice(0, 270_000), all.subarray(0, 270_000)],
         window: [file.slice(5, 270_005), all.subarray(5, 270_005)],
       };
       const out = { total: all.length };
       for (const [name, [body, expected]] of Object.entries(cases)) {
         const { received, hash } = await (await fetch(server.url, { method: "POST", body })).json();
         out[name] = { received, same: hash === String(Bun.hash(expected)) };
       }
       console.log(JSON.stringify(out));`,
      { ...bunEnv, BIG_ENV_A: big, BIG_ENV_B: big, BIG_ENV_C: big },
    );
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    const total: number = result.total;
    expect(total).toBeGreaterThan(270_005);
    expect(result).toEqual({
      total,
      whole: { received: total, same: true },
      from1: { received: total - 1, same: true },
      first270000: { received: 270_000, same: true },
      window: { received: 270_000, same: true },
    });
    expect(exitCode).toBe(0);
  });

  // /proc/self/pagemap yields hundreds of GB. The child lowers the size limit of a JS buffer to keep this fast.
  test
    .skipIf(!existsSync("/proc/self/pagemap"))
    .concurrent("rejects with ENOMEM at the size limit when the file has no practical end", async () => {
      const { stdout, stderr, exitCode } = await runChild(
        `require("bun:internal-for-testing").setSyntheticAllocationLimitForTesting(1024 * 1024);
       const error = await fetch("http://127.0.0.1:1/", { method: "POST", body: Bun.file("/proc/self/pagemap") }).catch(e => e);
       console.log(JSON.stringify({ code: error.code, syscall: error.syscall }));`,
      );
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ code: "ENOMEM", syscall: "read" });
      expect(exitCode).toBe(0);
    });
});

describe.skipIf(!isPosix)("a character device, which never reaches EOF", () => {
  test("uploads a whole slice", async () => {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async req => new Response(`${req.headers.get("content-length")} ${(await req.bytes()).length}`),
    });
    const body = Bun.file("/dev/zero").slice(0, 1024 * 1024);
    expect(await (await fetch(server.url, { method: "POST", body })).text()).toBe("1048576 1048576");
  });

  // The child lowers the size limit of a JS buffer to keep this fast.
  test("rejects with ENOMEM at the size limit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `require("bun:internal-for-testing").setSyntheticAllocationLimitForTesting(1024 * 1024);
         const error = await fetch("http://127.0.0.1:1/", { method: "POST", body: Bun.file("/dev/zero") }).catch(e => e);
         console.log(JSON.stringify({ code: error.code, syscall: error.syscall }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ code: "ENOMEM", syscall: "read" });
    expect(exitCode).toBe(0);
  });
});
