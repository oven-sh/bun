import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import * as net from "node:net";

// https://github.com/oven-sh/bun/issues/9180
test("weird headers", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch(req) {
      const headers = new Headers();
      req.headers.forEach((value, key) => {
        headers.append(key, value);
      });

      return new Response("OK", {
        headers,
      });
    },
  });

  {
    for (let i = 0; i < 255; i++) {
      const headers = new Headers();
      const name = "X-" + String.fromCharCode(i);
      try {
        headers.set(name, "1");
      } catch {
        continue;
      }

      const res = await fetch(server.url, {
        headers,
      });
      expect(res.headers.get(name)).toBe("1");
    }
  }
});

// https://fetch.spec.whatwg.org/#concept-header-value
// Header values are ByteStrings: U+00E9 goes out as the single byte 0xE9, not as
// UTF-8 0xC3 0xA9. The bytes must not depend on whether JSC stores the string as
// 8-bit (a literal) or 16-bit (TextDecoder, normalize(), JSON.parse output).
describe("response header values are isomorphic-encoded on the wire", () => {
  const eightBit = "caf\u00e9-\u0080\u00ff";
  // A utf-16le decode always yields a 16-bit string, even for latin-1 content.
  const sixteenBit = new TextDecoder("utf-16le").decode(new Uint16Array([0x63, 0x61, 0x66, 0xe9, 0x2d, 0x80, 0xff]));
  const expectedHex = "63 61 66 e9 2d 80 ff";

  async function rawResponse(port: number, path: string): Promise<string> {
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      let raw = "";
      await new Promise<void>(resolve => {
        socket.on("data", chunk => (raw += chunk.toString("latin1")));
        socket.on("close", resolve);
      });
      return raw;
    } finally {
      socket.destroy();
    }
  }

  function headerHex(raw: string, name: string): string[] {
    const head = raw.split("\r\n\r\n")[0];
    return head
      .split("\r\n")
      .filter(line => line.toLowerCase().startsWith(name + ":"))
      .map(line =>
        [...Buffer.from(line.slice(name.length + 2), "latin1")].map(c => c.toString(16).padStart(2, "0")).join(" "),
      );
  }

  test("Response headers", async () => {
    expect(sixteenBit).toBe(eightBit);
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const value = new URL(req.url).pathname === "/16" ? sixteenBit : eightBit;
        return new Response("ok", { headers: { "x-t": value } });
      },
    });

    expect(headerHex(await rawResponse(server.port, "/8"), "x-t")).toEqual([expectedHex]);
    expect(headerHex(await rawResponse(server.port, "/16"), "x-t")).toEqual([expectedHex]);

    // A fetch() client reads the same value back, not mojibake.
    const res = await fetch(`http://127.0.0.1:${server.port}/16`);
    expect(res.headers.get("x-t")).toBe(eightBit);
  });

  test("Set-Cookie headers", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const value = new URL(req.url).pathname === "/16" ? sixteenBit : eightBit;
        const headers = new Headers();
        headers.append("set-cookie", `a=${value}`);
        headers.append("set-cookie", `b=${value}`);
        return new Response("ok", { headers });
      },
    });

    const expected = ["61 3d " + expectedHex, "62 3d " + expectedHex];
    expect(headerHex(await rawResponse(server.port, "/8"), "set-cookie")).toEqual(expected);
    expect(headerHex(await rawResponse(server.port, "/16"), "set-cookie")).toEqual(expected);
  });

  test("long values and values that start with a non-ASCII char", async () => {
    // 300 ASCII code units, then latin-1, then digits: longer than the writer's inline buffer.
    const units = Array.from({ length: 300 }, (_, i) => 0x41 + (i % 26));
    units.push(0xe9, 0x80, 0xff, ...Array.from({ length: 100 }, (_, i) => 0x30 + (i % 10)));
    const values: Record<string, Uint16Array> = {
      long: new Uint16Array(units),
      lead: new Uint16Array([0xe9, 0x61]),
      ascii: new Uint16Array([0x61, 0x62, 0x63]),
    };
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const url = new URL(req.url);
        const codeUnits = values[url.pathname.slice(1)];
        const value =
          url.searchParams.get("bits") === "16"
            ? new TextDecoder("utf-16le").decode(codeUnits)
            : String.fromCharCode(...codeUnits);
        return new Response("ok", { headers: { "x-t": value } });
      },
    });

    for (const [name, codeUnits] of Object.entries(values)) {
      const expected = [[...codeUnits].map(c => c.toString(16).padStart(2, "0")).join(" ")];
      expect(headerHex(await rawResponse(server.port, `/${name}?bits=8`), "x-t")).toEqual(expected);
      expect(headerHex(await rawResponse(server.port, `/${name}?bits=16`), "x-t")).toEqual(expected);
    }
  });
});

