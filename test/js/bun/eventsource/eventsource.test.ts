function sse(req: Request) {
  const signal = req.signal;
  return new Response(
    new ReadableStream({
      type: "direct",
      async pull(controller) {
        while (!signal.aborted) {
          await controller.write(`data:Hello, World!\n\n`);
          await controller.write(`event: bun\ndata: Hello, World!\n\n`);
          await controller.write(`event: lines\ndata: Line 1!\ndata: Line 2!\n\n`);
          await controller.write(`event: id_test\nid:1\n\n`);
          await controller.flush();
          await Bun.sleep(100);
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function sse_unstable(req: Request) {
  const signal = req.signal;
  let id = parseInt(req.headers.get("last-event-id") || "0", 10);

  return new Response(
    new ReadableStream({
      type: "direct",
      async pull(controller) {
        if (!signal.aborted) {
          await controller.write(`id:${++id}\ndata: Hello, World!\nretry:100\n\n`);
          await controller.flush();
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function sseServer(
  done: (err?: unknown) => void,
  pathname: string,
  callback: (evtSource: EventSource, done: (err?: unknown) => void) => void,
) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/stream") {
        return sse(req);
      }
      if (new URL(req.url).pathname === "/unstable") {
        return sse_unstable(req);
      }
      return new Response("Hello, World!");
    },
  });
  let evtSource: EventSource | undefined;
  try {
    evtSource = new EventSource(`http://localhost:${server.port}${pathname}`);
    callback(evtSource, err => {
      try {
        done(err);
        evtSource?.close();
      } catch (err) {
        done(err);
      } finally {
        server.stop(true);
      }
    });
  } catch (err) {
    evtSource?.close();
    server.stop(true);
    done(err);
  }
}

import { describe, expect, it } from "bun:test";

describe("events", () => {
  it("should call open", done => {
    sseServer(done, "/stream", (evtSource, done) => {
      evtSource.onopen = () => {
        done();
      };
      evtSource.onerror = err => {
        done(err);
      };
    });
  });

  it("should call message", done => {
    sseServer(done, "/stream", (evtSource, done) => {
      evtSource.onmessage = e => {
        expect(e.data).toBe("Hello, World!");
        done();
      };
    });
  });

  it("should call custom event", done => {
    sseServer(done, "/stream", (evtSource, done) => {
      evtSource.addEventListener("bun", e => {
        expect(e.data).toBe("Hello, World!");
        done();
      });
    });
  });

  it("should call event with multiple lines", done => {
    sseServer(done, "/stream", (evtSource, done) => {
      evtSource.addEventListener("lines", e => {
        expect(e.data).toBe("Line 1!\nLine 2!");
        done();
      });
    });
  });

  it("should receive id", done => {
    sseServer(done, "/stream", (evtSource, done) => {
      evtSource.addEventListener("id_test", e => {
        expect(e.lastEventId).toBe("1");
        done();
      });
    });
  });

  it("should reconnect with id", done => {
    sseServer(done, "/unstable", (evtSource, done) => {
      const ids: string[] = [];
      evtSource.onmessage = e => {
        ids.push(e.lastEventId);
        if (ids.length === 2) {
          for (let i = 0; i < 2; i++) {
            expect(ids[i]).toBe((i + 1).toString());
          }
          done();
        }
      };
    });
  });

  it("should call error", done => {
    sseServer(done, "/", (evtSource, done) => {
      evtSource.onerror = e => {
        expect(e.error.message).toBe(
          `EventSource's response has a MIME type that is not "text/event-stream". Aborting the connection.`,
        );
        done();
      };
    });
  });
});
