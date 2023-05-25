import EventSource from "eventsource";

function sse(req) {
  const signal = req.signal;
  return new Response(
    new ReadableStream({
      type: "direct",
      async pull(controller) {
        while (!signal.aborted) {
          await controller.write(`data:Hello, World!\n\n`);
          await controller.write(`event: bun\ndata: Hello, World!\n\n`);
          await controller.flush();
          await Bun.sleep(1000);
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function sseServer(done, pathname, callback) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/stream") {
        return sse(req);
      }
      return new Response("Hello, World!");
    },
  });
  try {
    callback(`http://localhost:${server.port}${pathname}`, err => {
      done(err);
      server.stop(true);
    });
  } catch (err) {
    server.stop(true);
    done(err);
  }
}

import { describe, expect, it } from "bun:test";

describe("events", () => {
  it("should call open", done => {
    sseServer(done, "/stream", (url, done) => {
      const evtSource = new EventSource(url);
      evtSource.onopen = () => {
        done();
      };
    });
  });

  it("should call message", done => {
    sseServer(done, "/stream", (url, done) => {
      const evtSource = new EventSource(url);
      evtSource.onmessage = e => {
        expect(e.data).toBe("Hello, World!");
        done();
      };
    });
  });

  it("should call custom event", done => {
    sseServer(done, "/stream", (url, done) => {
      const evtSource = new EventSource(url);

      evtSource.addEventListener("bun", e => {
        expect(e.data).toBe("Hello, World!");
        done();
      });
    });
  });

  it("should call error", done => {
    sseServer(done, "/", (url, done) => {
      const evtSource = new EventSource(url);

      evtSource.onerror = e => {
        expect(e.error.message).toBe(
          `EventSource's response has a MIME type that is not "text/event-stream". Aborting the connection.`,
        );
        done();
      };
    });
  });
});
