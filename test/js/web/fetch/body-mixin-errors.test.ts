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

        // Close the socket so the body download fails, then pump the event
        // loop until `FetchTasklet.onBodyReceived` has run on the main thread
        // and transitioned the body to `.Error`. We don't wait on wall-clock
        // time here; each `setImmediate` yields one macrotask turn and the
        // transition happens in a small, bounded number of turns.
        currentSocket!.destroy();
        for (let i = 0; i < 50; i++) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }

        return await fn(res);
      } finally {
        server.close();
      }
    }

    it.each([
      ["text", (res: Response) => res.text()],
      ["json", (res: Response) => res.json()],
      ["arrayBuffer", (res: Response) => res.arrayBuffer()],
      ["bytes", (res: Response) => res.bytes()],
      ["blob", (res: Response) => res.blob()],
      ["formData", (res: Response) => res.formData()],
    ] as const)("%s() rejects with the body error instead of returning empty", async (_name, consume) => {
      let threw: unknown;
      let result: unknown;
      try {
        result = await withErroredBody(consume);
      } catch (err) {
        threw = err;
      }
      // Before the fix, text()/bytes()/arrayBuffer()/blob() resolved with an
      // empty value here and the `ValueError` payload was leaked; json() and
      // formData() resolved or rejected with an unrelated parse error. Now all
      // of them surface the underlying connection error.
      expect(threw, `expected rejection, got ${Bun.inspect(result)}`).toBeDefined();
      expect((threw as { code?: string }).code).toBe("ECONNRESET");
    });

    it("text() marks the body used and does not leak the error on re-consume", async () => {
      await withErroredBody(async res => {
        await expect(res.text()).rejects.toMatchObject({ code: "ECONNRESET" });
        // Second consume should see the body as already used, proving the
        // `.Error` payload was released and the state moved to `.Used`.
        await expect(res.text()).rejects.toMatchObject({ code: "ERR_BODY_ALREADY_USED" });
      });
    });
  });
});
