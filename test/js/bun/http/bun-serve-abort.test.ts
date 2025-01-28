import { describe, expect, test, mock } from "bun:test";
import { bunEnv, bunExe, rejectUnauthorizedScope, tempDirWithFiles, tls } from "harness";

describe("server.abort()", async () => {
  test("after sleep", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        await Bun.sleep(0);
        server.abort(request);
        return new Response("Hello, world!");
      },
    });

    expect(async () => {
      const response = await fetch(`http://localhost:${server.port}`);
    }).toThrow("The socket connection was closed");
  });

  test("before sleep", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        expect(server.abort(request)).toBe(true);
        await Bun.sleep(0);
        // calling it again should do nothing
        expect(server.abort(request)).toBe(false);

        return new Response("Hello, world!");
      },
    });

    expect(async () => {
      await fetch(`http://localhost:${server.port}`);
    }).toThrow("The socket connection was closed");
  });

  test("slightly after response is returned", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        queueMicrotask(() => {
          expect(server.abort(request)).toBe(true);
        });
        return new Response("hello!");
      },
    });

    expect(async () => {
      await fetch(`http://localhost:${server.port}`);
    }).toThrow("The socket connection was closed");
  });

  test("after response was probably sent does nothing", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        setTimeout(() => {
          expect(server.abort(request)).toBe(false);
        }, 0);
        return new Response("hello!");
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello!");
  });

  test("triggers AbortSignal", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        const fn = mock(() => {
          // already aborted.
          expect(server.abort(request)).toBe(false);
        });
        request.signal.addEventListener("abort", fn);
        expect(server.abort(request)).toBe(true);

        // you can return undefined and it should not trigger an uncaught exception
      },
    });

    expect(async () => {
      await fetch(`http://localhost:${server.port}`);
    }).toThrow("The socket connection was closed");
  });

  test("triggers AbortSignal after sleep", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        const fn = mock(() => {
          // already aborted.
          expect(server.abort(request)).toBe(false);
        });
        request.signal.addEventListener("abort", fn);

        await Bun.sleep(0);
        expect(server.abort(request)).toBe(true);

        // you can return undefined and it should not trigger an uncaught exception
      },
    });

    expect(async () => {
      await fetch(`http://localhost:${server.port}`);
    }).toThrow("The socket connection was closed");
  });

  test("works inside of a ReadableStream on the original Request with sleep", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              await Bun.sleep(0);
              server.abort(request);
              controller.close();
            },
          }),
        );
      },
    });

    expect(async () => {
      await fetch(`http://localhost:${server.port}`);
    }).toThrow("The socket connection was closed");
  });

  test("works inside of a ReadableStream on the original Request without sleep", async () => {
    using server = Bun.serve({
      port: 0,

      async fetch(request, server) {
        return new Response(
          new ReadableStream({
            pull(controller) {
              server.abort(request);
              controller.close();
            },
          }),
        );
      },
    });

    expect(async () => {
      await fetch(`http://localhost:${server.port}`);
    }).toThrow("The socket connection was closed");
  });

  test("works inside of a ReadableStream on the original Request without sleep, with SSL", async () => {
    using server = Bun.serve({
      port: 0,
      tls: tls,
      async fetch(request, server) {
        return new Response(
          new ReadableStream({
            pull(controller) {
              server.abort(request);
              controller.close();
            },
          }),
        );
      },
    });

    expect(async () => {
      await fetch(`https://localhost:${server.port}`, {
        tls: {
          rejectUnauthorized: false,
        },
      });
    }).toThrow("The socket connection was closed");
  });
});
