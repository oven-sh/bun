import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
// Namespace import so a missing binding fails only the kernel tests below
// (accessing an absent export is `undefined`), not the whole file.
import * as internalForTesting from "bun:internal-for-testing";
import { bunEnv, bunExe } from "harness";

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
      expect(() => new Headers([["age"]])).toThrow(TypeError);
    });
    test("cannot create headers from array with entry of length 3", () => {
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
      expect(() => new Headers((function* () {})() as any)).not.toThrow();
    });
    test("can create headers from iterator", () => {
      const headers = new Headers(
        (function* () {
          yield ["server", "bun"];
          yield ["content-type", "application/json"];
        })() as any,
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
            })() as any,
          ),
      ).toThrow(error);
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
    test.each(["accept", "cookie", "x-repeated"])("throws when the joined %s value is too long", name => {
      const half = Buffer.alloc(512 * 1024, "a").toString();
      const headers = new Headers([[name, half]]);
      const originalLimit = internalForTesting.setSyntheticAllocationLimitForTesting(1024 * 1024);
      try {
        expect(() => headers.append(name, half)).toThrow("Out of memory");
        expect(headers.get(name)).toHaveLength(half.length);
      } finally {
        internalForTesting.setSyntheticAllocationLimitForTesting(originalLimit);
      }
    });
    test("throws when the set-cookie list can't grow", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            // With a 64 KiB limit the list is capped at 8192 values.
            const headers = new Headers();
            for (let i = 0; i < 8192; i++) headers.append("set-cookie", "a");
            try {
              headers.append("set-cookie", "a");
              console.log("no error");
            } catch (e) {
              console.log(e.name, e.message);
            }
            console.log(headers.getSetCookie().length);
          `,
        ],
        env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(64 * 1024) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "RangeError Out of memory\n8192\n",
        stderr: "",
        exitCode: 0,
      });
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
      const values: [unknown, string][] = [
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
    test("throws when the joined set-cookie values are too long", () => {
      const half = Buffer.alloc(512 * 1024, "a").toString();
      const headers = new Headers([
        ["set-cookie", half],
        ["set-cookie", half],
      ]);
      const originalLimit = internalForTesting.setSyntheticAllocationLimitForTesting(1024 * 1024);
      try {
        expect(() => headers.get("set-cookie")!.length).toThrow("Out of memory");
        expect(headers.getSetCookie()).toHaveLength(2);
      } finally {
        internalForTesting.setSyntheticAllocationLimitForTesting(originalLimit);
      }
    });
    test("joins many set-cookie values after a long first value", () => {
      const headers = new Headers();
      headers.append("set-cookie", Buffer.alloc(2 ** 20, "x").toString());
      for (let i = 0; i < 2047; i++) headers.append("set-cookie", "a");
      const joined = headers.get("set-cookie")!;
      expect(joined.length).toBe(2 ** 20 + 3 * 2047);
      expect(joined.slice(-4)).toBe("a, a");
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
    test("quotes an invalid name in the error, like get() and delete()", () => {
      const headers = new Headers();
      for (const method of ["has", "get", "delete"] as const) {
        expect(() => headers[method]("a b")).toThrow(new TypeError("Invalid header name: 'a b'"));
      }
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
  describe("iteration", () => {
    // prettier-ignore
    const knownNames = [
      "Accept", "Accept-Charset", "Accept-Encoding", "Accept-Language", "Accept-Ranges", "Access-Control-Allow-Credentials",
      "Access-Control-Allow-Headers", "Access-Control-Allow-Methods", "Access-Control-Allow-Origin",
      "Access-Control-Expose-Headers", "Access-Control-Max-Age", "Access-Control-Request-Headers",
      "Access-Control-Request-Method", "Age", "Authorization", "Cache-Control", "Connection", "Content-Disposition",
      "Content-Encoding", "Content-Language", "Content-Length", "Content-Location", "Content-Range",
      "Content-Security-Policy", "Content-Security-Policy-Report-Only", "Content-Type", "Cookie", "Cookie2",
      "Cross-Origin-Embedder-Policy", "Cross-Origin-Embedder-Policy-Report-Only", "Cross-Origin-Opener-Policy",
      "Cross-Origin-Opener-Policy-Report-Only", "Cross-Origin-Resource-Policy", "DNT", "Date", "Default-Style", "ETag",
      "Expect", "Expires", "Host", "Icy-MetaInt", "Icy-Metadata", "If-Match", "If-Modified-Since", "If-None-Match",
      "If-Range", "If-Unmodified-Since", "Keep-Alive", "Last-Event-ID", "Last-Modified", "Link", "Location", "Origin",
      "Ping-From", "Ping-To", "Pragma", "Proxy-Authorization", "Proxy-Connection", "Purpose", "Range", "Referer",
      "Referrer-Policy", "Refresh", "Report-To", "Sec-Fetch-Dest", "Sec-Fetch-Mode", "Sec-WebSocket-Accept",
      "Sec-WebSocket-Extensions", "Sec-WebSocket-Key", "Sec-WebSocket-Protocol", "Sec-WebSocket-Version",
      "Server-Timing", "Service-Worker", "Service-Worker-Allowed", "Service-Worker-Navigation-Preload", "Set-Cookie2",
      "SourceMap", "Strict-Transport-Security", "TE", "Timing-Allow-Origin", "Trailer", "Transfer-Encoding", "Upgrade",
      "Upgrade-Insecure-Requests", "User-Agent", "Vary", "Via", "X-Content-Type-Options", "X-DNS-Prefetch-Control",
      "X-Frame-Options", "X-SourceMap", "X-Temp-Tablet", "X-XSS-Protection",
    ];
    // Names that sort right before, right after and in between the ones above.
    // prettier-ignore
    const customNames = [
      "A", "Accept-", "Accept-Charsets", "Dat", "Date-", "Dns", "Dnt-", "Icy-Meta", "Icy-Metab", "Icy-Metaj", "Set-Cookie3",
      "X-", "X-Custom", "X-XSS-Protection-", "Z", "_", "~", "0", "!",
    ];
    const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

    function expectEveryWalk(headers: Headers, expected: string[][]) {
      const forEach: string[][] = [];
      headers.forEach((value, key, parent) => {
        expect(parent).toBe(headers);
        forEach.push([key, value]);
      });
      const values = [...headers.values()];
      expect({
        forEach,
        forOf: [...headers],
        entries: [...headers.entries()],
        keysAndValues: [...headers.keys()].map((key, i) => [key, values[i]]),
      }).toEqual({ forEach: expected, forOf: expected, entries: expected, keysAndValues: expected });
    }

    test.each([
      ["in the order they are listed", (names: string[]) => names],
      ["in reverse", (names: string[]) => names.toReversed()],
      [
        "custom names first",
        (names: string[]) => [...names.slice(knownNames.length), ...names.slice(0, knownNames.length)],
      ],
      ["interleaved", (names: string[]) => names.map((_, i) => names[(i * 37) % names.length])],
    ])("every known name and the names around them come out sorted, set %s", (_, order) => {
      const names = order([...knownNames, ...customNames]);
      expect(new Set(names).size).toBe(knownNames.length + customNames.length);
      const headers = new Headers();
      for (const name of names) headers.set(name, `value of ${name}`);

      const expected = names
        .map(name => [name.toLowerCase(), `value of ${name}`])
        .sort((a, b) => byCodeUnit(a[0], b[0]));
      expectEveryWalk(headers, expected);
    });

    // What Bun does today. The Fetch spec sorts "set-cookie" in with the other names.
    test("Set-Cookie headers come last, one entry each", () => {
      const headers = new Headers([
        ["Set-Cookie", "a=1"],
        ["X-Last", "1"],
        ["Set-Cookie", "b=2"],
        ["Accept", "*/*"],
      ]);
      const expected = [
        ["accept", "*/*"],
        ["x-last", "1"],
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
      ];
      expectEveryWalk(headers, expected);
    });

    test("a name stored as UTF-16 is lowercased and sorted like any other", () => {
      const wide = (name: string) => ("\u{1F600}" + name).slice(2);
      const headers = new Headers();
      headers.set(wide("X-Wide-B"), "1");
      headers.set("X-Wide-C", "2");
      headers.set(wide("X-Wide-A"), "3");
      headers.set(wide("Content-Type"), "4");
      expect([...headers]).toEqual([
        ["content-type", "4"],
        ["x-wide-a", "3"],
        ["x-wide-b", "1"],
        ["x-wide-c", "2"],
      ]);
    });

    describe("while the headers change", () => {
      const start = () =>
        new Headers([
          ["Accept", "a"],
          ["Content-Type", "c"],
          ["Host", "h"],
          ["X-Custom", "x"],
          ["X-Other", "y"],
        ]);
      // Takes some steps, applies the change, and collects the rest.
      function walkWith(change: (headers: Headers) => void, steps = 1) {
        const headers = start();
        const iterator = headers.entries();
        const seen: unknown[] = [];
        for (let i = 0; i < steps; i++) seen.push(iterator.next().value);
        change(headers);
        for (const entry of iterator) seen.push(entry);
        return seen;
      }

      test("a new value for a known name that is still to come is seen", () => {
        expect(walkWith(headers => headers.set("host", "changed"))).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["host", "changed"],
          ["x-custom", "x"],
          ["x-other", "y"],
        ]);
      });
      test("a new value for a custom name that is still to come is seen", () => {
        expect(walkWith(headers => headers.set("x-other", "changed"))).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["host", "h"],
          ["x-custom", "x"],
          ["x-other", "changed"],
        ]);
      });
      test("an appended value is seen", () => {
        expect(walkWith(headers => headers.append("X-Custom", "more"))).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["host", "h"],
          ["x-custom", "x, more"],
          ["x-other", "y"],
        ]);
      });
      test("a name deleted before it is reached is skipped", () => {
        expect(walkWith(headers => headers.delete("x-custom"))).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["host", "h"],
          ["x-other", "y"],
        ]);
        expect(walkWith(headers => headers.delete("host"))).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["x-custom", "x"],
          ["x-other", "y"],
        ]);
      });
      test("the iterator keeps its position in the new sorted list", () => {
        // One name fewer before the position: the next one is passed over.
        expect(walkWith(headers => headers.delete("accept"), 2)).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["x-custom", "x"],
          ["x-other", "y"],
        ]);
        // One name more before the position: the last one comes again.
        expect(walkWith(headers => headers.set("Aa", "new"), 2)).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["content-type", "c"],
          ["host", "h"],
          ["x-custom", "x"],
          ["x-other", "y"],
        ]);
      });
      test("a name added after the position is reached", () => {
        expect(walkWith(headers => headers.set("X-Later", "new"), 4)).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["host", "h"],
          ["x-custom", "x"],
          ["x-later", "new"],
          ["x-other", "y"],
        ]);
      });
      test("everything deleted ends the iteration", () => {
        expect(
          walkWith(headers => {
            for (const key of [...headers.keys()]) headers.delete(key);
          }),
        ).toEqual([["accept", "a"]]);
      });
      test("cookies added and removed", () => {
        expect(walkWith(headers => headers.append("Set-Cookie", "a=1"), 5)).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["host", "h"],
          ["x-custom", "x"],
          ["x-other", "y"],
          ["set-cookie", "a=1"],
        ]);

        const headers = start();
        headers.append("Set-Cookie", "a=1");
        headers.append("Set-Cookie", "b=2");
        headers.append("Set-Cookie", "c=3");
        const iterator = headers.values();
        const seen: unknown[] = [];
        for (let i = 0; i < 6; i++) seen.push(iterator.next().value);
        headers.append("Set-Cookie", "d=4");
        seen.push(iterator.next().value);
        headers.delete("Set-Cookie");
        seen.push(iterator.next());
        expect(seen).toEqual(["a", "c", "h", "x", "y", "a=1", "b=2", { value: undefined, done: true }]);
      });
      // Script did not ask for these, so unlike delete() they leave the iterator on the name it stood on.
      describe("a name that native code removes", () => {
        const names = ["accept", "content-length", "content-type", "host", "x-custom"];
        const response = () =>
          new Response("ok", {
            headers: { "Accept": "a", "Content-Length": "2", "Content-Type": "t/t", "Host": "h", "X-Custom": "x" },
          });
        function take(iterator: Iterator<string>, steps: number) {
          const seen: string[] = [];
          for (let i = 0; i < steps; i++) seen.push(iterator.next().value);
          return seen;
        }
        // Content-Length is only seen by an iterator that got to it before it went away. Nothing else is lost.
        const expected = (steps: number) => (steps >= 2 ? names : names.filter(name => name !== "content-length"));

        test.each([0, 1, 2, 3, 4, 5])("as the server writes the response, after %d steps", async steps => {
          let iterator: Iterator<string> & Iterable<string>;
          let seen: string[] = [];
          using server = Bun.serve({
            port: 0,
            fetch() {
              const res = response();
              iterator = res.headers.keys();
              seen = take(iterator, steps);
              return res;
            },
          });
          expect(await (await fetch(server.url)).text()).toBe("ok");
          expect([...seen, ...iterator!]).toEqual(expected(steps));
        });

        test.each([0, 1, 2, 3, 4, 5])("as a static route takes the response, after %d steps", steps => {
          const res = response();
          const iterator = res.headers.keys();
          const seen = take(iterator, steps);
          using server = Bun.serve({ port: 0, routes: { "/": res }, fetch: () => new Response() });
          expect([...seen, ...iterator]).toEqual(expected(steps));
        });

        test("as server.upgrade() takes the headers", async () => {
          let seen: string[] = [];
          using server = Bun.serve({
            port: 0,
            fetch(req, server) {
              const headers = new Headers({
                "Age": "0",
                "Sec-WebSocket-Extensions": "",
                "Sec-WebSocket-Protocol": "a",
                "Server-Timing": "t",
                "X-Custom": "x",
              });
              const iterator = headers.keys();
              seen = take(iterator, 3);
              server.upgrade(req, { headers });
              seen.push(...iterator);
            },
            websocket: {
              open: ws => ws.close(),
              message() {},
            },
          });
          const { promise, resolve } = Promise.withResolvers();
          const ws = new WebSocket(server.url.href.replace("http", "ws"), ["a"]);
          ws.onclose = ws.onerror = resolve;
          await promise;
          expect(seen).toEqual([
            "age",
            "sec-websocket-extensions",
            "sec-websocket-protocol",
            "server-timing",
            "x-custom",
          ]);
        });

        test("and a change by script after that", async () => {
          let res: Response;
          let iterator: Iterator<string> & Iterable<string>;
          let seen: string[] = [];
          using server = Bun.serve({
            port: 0,
            fetch() {
              res = response();
              iterator = res.headers.keys();
              seen = take(iterator, 2);
              return res;
            },
          });
          expect(await (await fetch(server.url)).text()).toBe("ok");
          res!.headers.set("X-Later", "l");
          // The index is kept, as after any change by script: one name fewer before it, so "content-type" is passed over.
          expect([...seen, ...iterator!]).toEqual(["accept", "content-length", "host", "x-custom", "x-later"]);
        });
      });
      test("forEach sees what its callback changes", () => {
        const headers = start();
        const seen: [string, string][] = [];
        headers.forEach((value, key) => {
          seen.push([key, value]);
          if (key === "accept") {
            headers.set("Host", "changed");
            headers.delete("X-Custom");
            headers.set("X-Zzz", "new");
          }
        });
        expect(seen).toEqual([
          ["accept", "a"],
          ["content-type", "c"],
          ["host", "changed"],
          ["x-other", "y"],
          ["x-zzz", "new"],
        ]);
      });
      test("forEach stops at what its callback throws", () => {
        const headers = start();
        const seen: string[] = [];
        expect(() =>
          headers.forEach((_, key) => {
            seen.push(key);
            if (key === "host") throw new RangeError("stop");
          }),
        ).toThrow(new RangeError("stop"));
        expect(seen).toEqual(["accept", "content-type", "host"]);
      });
    });

    test("forEach passes thisArg and rejects what it cannot call", () => {
      const headers = new Headers({ a: "1" });
      const thisArg = {};
      let receiver: unknown;
      headers.forEach(function (this: unknown) {
        receiver = this;
      }, thisArg);
      expect(receiver).toBe(thisArg);
      // @ts-expect-error
      expect(() => headers.forEach({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
      // @ts-expect-error
      expect(() => new Headers().forEach()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    });

    test("an iterator that is done stays done", () => {
      const headers = new Headers({ a: "1" });
      const iterator = headers.entries();
      expect(iterator.next()).toEqual({ value: ["a", "1"], done: false });
      expect(iterator.next()).toEqual({ value: undefined, done: true });
      headers.set("b", "2");
      expect(iterator.next()).toEqual({ value: undefined, done: true });
    });

    test("an iterator over empty headers finds what is added before its first step", () => {
      const headers = new Headers();
      const iterator = headers.keys();
      headers.set("X-Added", "1");
      expect([...iterator]).toEqual(["x-added"]);
    });

    test("an iterator keeps its headers alive", () => {
      const valueOf = (i: number) => Buffer.alloc(64, "v").toString() + i;
      const iterator = (() => {
        const headers = new Headers();
        for (let i = 0; i < 32; i++) headers.set(`X-Custom-${i}`, valueOf(i));
        headers.set("Content-Type", "text/plain");
        const iterator = headers.entries();
        iterator.next();
        return iterator;
      })();
      Bun.gc(true);
      expect([...iterator]).toEqual(
        Array.from({ length: 32 }, (_, i) => [`x-custom-${i}`, valueOf(i)]).sort((a, b) => byCodeUnit(a[0], b[0])),
      );
    });

    test("each entry is a new array in a new result object", () => {
      const headers = new Headers({ "Content-Type": "text/plain" });
      const [first, second] = [headers.entries().next(), headers.entries().next()];
      expect(first).not.toBe(second);
      expect(first.value).not.toBe(second.value);
      first.value![0] = "changed";
      expect(second.value).toEqual(["content-type", "text/plain"]);
      expect([...headers]).toEqual([["content-type", "text/plain"]]);
      expect(Object.getPrototypeOf(first.value)).toBe(Array.prototype);
    });

    test("walking known names makes no string per name", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { heapStats } from "bun:jsc";
           const headers = new Headers({ "Content-Type": "a", "Content-Length": "1", "Cache-Control": "b", "Accept": "c", "Host": "d", "User-Agent": "e", "ETag": "f", "Date": "g" });
           const kept = [];
           const walk = () => {
             kept.push(...headers.keys());
             for (const [key] of headers) kept.push(key);
             headers.forEach((_, key) => kept.push(key));
           };
           walk();
           const before = heapStats().objectTypeCounts.string;
           for (let i = 0; i < 500; i++) walk();
           console.log(kept.length, heapStats().objectTypeCounts.string - before < 500);`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("12024 true\n");
      expect(exitCode).toBe(0);
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
  // Up to 64 custom names, HTTPHeaderMap finds one with a scan. Above that it uses a hash index, and a name that is
  // deleted leaves a hole in the list. With more holes than names the list is packed again, and the scan is back
  // when 64 names or fewer are left.
  describe("many custom names", () => {
    const name = (i: number) => `x-custom-${i}`;
    // Every second name is stored with capitals and asked for without, and the other way around.
    const stored = (i: number) => (i % 2 ? name(i) : `X-Custom-${i}`);
    const asked = (i: number) => (i % 2 ? `X-Custom-${i}` : name(i));

    // A Map keeps its keys the way Headers keeps custom names: in the order they were added, a new value in the
    // old place, and a name that was deleted and added again at the end.
    function expectSame(headers: Headers, model: Map<string, string>, upTo: number) {
      const indexes = Array.from({ length: upTo }, (_, i) => i);
      expect({
        count: headers.count,
        inOrder: Object.entries(headers.toJSON()),
        sorted: [...headers],
        get: indexes.map(i => headers.get(asked(i))),
        has: indexes.map(i => headers.has(asked(i))),
      }).toEqual({
        count: model.size,
        inOrder: [...model],
        sorted: [...model].sort(([a], [b]) => (a < b ? -1 : 1)),
        get: indexes.map(i => model.get(name(i)) ?? null),
        has: indexes.map(i => model.has(name(i))),
      });
    }

    test.each([32, 33, 64, 65, 66, 130, 200])("%d names are found, changed and deleted like the keys of a Map", n => {
      const headers = new Headers();
      const model = new Map<string, string>();
      for (let i = 0; i < n; i++) {
        headers.append(stored(i), `v${i}`);
        model.set(name(i), `v${i}`);
      }
      expectSame(headers, model, n + 1);

      for (let i = 0; i < n; i++) {
        if (i % 3 === 0) {
          headers.set(asked(i), `s${i}`);
          model.set(name(i), `s${i}`);
        } else if (i % 3 === 1) {
          headers.append(asked(i), `a${i}`);
          model.set(name(i), `v${i}, a${i}`);
        } else {
          headers.delete(asked(i));
          model.delete(name(i));
        }
      }
      expectSame(headers, model, n + 1);

      // From the front until nothing is left. Every fourth name comes back, at the end.
      const every = Math.ceil(n / 6);
      for (let i = 0; i < n; i++) {
        headers.delete(asked(i));
        model.delete(name(i));
        if (i % 4 === 0) {
          headers.set(stored(i), `again${i}`);
          model.set(name(i), `again${i}`);
        }
        if (i % every === 0) expectSame(headers, model, n);
      }
      for (const key of [...model.keys()]) {
        headers.delete(key);
        model.delete(key);
        if (model.size % every === 0) expectSame(headers, model, n);
      }
    });

    test("random changes to two copies match a Map each", () => {
      let seed = 0x2f6e2b1;
      const random = (below: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return Math.floor((seed / 2 ** 32) * below);
      };
      const pool = 180;
      let pairs: [Headers, Map<string, string>][] = [
        [new Headers(), new Map()],
        [new Headers(), new Map()],
      ];
      for (let step = 0; step < 2400; step++) {
        const [headers, model] = pairs[random(2)];
        // For 600 steps most names of the pool are added, then for 600 steps most of them are deleted.
        // No copy is made while the names are deleted, so that the holes add up.
        const grow = Math.floor(step / 600) % 2 === 0;
        const i = random(pool);
        const action = random(grow ? 24 : 60);
        const [append, set, get, copy] = grow ? [8, 14, 18, 19] : [4, 7, 9, 9];
        if (action < append) {
          headers.append(stored(i), `a${step}`);
          model.set(name(i), model.has(name(i)) ? `${model.get(name(i))}, a${step}` : `a${step}`);
        } else if (action < set) {
          headers.set(asked(i), `s${step}`);
          model.set(name(i), `s${step}`);
        } else if (action < get) {
          expect(headers.get(asked(i))).toBe(model.get(name(i)) ?? null);
          expect(headers.has(stored(i))).toBe(model.has(name(i)));
        } else if (action < copy) {
          // The other pair goes on from a copy of this one.
          pairs = [
            [headers, model],
            [new Headers(headers), new Map(model)],
          ];
        } else {
          headers.delete(asked(i));
          model.delete(name(i));
        }
        if (step % 600 === 599) for (const [headers, model] of pairs) expectSame(headers, model, pool);
      }
    });

    test("a name in 16-bit characters is the same name", () => {
      const wide = (text: string) => ("\u{1F600}" + text).slice(2);
      const headers = new Headers();
      for (let i = 0; i < 80; i++) headers.set(i % 2 ? wide(stored(i)) : stored(i), `v${i}`);
      for (let i = 0; i < 80; i++) {
        expect(headers.get(i % 3 ? wide(asked(i)) : asked(i))).toBe(`v${i}`);
        headers.append(i % 3 ? asked(i) : wide(asked(i)), "more");
      }
      expect(headers.count).toBe(80);
      expect(headers.get(name(79))).toBe("v79, more");
      headers.delete(wide(asked(79)));
      expect(headers.has(name(79))).toBe(false);
      expect(() => headers.get(wide("x-custom-\u00e9"))).toThrow("Invalid header name");
    });

    test("an iterator goes on while the names pass 64 and the index comes and goes", () => {
      const headers = new Headers();
      for (let i = 100; i < 164; i++) headers.set(name(i), "v");
      const iterator = headers.keys();
      const seen = [iterator.next().value, iterator.next().value];
      expect(headers.get(name(163))).toBe("v");
      headers.set(name(164), "v");
      expect(headers.has(name(164))).toBe(true);
      seen.push(iterator.next().value);
      for (let i = 104; i < 164; i++) headers.delete(name(i));
      expect(headers.has(name(165))).toBe(false);
      expect([...seen, ...iterator]).toEqual([100, 101, 102, 103, 164].map(name));
    });

    test("a copy has its own names", () => {
      const headers = new Headers();
      for (let i = 0; i < 90; i++) headers.set(name(i), "v");
      for (let i = 0; i < 10; i++) headers.delete(name(i));
      const copy = new Headers(headers);
      const request = new Request("http://localhost/", { headers });
      const clone = request.clone();

      copy.delete(name(89));
      copy.set(name(5), "copy");
      headers.set(name(89), "changed");
      headers.delete(name(20));
      expect([copy.count, copy.get(name(89)), copy.get(name(5)), copy.get(name(20))]).toEqual([80, null, "copy", "v"]);
      expect([headers.count, headers.get(name(89)), headers.has(name(5))]).toEqual([79, "changed", false]);
      expect([request.headers.count, clone.headers.get(name(89)), clone.headers.get(name(20))]).toEqual([80, "v", "v"]);
      expect(Bun.deepEquals(request.headers, clone.headers)).toBe(true);
      expect(Bun.deepEquals(headers, copy)).toBe(false);
      // The copy was not asked for a name before its first delete.
      const second = new Headers(headers);
      for (let i = 10; i < 89; i++) second.delete(name(i));
      expect(second.toJSON()).toEqual({ [name(89)]: "changed" });
      expect(headers.count).toBe(79);
    });

    test.each([1, 4, 5, 17])("a copy has its own %d Set-Cookie values", count => {
      const cookies = Array.from({ length: count }, (_, i) => `c${i}=1`);
      const headers = new Headers(cookies.map(cookie => ["Set-Cookie", cookie]));
      const copy = new Headers(headers);
      copy.append("set-cookie", "more=1");
      headers.delete("set-cookie");
      expect(headers.getSetCookie()).toEqual([]);
      expect(copy.getSetCookie()).toEqual([...cookies, "more=1"]);
      expect([...copy]).toEqual([...cookies, "more=1"].map(cookie => ["set-cookie", cookie]));
      copy.set("Set-Cookie", "one=1");
      expect(copy.get("set-cookie")).toBe("one=1");
      expect(copy.count).toBe(1);
    });

    // Sends one request with the given header lines and gives back the raw response.
    async function rawRequest(server: { hostname?: string; port?: number }, fields: string[]) {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      let response = "";
      const socket = await Bun.connect({
        hostname: server.hostname!,
        port: server.port!,
        socket: {
          data(socket, chunk) {
            response += chunk.toString("latin1");
            const end = response.indexOf("\r\n\r\n");
            if (end === -1) return;
            const length = Number(/^content-length: (\d+)$/im.exec(response)?.[1]);
            if (response.length === end + 4 + length) {
              resolve(response);
              socket.end();
            }
          },
          error: (_, error) => reject(error),
          close: () => reject(new Error("closed before the response ended: " + JSON.stringify(response))),
        },
      });
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n" + fields.map(field => field + "\r\n").join("") + "\r\n");
      return promise;
    }

    test("what was deleted is not sent, and the rest is sent as it was first spelled", async () => {
      const headers = new Headers();
      for (let i = 0; i < 80; i++) headers.append(stored(i), `v${i}`);
      for (let i = 1; i < 80; i += 2) headers.delete(asked(i));
      for (let i = 0; i < 80; i += 4) headers.set(asked(i), `s${i}`);
      const sent = Array.from({ length: 40 }, (_, i) => `X-Custom-${i * 2}: ${i % 2 ? "v" : "s"}${i * 2}`);
      const names = Array.from({ length: 40 }, (_, i) => name(i * 2));

      let received: string[] = [];
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          received = Object.keys(req.headers.toJSON()).filter(key => key.startsWith("x-custom-"));
          return new Response("ok", { headers });
        },
      });
      const lines = (await rawRequest(server, sent)).split("\r\n");
      expect(lines.filter(line => /^x-custom-/i.test(line))).toEqual(sent);
      expect(lines.filter(line => /^[^:]*:\s*$/.test(line))).toEqual([]);
      expect(received).toEqual(names);

      // fetch() counts the headers and then copies them.
      expect(await (await fetch(server.url, { headers })).text()).toBe("ok");
      expect(received.toSorted()).toEqual(names.toSorted());
    });

    test("a request with many custom names and a repeated one", async () => {
      using server = Bun.serve({
        port: 0,
        fetch: req =>
          Response.json([
            req.headers.count,
            req.headers.get(asked(0)),
            req.headers.get(asked(79)),
            Object.keys(req.headers.toJSON()).slice(1),
          ]),
      });
      const fields = Array.from({ length: 80 }, (_, i) => `${stored(i)}: v${i}`);
      const response = await rawRequest(server, [...fields, `${asked(0)}: again`, `${asked(79)}: again`]);
      expect(JSON.parse(response.split("\r\n\r\n")[1])).toEqual([
        81,
        "v0, again",
        "v79, again",
        Array.from({ length: 80 }, (_, i) => name(i)),
      ]);
    });

    test("a response with many custom names and a repeated one", async () => {
      const fields = Array.from({ length: 80 }, (_, i) => `${stored(i)}: v${i}\r\n`).join("");
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket) {
            socket.end(
              `HTTP/1.1 200 OK\r\nContent-Length: 2\r\n${fields}${asked(0)}: again\r\n${asked(79)}: again\r\n\r\nok`,
            );
          },
        },
      });
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(await response.text()).toBe("ok");
      expect([response.headers.count, response.headers.get(asked(0)), response.headers.get(asked(79))]).toEqual([
        81,
        "v0, again",
        "v79, again",
      ]);
      expect(Object.keys(response.headers.toJSON()).slice(1)).toEqual(Array.from({ length: 80 }, (_, i) => name(i)));
      response.headers.delete(name(0));
      expect([response.headers.count, response.headers.has(asked(0))]).toEqual([80, false]);
    });

    // Each of these walked every stored name once or twice per call, so the time grew with the square of the
    // number of names. The spawn timeout tells the two apart. A debug build takes longer for one call than a
    // release build takes for a scan, which is why the sizes differ.
    const N = isDebug ? 12_000 : 200_000;
    const setup = `
      const N = ${N};
      const names = Array.from({ length: N }, (_, i) => "x-custom-" + i);
      const pairs = names.map(name => [name, "1"]);
      const expectCount = headers => { if (headers.count !== N) throw new Error("count " + headers.count); };
    `;
    test.concurrent.each([
      ["new Headers(record)", `expectCount(new Headers(Object.fromEntries(pairs)));`],
      ["new Headers(pairs)", `expectCount(new Headers(pairs));`],
      ["new Request(url, { headers })", `expectCount(new Request("http://a/", { headers: pairs }).headers);`],
      ["new Response(body, { headers })", `expectCount(new Response(null, { headers: pairs }).headers);`],
      ["append()", `const h = new Headers(); for (const name of names) h.append(name, "1"); expectCount(h);`],
      ["set()", `const h = new Headers(); for (const name of names) h.set(name, "1"); expectCount(h);`],
      [
        "get() and has()",
        `const h = new Headers(pairs);
         for (const name of names) if (h.get(name) !== "1" || !h.has(name) || h.has(name + "-")) throw new Error(name);`,
      ],
      [
        "get() on a copy",
        `const h = new Headers(new Headers(pairs)); for (const name of names) if (h.get(name) !== "1") throw new Error(name);`,
      ],
      [
        "delete(), last name first",
        `const h = new Headers(pairs); for (const name of names.toReversed()) h.delete(name); if (h.count) throw new Error("left");`,
      ],
      [
        "delete(), first name first",
        `const h = new Headers(pairs); for (const name of names) h.delete(name); if (h.count) throw new Error("left");`,
      ],
      [
        "delete() on a copy",
        `const h = new Headers(new Headers(pairs)); for (const name of names.toReversed()) h.delete(name); if (h.count) throw new Error("left");`,
      ],
    ])(
      "%s takes time in proportion to the number of names",
      async (_, body) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", setup + body + `console.log("done");`],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 15_000,
          killSignal: "SIGKILL",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
          stdout: "done",
          stderr: "",
          exitCode: 0,
          signalCode: null,
        });
      },
      60_000,
    );
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

  // Debug builds need minutes to validate the 4 GiB of values the child appends.
  test.skipIf(isDebug)("fetch() and Bun.serve() reject headers that total 4 GiB or more", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
          // The 16 values share one 256 MiB string. Names and values total 2 ** 32 - 1 bytes,
          // which is the maximum.
          const value = Buffer.alloc(2 ** 28, "a").toString("latin1");
          const headers = new Headers();
          for (let i = 0; i < 15; i++) headers.append("set-cookie", value);
          headers.append("set-cookie", value.slice(0, 2 ** 28 - 161));

          async function outcome(fn) {
            try {
              await fn();
              return "no error";
            } catch (e) {
              return e.name + ": " + e.message;
            }
          }
          function serve(response) {
            Bun.serve({ port: 0, routes: { "/": response } }).stop(true);
          }

          await using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
          const url = server.url.href;
          const file = Bun.file(process.execPath);

          // The headers fit by themselves, but not with the Content-Type that fetch() adds for the body.
          const body = new Blob(["x"], { type: "text/plain" });
          console.log("content-type:", await outcome(() => fetch(url, { method: "POST", body, headers })));

          // This brings the total to 2 ** 32 + 10 bytes.
          headers.append("set-cookie", "x");
          console.log("fetch:", await outcome(() => fetch(url, { headers })));
          console.log("proxy:", await outcome(() => fetch(url, { proxy: { url, headers } })));
          console.log("static route:", await outcome(() => serve(new Response("body", { headers }))));
          console.log("file route:", await outcome(() => serve(new Response(file, { headers }))));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    const error = "RangeError: Headers exceed the maximum total size of 4294967295 bytes";
    expect(stdout.split("\n")).toEqual([
      `content-type: ${error}`,
      `fetch: ${error}`,
      `proxy: ${error}`,
      `static route: ${error}`,
      `file route: ${error}`,
      "",
    ]);
    expect(exitCode).toBe(0);
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
