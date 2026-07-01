import { describe, expect, it } from "bun:test";

describe("url", () => {
  it("URL throws", () => {
    expect(() => new URL("")).toThrow('"" cannot be parsed as a URL');
    expect(() => new URL(" ")).toThrow('" " cannot be parsed as a URL');
    expect(() => new URL("boop", "http!/example.com")).toThrow(
      '"boop" cannot be parsed as a URL against "http!/example.com"',
    );
    expect(() => new URL("boop", "http!/example.com")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_URL",
      }),
    );

    // redact
    expect(() => new URL("boop", "https!!username:password@example.com")).toThrow(
      '"boop" cannot be parsed as a URL against <redacted>',
    );
  });

  it("should have correct origin and protocol", () => {
    var url = new URL("https://example.com");
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe("https://example.com");
    url = new URL("about:blank");
    expect(url.protocol).toBe("about:");
    expect(url.origin).toBe("null");
    url = new URL("http://example.com");
    expect(url.protocol).toBe("http:");
    expect(url.origin).toBe("http://example.com");
    url = new URL("ftp://example.com");
    expect(url.protocol).toBe("ftp:");
    expect(url.origin).toBe("ftp://example.com");
    url = new URL("file://example.com");
    expect(url.protocol).toBe("file:");
    expect(url.origin).toBe("null");
    url = new URL("ws://example.com");
    expect(url.protocol).toBe("ws:");
    expect(url.origin).toBe("ws://example.com");
    url = new URL("wss://example.com");
    expect(url.protocol).toBe("wss:");
    expect(url.origin).toBe("wss://example.com");
    url = new URL("kekjafek://example.com");
    expect(url.protocol).toBe("kekjafek:");
    expect(url.origin).toBe("null");
    url = new URL("data:text/plain,Hello%2C%20World!");
    expect(url.protocol).toBe("data:");
    expect(url.origin).toBe("null");
    url = new URL("blob://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("javascript:alert('Hello World!')");
    expect(url.protocol).toBe("javascript:");
    expect(url.origin).toBe("null");
    url = new URL("mailto:");
    expect(url.protocol).toBe("mailto:");
    expect(url.origin).toBe("null");
  });
  it("blob urls", () => {
    var url = new URL("blob:https://example.com/1234-5678");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("https://example.com");
    url = new URL("blob:file://text.txt");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("file://text.txt");
    url = new URL("blob:kjka://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:blob://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:blob://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:ws://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("ws://example.com");
    url = new URL("blob:file:///folder/else/text.txt");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("file://");
  });
  it("prints", () => {
    expect(Bun.inspect(new URL("https://example.com"))).toBe(`URL {
  href: "https://example.com/",
  origin: "https://example.com",
  protocol: "https:",
  username: "",
  password: "",
  host: "example.com",
  hostname: "example.com",
  port: "",
  pathname: "/",
  hash: "",
  search: "",
  searchParams: ${Bun.inspect(new URLSearchParams())},
  toJSON: [Function: toJSON],
  toString: [Function: toString],
}`);

    expect(
      Bun.inspect(
        new URL("https://github.com/oven-sh/bun/issues/135?hello%20i%20have%20spaces%20thank%20you%20good%20night"),
      ),
    ).toBe(`URL {
  href: "https://github.com/oven-sh/bun/issues/135?hello%20i%20have%20spaces%20thank%20you%20good%20night",
  origin: "https://github.com",
  protocol: "https:",
  username: "",
  password: "",
  host: "github.com",
  hostname: "github.com",
  port: "",
  pathname: "/oven-sh/bun/issues/135",
  hash: "",
  search: "?hello%20i%20have%20spaces%20thank%20you%20good%20night",
  searchParams: URLSearchParams {\n    \"hello i have spaces thank you good night\": \"\",\n  },
  toJSON: [Function: toJSON],
  toString: [Function: toString],
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

  // https://url.spec.whatwg.org/#host-state: the parser removes ASCII tab and
  // newline, then ":", "/", "?", "#", and "\" end the host. A special non-file
  // URL must be left unchanged when nothing in the value precedes that point.
  describe("host and hostname setters", () => {
    it("does not rewrite the authority from a path segment on an invalid value", () => {
      const url = new URL("ws://x:80/a/b/c");
      url.host = "#z";
      expect({
        href: url.href,
        host: url.host,
        hostname: url.hostname,
        port: url.port,
        pathname: url.pathname,
      }).toEqual({
        href: "ws://x/a/b/c",
        host: "x",
        hostname: "x",
        port: "",
        pathname: "/a/b/c",
      });
    });

    // Every expected href below matches Node 26.3.
    it.each([
      // values starting with a host terminator are a no-op on special schemes
      ["ws://x:80/a/b/c", "host", "#z", "ws://x/a/b/c"],
      ["ws://x:80/a/b/c", "hostname", "#z", "ws://x/a/b/c"],
      ["http://example.com/a/b/c", "host", "#z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "hostname", "#z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "/z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "?z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "\\z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "hostname", "/z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "hostname", "\\z", "http://example.com/a/b/c"],
      ["https://example.com/a/b/c", "host", "#", "https://example.com/a/b/c"],
      ["wss://x/a/b/c", "hostname", "#z", "wss://x/a/b/c"],
      ["http://example.com:81/a/b/c", "host", "#z", "http://example.com:81/a/b/c"],
      ["http://example.com:81/a/b/c", "hostname", "#z", "http://example.com:81/a/b/c"],
      ["http://u:p@example.com/a/b", "host", "#z", "http://u:p@example.com/a/b"],
      // the parser removes ASCII tab and newline first, so an all-tab-or-newline
      // value (or one where only a terminator follows) has an empty host too
      ["http://example.com/a/b/c", "host", "\t", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "hostname", "\t", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "\n\r\t", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "\t#z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "hostname", "\t#z", "http://example.com/a/b/c"],
      ["ws://x:80/a/b/c", "host", "\t", "ws://x/a/b/c"],
      // ":" ends the host as well, so a value with nothing before it is a no-op
      ["http://example.com/a/b/c", "host", ":99", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "hostname", ":99", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "\t:80", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "\t:99", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "host", "\t:x", "http://example.com/a/b/c"],
      // a leading space is NOT removed (that trim is for top-level parses only);
      // it makes the host non-empty and then fails host parsing, also a no-op
      ["http://example.com/a/b/c", "host", " #z", "http://example.com/a/b/c"],
      ["http://example.com/a/b/c", "hostname", " /z", "http://example.com/a/b/c"],
      // the part before the first terminator still applies when it is non-empty
      ["http://example.com/a/b/c", "host", "y#z", "http://y/a/b/c"],
      ["http://example.com/a/b/c", "hostname", "y/z", "http://y/a/b/c"],
      ["http://example.com/a/b/c", "host", "y:99#z", "http://y:99/a/b/c"],
      ["http://example.com:81/a/b/c", "host", "y#z", "http://y:81/a/b/c"],
      ["http://example.com/a/b/c", "host", "\ty", "http://y/a/b/c"],
      ["http://example.com/a/b/c", "hostname", "y\tz", "http://yz/a/b/c"],
      ["http://example.com/a/b/c", "host", "y\t:99", "http://y:99/a/b/c"],
      // file and non-special schemes allow an empty host, so the value still applies
      ["file://x/a/b", "host", "#z", "file:///a/b"],
      ["foo://x/a/b", "host", "#z", "foo:///a/b"],
      ["foo://x/a/b", "hostname", "/z", "foo:///a/b"],
    ] as const)("new URL(%j).%s = %j -> %j", (base, property, value, expected) => {
      const url = new URL(base);
      url[property] = value;
      expect(url.href).toBe(expected);
    });
  });

  describe("URL.canParse", () => {
    (
      [
        {
          "url": undefined,
          "base": undefined,
          "expected": false,
        },
        {
          "url": "a:b",
          "base": undefined,
          "expected": true,
        },
        {
          "url": undefined,
          "base": "a:b",
          "expected": false,
        },
        {
          "url": "a:/b",
          "base": undefined,
          "expected": true,
        },
        {
          "url": undefined,
          "base": "a:/b",
          "expected": true,
        },
        {
          "url": "https://test:test",
          "base": undefined,
          "expected": false,
        },
        {
          "url": "a",
          "base": "https://b/",
          "expected": true,
        },
      ] as const
    ).forEach(({ url, base, expected }) => {
      it(`URL.canParse(${url}, ${base})`, () => {
        // @ts-expect-error
        expect(URL.canParse(url, base)).toBe(expected);
      });
    });

    it("URL.canParse.length should be 1", () => {
      expect(URL.canParse.length).toBe(1);
    });
  });
});
