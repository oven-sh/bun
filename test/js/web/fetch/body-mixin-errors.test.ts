import { describe, expect, it } from "bun:test";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";

describe("body-mixin-errors", () => {
  it.concurrent.each([
    ["Response", () => new Response("a"), (b: Response | Request) => b.text()],
    [
      "Request",
      () => new Request("https://example.com", { body: "{}", method: "POST" }),
      (b: Response | Request) => b.json(),
    ],
  ])("should throw TypeError when body already used on %s", async (type, createBody, secondCall) => {
    const body = createBody();
    await body.text();

    try {
      await secondCall(body);
      expect.unreachable("body is already used");
    } catch (err: any) {
      expect(err.name).toBe("TypeError");
      expect(err.message).toBe("Body already used");
      expect(err instanceof TypeError).toBe(true);
    }
  });

  describe("consuming an errored body", () => {
    // When the response body download fails (socket closes before
    // Content-Length is satisfied) the body Value transitions to `.Error`
    // holding a `ValueError` (a `jsc.Strong`, `bun.String`, or ref-counted
    // `SystemError`). Consuming the body after that point must reject with
    // the stored error. Previously the `.Error` state fell through to
    // `useAsAnyBlob*()` which overwrote it with `.Used` without calling
    // `ValueError.deinit()`, leaking the payload and silently returning an
    // empty body.
    async function withErroredBody(fn: (res: Response) => Promise<unknown>) {
      let currentSocket: Socket | undefined;
      const server = createServer(socket => {
        currentSocket = socket;
        // Promise a large body but only send a few bytes so that closing the
        // socket produces a body download failure.
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\nhello");
      });
      try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as import("node:net").AddressInfo;

        const res = await fetch(`http://127.0.0.1:${port}/`);
        expect(res.status).toBe(200);

        // Close the socket so the body download fails, wait for the kernel
        // to acknowledge the close, then give the HTTP client thread CPU
        // time to observe it and post the failure to the JS event loop so
        // the body transitions from `.Locked` to `.Error`. `Bun.sleep` (as
        // opposed to `setImmediate`) actually yields the CPU so the HTTP
        // thread can run even when the JS thread would otherwise be busy
        // under load.
        const closed = once(currentSocket!, "close");
        currentSocket!.destroy();
        await closed;
        for (let i = 0; i < 20; i++) {
          await Bun.sleep(1);
        }

        return await fn(res);
      } finally {
        server.close();
      }
    }

    // `formData()` is intentionally omitted: without a `Content-Type`
    // header it rejects with `ERR_FORMDATA_PARSE_ERROR` before the body is
    // ever touched, so it cannot observe the `.Error` state independently
    // of the other consumers.
    it.each([
      ["text", (res: Response) => res.text()],
      ["json", (res: Response) => res.json()],
      ["arrayBuffer", (res: Response) => res.arrayBuffer()],
      ["bytes", (res: Response) => res.bytes()],
      ["blob", (res: Response) => res.blob()],
    ] as const)("%s() rejects with the body error instead of returning empty", async (_name, consume) => {
      let threw: unknown;
      let result: unknown;
      try {
        result = await withErroredBody(consume);
      } catch (err) {
        threw = err;
      }
      // Before the fix, text()/bytes()/arrayBuffer()/blob() resolved with an
      // empty value here (and the `ValueError` payload was leaked); json()
      // rejected with an unrelated `SyntaxError`. Now all of them surface the
      // underlying connection error.
      expect(threw, `expected rejection, got ${Bun.inspect(result)}`).toBeDefined();
      expect((threw as { code?: string }).code).toBe("ECONNRESET");
    });

    it("marks the body used after rejecting with the error", async () => {
      await withErroredBody(async res => {
        // First consume rejects with the connection error. Depending on
        // whether the body was already `.Error` or still `.Locked` when
        // consumed this goes through `handleBodyError` directly or through
        // `setPromise` + `toErrorInstance`; either way the body ends up in a
        // terminal state within one extra consume.
        await expect(res.text()).rejects.toMatchObject({ code: "ECONNRESET" });
        // Drain any remaining `.Error` state left by the `.Locked` path.
        await res.text().catch(() => {});
        // Subsequent consume must see the body as already used, proving the
        // `.Error` payload was released and the state moved to `.Used`
        // rather than being leaked.
        await expect(res.text()).rejects.toMatchObject({ code: "ERR_BODY_ALREADY_USED" });
      });
    });
  });
});
