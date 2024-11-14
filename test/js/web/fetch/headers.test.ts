import { beforeAll, describe, expect, test } from "bun:test";

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
});
