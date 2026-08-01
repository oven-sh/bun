import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";
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
