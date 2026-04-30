import { describe, expect, test } from "bun:test";

function sseServer(handler: (controller: ReadableStreamDirectController, req: Request) => void | Promise<void>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            await handler(controller, req);
          },
        }),
        {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        },
      );
    },
  });
}

describe("EventSource", () => {
  test("is exposed as a global constructor", () => {
    expect(typeof EventSource).toBe("function");
    expect(EventSource.name).toBe("EventSource");
    expect(EventSource.CONNECTING).toBe(0);
    expect(EventSource.OPEN).toBe(1);
    expect(EventSource.CLOSED).toBe(2);
  });

  test("constructor throws SyntaxError for an invalid URL", () => {
    expect(() => new EventSource("not a url")).toThrow();
    try {
      new EventSource("not a url");
      expect.unreachable();
    } catch (e: any) {
      expect(e.name).toBe("SyntaxError");
    }
  });

  test("receives open + message events and populates MessageEvent fields", async () => {
    await using server = sseServer(async (c, req) => {
      c.write("data: hello\n\n");
      c.write("id: abc\ndata: world\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });

    const es = new EventSource(server.url.href);
    expect(es.url).toBe(server.url.href);
    expect(es.withCredentials).toBe(false);
    expect(es.readyState).toBe(EventSource.CONNECTING);

    let opened: Event | undefined;
    let openReadyState = -1;
    es.onopen = e => {
      opened = e;
      openReadyState = es.readyState;
    };

    const messages: MessageEvent[] = [];
    await new Promise<void>(resolve => {
      es.onmessage = e => {
        messages.push(e);
        if (messages.length === 2) resolve();
      };
    });

    expect(opened?.type).toBe("open");
    expect(openReadyState).toBe(EventSource.OPEN);

    expect(messages[0]).toBeInstanceOf(MessageEvent);
    expect(messages[0].type).toBe("message");
    expect(messages[0].data).toBe("hello");
    expect(messages[0].lastEventId).toBe("");
    expect(messages[0].origin).toBe(server.url.origin);

    expect(messages[1].data).toBe("world");
    expect(messages[1].lastEventId).toBe("abc");

    es.close();
    expect(es.readyState).toBe(EventSource.CLOSED);
    expect(es.onmessage).toBeFunction();
    expect(es.CONNECTING).toBe(0);
    expect(es.OPEN).toBe(1);
    expect(es.CLOSED).toBe(2);
  });

  test("parses multi-line data, custom event types, CRLF, and comments", async () => {
    await using server = sseServer(async (c, req) => {
      // CRLF line endings
      c.write("data: a\r\ndata: b\r\n\r\n");
      // comment line
      c.write(": this is ignored\n");
      // custom event type
      c.write("event: ping\ndata: pong\n\n");
      // field with no value → empty-string data per spec
      c.write("data\n\n");
      // leading empty data line is significant
      c.write("data:\ndata: x\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });

    const es = new EventSource(server.url.href);
    const received: Array<[string, string]> = [];
    const done = new Promise<void>(resolve => {
      const check = () => {
        if (received.length === 4) resolve();
      };
      es.onmessage = e => {
        received.push(["message", e.data]);
        check();
      };
      es.addEventListener("ping", (e: MessageEvent) => {
        received.push(["ping", e.data]);
        check();
      });
    });
    await done;

    expect(received).toEqual([
      ["message", "a\nb"],
      ["ping", "pong"],
      ["message", ""],
      ["message", "\nx"],
    ]);
    es.close();
  });

  test("strips one leading UTF-8 BOM from the stream", async () => {
    await using server = sseServer(async (c, req) => {
      c.write("\uFEFFdata: bom\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });
    const es = new EventSource(server.url.href);
    const msg = await new Promise<MessageEvent>(r => (es.onmessage = r));
    expect(msg.data).toBe("bom");
    es.close();
  });

  test("strips a leading BOM even when its bytes span multiple chunks", async () => {
    // Flush each BOM byte separately so the parser's chunk-boundary BOM
    // buffering is exercised. If the transport happens to coalesce them
    // the single-chunk BOM path is taken instead — either way the final
    // assertion holds, so this test cannot flake false-positive.
    await using server = sseServer(async (c, req) => {
      c.write(new Uint8Array([0xef]));
      await c.flush();
      c.write(new Uint8Array([0xbb]));
      await c.flush();
      c.write(new Uint8Array([0xbf]));
      await c.flush();
      c.write("data: split-bom\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });
    const es = new EventSource(server.url.href);
    const msg = await new Promise<MessageEvent>(r => (es.onmessage = r));
    expect(msg.data).toBe("split-bom");
    es.close();
  });

  test("reconnects after the stream ends and sends Last-Event-ID", async () => {
    let connections = 0;
    let sawLastEventId: string | null = null;
    let retrySeen = false;

    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        connections++;
        const conn = connections;
        if (conn === 2) sawLastEventId = req.headers.get("Last-Event-ID");
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(c) {
              if (conn === 1) {
                c.write("retry: 20\n");
                c.write("id: evt-1\ndata: first\n\n");
                await c.flush();
                c.close(); // server closes → client should reconnect
              } else {
                c.write("data: second\n\n");
                await c.flush();
                await new Promise(r => req.signal.addEventListener("abort", r));
              }
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });

    const es = new EventSource(server.url.href);
    const msgs: string[] = [];
    let errorFiredWhileConnecting = false;

    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING) errorFiredWhileConnecting = true;
      retrySeen = true;
    };

    await new Promise<void>(resolve => {
      es.onmessage = e => {
        msgs.push(e.data);
        if (msgs.length === 2) resolve();
      };
    });

    expect(msgs).toEqual(["first", "second"]);
    expect(connections).toBe(2);
    expect(sawLastEventId).toBe("evt-1");
    expect(retrySeen).toBe(true);
    expect(errorFiredWhileConnecting).toBe(true);
    es.close();
  });

  test("non-200 response fails the connection with readyState CLOSED", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("no", { status: 500 }),
    });

    const es = new EventSource(server.url.href);
    const err = await new Promise<Event>(resolve => (es.onerror = resolve));
    expect(err.type).toBe("error");
    expect(es.readyState).toBe(EventSource.CLOSED);
    es.close();
  });

  test("wrong Content-Type fails the connection with readyState CLOSED", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("hello", { headers: { "Content-Type": "text/plain" } }),
    });

    const es = new EventSource(server.url.href);
    await new Promise<void>(resolve => (es.onerror = () => resolve()));
    expect(es.readyState).toBe(EventSource.CLOSED);
    es.close();
  });

  test("addEventListener / removeEventListener", async () => {
    await using server = sseServer(async (c, req) => {
      c.write("data: 1\n\n");
      c.write("data: 2\n\n");
      c.write("data: 3\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });

    const es = new EventSource(server.url.href);
    const hits: number[] = [];
    const listener = (e: MessageEvent) => {
      hits.push(Number(e.data));
      if (e.data === "2") es.removeEventListener("message", listener);
    };
    es.addEventListener("message", listener);
    // Adding the same listener twice should be a no-op.
    es.addEventListener("message", listener);

    await new Promise<void>(resolve => {
      es.onmessage = e => {
        if (e.data === "3") resolve();
      };
    });

    // Listener saw 1 and 2 (once each); removed itself after 2.
    expect(hits).toEqual([1, 2]);
    es.close();
  });

  test("passes custom headers to the request (Bun extension)", async () => {
    let gotAuth: string | null = null;
    let gotAccept: string | null = null;
    await using server = sseServer(async (c, req) => {
      gotAuth = req.headers.get("Authorization");
      gotAccept = req.headers.get("Accept");
      c.write("data: ok\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });

    const es = new EventSource(server.url.href, {
      // @ts-expect-error Bun extension
      headers: { Authorization: "Bearer token-123" },
    });
    await new Promise<void>(r => (es.onmessage = () => r()));
    expect(gotAuth).toBe("Bearer token-123");
    expect(gotAccept).toBe("text/event-stream");
    es.close();
  });

  test("ref() / unref() return undefined and don't throw", async () => {
    await using server = sseServer(async (c, req) => {
      c.write("data: x\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });
    const es = new EventSource(server.url.href);
    // @ts-expect-error Bun extension
    expect(es.unref()).toBeUndefined();
    // @ts-expect-error Bun extension
    expect(es.ref()).toBeUndefined();
    await new Promise<void>(r => (es.onmessage = () => r()));
    es.close();
  });

  test("dispatchEvent routes to on-handlers and listeners and returns !defaultPrevented", () => {
    const es = new EventSource("http://127.0.0.1:1/"); // will error async; fine
    let onmsgHit = 0;
    let listenerHit = 0;
    es.onmessage = () => onmsgHit++;
    es.addEventListener("message", () => listenerHit++);
    const ev = new MessageEvent("message", { data: "synthetic" });
    expect(es.dispatchEvent(ev)).toBe(true);
    expect(onmsgHit).toBe(1);
    expect(listenerHit).toBe(1);

    const cancelable = new Event("message", { cancelable: true });
    es.addEventListener("message", e => e.preventDefault(), { once: true });
    expect(es.dispatchEvent(cancelable)).toBe(false);
    es.close();
  });

  test("addEventListener honours { once: true } and accepts { handleEvent } objects", async () => {
    await using server = sseServer(async (c, req) => {
      c.write("data: 1\n\n");
      c.write("data: 2\n\n");
      c.write("data: 3\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });

    const es = new EventSource(server.url.href);
    const onceHits: string[] = [];
    const objHits: string[] = [];
    let objThis: unknown;

    es.addEventListener("message", (e: MessageEvent) => onceHits.push(e.data), { once: true });
    const listenerObj = {
      handleEvent(this: unknown, e: MessageEvent) {
        objThis = this;
        objHits.push(e.data);
      },
    };
    es.addEventListener("message", listenerObj);

    await new Promise<void>(resolve => {
      es.onmessage = e => {
        if (e.data === "3") resolve();
      };
    });

    expect(onceHits).toEqual(["1"]);
    expect(objHits).toEqual(["1", "2", "3"]);
    expect(objThis).toBe(listenerObj);

    es.removeEventListener("message", listenerObj);
    es.dispatchEvent(new MessageEvent("message", { data: "4" }));
    expect(objHits).toEqual(["1", "2", "3"]);
    es.close();
  });

  test("close() inside a listener still delivers the in-flight event to remaining listeners", async () => {
    await using server = sseServer(async (c, req) => {
      c.write("data: x\n\n");
      await c.flush();
      await new Promise(r => req.signal.addEventListener("abort", r));
    });

    const es = new EventSource(server.url.href);
    const hits: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    // Per spec, EventSource#close() only aborts the fetch and sets
    // readyState — it does not set the stop-immediate-propagation flag,
    // so every listener snapshotted for this event must still fire.
    es.onmessage = () => {
      hits.push("onmessage");
      es.close();
    };
    es.addEventListener("message", () => {
      hits.push("listener-1");
      expect(es.readyState).toBe(EventSource.CLOSED);
    });
    es.addEventListener("message", () => {
      hits.push("listener-2");
      resolve();
    });
    await promise;
    expect(hits).toEqual(["onmessage", "listener-1", "listener-2"]);
    expect(es.readyState).toBe(EventSource.CLOSED);
  });

  test("listener identity includes the capture flag for dedupe and removal", () => {
    const es = new EventSource("http://127.0.0.1:1/");
    let hits = 0;
    const fn = () => hits++;
    // Same callback, different capture → two distinct registrations.
    es.addEventListener("ping", fn, true);
    es.addEventListener("ping", fn, false);
    // Duplicate of the bubble registration → ignored.
    es.addEventListener("ping", fn, { capture: false });
    es.dispatchEvent(new Event("ping"));
    expect(hits).toBe(2);

    // Remove only the bubble one; the capture one remains.
    es.removeEventListener("ping", fn, false);
    es.dispatchEvent(new Event("ping"));
    expect(hits).toBe(3);

    // Removing with the wrong capture is a no-op.
    es.removeEventListener("ping", fn, false);
    es.dispatchEvent(new Event("ping"));
    expect(hits).toBe(4);

    // Removing with matching capture finally drops it.
    es.removeEventListener("ping", fn, { capture: true });
    es.dispatchEvent(new Event("ping"));
    expect(hits).toBe(4);
    es.close();
  });

  test("removeEventListener during dispatch skips the removed listener", () => {
    const es = new EventSource("http://127.0.0.1:1/");
    const hits: string[] = [];
    const b = () => hits.push("b");
    es.addEventListener("tick", () => {
      hits.push("a");
      es.removeEventListener("tick", b);
    });
    es.addEventListener("tick", b);
    es.addEventListener("tick", () => hits.push("c"));
    es.dispatchEvent(new Event("tick"));
    // b was removed before its turn in the snapshot → skipped.
    expect(hits).toEqual(["a", "c"]);
    es.close();
  });
});
