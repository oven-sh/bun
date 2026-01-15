import { describe, expect, it } from "bun:test";

// Test for https://github.com/oven-sh/bun/issues/3319
// EventSource (Server-Sent Events) implementation

describe("EventSource", () => {
  it("should be defined globally", () => {
    expect(typeof EventSource).toBe("function");
    expect(EventSource.CONNECTING).toBe(0);
    expect(EventSource.OPEN).toBe(1);
    expect(EventSource.CLOSED).toBe(2);
  });

  it("should have correct prototype chain", () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("data: test\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const es = new EventSource(`http://localhost:${server.port}`);
    expect(es instanceof EventTarget).toBe(true);
    expect(EventSource.prototype).toBeDefined();
    es.close();
  });

  describe("connection lifecycle", () => {
    it("should start in CONNECTING state", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: test\n\n"));
                // Don't close to keep stream open
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      expect(es.readyState).toBe(EventSource.CONNECTING);
      es.close();
    });

    it("should transition to OPEN state when connected", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: test\n\n"));
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      es.onopen = () => {
        expect(es.readyState).toBe(EventSource.OPEN);
        es.close();
        resolve();
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      await promise;
    });

    it("should transition to CLOSED state when close() is called", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: test\n\n"));
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      es.onopen = () => {
        es.close();
        expect(es.readyState).toBe(EventSource.CLOSED);
        resolve();
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      await promise;
    });
  });

  describe("message events", () => {
    it("should receive simple message events", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: Hello, World!\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("Hello, World!");
    });

    it("should handle multi-line data", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: Line 1\ndata: Line 2\ndata: Line 3\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("Line 1\nLine 2\nLine 3");
    });

    it("should handle custom event types", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("event: custom\ndata: Custom Event Data\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.addEventListener("custom", (e: Event) => {
        es.close();
        resolve(e as MessageEvent);
      });

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("Custom Event Data");
    });

    it("should track lastEventId", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("id: 123\ndata: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.lastEventId).toBe("123");
    });
  });

  describe("error handling", () => {
    it("should fire error event for wrong MIME type", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve } = Promise.withResolvers<Event>();

      es.onerror = e => {
        es.close();
        resolve(e);
      };

      await promise;
      expect(es.readyState).toBe(EventSource.CLOSED);
    });

    it("should fire error event for HTTP errors", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Not Found", { status: 404 });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve } = Promise.withResolvers<Event>();

      es.onerror = e => {
        es.close();
        resolve(e);
      };

      await promise;
      expect(es.readyState).toBe(EventSource.CLOSED);
    });

    it("should close connection on HTTP 204", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(null, { status: 204 });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve } = Promise.withResolvers<Event>();

      es.onerror = e => {
        es.close();
        resolve(e);
      };

      await promise;
      expect(es.readyState).toBe(EventSource.CLOSED);
    });
  });

  describe("properties", () => {
    it("should have correct url property", () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const url = `http://localhost:${server.port}/path?query=value`;
      const es = new EventSource(url);
      expect(es.url).toBe(url);
      es.close();
    });

    it("should default withCredentials to false", () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      expect(es.withCredentials).toBe(false);
      es.close();
    });

    it("should respect withCredentials option", () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`, { withCredentials: true });
      expect(es.withCredentials).toBe(true);
      es.close();
    });

    it("should have non-enumerable instance getters for state constants", () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      // Instance should have getters that delegate to static values
      expect(es.CONNECTING).toBe(0);
      expect(es.OPEN).toBe(1);
      expect(es.CLOSED).toBe(2);
      // They should not be own enumerable properties
      expect(Object.keys(es)).not.toContain("CONNECTING");
      expect(Object.keys(es)).not.toContain("OPEN");
      expect(Object.keys(es)).not.toContain("CLOSED");
      es.close();
    });
  });

  describe("comments and ignored lines", () => {
    it("should ignore comment lines starting with colon", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(":this is a comment\ndata: actual data\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("actual data");
    });
  });

  describe("retry field", () => {
    it("should accept valid retry field values", async () => {
      // Note: We can't directly test the internal reconnection time,
      // but we verify the connection works with a retry field
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("retry: 1000\ndata: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("test");
    });
  });

  describe("multiple messages", () => {
    it("should receive multiple messages in sequence", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: first\n\ndata: second\n\ndata: third\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const messages: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      es.onmessage = e => {
        messages.push(e.data);
        if (messages.length >= 3) {
          es.close();
          resolve();
        }
      };

      es.onerror = () => {
        es.close();
        // On stream end, error fires before reconnect attempt
        if (messages.length >= 3) {
          resolve();
        } else {
          reject(new Error("Connection error"));
        }
      };

      await promise;
      expect(messages).toEqual(["first", "second", "third"]);
    });
  });

  describe("CRLF handling", () => {
    it("should handle CRLF line endings", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\r\n\r\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("test");
    });
  });

  describe("Content-Type handling", () => {
    it("should accept Content-Type with parameters", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("test");
    });

    it("should accept Content-Type case-insensitively", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "TEXT/EVENT-STREAM" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();

      es.onmessage = e => {
        es.close();
        resolve(e);
      };

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      const event = await promise;
      expect(event.data).toBe("test");
    });
  });

  describe("global reassignment", () => {
    it("should allow EventSource to be reassigned", () => {
      const original = EventSource;
      const fake = function FakeEventSource() {};

      // Reassign should work
      (globalThis as any).EventSource = fake;
      expect(EventSource).toBe(fake);

      // Restore
      (globalThis as any).EventSource = original;
      expect(EventSource).toBe(original);
    });
  });

  describe("event handler setters", () => {
    it("should handle non-callable values gracefully", () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);

      // Setting non-function should not throw and should result in null
      es.onopen = 1 as any;
      expect(es.onopen).toBe(null);

      es.onmessage = "not a function" as any;
      expect(es.onmessage).toBe(null);

      es.onerror = {} as any;
      expect(es.onerror).toBe(null);

      // Setting null should work
      es.onopen = null;
      expect(es.onopen).toBe(null);

      // Setting undefined should result in null
      es.onopen = undefined as any;
      expect(es.onopen).toBe(null);

      es.close();
    });

    it("should properly replace handlers", async () => {
      using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("data: test\n\n", {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });

      const es = new EventSource(`http://localhost:${server.port}`);
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      let firstCalled = false;
      let secondCalled = false;

      const firstHandler = () => {
        firstCalled = true;
      };

      const secondHandler = () => {
        secondCalled = true;
        es.close();
        resolve();
      };

      es.onmessage = firstHandler;
      expect(es.onmessage).toBe(firstHandler);

      // Replace with second handler - first should be removed
      es.onmessage = secondHandler;
      expect(es.onmessage).toBe(secondHandler);

      es.onerror = () => {
        es.close();
        reject(new Error("Connection error"));
      };

      await promise;
      expect(firstCalled).toBe(false);
      expect(secondCalled).toBe(true);
    });
  });
});
