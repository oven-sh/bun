import type { DirectUnderlyingSource } from "bun";
import { describe, expect, test } from "bun:test";

describe("fetch with Request body lifecycle", () => {
  test("should properly handle Request with streaming body", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(text);
      },
    });

    const chunk = new TextEncoder().encode("test data");
    let pulled = false;

    const originalRequest = new Request(server.url, {
      method: "POST",
      body: new ReadableStream({
        async pull(controller) {
          if (pulled) return;
          pulled = true;
          await Bun.sleep(0);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    });

    const response = await fetch(originalRequest);
    expect(await response.text()).toBe("test data");

    // attempting to reuse the request should throw
    await expect(fetch(originalRequest)).rejects.toThrow("Stream already used");
  });

  test("should handle multiple requests with the same streaming body", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(text);
      },
    });

    const makeStream = () => {
      // use raw Uint8Array to avoid string optimization
      const parts = [
        new Uint8Array([111, 114, 105, 103, 105, 110, 97, 108, 32]), // "original "
        new Uint8Array([100, 97, 116, 97]), // "data"
      ];
      let index = 0;

      return new ReadableStream({
        async pull(controller) {
          if (index >= parts.length) {
            controller.close();
            return;
          }
          await Bun.sleep(0);
          controller.enqueue(parts[index++]);
        },
      });
    };

    const makeRequest = () =>
      new Request(server.url, {
        method: "POST",
        body: makeStream(),
      });

    const [r1, r2] = await Promise.all([fetch(makeRequest()), fetch(makeRequest())]);

    expect(await r1.text()).toBe("original data");
    expect(await r2.text()).toBe("original data");
  });

  test("should abort direct streaming body inside pull", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
        } catch {
          // ignore abort from client
        }
        return new Response("ok");
      },
    });

    const abortController = new AbortController();
    const { promise: pull_called, resolve: resolve_pull } = Promise.withResolvers<void>();

    const directSource: DirectUnderlyingSource = {
      type: "direct",
      async pull(controller) {
        // what happened before
        // aborting inside pull triggers a cascade:
        // 1. abort signal fires
        // 2. fetch cancels the request stream (ResumableSink.cancel)
        // 3. cancel calls writeEndRequest on the fetch context
        // 4. writeEndRequest calls deref on the fetch context
        // 5. panic: if the reference count is already 0, indicating a double-deref bug
        //
        // this happens because the stream is both:
        // - retained by the fetch request body
        // - retained by the direct stream pull in progress
        // when abort fires, both paths try to release ownership, causing double-deref
        // TLDR - it panic at abort
        abortController.abort();
        controller.close();
        resolve_pull();
      },
    };

    const stream = new ReadableStream(directSource as any);

    const request = new Request(server.url, {
      method: "POST",
      body: stream,
      signal: abortController.signal,
    });

    const fetchPromise = fetch(request);

    await pull_called;
    await expect(fetchPromise).rejects.toThrow();
  });

  // Tests memory cleanup with large payloads and mid-stream abort
  test("should not crash with large body and abort", async () => {
    const { promise: firstChunkSent, resolve: resolveFirstChunkSent } = Promise.withResolvers<void>();

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // consume the body until the client aborts
        try {
          const reader = req.body!.getReader();
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } catch {
          // ignore abort from client
        }
        return new Response("ok");
      },
    });

    const request = new Request(server.url, {
      method: "POST",
      body: new ReadableStream({
        async start(controller) {
          const chunk = Buffer.alloc(1024 * 256, "a"); // 256KB chunks
          for (let i = 0; i < 4; i++) {
            controller.enqueue(chunk);
            if (i === 0) {
              resolveFirstChunkSent();
            }
            await Promise.resolve();
          }
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const controller = new AbortController();
    const fetchPromise = fetch(request, { signal: controller.signal });

    await firstChunkSent;
    controller.abort();

    await expect(fetchPromise).rejects.toThrow();
  });

  test("should properly cleanup when server closes connection early", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch() {
        // don't read the body, just close
        return new Response("closed early", { status: 200 });
      },
    });

    const request = new Request(server.url, {
      method: "POST",
      body: Buffer.alloc(1024 * 100, "x").toString(), // 100KB
    });

    // should not crash or hang
    const response = await fetch(request);
    expect(await response.text()).toBe("closed early");
  });

  test("should handle async iteration in stream start with cleanup", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(text);
      },
    });

    const cleanup = { called: false };
    async function* dataGenerator() {
      try {
        yield "chunk1\n";
        yield "chunk2\n";
        yield "chunk3\n";
      } finally {
        cleanup.called = true;
      }
    }

    const iterator = dataGenerator();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of iterator) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
        }
      },
      async cancel(reason) {
        if (iterator.return) {
          await iterator.return(reason);
        }
      },
    });

    const request = new Request(server.url, {
      method: "POST",
      body: stream,
    });

    const response = await fetch(request);
    expect(await response.text()).toBe("chunk1\nchunk2\nchunk3\n");
    expect(cleanup.called).toBe(true);
  });

  test("should call cancel when fetch is aborted during async iteration", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.text();
        return new Response("ok");
      },
    });

    const abortController = new AbortController();

    async function* dataGenerator() {
      let i = 0;
      while (i < 50) {
        yield `chunk${i++}\n`;
        await Promise.resolve();
      }
    }

    const iterator = dataGenerator();
    const { promise: firstChunkSent, resolve: resolveFirstChunkSent } = Promise.withResolvers<void>();
    const stream = new ReadableStream({
      async start(controller) {
        let firstChunk = true;
        try {
          for await (const chunk of iterator) {
            controller.enqueue(new TextEncoder().encode(chunk));
            if (firstChunk) {
              firstChunk = false;
              resolveFirstChunkSent();
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
        }
      },
      async cancel(reason) {
        if (iterator.return) {
          await iterator.return(reason);
        }
      },
    });

    const request = new Request(server.url, {
      method: "POST",
      body: stream,
      signal: abortController.signal,
    });

    const fetchPromise = fetch(request);

    await firstChunkSent;
    abortController.abort();

    await expect(fetchPromise).rejects.toThrow();
  });
});
