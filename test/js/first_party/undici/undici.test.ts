import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import diagnosticsChannel from "node:diagnostics_channel";
import { ping, request, WebSocket as UndiciWebSocket } from "undici";

import { createServer } from "../../../http-test-server";

describe("undici", () => {
  let serverCtl: ReturnType<typeof createServer>;
  let hostUrl: string;
  let port: number;
  let host: string;

  beforeAll(() => {
    serverCtl = createServer();
    port = serverCtl.port;
    host = `${serverCtl.hostname}:${port}`;
    hostUrl = `http://${host}`;
  });

  afterAll(() => {
    serverCtl.stop();
  });

  describe("request", () => {
    it("should make a GET request when passed a URL string", async () => {
      const { body } = await request(`${hostUrl}/get`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    it("should error when body has already been consumed", async () => {
      const { body } = await request(`${hostUrl}/get`);
      await body.json();
      expect(body.bodyUsed).toBe(true);
      try {
        await body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("unusable");
      }
    });

    it("should make a POST request when provided a body and POST method", async () => {
      const { body } = await request(`${hostUrl}/post`, {
        method: "POST",
        body: "Hello world",
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { data: string };
      expect(json.data).toBe("Hello world");
    });

    it("should accept a URL class object", async () => {
      const { body } = await request(new URL(`${hostUrl}/get`));
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    // it("should accept an undici UrlObject", async () => {
    //   // @ts-ignore
    //   const { body } = await request({ protocol: "https:", hostname: host, path: "/get" });
    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { url: string };
    //   expect(json.url).toBe(`${hostUrl}/get`);
    // });

    it("should prevent body from being attached to GET or HEAD requests", async () => {
      try {
        await request(`${hostUrl}/get`, {
          method: "GET",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }

      try {
        await request(`${hostUrl}/head`, {
          method: "HEAD",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }
    });

    it("should allow a query string to be passed", async () => {
      const { body } = await request(`${hostUrl}/get?foo=bar`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { args: { foo: string } };
      expect(json.args.foo).toBe("bar");

      const { body: body2 } = await request(`${hostUrl}/get`, {
        query: { foo: "bar" },
      });
      expect(body2).toBeDefined();
      const json2 = (await body2.json()) as { args: { foo: string } };
      expect(json2.args.foo).toBe("bar");
    });

    it("should throw on HTTP 4xx or 5xx error when throwOnError is true", async () => {
      try {
        await request(`${hostUrl}/status/404`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 404");
      }

      try {
        await request(`${hostUrl}/status/500`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 500");
      }
    });

    it("should allow us to abort the request with a signal", async () => {
      const controller = new AbortController();
      try {
        setTimeout(() => controller.abort(), 500);
        const req = await request(`${hostUrl}/delay/5`, {
          signal: controller.signal,
        });
        await req.body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("The operation was aborted.");
      }
    });

    it("should properly append headers to the request", async () => {
      const { body } = await request(`${hostUrl}/headers`, {
        headers: {
          "x-foo": "bar",
        },
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { headers: { "x-foo": string } };
      expect(json.headers["x-foo"]).toBe("bar");
    });

    // it("should allow the use of FormData", async () => {
    //   const form = new FormData();
    //   form.append("foo", "bar");
    //   const { body } = await request(`${hostUrl}/post`, {
    //     method: "POST",
    //     body: form,
    //   });

    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { form: { foo: string } };
    //   expect(json.form.foo).toBe("bar");
    // });
  });
});

describe("undici.request maxRedirections", () => {
  it("does not follow more redirects than maxRedirections allows", async () => {
    const hits: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        hits.push(pathname);
        if (pathname.startsWith("/redirect/")) {
          const hop = Number(pathname.slice("/redirect/".length));
          if (hop >= 5) {
            return Response.json({ done: true, hop });
          }
          return new Response(null, {
            status: 302,
            headers: { location: `/redirect/${hop + 1}` },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const origin = `http://localhost:${server.port}`;

      // The caller's cap must be enforced: with maxRedirections: 1 only one
      // redirect may be followed, so the client stops at /redirect/1 instead
      // of chasing the chain to the end.
      hits.length = 0;
      await expect(request(`${origin}/redirect/0`, { maxRedirections: 1 })).rejects.toThrow(
        "redirected too many times",
      );
      expect(hits).toEqual(["/redirect/0", "/redirect/1"]);

      // A cap large enough for the whole chain still reaches the final response.
      hits.length = 0;
      const followed = await request(`${origin}/redirect/0`, { maxRedirections: 10 });
      expect(hits).toEqual(["/redirect/0", "/redirect/1", "/redirect/2", "/redirect/3", "/redirect/4", "/redirect/5"]);
      expect(followed.statusCode).toBe(200);
      expect(((await followed.body!.json()) as { done: boolean; hop: number }).hop).toBe(5);

      // Invalid caps are rejected up front instead of being silently ignored.
      await expect(request(`${origin}/redirect/0`, { maxRedirections: -1 })).rejects.toThrow(
        "maxRedirections must be a positive number",
      );
    } finally {
      server.stop(true);
    }
  });
});

describe.concurrent("undici WebSocket ping", () => {
  function serveWebSocket(handlers: Partial<Bun.WebSocketHandler> = {}) {
    return Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 400 });
      },
      websocket: {
        message() {},
        ...handlers,
      },
    });
  }

  it("exports ping as a function", () => {
    expect(typeof ping).toBe("function");
  });

  it("ping() sends a ping frame and undici:websocket:pong fires on the reply", async () => {
    const serverReceived = Promise.withResolvers<Buffer>();
    await using server = serveWebSocket({
      ping(_ws, data) {
        serverReceived.resolve(data);
      },
    });

    const ws = new UndiciWebSocket(`ws://localhost:${server.port}/`);
    const pongMessage = Promise.withResolvers<{ payload: Buffer; websocket: unknown }>();
    const pongChannel = diagnosticsChannel.channel("undici:websocket:pong");
    // the channel is process-global, so only accept messages for this socket
    const onPong = (message: any) => {
      if (message.websocket === ws) pongMessage.resolve(message);
    };
    pongChannel.subscribe(onPong);
    try {
      const opened = Promise.withResolvers<void>();
      ws.addEventListener("open", () => opened.resolve());
      ws.addEventListener("error", (e: any) => opened.reject(e.error ?? new Error(e.message)));
      await opened.promise;

      ping(ws, Buffer.from("hello slack"));

      expect((await serverReceived.promise).toString()).toBe("hello slack");

      // the server answers the ping with a pong echoing the payload
      const message = await pongMessage.promise;
      expect(Buffer.isBuffer(message.payload)).toBe(true);
      expect(message.payload.toString()).toBe("hello slack");
      expect(message.websocket).toBe(ws);
    } finally {
      pongChannel.unsubscribe(onPong);
      ws.close();
    }
  });

  it("undici:websocket:ping fires when the server sends a ping", async () => {
    await using server = serveWebSocket({
      open(ws) {
        ws.ping(Buffer.from("from server"));
      },
    });

    const ws = new UndiciWebSocket(`ws://localhost:${server.port}/`);
    const pingMessage = Promise.withResolvers<{ payload: Buffer; websocket: unknown }>();
    const pingChannel = diagnosticsChannel.channel("undici:websocket:ping");
    // the channel is process-global, so only accept messages for this socket
    const onPing = (message: any) => {
      if (message.websocket === ws) pingMessage.resolve(message);
    };
    pingChannel.subscribe(onPing);
    try {
      ws.addEventListener("error", (e: any) => pingMessage.reject(e.error ?? new Error(e.message)));
      ws.addEventListener("close", (e: any) =>
        pingMessage.reject(new Error(`socket closed before ping: ${e.code} ${e.reason}`)),
      );
      const message = await pingMessage.promise;
      expect(Buffer.isBuffer(message.payload)).toBe(true);
      expect(message.payload.toString()).toBe("from server");
      expect(message.websocket).toBe(ws);
    } finally {
      pingChannel.unsubscribe(onPing);
      ws.close();
    }
  });

  it("publishes a Buffer payload even when binaryType is 'arraybuffer'", async () => {
    await using server = serveWebSocket({
      open(ws) {
        ws.ping(Buffer.from("typed"));
      },
    });

    const ws = new UndiciWebSocket(`ws://localhost:${server.port}/`);
    ws.binaryType = "arraybuffer";
    const pingMessage = Promise.withResolvers<{ payload: Buffer; websocket: unknown }>();
    const pingChannel = diagnosticsChannel.channel("undici:websocket:ping");
    const onPing = (message: any) => {
      if (message.websocket === ws) pingMessage.resolve(message);
    };
    pingChannel.subscribe(onPing);
    try {
      ws.addEventListener("error", (e: any) => pingMessage.reject(e.error ?? new Error(e.message)));
      ws.addEventListener("close", (e: any) =>
        pingMessage.reject(new Error(`socket closed before ping: ${e.code} ${e.reason}`)),
      );
      const message = await pingMessage.promise;
      expect(Buffer.isBuffer(message.payload)).toBe(true);
      expect(message.payload.toString()).toBe("typed");
    } finally {
      pingChannel.unsubscribe(onPing);
      ws.close();
    }
  });

  it("ping() validates its arguments like undici", async () => {
    await using server = serveWebSocket();
    const ws = new UndiciWebSocket(`ws://localhost:${server.port}/`);
    try {
      expect(() => ping(undefined as any)).toThrow(TypeError);
      expect(() => ping(null as any)).toThrow(TypeError);
      expect(() => ping({} as any)).toThrow(TypeError);
      expect(() => ping(ws, "not a buffer" as any)).toThrow("Expected buffer payload");
      expect(() => ping(ws, null as any)).toThrow("Expected buffer payload");
      expect(() => ping(ws, new Uint8Array(4) as any)).toThrow("Expected buffer payload");
      expect(() => ping(ws, Buffer.alloc(126))).toThrow("A PING frame cannot have a body larger than 125 bytes.");
      // a ping on a socket that is not open is a no-op, not an error
      // (matches undici 7.x: ping() only sends while OPEN and never throws on state)
      expect(ws.readyState).toBe(UndiciWebSocket.CONNECTING);
      expect(() => ping(ws, Buffer.alloc(125))).not.toThrow();
      expect(() => ping(ws)).not.toThrow();
    } finally {
      ws.close();
    }
  });
});
