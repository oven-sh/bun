import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isMacOS, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

// Aborting a fetch whose request body stream is still uploading must also
// settle the response side. The failure callback used to return right after
// cancelling the request-body sink, so a buffered body promise
// (arrayBuffer/text/json) never rejected and awaiting it hung forever.
// Runs in a subprocess because the buggy build leaves zombie requests behind
// that keep the process from exiting.
test.concurrent(
  "abort mid-response rejects buffered body promises while the request body stream is active",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fetch-abort-buffered-body-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("arrayBuffer rejected AbortError\ntext rejected AbortError\n");
    expect(exitCode).toBe(0);
  },
);

// The stream's native NewSource box is owned by a PreciseAllocation source cell
// that GC sweeps synchronously; the Response wrapper (MarkedBlock) is swept
// lazily, so its BodyAbortListener can fire between the two and read the body
// stream through the downgraded `Locked.readable` handle. The fix stores that
// handle as a real JSC::Weak so it reads as empty once reaped. Full details in
// the fixture.
test
  .skipIf(!isASAN)
  .concurrent("abort after reader.cancel() + eden GC does not use a freed response-body source", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fetch-abort-after-cancel-gc-fixture.ts")],
      env: {
        ...bunEnv,
        ITER: "20",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "fast_unwind_on_fatal=1"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("AddressSanitizer");
    expect(stdout).toBe("done 20\n");
    expect(exitCode).toBe(0);
  });

// A native ByteStream request body (an upstream response body piped into
// fetch) that errors or finishes between fetch() and the can_stream tick is
// ended inline by wire_native_sink. That path released the request-stream ref
// but left the sink installed as live, so the terminal
// cancel_request_body_sink released the same ref again and freed the
// FetchTasklet while the completion path was still using it. ASAN-only: the
// release build corrupts silently. Details in the fixture.
test
  .skipIf(!isASAN)
  .concurrent("piping an erroring upstream body into fetch does not double-release the tasklet", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fetch-stream-body-ended-inline-fixture.ts")],
      env: { ...bunEnv, ITER: "100" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("AddressSanitizer");
    expect(stdout).toBe("done 100\n");
    expect(exitCode).toBe(0);
  });

// A direct stream's pull() runs synchronously inside start_request_stream, and
// that only happens once the HTTP thread has sent the headers and asked for the
// body. Writing and then throwing from it tears the request down (clear_sink)
// while the HTTP thread is still flushing the bytes just written and reporting
// the buffer drained, so the JS side clears the buffer's drain callback at the
// same moment the HTTP thread reads it; both have to go through the buffer's
// mutex. Every iteration has to reject with pull's own error, and clearing the
// callback must not deadlock against the HTTP thread holding the buffer.
test.concurrent(
  "request body pull() that writes and then throws rejects the fetch while the upload is in flight",
  async () => {
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Only answer once the client has torn the upload down, so the rejection
        // below can only come from pull()'s error, never from a response.
        await req.arrayBuffer().catch(() => {});
        return new Response("unreachable");
      },
    });

    const iterations = 50;
    // Several chunks over the sink's 16 KiB high water mark, so the HTTP thread
    // is woken and has something to flush (and report drained) while pull()
    // throws on the JS thread.
    const chunk = Buffer.alloc(64 * 1024, "x");
    let pulls = 0;

    for (let i = 0; i < iterations; i++) {
      const error = new Error(`pull ${i}`);
      const body = new ReadableStream({
        type: "direct",
        pull(controller) {
          pulls++;
          for (let j = 0; j < 4; j++) controller.write(chunk);
          throw error;
        },
      });
      await expect(fetch(server.url, { method: "POST", body })).rejects.toBe(error);
    }

    expect(pulls).toBe(iterations);
  },
);

test("aborting fetch with a ReadableStream request body does not double-cancel the sink", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fetch-abort-stream-body-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("done 50\n");
  expect(exitCode).toBe(0);
});

