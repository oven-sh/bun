// prettier-ignore
import { beforeAll,describe,expect,it } from "bun:test";
import url from "node:url";

// url.parse is deprecated.
process.emitWarning = () => {};

describe("Invalid IPv6 addresses", () => {
  it.each(["https://[::1", "https://[:::1]", "https://[\n::1]", "http://[::banana]"])(
    "Invalid hostnames - parsing '%s' fails",
    input => {
      expect(() => url.parse(input)).toThrowError(TypeError);
    },
  );

  it.each(["https://[::1]::", "https://[::1]:foo"])("Invalid ports - parsing '%s' fails", input => {
    expect(() => url.parse(input)).toThrowError(TypeError);
  });
}); // </Invalid IPv6 addresses>

describe("Valid spot checks", () => {
  it.each([
    // ports
    ["http://[::1]:", { host: "[::1]", hostname: "::1", port: null, path: "/", href: "http://[::1]/" }], // trailing colons are ignored
    ["http://[::1]:1", { host: "[::1]", hostname: "::1", port: "1", path: "/", href: "http://[::1]/" }],

    // unicast
    ["http://[::0]", { host: "[::0]", path: "/" }],
    ["http://[::f]", { host: "[::f]", path: "/" }],
    ["http://[::F]", { host: "[::F]", path: "/" }],
    // these are technically invalid unicast addresses but url.parse allows them
    ["http://[::7]", { host: "[::7]", path: "/" }],
    // ["http://[::z]",       { host: "[::7]",       path: "/" }],
    // ["http://[::😩]",      { host: "[::😩]",      path: "/" }],

    // full form-ish
    ["https://[::1:2:3:4:5]", { host: "[::1:2:3:4:5]", path: "/" }],
    ["[0:0:0:1:2:3:4:5]", { host: "[0:0:0:1:2:3:4:5]", path: "/" }],
  ])("Parsing '%s' succeeds", (input, expected) => {
    expect(url.parse(input)).toMatchObject(expect.objectContaining(expected));
  });
}); // </Valid spot checks>

// checks on all properties
describe.each([
  [
    "[::1]", // w/o a protocol, it's treated as a path
    {
      protocol: null,
      slashes: null,
      auth: null,
      host: null,
      port: null,
      hostname: null,
      hash: null,
      search: null,
      query: null,
      pathname: "[::1]",
      path: "[::1]",
      href: "[::1]",
    },
  ],
  [
    "https://[::1]",
    {
      protocol: "https:",
      slashes: true,
      auth: null,
      host: "[::1]",
      port: null,
      hostname: "::1",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "https://[::1]/",
    },
  ],
  [
    "http://user@[::1]:3000/foo/bar#baz?a=hi&b=1&c=%20",
    {
      protocol: "http:",
      slashes: true,
      auth: "user",
      host: "[::1]:3000",
      port: "3000",
      hostname: "::1",
      hash: "#baz?a=hi&b=1&c=%20",
      search: null,
      query: null,
      pathname: "/foo/bar",
      path: "/foo/bar",
      href: "http://user@[::1]:3000/foo/bar#baz?a=hi&b=1&c=%20",
    },
  ],
  [
    "http://user@[::1]:80/foo/bar?a=hi&b=1&c=%20",
    {
      protocol: "http:",
      slashes: true,
      auth: "user",
      host: "[::1]:80",
      port: "80",
      hostname: "::1",
      hash: null,
      search: "?a=hi&b=1&c=%20",
      query: "a=hi&b=1&c=%20",
      pathname: "/foo/bar",
      path: "/foo/bar?a=hi&b=1&c=%20",
      href: "http://user@[::1]:80/foo/bar?a=hi&b=1&c=%20",
    },
  ],
  /*
  [
    // 7 bytes instead of 8
    "http://[0:0:1:2:3:4:5]/foo?bar#bar",
    {
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "[0:0:1:2:3:4:5]",
      port: null,
      hostname: "0:0:1:2:3:4:5",
      hash: "#bar",
      search: "?bar",
      query: "bar",
      pathname: "/foo",
      path: "/foo?bar",
      href: "http://[0:0:1:2:3:4:5]/foo?bar#bar",
    },
  ],
  */
  [
    "file://[::1]",
    {
      protocol: "file:",
      slashes: true,
      auth: null,
      host: "[::1]",
      port: null,
      hostname: "::1",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "file://[::1]/",
    },
  ],
])("Valid", (input, expected) => {
  describe(`url.parse("${input}")`, () => {
    let parsed: url.UrlWithStringQuery;

    beforeAll(() => {
      parsed = url.parse(input);
    });

    it("parses to the expected object", () => {
      expect(parsed).toMatchObject(expected);
    });

    it("is a Url, not a URL", () => {
      expect(parsed).not.toBeInstanceOf(url.URL);
      expect(parsed).not.toBeInstanceOf(globalThis.URL);
    });
  }); // </url.parse(ipv6)>

  describe(`url.parse("${input}", true)`, () => {
    let parsed: url.UrlWithParsedQuery;

    beforeAll(() => {
      parsed = url.parse(input, true);
    });

    it("parses to the expected object", () => {
      const { query, ...rest } = expected;
      expect(parsed).toMatchObject(expect.objectContaining(rest));
    });

    it("parses the query", () => {
      expect(parsed.query).not.toBeInstanceOf(String);
    });
  }); // </url.parse(ipv6, true)>
}); // </Valid ipv6>
