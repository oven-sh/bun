import { describe, test } from "bun:test";
import assert from "node:assert";
import url from "node:url";

describe("url.parse", () => {
  describe.each(["/foo/bar?baz=quux", "/foo/bar", "http://example.com/a?baz=quux", "http://example.com/a"])(
    "parseQueryString for %s",
    input => {
      test("returns a null-prototype query object", () => {
        const { query } = url.parse(input, true);
        assert.strictEqual(Object.getPrototypeOf(query), null);
        assert.strictEqual(query.hasOwnProperty, undefined);
        assert.strictEqual(query.toString, undefined);
      });
    },
  );

  test("parseQueryString keeps single values and repeated keys", () => {
    const { query } = url.parse("/foo/bar?baz=quux&baz=2&single=1", true);
    assert.strictEqual(query.single, "1");
    assert.deepStrictEqual(query.baz, ["quux", "2"]);
  });

  describe.each(["/foo/bar?baz=quux&baz=2", "http://example.com/a?b=1"])(
    "parseQueryString query object for %s",
    input => {
      test("carries no symbol keys", () => {
        const { query } = url.parse(input, true);
        assert.deepStrictEqual(Object.getOwnPropertySymbols(query), []);
        assert.strictEqual(Object.getPrototypeOf(query), null);
        assert.strictEqual(query[Symbol.toStringTag], undefined);
      });
    },
  );

  test("with query string", () => {
    function createWithNoPrototype(properties = []) {
      const noProto = { __proto__: null };
      properties.forEach(property => {
        noProto[property.key] = property.value;
      });
      return noProto;
    }

    function check(actual, expected) {
      assert.notStrictEqual(Object.getPrototypeOf(actual), Object.prototype);
      assert.deepStrictEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
      Object.keys(expected).forEach(function (key) {
        assert.deepStrictEqual(actual[key], expected[key]);
      });
    }

    const parseTestsWithQueryString = {
      "/foo/bar?baz=quux#frag": {
        href: "/foo/bar?baz=quux#frag",
        hash: "#frag",
        search: "?baz=quux",
        query: createWithNoPrototype([{ key: "baz", value: "quux" }]),
        pathname: "/foo/bar",
        path: "/foo/bar?baz=quux",
      },
      "http://example.com": {
        href: "http://example.com/",
        protocol: "http:",
        slashes: true,
        host: "example.com",
        hostname: "example.com",
        query: createWithNoPrototype(),
        search: null,
        pathname: "/",
        path: "/",
      },
      "/example": {
        protocol: null,
        slashes: null,
        auth: undefined,
        host: null,
        port: null,
        hostname: null,
        hash: null,
        search: null,
        query: createWithNoPrototype(),
        pathname: "/example",
        path: "/example",
        href: "/example",
      },
      "/example?query=value": {
        protocol: null,
        slashes: null,
        auth: undefined,
        host: null,
        port: null,
        hostname: null,
        hash: null,
        search: "?query=value",
        query: createWithNoPrototype([{ key: "query", value: "value" }]),
        pathname: "/example",
        path: "/example?query=value",
        href: "/example?query=value",
      },
    };
    for (const u in parseTestsWithQueryString) {
      const actual = url.parse(u, true);
      const expected = Object.assign(new url.Url(), parseTestsWithQueryString[u]);
      for (const i in actual) {
        if (actual[i] === null && expected[i] === undefined) {
          expected[i] = null;
        }
      }

      const properties = Object.keys(actual).sort();
      assert.deepStrictEqual(properties, Object.keys(expected).sort());
      properties.forEach(property => {
        if (property === "query") {
          check(actual[property], expected[property]);
        } else {
          assert.deepStrictEqual(actual[property], expected[property]);
        }
      });
    }
  });
});