// Fetch spec "abort a fetch" step 4: if response's body is non-null and
// readable, error the stream with the abort reason. When the body is fully
// received before .body is touched, the stream is backed by a ByteBlobLoader
// and abort() used to be a no-op on it (FetchTasklet had already detached its
// listener), so the reader drained the full body and the off-heap store was
// only released by GC. https://github.com/oven-sh/bun/issues/32659
test.concurrent("abort() errors a fully-buffered fetch response body", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Response(new Uint8Array(1024)),
  });
  // Small body with Content-Length arrives with the headers, so by the time
  // the fetch promise resolves the body is an InternalBlob (ByteBlobLoader
  // path) rather than a still-streaming ByteStream.
  const wait = () => new Promise(r => setImmediate(() => setImmediate(r)));

  // abort() before .body: reader rejects, store not drainable.
  {
    const ac = new AbortController();
    const res = await fetch(server.url, { signal: ac.signal });
    await wait();
    ac.abort();
    const reader = res.body!.getReader();
    const result = await reader.read().then(
      r => ({ rejected: false, bytes: r.value?.byteLength ?? 0 }),
      e => ({ rejected: true, name: (e as Error).name }),
    );
    expect(result).toEqual({ rejected: true, name: "AbortError" });
  }

  // abort() after .body.getReader().read(): next read rejects.
  {
    const ac = new AbortController();
    const res = await fetch(server.url, { signal: ac.signal });
    await wait();
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first).toEqual({ done: false, value: new Uint8Array(1024) });
    ac.abort();
    const second = await reader.read().then(
      r => ({ rejected: false, done: r.done }),
      e => ({ rejected: true, name: (e as Error).name }),
    );
    expect(second).toEqual({ rejected: true, name: "AbortError" });
  }

  // abort() before a body consumer: arrayBuffer() rejects.
  {
    const ac = new AbortController();
    const res = await fetch(server.url, { signal: ac.signal });
    await wait();
    ac.abort();
    const result = await res.arrayBuffer().then(
      buf => ({ rejected: false, bytes: buf.byteLength }),
      e => ({ rejected: true, name: (e as Error).name }),
    );
    expect(result).toEqual({ rejected: true, name: "AbortError" });
  }

  // Custom abort reason propagates.
  {
    const ac = new AbortController();
    const res = await fetch(server.url, { signal: ac.signal });
    await wait();
    const reader = res.body!.getReader();
    const reason = new Error("boom");
    ac.abort(reason);
    await expect(reader.read()).rejects.toBe(reason);
  }
});