// RFC 9112 §9.6: a server that sends "Connection: close" MUST close the
// connection after that response. Bun was emitting the header but leaving the
// socket in the keep-alive pool, servicing further requests on the "closed"
// connection.
describe("response Connection: close closes the socket", () => {
  async function check(makeResponse: () => Response) {
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      fetch() {
        handled++;
        return makeResponse();
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");

      // Collect everything the server sends until it closes the connection, or
      // until it services a second request on the same socket (the bug). Either
      // event resolves the promise, so this never relies on a wall-clock wait.
      const result = await new Promise<{ raw: string; closedByServer: boolean }>(resolve => {
        let raw = "";
        let sentSecond = false;
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          // Once the first response body has fully arrived, send a follow-up
          // request. A correct server has already closed (or is about to) and
          // will never answer it; a buggy server answers and we resolve below.
          if (!sentSecond && raw.includes("\r\n\r\n") && raw.includes("bye")) {
            sentSecond = true;
            socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
          }
          if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length > 1) {
            resolve({ raw, closedByServer: false });
          }
        });
        socket.on("close", () => resolve({ raw, closedByServer: true }));
      });

      const responses = (result.raw.match(/HTTP\/1\.1 200/g) ?? []).length;
      const head = result.raw.split("\r\n\r\n")[0];
      expect(head).toMatch(/\r\nconnection:[^\r\n]*\bclose\b/i);
      expect({ responses, handled, closedByServer: result.closedByServer }).toEqual({
        responses: 1,
        handled: 1,
        closedByServer: true,
      });
    } finally {
      socket.destroy();
    }
  }

  test("string body", async () => {
    await check(() => new Response("bye", { headers: { Connection: "close" } }));
  });

  test("case-insensitive value", async () => {
    await check(() => new Response("bye", { headers: { connection: "Close" } }));
  });

  test("token list", async () => {
    // Connection is 1#connection-option: "close" as one of several tokens must
    // still trigger closure.
    await check(() => new Response("bye", { headers: { Connection: "TE, close" } }));
  });

  test("streaming body", async () => {
    await check(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("bye"));
              c.close();
            },
          }),
          { headers: { Connection: "close" } },
        ),
    );
  });

  test("keep-alive still the default", async () => {
    // Negative: without Connection: close, a second request on the same socket
    // must be serviced.
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      fetch() {
        handled++;
        return new Response("bye");
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");

      let raw = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length >= 2) resolve();
        });
        socket.on("close", () => reject(new Error("server closed a keep-alive connection")));
      });

      expect(handled).toBe(2);
      expect(raw.toLowerCase()).not.toContain("connection: close");
    } finally {
      socket.destroy();
    }
  });
});

