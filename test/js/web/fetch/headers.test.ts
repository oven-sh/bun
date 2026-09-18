import { beforeAll, describe, expect, test } from "bun:test";
// Namespace import so a missing binding fails only the kernel tests below
// (accessing an absent export is `undefined`), not the whole file.
import * as internalForTesting from "bun:internal-for-testing";

beforeAll(() => {
  // expect(Headers).toBeDefined();
});

describe("Headers", () => {
  describe("constructor", () => {
    test("can create headers from no arguments", () => {
      expect(() => new Headers()).not.toThrow();
      expect(() => new Headers(undefined)).not.toThrow();
    });
    test("cannot create headers from null", () => {
      // @ts-expect-error
      expect(() => new Headers(null)).toThrow(TypeError);
    });
    test("can create headers from empty object", () => {
      expect(() => new Headers({})).not.toThrow();
    });
    test("can create headers from object", () => {
      const headers = new Headers({
        "content-type": "text/plain",
      });
      expect(headers.get("content-type")).toBe("text/plain");
    });

    test("deleted key in header constructor is not kept", () => {
      const record = {
        "content-type": "text/plain",
        "user-agent": "bun",
      };
      // @ts-expect-error
      delete record["content-type"];

      const headers = new Headers(record);
      expect(headers.get("content-type")).toBeNull();
      expect(headers.get("user-agent")).toBe("bun");
    });
    // Web IDL record conversion interleaves Get with value conversion: mutations made by a
    // value's toString() are observed by the keys that follow it.
    test("constructing headers from an object interleaves Get with value conversion", () => {
      const record: any = {
        "x-first": {
          toString() {
            record["x-second"] = "replaced";
            delete record["x-third"];
            return "first";
          },
        },
        "x-second": "second",
        "x-third": "third",
      };
      const headers = new Headers(record);
      expect(headers.get("x-first")).toBe("first");
      expect(headers.get("x-second")).toBe("replaced");
      expect(headers.get("x-third")).toBeNull();
    });
    test("constructing headers from an object with a getter interleaves Get with value conversion", () => {
      const record: any = {
        "x-first": {
          toString() {
            record["x-second"] = "replaced";
            delete record["x-third"];
            return "first";
          },
        },
        "x-second": "second",
        "x-third": "third",
      };
      Object.defineProperty(record, "x-fourth", { get: () => "fourth", enumerable: true });
      const headers = new Headers(record);
      expect(headers.get("x-first")).toBe("first");
      expect(headers.get("x-second")).toBe("replaced");
      expect(headers.get("x-third")).toBeNull();
      expect(headers.get("x-fourth")).toBe("fourth");
    });
    // The literal takes the fast path; redefining "x-second" transitions the structure, so the
    // remaining keys must be re-read through [[GetOwnProperty]], which invokes the new getter.
    test("constructing headers from an object observes a getter installed by an earlier value's toString", () => {
      const record: any = {
        "x-first": {
          toString() {
            Object.defineProperty(record, "x-second", { get: () => "from-getter", enumerable: true });
            return "first";
          },
        },
        "x-second": "second",
        "x-third": "third",
      };
      expect([...new Headers(record)]).toEqual([
        ["x-first", "first"],
        ["x-second", "from-getter"],
        ["x-third", "third"],
      ]);
    });
    test("constructing headers from an object propagates an exception from a getter installed by an earlier value's toString", () => {
      const record: any = {
        "x-first": {
          toString() {
            Object.defineProperty(record, "x-second", {
              get: () => {
                throw new Error("getter boom");
              },
              enumerable: true,
            });
            return "first";
          },
        },
        "x-second": "second",
      };
      expect(() => new Headers(record)).toThrow("getter boom");
    });
    test("constructing headers from an object keeps own-property semantics after setPrototypeOf mid-conversion", () => {
      const proto = { "x-second": "from-proto" };
      const record: any = {
        "x-first": {
          toString() {
            delete record["x-second"];
            Object.setPrototypeOf(record, proto);
            return "first";
          },
        },
        "x-second": "second",
        "x-third": "third",
      };
      expect([...new Headers(record)]).toEqual([
        ["x-first", "first"],
        ["x-third", "third"],
      ]);
    });
    test("can create headers from object with duplicates", () => {
      const headers = new Headers({
        "accept": "*/*",
        "Accept": "text/html",
      });
      expect(headers.get("accept")).toBe("*/*, text/html");
    });
    test("can create headers from object with non-strings", () => {
      // @ts-expect-error
      const headers = new Headers({
        "age": 60,
      });
      expect(headers.get("age")).toBe("60");
    });
    test("can create headers from empty array", () => {
      expect(() => new Headers([])).not.toThrow();
    });
    test("can create headers from array", () => {
      const headers = new Headers([["cache-control", "no-cache"]]);
      expect(headers.get("cache-control")).toBe("no-cache");
    });
    test("can create headers from array with duplicates", () => {
      const headers = new Headers([
        ["accept", "*/*"],
        ["accept", "text/html"],
        ["Accept", "text/plain"],
      ]);
      expect(headers.get("accept")).toBe("*/*, text/html, text/plain");
    });
    test("can create headers from array with non-strings", () => {
      const headers = new Headers([
        // @ts-expect-error
        ["age", 60],
      ]);
      expect(headers.get("age")).toBe("60");
    });
    test("cannot create headers from array with non-entry", () => {
      // @ts-expect-error
      expect(() => new Headers(["notanentry"])).toThrow(TypeError);
    });
    test("cannot create headers from array with entry of length 1", () => {
      // @ts-expect-error
      expect(() => new Headers([["age"]])).toThrow(TypeError);
    });
    test("cannot create headers from array with entry of length 3", () => {
      // @ts-expect-error
      expect(() => new Headers([["age", "60", "extra"]])).toThrow(TypeError);
    });
    test("can create headers from empty headers", () => {
      expect(() => new Headers(new Headers())).not.toThrow();
    });
    test("can create headers from headers", () => {
      const headers = new Headers(
        new Headers({
          "user-agent": "bun",
        }),
      );
      expect(headers.get("user-agent")).toBe("bun");
    });
    test("can create headers from headers with duplicates", () => {
      const headers = new Headers(
        new Headers([
          ["accept", "text/plain"],
          ["accept", "text/html"],
          ["accept", "*/*"],
        ]),
      );
      expect(headers.get("accept")).toBe("text/plain, text/html, */*");
    });
    test("can create headers from headers with copying", () => {
      const headers = new Headers({
        "user-agent": "bun",
      });
      const copy = new Headers(headers);
      headers.delete("user-agent");
      expect(copy.get("user-agent")).toBe("bun");
    });
    test("can create headers from empty iterator", () => {
      expect(() => new Headers((function* () {})())).not.toThrow();
    });
    test("can create headers from iterator", () => {
      const headers = new Headers(
        (function* () {
          yield ["server", "bun"];
          yield ["content-type", "application/json"];
        })(),
      );
      expect(headers.get("server")).toBe("bun");
      expect(headers.get("content-type")).toBe("application/json");
    });
    test("cannot create headers from iterator that throws", () => {
      const error = new Error("Iterator failed.");
      expect(
        () =>
          new Headers(
            (function* () {
              throw error;
            })(),
          ),
      ).toThrow(error);
    });
  });
  // Web IDL converts a HeadersInit through the Symbol.iterator method of the value. A Headers
  // object is copied from its header list only while that method is Headers.prototype.entries.
  describe("a Headers object as HeadersInit", () => {
    const entries = (headers: Headers) => [...Headers.prototype.entries.call(headers)];

    class Overridden extends Headers {
      *[Symbol.iterator](): Generator<[string, string], undefined, unknown> {
        yield ["x-from-iterator", "1"];
      }
    }
    const overridden = () => new Overridden([["a", "b"]]);

    function withOwnIterator(method: unknown, enumerable = true) {
      const headers = new Headers([["a", "b"]]);
      Object.defineProperty(headers, Symbol.iterator, { value: method, enumerable, configurable: true });
      return headers;
    }

    test("new Headers() calls a subclass iterator", () => {
      expect(entries(new Headers(overridden()))).toEqual([["x-from-iterator", "1"]]);
    });

    test("new Headers() calls an own iterator", () => {
      const headers = withOwnIterator(function* (this: Headers) {
        yield ["x-own", this.get("a")];
      });
      expect(entries(new Headers(headers))).toEqual([["x-own", "b"]]);
    });

    test("new Headers() reads an accessor once", () => {
      const headers = new Headers([["a", "b"]]);
      let reads = 0;
      Object.defineProperty(headers, Symbol.iterator, {
        get() {
          reads++;
          return function* () {
            yield ["x-getter", "1"];
          };
        },
      });
      expect(entries(new Headers(headers))).toEqual([["x-getter", "1"]]);
      expect(reads).toBe(1);
    });

    test("new Headers() reads the iterator through a Proxy in the prototype chain", () => {
      const headers = new Headers([["a", "b"]]);
      const keys: PropertyKey[] = [];
      const proxy = new Proxy(Headers.prototype, {
        get(target, key, receiver) {
          keys.push(key);
          if (key !== Symbol.iterator) return Reflect.get(target, key, receiver);
          return function* () {
            yield ["x-proxy", "1"];
          };
        },
      });
      Object.setPrototypeOf(headers, proxy);
      expect(entries(new Headers(headers))).toEqual([["x-proxy", "1"]]);
      expect(keys).toEqual([Symbol.iterator]);
    });

    test("new Headers() reads a replaced and a deleted Headers.prototype[Symbol.iterator]", () => {
      const descriptor = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
      const source = new Headers([["a", "b"]]);
      const seen: Record<string, [string, string][]> = {};
      try {
        Headers.prototype[Symbol.iterator] = function* () {
          yield ["x-prototype", "1"];
        } as any;
        seen.replaced = entries(new Headers(source));
        delete (Headers.prototype as any)[Symbol.iterator];
        // No iterator method: the value converts as a record, and it has no own keys.
        seen.deleted = entries(new Headers(source));
      } finally {
        Object.defineProperty(Headers.prototype, Symbol.iterator, descriptor);
      }
      seen.restored = entries(new Headers(source));
      expect(seen).toEqual({
        replaced: [["x-prototype", "1"]],
        deleted: [],
        restored: [["a", "b"]],
      });
    });

    test("new Headers() throws what the iterator throws", () => {
      const error = new RangeError("Iterator failed.");
      const headers = withOwnIterator(() => {
        throw error;
      });
      expect(() => new Headers(headers)).toThrow(error);
    });

    test("new Headers() rejects an iterator that does not yield pairs", () => {
      expect(() => new Headers(withOwnIterator(Headers.prototype.keys))).toThrow(TypeError);
    });

    test("new Headers() converts as a record when the iterator is undefined", () => {
      expect(entries(new Headers(withOwnIterator(undefined, false)))).toEqual([]);
      // A record key cannot be a symbol.
      expect(() => new Headers(withOwnIterator(undefined))).toThrow(TypeError);
    });

    test("new Headers() copies the header list when the iterator is the built-in one", () => {
      class OnlyEntries extends Headers {
        *entries(): Generator<[string, string], undefined, unknown> {
          yield ["x-entries", "1"];
        }
      }
      expect(entries(new Headers(new OnlyEntries([["a", "b"]])))).toEqual([["a", "b"]]);
      expect(entries(new Headers(withOwnIterator(Headers.prototype.entries)))).toEqual([["a", "b"]]);
    });

    test("Response and Request call the iterator", () => {
      const request = new Request("http://localhost/", { headers: { "x-request": "1" } });
      const emptyWithOwnIterator = new Headers();
      emptyWithOwnIterator[Symbol.iterator] = (() => [["x-own", "1"]].values()) as any;
      expect({
        response: entries(new Response(null, { headers: overridden() }).headers),
        json: entries(Response.json(null, { headers: overridden() }).headers),
        redirect: entries(Response.redirect("http://localhost/", { headers: overridden() }).headers),
        request: entries(new Request("http://localhost/", { headers: overridden() }).headers),
        requestFromRequest: entries(new Request(request, { headers: overridden() }).headers),
        emptyWithOwnIterator: entries(new Response(null, { headers: emptyWithOwnIterator }).headers),
      }).toEqual({
        response: [["x-from-iterator", "1"]],
        json: [
          ["content-type", "application/json;charset=utf-8"],
          ["x-from-iterator", "1"],
        ],
        redirect: [
          ["location", "http://localhost/"],
          ["x-from-iterator", "1"],
        ],
        request: [["x-from-iterator", "1"]],
        requestFromRequest: [["x-from-iterator", "1"]],
        emptyWithOwnIterator: [["x-own", "1"]],
      });
    });

    // Bun.serve gives lowercase names. The raw request shows the names as sent.
    async function sentHeaders(send: (url: string) => Promise<unknown>) {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      let received = "";
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket, chunk) {
            received += chunk.toString("latin1");
            if (!received.includes("\r\n\r\n")) return;
            // end() can call close() before it returns.
            resolve(received);
            socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          },
          close() {
            reject(new Error("The connection closed before the end of the headers."));
          },
          error(_, error) {
            reject(error);
          },
        },
      });
      const [head] = await Promise.all([promise, send(`http://127.0.0.1:${server.port}/`)]);
      return customHeaders(head);
    }
    const customHeaders = (head: string) =>
      head
        .split("\r\n")
        .filter(line => /^(a|x-[a-z-]+):/i.test(line))
        .sort();

    test("fetch() sends what the iterator yields", async () => {
      expect(await sentHeaders(url => fetch(url, { headers: overridden() }))).toEqual(["x-from-iterator: 1"]);
    });

    test("fetch({ url, headers }) sends what the iterator yields", async () => {
      const sent = await sentHeaders(url => fetch({ url, headers: overridden() } as any));
      expect(sent).toEqual(["x-from-iterator: 1"]);
    });

    test("fetch() keeps the case of the names when a subclass has the built-in iterator", async () => {
      class Plain extends Headers {}
      const headers = new Plain([["X-Mixed-Case", "1"]]);
      expect(await sentHeaders(url => fetch(url, { headers }))).toEqual(["X-Mixed-Case: 1"]);
    });

    test("fetch() sends what the iterator of proxy.headers yields", async () => {
      const sent = await sentHeaders(url =>
        fetch("http://example.invalid/", { proxy: { url, headers: overridden() } }),
      );
      expect(sent).toEqual(["x-from-iterator: 1"]);
    });

    test("WebSocket sends what the iterator of proxy.headers yields", async () => {
      const sent = await sentHeaders(url => {
        const { promise, resolve } = Promise.withResolvers<void>();
        // The proxy in this test answers and closes, so the handshake fails.
        const ws = new WebSocket("ws://example.invalid/", { proxy: { url, headers: overridden() } });
        ws.onclose = () => resolve();
        return promise;
      });
      expect(sent).toEqual(["x-from-iterator: 1"]);
    });

    // The status line and the custom headers of the answer to a WebSocket handshake.
    async function upgradeResponse(headers: HeadersInit) {
      using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request, server) {
          if (server.upgrade(request, { headers })) return;
          return new Response("The upgrade failed.", { status: 500 });
        },
        websocket: { message() {} },
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      let received = "";
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(socket) {
            socket.write(
              "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
                "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
            );
          },
          data(_, chunk) {
            received += chunk.toString("latin1");
            if (received.includes("\r\n\r\n")) resolve(received);
          },
          close() {
            reject(new Error("The connection closed before the end of the headers."));
          },
          error(_, error) {
            reject(error);
          },
        },
      });
      try {
        const head = await promise;
        return [head.split("\r\n")[0], ...customHeaders(head)];
      } finally {
        socket.end();
      }
    }

    test("server.upgrade() sends what the iterator yields", async () => {
      expect(await upgradeResponse(overridden())).toEqual(["HTTP/1.1 101 Switching Protocols", "x-from-iterator: 1"]);
    });

    test("server.upgrade() adds no header when the HeadersInit is empty", async () => {
      class YieldsNothing extends Headers {
        *[Symbol.iterator](): Generator<[string, string], undefined, unknown> {}
      }
      for (const headers of [new YieldsNothing([["a", "b"]]), {}, []]) {
        expect(await upgradeResponse(headers)).toEqual(["HTTP/1.1 101 Switching Protocols"]);
      }
    });
  });
  describe("append()", () => {
    test("can append header", () => {
      const headers = new Headers();
      headers.append("accept", "*/*");
      expect(headers.get("accept")).toBe("*/*");
    });
    test("can append header with duplicate name", () => {
      const headers = new Headers();
      headers.append("accept", "*/*");
      expect(headers.get("accept")).toBe("*/*");
      headers.append("Accept", "text/html");
      expect(headers.get("accept")).toBe("*/*, text/html");
    });
    test("cannot append header with no argument", () => {
      const headers = new Headers();
      // @ts-expect-error
      expect(() => headers.append()).toThrow(TypeError);
    });
    test("cannot append header with 1 argument", () => {
      const headers = new Headers();
      // @ts-expect-error
      expect(() => headers.append("expires")).toThrow(TypeError);
    });
  });
  describe("set()", () => {
    test("can set header", () => {
      const headers = new Headers();
      headers.set("cache-control", "public");
      expect(headers.get("cache-control")).toBe("public");
    });
    test("can set header with duplicate name", () => {
      const headers = new Headers();
      for (const value of ["public", "no-transform", "private"]) {
        headers.set("cache-control", value);
        expect(headers.get("cache-control")).toBe(value);
      }
    });
    test("can set header with non-string value", () => {
      const headers = new Headers();
      const values = [
        [60, "60"],
        [60n, "60"],
        [true, "true"],
        [null, "null"],
        [{}, "[object Object]"],
        [[], ""],
      ];
      for (const [actual, expected] of values) {
        // @ts-expect-error
        headers.set("header", actual);
        expect(headers.get("header")).toBe(expected);
      }
    });
    test("cannot set header with non-iso-8859-1", () => {
      const headers = new Headers();
      expect(() => headers.set("emoji", "😃")).toThrow(TypeError);
      expect(() => headers.set("🚀", "emoji")).toThrow(TypeError);
    });
    test("cannot set header with no arguments", () => {
      const headers = new Headers();
      // @ts-expect-error
      expect(() => headers.set()).toThrow(TypeError);
    });
    test("cannot set header with 1 argument", () => {
      const headers = new Headers();
      // @ts-expect-error
      expect(() => headers.set("user-agent")).toThrow(TypeError);
    });
  });
  describe("delete()", () => {
    test("can delete header", () => {
      const headers = new Headers({
        "user-agent": "bun",
      });
      headers.delete("user-agent");
      expect(headers.get("user-agent")).toBeNull();
    });
    test("can delete header with non-existent name", () => {
      const headers = new Headers();
      headers.delete("age");
      expect(headers.get("age")).toBeNull();
    });
    test("can delete header with duplicate name", () => {
      const headers = new Headers({
        "cache-control": "public",
        "Cache-Control": "no-transform",
      });
      headers.delete("cache-control");
      expect(headers.get("cache-control")).toBeNull();
    });
    test("cannot delete header with no arguments", () => {
      const headers = new Headers();
      // @ts-expect-error
      expect(() => headers.delete()).toThrow(TypeError);
    });
  });
  describe("get()", () => {
    test("can get header", () => {
      const headers = new Headers({
        "user-agent": "bun",
      });
      expect(headers.get("user-agent")).toBe("bun");
      expect(headers.get("User-Agent")).toBe("bun");
      expect(headers.get("USER-AGENT")).toBe("bun");
      expect(headers.get("user-agen")).toBeNull();
    });
    const cookies = new Headers([
      ["Set-Cookie", "__Secure-ID=123; Secure; Domain=example.com"],
      ["set-cookie", "__Host-ID=123; Secure; Path=/"],
    ]);
    test("can get header with set-cookie", () => {
      expect(cookies.get("set-cookie")).toBe(
        "__Secure-ID=123; Secure; Domain=example.com, __Host-ID=123; Secure; Path=/",
      );
    });
    const it0 = "getAll" in cookies ? test : test.skip;
    it0("can get header with set-cookie using getAll()", () => {
      expect(cookies.getAll("Set-Cookie")).toEqual([
        "__Secure-ID=123; Secure; Domain=example.com",
        "__Host-ID=123; Secure; Path=/",
      ]);
    });
    it0("cannot get header with non-set-cookie using getAll()", () => {
      // @ts-expect-error
      expect(() => cookies.getAll("not-set-cookie")).toThrow(TypeError);
    });
    test("can get header with set-cookie using getSetCookie()", () => {
      // @ts-expect-error
      expect(cookies.getSetCookie()).toEqual([
        "__Secure-ID=123; Secure; Domain=example.com",
        "__Host-ID=123; Secure; Path=/",
      ]);
    });
    test("cannot get header with no arguments", () => {
      const headers = new Headers();
      // @ts-expect-error
      expect(() => headers.get()).toThrow(TypeError);
    });
  });
  describe("has()", () => {
    test("can check header", () => {
      const headers = new Headers([
        ["expires", "0"],
        ["etag", ""],
      ]);
      expect(headers.has("expires")).toBe(true);
      expect(headers.has("Expires")).toBe(true);
      expect(headers.has("etag")).toBe(true);
      expect(headers.has("content-type")).toBe(false);
    });
    test("cannot check header with no arguments", () => {
      const headers = new Headers();
      // @ts-expect-error
      expect(() => headers.has()).toThrow(TypeError);
    });
  });
  describe("entries()", () => {
    test("can get header entries when empty", () => {
      const headers = new Headers();
      const entries = Array.from(headers.entries());
      expect(entries).toHaveLength(0);
    });
    test("can get header entries", () => {
      const headers = new Headers({
        "user-agent": "bun",
      });
      const entries = Array.from(headers.entries());
      expect(entries).toEqual([["user-agent", "bun"]]);
    });
    test("can get header entries when sorted and normalized", () => {
      const headers = new Headers([
        ["Expires", "120"],
        ["cache-control", "public"],
        ["Cache-Control", "no-transform"],
        ["ETag", "\\w0"],
      ]);
      const entries = Array.from(headers.entries());
      expect(entries).toEqual([
        ["cache-control", "public, no-transform"],
        ["etag", "\\w0"],
        ["expires", "120"],
      ]);
    });
  });
  describe("keys()", () => {
    test("can get header keys when empty", () => {
      const headers = new Headers();
      const keys = Array.from(headers.keys());
      expect(keys).toHaveLength(0);
    });
    test("can get header keys", () => {
      const headers = new Headers({
        "user-agent": "bun",
        "User-Agent": "bun",
      });
      const keys = Array.from(headers.keys());
      expect(keys).toEqual(["user-agent"]);
    });
    test("can get header keys when sorted and normalized", () => {
      const headers = new Headers({
        "user-agent": "bun",
        "User-Agent": "bun",
        "Age": "60",
      });
      const keys = Array.from(headers.keys());
      expect(keys).toEqual(["age", "user-agent"]);
    });
  });
  describe("values()", () => {
    test("can get header values when empty", () => {
      const headers = new Headers();
      const values = Array.from(headers.values());
      expect(values).toHaveLength(0);
    });
    test("can get header values", () => {
      const headers = new Headers({
        "cache-control": "immutable",
      });
      const values = Array.from(headers.values());
      expect(values).toEqual(["immutable"]);
    });
    test("can get header values when sorted and normalized", () => {
      const headers = new Headers([
        ["Content-Length", "0"],
        ["Cache-Control", "immutable"],
        ["cache-control", "private"],
      ]);
      const values = Array.from(headers.values());
      expect(values).toEqual(["immutable, private", "0"]);
    });
  });
  describe("forEach()", () => {
    test("can iterate over header entries when empty", () => {
      const headers = new Headers();
      const results: [string, string][] = [];
      headers.forEach((value, key, parent) => {
        results.push([key, value]);
        expect(parent).toBe(headers);
      });
      expect(results).toHaveLength(0);
    });
    test("can iterate over header entries when sorted and normalized", () => {
      const entries: [string, string][] = [
        ["user-agent", "bun"],
        ["Cache-Control", "private"],
        ["Expires", "0"],
      ];
      const headers = new Headers(entries);
      const results: [string, string][] = [];
      headers.forEach((value, key, parent) => {
        results.push([key, value]);
        expect(parent).toBe(headers);
      });
      expect(results).toEqual([
        ["cache-control", "private"],
        ["expires", "0"],
        ["user-agent", "bun"],
      ]);
    });
  });
  describe("[Symbol.iterator]", () => {
    test("can iterate over header object when empty", () => {
      const headers = new Headers();
      const entries = Array.from(headers);
      expect(entries).toHaveLength(0);
    });
    test("can iterate over header object", () => {
      const headers = new Headers({
        "user-agent": "bun",
      });
      const entries = Array.from(headers);
      expect(entries).toEqual([["user-agent", "bun"]]);
    });
    test("can iterate over header object when sorted and normalized", () => {
      const headers = new Headers([
        ["User-Agent", "bun"],
        ["Cache-Control", "max-age=60"],
        ["cache-control", "s-maxage=60"],
      ]);
      const entries = Array.from(headers);
      expect(entries).toEqual([
        ["cache-control", "max-age=60, s-maxage=60"],
        ["user-agent", "bun"],
      ]);
    });
  });
  describe("Bun.inspect()", () => {
    const it = "toJSON" in new Headers() ? test : test.skip;
    it("can convert to json when empty", () => {
      const headers = new Headers();
      expect(Bun.inspect(headers)).toStrictEqual(`Headers {}`);
    });
    it("can convert to json", () => {
      const headers = new Headers({
        "cache-control": "public, immutable",
      });
      expect(Bun.inspect(headers)).toStrictEqual(
        "Headers {" + "\n  " + `"cache-control": "public, immutable",` + "\n" + "}",
      );
    });
    it("can convert to json normalized", () => {
      const headers = new Headers({
        "user-agent": "bun",
        "X-Custom-Header": "1",
        "cache-control": "public, immutable",
      });
      expect(Bun.inspect(headers)).toStrictEqual(
        "Headers " +
          JSON.stringify(
            {
              "user-agent": "bun",
              "cache-control": "public, immutable",
              "x-custom-header": "1",
            },
            null,
            2,
          ).replace(/(\s+})$/, ",$1"), // add trailing comma
      );
    });
  });
  describe("toJSON()", () => {
    // @ts-ignore
    const it = new Headers()?.toJSON ? test : test.skip;

    it("can convert to json when empty", () => {
      const headers = new Headers();
      expect(headers.toJSON()).toStrictEqual({});
    });
    it("can convert to json", () => {
      const headers = new Headers({
        "cache-control": "public, immutable",
      });
      expect(headers.toJSON()).toStrictEqual({
        "cache-control": "public, immutable",
      });
    });
    it("can convert to json when sorted and normalized", () => {
      const headers = new Headers({
        "user-agent": "bun",
        "X-Custom-Header": "1",
        "cache-control": "public, immutable",
      });
      expect(headers.toJSON()).toStrictEqual({
        "cache-control": "public, immutable",
        "user-agent": "bun",
        "x-custom-header": "1",
      });
    });
  });
  describe("count", () => {
    // @ts-ignore
    const it = typeof new Headers()?.count !== "undefined" ? test : test.skip;
    it("can count headers when empty", () => {
      const headers = new Headers();
      expect(headers.count).toBe(0);
    });
    it("can count headers", () => {
      const headers = new Headers([
        ["user-agent", "bun"],
        ["cache-control", "public, immutable"],
        ["Cache-Control", "no-transform"],
      ]);
      expect(headers.count).toBe(2);
    });
  });

  // Header-name lowercasing on iteration (Object.fromEntries / spread / toJSON /
  // keys()) runs through a SIMD kernel on the 8-bit path. Sweep name lengths
  // across the vector-block boundaries and include every ASCII printable that is
  // a valid HTTP token character, so a kernel that mishandles its scalar tail or
  // touches a non-letter (e.g. blindly OR-ing 0x20 into '^', '_', '`', '|', '~')
  // would diverge from this scalar reference.
  describe("iteration lowercases uncommon header names", () => {
    // Valid HTTP token characters, per RFC 7230, excluding letters/digits.
    const tokenPunct = "!#$%&'*+-.^_`|~";
    const lower = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase());

    // Names of increasing length that always contain an uppercase letter (so the
    // kernel takes its allocate-and-lowercase slow path), built from a repeating
    // alphabet of mixed-case letters, digits, and token punctuation.
    const alphabet = "AzB0C-D_E^F`G|H~I.J9K";
    function nameOfLength(n: number): string {
      // Start with "X-" so it is never a known common header, keep an uppercase.
      let s = "X-";
      for (let i = 0; s.length < n; i++) s += alphabet[i % alphabet.length];
      return s.slice(0, Math.max(n, 3));
    }

    // Cover lengths straddling 16/32/64-byte SIMD blocks, plus the tail remainders.
    const lengths = [3, 4, 7, 8, 15, 16, 17, 31, 32, 33, 47, 48, 63, 64, 65, 95, 96, 127, 128, 129];

    test.each(lengths)("length %d round-trips through all iteration APIs", len => {
      const name = nameOfLength(len);
      const h = new Headers();
      h.append(name, "v");
      const expectedKey = lower(name);

      expect(Object.fromEntries(h)).toEqual({ [expectedKey]: "v" });
      expect(Object.fromEntries(h.entries())).toEqual({ [expectedKey]: "v" });
      expect([...h]).toEqual([[expectedKey, "v"]]);
      expect([...h.keys()]).toEqual([expectedKey]);
      expect(h.toJSON?.()).toEqual({ [expectedKey]: "v" });
    });

    test("preserves non-letter token characters while lowercasing letters", () => {
      // One header name per token punctuation char, surrounded by mixed-case
      // letters, so a naive OR-0x20 lowercase would corrupt '^' -> '~' etc.
      const names = [...tokenPunct].map((c, i) => `X-Ab${c}Cd${i}`);
      const h = new Headers();
      for (const n of names) h.append(n, "v");

      const expected: Record<string, string> = {};
      for (const n of names) expected[lower(n)] = "v";

      expect(Object.fromEntries(h)).toEqual(expected);
      expect(h.toJSON?.()).toEqual(expected);
    });

    test("already-lowercase names are returned unchanged", () => {
      const name = "x-already-lower-" + Buffer.alloc(80, "a").toString();
      const h = new Headers();
      h.append(name, "v");
      expect(Object.fromEntries(h)).toEqual({ [name]: "v" });
      expect([...h.keys()]).toEqual([name]);
    });

    test("lowercases a large set of mixed-case uncommon names with sorting", () => {
      const h = new Headers();
      const expected: Record<string, string> = {};
      for (let i = 0; i < 64; i++) {
        const name = `X-Custom-Header-${i}-AbCdEfGhIjKlMnOpQrStUvWxYz`;
        h.append(name, String(i));
        expected[name.toLowerCase()] = String(i);
      }
      expect(Object.fromEntries(h)).toEqual(expected);
    });
  });

  // Direct coverage of the SIMD header-name lowercasing kernel
  // (WebCore::lowercaseHeaderName, exposed via bun:internal-for-testing). This
  // calls the kernel with no surrounding Headers machinery, so it is exercised
  // even when the iterator's key cache or the common-header fast path would
  // otherwise hide it, and pins the kernel's output to a scalar reference.
  describe("lowercaseHeaderNameSIMD kernel", () => {
    const lowercaseHeaderNameSIMD = internalForTesting.lowercaseHeaderNameSIMD as (name: string) => string;
    // ASCII-lowercase only 'A'..'Z'; every other byte (digits, punctuation,
    // characters adjacent to the letter ranges like '@', '[', '^', '_', '`',
    // Latin-1 >= 0x80) must be left untouched.
    const scalarLower = (s: string) => [...s].map(c => (c >= "A" && c <= "Z" ? c.toLowerCase() : c)).join("");

    test("matches a scalar reference across lengths and alignments", () => {
      // Repeating alphabet spanning the risky 0x40-0x7f neighbourhood of the
      // uppercase range, so a kernel that over-lowercases (e.g. OR 0x20) or
      // mishandles its vector tail diverges from the reference.
      const alphabet = "AZaz09@[]^_`{|}~-.Mm";
      for (let len = 0; len <= 160; len++) {
        let s = "";
        for (let i = 0; i < len; i++) s += alphabet[(i * 7 + len) % alphabet.length];
        expect(lowercaseHeaderNameSIMD(s)).toBe(scalarLower(s));
      }
    });

    test("leaves non-letter bytes adjacent to the uppercase range intact", () => {
      // 0x40 '@', 0x5b..0x60 '[\]^_`' bracket 'A'..'Z'; none may change.
      const s = "@ABYZ[\\]^_`az{|}~";
      expect(lowercaseHeaderNameSIMD(s)).toBe("@abyz[\\]^_`az{|}~");
    });

    test("returns already-lowercase input unchanged", () => {
      for (const s of ["", "a", "x-custom-header", Buffer.alloc(200, "a").toString()]) {
        expect(lowercaseHeaderNameSIMD(s)).toBe(s);
      }
    });

    test("preserves Latin-1 bytes >= 0x80", () => {
      // 'À' (0xC0) is in the uppercase *Unicode* block but not ASCII A-Z, so the
      // ASCII kernel must not touch it; 'A' right after it must still fold.
      const s = "\u00c0A\u00e0Z\u00ff";
      expect(lowercaseHeaderNameSIMD(s)).toBe("\u00c0a\u00e0z\u00ff");
    });

    // An all-ASCII WTF string can still be stored as 16-bit, which takes a
    // separate kernel. Force 16-bit storage by appending a code unit > 0xFF and
    // slicing it back off, then run the same checks on the 16-bit path.
    const to16 = (s: string) => (s + "\u0100").slice(0, -1);

    test("16-bit: matches a scalar reference across lengths and alignments", () => {
      const alphabet = "AZaz09@[]^_`{|}~-.Mm";
      for (let len = 0; len <= 160; len++) {
        let s = "";
        for (let i = 0; i < len; i++) s += alphabet[(i * 7 + len) % alphabet.length];
        expect(lowercaseHeaderNameSIMD(to16(s))).toBe(scalarLower(s));
      }
    });

    test("16-bit: lowercases letters and leaves code units >= 0x80 untouched", () => {
      // Mixed-case ASCII interleaved with non-Latin-1 code units that must pass
      // through unchanged while A-Z fold.
      const s = "X-Ab\u0100Cd\u0101Ef\uffffGZ";
      expect(lowercaseHeaderNameSIMD(s)).toBe("x-ab\u0100cd\u0101ef\uffffgz");
    });
  });
});