// Fetch spec "abort a fetch" step 4 errors the body with the signal's abort reason, so every
// reader of the body rejects with `signal.reason` itself. The readers that take `res.body`
// natively (`new Response(res.body).text()` and `Bun.readableStreamTo*()` buffer it without a
// reader, `Bun.write()`, a fetch() upload, HTMLRewriter and a Bun.serve response wire it to their
// sink) got a fresh "AbortError: The operation was aborted." when they had already started, and
// an empty body that ended cleanly when they started after the abort.
describe("aborting mid-body fails every reader of res.body with signal.reason", () => {
  // A head, 40 of 100 body bytes, then nothing: the body is still arriving when the signal fires.
  async function stalledBodyServer() {
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n" + Buffer.alloc(40, "x")));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`,
      [Symbol.dispose]() {
        for (const socket of sockets) socket.destroy();
        server.close();
      },
    };
  }

  // Each returns once the headers arrived; `abort()` then fires the signal (the timer does it alone).
  const signals: Record<string, (url: string) => Promise<{ res: Response; signal: AbortSignal; abort(): void }>> = {
    "AbortSignal.timeout()": async url => {
      // A timer that beats the headers rejects fetch() itself: try again with a longer one.
      for (let ms = 100; ; ms *= 2) {
        const signal = AbortSignal.timeout(ms);
        try {
          return { res: await fetch(url, { signal }), signal, abort() {} };
        } catch (error) {
          if (error !== signal.reason) throw error;
        }
      }
    },
    "abort(new Error())": async url => {
      const controller = new AbortController();
      const res = await fetch(url, { signal: controller.signal });
      return { res, signal: controller.signal, abort: () => controller.abort(new Error("custom")) };
    },
    "abort()": async url => {
      const controller = new AbortController();
      const res = await fetch(url, { signal: controller.signal });
      return { res, signal: controller.signal, abort: () => controller.abort() };
    },
  };

  // Each starts to read before it returns its promise.
  const consumers: Record<string, (res: Response) => Promise<unknown>> = {
    "res.text()": res => res.text(),
    "res.body reader": async res => {
      const reader = res.body!.getReader();
      while (!(await reader.read()).done);
    },
    "res.body.pipeTo()": res => res.body!.pipeTo(new WritableStream({})),
    "new Response(res.body).text()": res => new Response(res.body).text(),
    "new Response(res.body).json()": res => new Response(res.body).json(),
    "new Response(res.body).bytes()": res => new Response(res.body).bytes(),
    "new Response(res.body).blob()": res => new Response(res.body).blob(),
    "new Response(res.body).arrayBuffer()": res => new Response(res.body).arrayBuffer(),
    "new Request(url, { body: res.body }).text()": res =>
      new Request("http://localhost/", { method: "POST", body: res.body }).text(),
    "Bun.readableStreamToText(res.body)": res => Bun.readableStreamToText(res.body!),
    "Bun.readableStreamToBytes(res.body)": async res => await Bun.readableStreamToBytes(res.body!),
    "res.body.text()": res => res.body!.text(),
    "Bun.write(path, new Response(res.body))": async res => {
      using dir = tempDir("fetch-abort-reason", {});
      await Bun.write(join(String(dir), "body"), new Response(res.body));
    },
    "new HTMLRewriter().transform(new Response(res.body)).text()": res =>
      new HTMLRewriter().transform(new Response(res.body)).text(),
  };

  const settle = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      error => error,
    );

  describe.each(Object.keys(signals))("%s after the reader started", kind => {
    test.concurrent.each(Object.keys(consumers))("%s", async name => {
      using server = await stalledBodyServer();
      const { res, signal, abort } = await signals[kind](server.url);
      const settled = settle(consumers[name](res));
      abort();
      expect(await settled).toBe(signal.reason);
    });
  });

  describe("abort(new Error()) before the reader starts", () => {
    test.concurrent.each(Object.keys(consumers))("%s", async name => {
      using server = await stalledBodyServer();
      const { res, signal, abort } = await signals["abort(new Error())"](server.url);
      // The stream exists when the signal fires. Nothing reads it yet.
      expect(res.body).toBeInstanceOf(ReadableStream);
      abort();
      expect(await settle(consumers[name](res))).toBe(signal.reason);
    });
  });

  // A reason does not have to be an Error.
  test.concurrent.each([[null], [42], ["str"], [Symbol("reason")]])(
    "abort(%p) reaches a native reader unchanged",
    async reason => {
      for (const timing of ["after the reader started", "before the reader starts"]) {
        using server = await stalledBodyServer();
        const controller = new AbortController();
        const res = await fetch(server.url, { signal: controller.signal });
        expect(res.body).toBeInstanceOf(ReadableStream);
        if (timing === "before the reader starts") controller.abort(reason);
        const settled = settle(new Response(res.body).text());
        if (timing === "after the reader started") controller.abort(reason);
        expect(await settled).toBe(reason);
      }
    },
  );

  test.concurrent.each(["after the upload started", "before the upload starts"])(
    "fetch(url, { body: res.body }), abort %s",
    async timing => {
      using server = await stalledBodyServer();
      const uploading = Promise.withResolvers<void>();
      await using target = Bun.serve({
        port: 0,
        async fetch(req) {
          const reader = req.body!.getReader();
          // The first body bytes: the upload has wired `res.body` to its sink.
          await reader.read();
          uploading.resolve();
          try {
            while (!(await reader.read()).done);
          } catch {}
          return new Response("ok");
        },
      });

      const controller = new AbortController();
      const reason = new Error("custom");
      const res = await fetch(server.url, { signal: controller.signal });
      const body = res.body;
      if (timing === "before the upload starts") controller.abort(reason);
      const upload = fetch(target.url, { method: "POST", body });
      if (timing === "after the upload started") {
        await uploading.promise;
        controller.abort(reason);
      }
      await expect(upload).rejects.toBe(reason);
    },
  );

  // A response that has not started can still go to the error handler.
  test.concurrent("Bun.serve response of new Response(res.body), abort before the response starts", async () => {
    using server = await stalledBodyServer();
    const reason = new Error("custom");
    await using proxy = Bun.serve({
      port: 0,
      async fetch() {
        const controller = new AbortController();
        const res = await fetch(server.url, { signal: controller.signal });
        const body = res.body;
        controller.abort(reason);
        return new Response(body);
      },
      error: error => new Response(error === reason ? "signal.reason" : `not signal.reason: ${error}`, { status: 502 }),
    });

    const res = await fetch(proxy.url);
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 502, body: "signal.reason" });
  });

  // A response that already streams has sent its status, so the server reports the failure itself
  // (stderr) and cuts the connection.
  test.concurrent("Bun.serve response of new Response(res.body), abort after the response started", async () => {
    const script = `
      import net from "node:net";
      const upstream = net.createServer(socket => {
        socket.on("error", () => {});
        socket.once("data", () =>
          socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 100\\r\\n\\r\\n" + Buffer.alloc(40, "x")),
        );
      });
      await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
      let controller;
      const proxy = Bun.serve({
        port: 0,
        async fetch() {
          controller = new AbortController();
          const res = await fetch("http://127.0.0.1:" + upstream.address().port, { signal: controller.signal });
          return new Response(res.body);
        },
      });
      const res = await fetch(proxy.url);
      const reader = res.body.getReader();
      const first = await reader.read();
      controller.abort(new Error("custom reason"));
      await reader.read().catch(() => {});
      console.log(JSON.stringify({ status: res.status, first: first.value.length }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("error: custom reason");
    expect(stdout).toBe('{"status":200,"first":40}\n');
    expect(exitCode).toBe(0);
  });
});

test.concurrent("abort reaches an in-flight fetch whose signal nothing else references, after GC", async () => {
  const response = Promise.withResolvers<Response>();
  await using server = Bun.serve({ port: 0, fetch: () => response.promise });
  const name = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      error => (error as Error).name,
    );
  // Both routes need a JS wrapper to survive the collections: the timeout source of any() is held
  // by nothing native, and a listener lives on its signal's wrapper.
  let listenerRan = 0;
  const results = [
    name(fetch(server.url, { signal: AbortSignal.any([AbortSignal.timeout(100)]) })),
    (() => {
      const signal = AbortSignal.timeout(100);
      signal.addEventListener("abort", () => listenerRan++);
      return name(fetch(server.url, { signal }));
    })(),
  ];
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(await Promise.all(results)).toEqual(["TimeoutError", "TimeoutError"]);
  expect(listenerRan).toBe(1);
  response.resolve(new Response());
});

// Aborting a fetch that is uploading a large body must close the connection
// in a way the server can observe from its read side. Bun aborts with an
// SO_LINGER{1,0} RST; on macOS that RST's sequence number (snd_nxt, with body
// bytes still in the kernel send buffer) can land past the peer's receive
// window and be dropped, so the server's socket stayed ESTABLISHED and never
// emitted 'end'/'error'/'close'. On macOS close_and_fail now FINs instead, so
// the server drains what was buffered and sees end-of-stream. Linux and
// Windows deliver the RST in window, and a FIN would put every aborted upload
// into TIME_WAIT (ephemeral-port exhaustion under abort churn), so they keep
// the RST and this test is macOS-only.
test.skipIf(!isMacOS)("server socket sees 'end' when a fetch upload is aborted mid-body", async () => {
  const events: string[][] = [];
  const sockets: net.Socket[] = [];
  let gotBody = Promise.withResolvers<void>();
  let socketClosed = Promise.withResolvers<void>();

  const server = net.createServer(s => {
    sockets.push(s);
    const ev: string[] = [];
    events.push(ev);
    let received = 0;
    s.on("data", d => {
      received += d.length;
      if (received >= 256 * 1024) gotBody.resolve();
    });
    s.on("end", () => ev.push("end"));
    s.on("error", (e: NodeJS.ErrnoException) => ev.push(`error:${e.code}`));
    s.once("close", () => {
      ev.push("close");
      socketClosed.resolve();
    });
  });
  server.on("error", e => gotBody.reject(e));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as net.AddressInfo).port;

  try {
    // An SO_LINGER{1,0} RST surfaces to the server as either ECONNRESET or,
    // when the read loop drains the final data and the error on the same
    // hangup event, as an orderly end-of-stream. Several connections make the
    // former reliably observable on a build that still resets.
    const body = new Uint8Array(16 * 1024 * 1024).fill(83);
    for (let i = 0; i < 8; i++) {
      gotBody = Promise.withResolvers<void>();
      socketClosed = Promise.withResolvers<void>();

      const ac = new AbortController();
      const req = fetch(`http://127.0.0.1:${port}/upload`, {
        method: "POST",
        body,
        signal: ac.signal,
      }).catch(e => e);

      // The server is reading, so the client's write side is making progress
      // and has body bytes in flight when the abort fires.
      await gotBody.promise;
      ac.abort();
      expect((await req).name).toBe("AbortError");

      // The server must observe the connection closing from its read side,
      // without having to write to provoke a fresh RST. With the HTTP client
      // aborting via a graceful FIN, the server drains what the kernel had
      // buffered and then sees end-of-stream.
      await socketClosed.promise;
    }
    expect(events).toEqual(Array(8).fill(["end", "close"]));
  } finally {
    for (const s of sockets) s.destroy();
    server.close();
  }
});