// `Request.url` and `Request.headers` are read from the uWS request the first
// time JS asks for them. That request only lives while the handler dispatch is
// on the stack. A handler that responded synchronously used to leave a Request
// that read back as url "" and an empty Headers once the dispatch ended, so a
// deferred log hook saw nothing (an async handler that awaited I/O was fine).
describe("Request.url and Request.headers after the handler returned", () => {
  const requestHeaders = { "user-agent": "UA/1", cookie: "a=1; b=2", "x-custom": "custom-value" };

  // Reads the request from a timer: the dispatch that created it has returned by then.
  function readLater(req: Request) {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    setTimeout(() => {
      // The copies read url/headers through the same lazy path as the original.
      const clone = req.clone();
      const copy = new Request(req);
      const copyWithInit = new Request(req, { method: "POST" });
      resolve({
        url: req.url,
        headers: Object.fromEntries(req.headers),
        ua: req.headers.get("user-agent"),
        clone: [clone.url, clone.headers.get("user-agent")],
        copy: [copy.url, copy.headers.get("user-agent")],
        copyWithInit: [copyWithInit.url, copyWithInit.method, copyWithInit.headers.get("user-agent")],
        inspectHasUa: Bun.inspect(req).includes("UA/1"),
      });
    }, 0);
    return promise;
  }

  const handlers: Record<string, (req: Request) => Response | Promise<Response> | undefined> = {
    "returns a Response": () => new Response("ok"),
    "returns Promise.resolve(Response)": () => Promise.resolve(new Response("ok")),
    "resumes from a microtask": async () => {
      await 0;
      return new Response("ok");
    },
    "awaits a timer": async () => {
      await Bun.sleep(1);
      return new Response("ok");
    },
    "returns undefined": () => undefined,
    "throws": () => {
      throw new Error("boom");
    },
  };

  describe.each([false, true])("development: %p", development => {
    for (const [name, handler] of Object.entries(handlers)) {
      test(`fetch handler ${name}`, async () => {
        let later: Promise<Record<string, unknown>> | undefined;
        let expectedHeaders: Record<string, string> | undefined;
        using server = Bun.serve({
          port: 0,
          development,
          fetch(req) {
            if (!later) {
              later = readLater(req);
              return handler(req) as Response;
            }
            // Control request: a synchronous read of the same headers.
            expectedHeaders = Object.fromEntries(req.headers);
            return new Response("control");
          },
          error() {
            return new Response("handled", { status: 500 });
          },
        });

        const url = `${server.url}path?q=1`;
        await (await fetch(url, { headers: requestHeaders })).text();
        await (await fetch(url, { headers: requestHeaders })).text();

        expect(await later!).toEqual({
          url,
          headers: expectedHeaders!,
          ua: "UA/1",
          clone: [url, "UA/1"],
          copy: [url, "UA/1"],
          copyWithInit: [url, "POST", "UA/1"],
          inspectHasUa: true,
        });
        expect(expectedHeaders!["x-custom"]).toBe("custom-value");
      });
    }

    test("routes handler: url, params, headers and cookies", async () => {
      let later: Promise<Record<string, unknown>> | undefined;
      using server = Bun.serve({
        port: 0,
        development,
        routes: {
          "/r/:id": req => {
            const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
            later = promise;
            setTimeout(() => {
              resolve({
                url: req.url,
                id: req.params.id,
                ua: req.headers.get("user-agent"),
                cookieA: req.cookies.get("a"),
                cookieB: req.cookies.get("b"),
              });
            }, 0);
            return new Response("ok");
          },
        },
        fetch: () => new Response("not found", { status: 404 }),
      });

      const url = `${server.url}r/42`;
      await (await fetch(url, { headers: requestHeaders })).text();

      expect(await later!).toEqual({ url, id: "42", ua: "UA/1", cookieA: "1", cookieB: "2" });
    });
  });

  test("a retained Request never shows the next request on the same connection", async () => {
    const requests: Request[] = [];
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        requests.push(req);
        return new Response("ok");
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write(
        "GET /first HTTP/1.1\r\nHost: x\r\nX-Id: first\r\n\r\n" +
          "GET /second HTTP/1.1\r\nHost: x\r\nX-Id: second\r\n\r\n",
      );

      let raw = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length >= 2) resolve();
        });
        socket.on("close", () => reject(new Error("server closed the connection")));
      });
    } finally {
      socket.destroy();
    }

    expect(requests.map(req => [req.url, req.headers.get("x-id")])).toEqual([
      ["http://x/first", "first"],
      ["http://x/second", "second"],
    ]);
  });
});
