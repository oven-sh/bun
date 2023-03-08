import { describe, it, expect } from "bun:test";

describe("url", () => {
  it("prints", () => {
    expect(Bun.inspect(new URL("https://example.com"))).toBe(`URL {
  "href": "https://example.com/",
  "origin": "https://example.com",
  "protocol": "https:",
  "username": "",
  "password": "",
  "host": "example.com",
  "hostname": "example.com",
  "port": "",
  "pathname": "/",
  "hash": "",
  "search": "",
  "searchParams": URLSearchParams {
    "append": [Function: append],
    "delete": [Function: delete],
    "get": [Function: get],
    "getAll": [Function: getAll],
    "has": [Function: has],
    "set": [Function: set],
    "sort": [Function: sort],
    "entries": [Function: entries],
    "keys": [Function: keys],
    "values": [Function: values],
    "forEach": [Function: forEach],
    "toString": [Function: toString],
    [Symbol(Symbol.iterator)]: [Function: entries],
  },
  "toJSON": [Function: toJSON],
  "toString": [Function: toString],
}`);

    expect(
      Bun.inspect(
        new URL("https://github.com/oven-sh/bun/issues/135?hello%20i%20have%20spaces%20thank%20you%20good%20night"),
      ),
    ).toBe(`URL {
  "href": "https://github.com/oven-sh/bun/issues/135?hello%20i%20have%20spaces%20thank%20you%20good%20night",
  "origin": "https://github.com",
  "protocol": "https:",
  "username": "",
  "password": "",
  "host": "github.com",
  "hostname": "github.com",
  "port": "",
  "pathname": "/oven-sh/bun/issues/135",
  "hash": "",
  "search": "?hello%20i%20have%20spaces%20thank%20you%20good%20night",
  "searchParams": URLSearchParams {
    "append": [Function: append],
    "delete": [Function: delete],
    "get": [Function: get],
    "getAll": [Function: getAll],
    "has": [Function: has],
    "set": [Function: set],
    "sort": [Function: sort],
    "entries": [Function: entries],
    "keys": [Function: keys],
    "values": [Function: values],
    "forEach": [Function: forEach],
    "toString": [Function: toString],
    [Symbol(Symbol.iterator)]: [Function: entries],
  },
  "toJSON": [Function: toJSON],
  "toString": [Function: toString],
}`);
  });
  it("works", () => {
    const inputs = [
      [
        "https://username:password@api.foo.bar.com:9999/baz/okay/i/123?ran=out&of=things#to-use-as-a-placeholder",
        {
          hash: "#to-use-as-a-placeholder",
          host: "api.foo.bar.com:9999",
          hostname: "api.foo.bar.com",
          href: "https://username:password@api.foo.bar.com:9999/baz/okay/i/123?ran=out&of=things#to-use-as-a-placeholder",
          origin: "https://api.foo.bar.com:9999",
          password: "password",
          pathname: "/baz/okay/i/123",
          port: "9999",
          protocol: "https:",
          search: "?ran=out&of=things",
          username: "username",
        },
      ],
      [
        "https://url.spec.whatwg.org/#url-serializing",
        {
          hash: "#url-serializing",
          host: "url.spec.whatwg.org",
          hostname: "url.spec.whatwg.org",
          href: "https://url.spec.whatwg.org/#url-serializing",
          origin: "https://url.spec.whatwg.org",
          password: "",
          pathname: "/",
          port: "",
          protocol: "https:",
          search: "",
          username: "",
        },
      ],
      [
        "https://url.spec.whatwg.org#url-serializing",
        {
          hash: "#url-serializing",
          host: "url.spec.whatwg.org",
          hostname: "url.spec.whatwg.org",
          href: "https://url.spec.whatwg.org/#url-serializing",
          origin: "https://url.spec.whatwg.org",
          password: "",
          pathname: "/",
          port: "",
          protocol: "https:",
          search: "",
          username: "",
        },
      ],
    ] as const;

    for (let [url, values] of inputs) {
      const result = new URL(url);
      expect(result.hash).toBe(values.hash);
      expect(result.host).toBe(values.host);
      expect(result.hostname).toBe(values.hostname);
      expect(result.href).toBe(values.href);
      expect(result.password).toBe(values.password);
      expect(result.pathname).toBe(values.pathname);
      expect(result.port).toBe(values.port);
      expect(result.protocol).toBe(values.protocol);
      expect(result.search).toBe(values.search);
      expect(result.username).toBe(values.username);
    }
  });
});
