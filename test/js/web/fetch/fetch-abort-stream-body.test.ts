import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
