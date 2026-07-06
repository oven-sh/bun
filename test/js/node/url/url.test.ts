import { parse } from "url";

describe("Url.prototype.parse", () => {
  it("parses URL correctly", () => {
    const url = parse("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");

    expect(url.hash).toEqual("#qat");
    expect(url.host).toEqual("baz.qat:8000");
    expect(url.hostname).toEqual("baz.qat");
    expect(url.href).toEqual("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    expect(url.pathname).toEqual("/qux/quux");
    expect(url.port).toEqual("8000");
    expect(url.protocol).toEqual("https:");
    expect(url.search).toEqual("?foo=bar&baz=12");
  });

  it("accepts empty host", () => {
    expect(() => parse("http://")).not.toThrow();
  });

  it("accepts ipv6 host", () => {
    expect(parse("http://[::1]")).toEqual({
      protocol: "http:",
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
      href: "http://[::1]/",
    });
  });

  it("handles punycode", () => {
    expect(parse("http://xn--xample-hva.com")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "xn--xample-hva.com",
      port: null,
      hostname: "xn--xample-hva.com",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://xn--xample-hva.com/",
    });
    expect(parse("http://💥.net")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "xn--hs8h.net",
      port: null,
      hostname: "xn--hs8h.net",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://xn--hs8h.net/",
    });
  });
});

/*
 * url.parse() uses node's legacy host grammar, not the WHATWG host parser: the
 * hostname is IDNA mapped, but never canonicalized or validated as an IP.
 */
describe("Url.prototype.parse host handling", () => {
  function parseError(input: string): Error & { code?: string; input?: string } {
    try {
      parse(input);
    } catch (e) {
      return e as Error & { code?: string };
    }
    throw new Error(`expected url.parse(${JSON.stringify(input)}) to throw`);
  }

  it("does not canonicalize IPv4 or IPv6 hosts", () => {
    const hostnames = [
      "http://0x7f.1/",
      "http://0300.0250.0.01/",
      "http://2130706433/",
      "http://127.1/",
      "http://[::ffff:1.2.3.4]/",
      "http://[0:0:0:0:0:0:0:1]/",
    ].map(input => parse(input).hostname);

    expect(hostnames).toEqual(["0x7f.1", "0300.0250.0.01", "2130706433", "127.1", "::ffff:1.2.3.4", "0:0:0:0:0:0:0:1"]);
  });

  it("accepts hosts the WHATWG host parser rejects", () => {
    const hostnames = ["http://192.168.1.256/", "http://1.2.3.4.5/", "http://0x100000000/"].map(
      input => parse(input).hostname,
    );

    expect(hostnames).toEqual(["192.168.1.256", "1.2.3.4.5", "0x100000000"]);
  });

  it("keeps the unparsed host in host and href", () => {
    expect(parse("http://0x7f.1:8080/p")).toMatchObject({
      host: "0x7f.1:8080",
      hostname: "0x7f.1",
      port: "8080",
      href: "http://0x7f.1:8080/p",
    });
  });

  it("still IDNA maps non-ASCII hosts", () => {
    expect(parse("http://Ünicode.com/").hostname).toBe("xn--nicode-2ya.com");
  });

  // https://github.com/oven-sh/bun/issues/24812
  it("parses a multi-host connection string", () => {
    expect(parse("mongodb://user:password@[fd34:b871:e6a7::1],[fd34:b871:e6a7::2]:27017/db")).toMatchObject({
      protocol: "mongodb:",
      auth: "user:password",
      host: "[fd34:b871:e6a7::1],[fd34:b871:e6a7::2]:27017",
      port: "27017",
      hostname: "fd34:b871:e6a7::1],[fd34:b871:e6a7::2",
      pathname: "/db",
      href: "mongodb://user:password@[fd34:b871:e6a7::1],[fd34:b871:e6a7::2]:27017/db",
    });
  });

  it.each([
    ["http://h:8a/x", "ERR_INVALID_ARG_VALUE"],
    ["https://evil.com:.example.com", "ERR_INVALID_ARG_VALUE"],
    ["git+ssh://git@github.com:npm/npm", "ERR_INVALID_ARG_VALUE"],
    ["http://fail\uFF20fail.com/", "ERR_INVALID_URL"],
    ["http://fail\u2100fail.com/", "ERR_INVALID_URL"],
    ["http://\u00AD/bad.com/", "ERR_INVALID_URL"],
    ["http://[127.0.0.1\0c8763]:8000/", "ERR_INVALID_URL"],
  ])("parsing %j throws %s", (input, code) => {
    const err = parseError(input);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe(code);
  });

  it("reports the whole url as the input of an ERR_INVALID_URL", () => {
    expect(parseError("http://[127.0.0.1\0c8763]:8000/").input).toBe("http://[127.0.0.1\0c8763]:8000/");
  });
});

it("URL constructor throws ERR_MISSING_ARGS", () => {
  var err;
  try {
    // @ts-expect-error
    new URL();
  } catch (e) {
    err = e;
  }

  // @ts-expect-error
  expect(err?.code).toEqual("ERR_MISSING_ARGS");
});

// https://github.com/oven-sh/bun/issues/16705
it("#16705", () => {
  expect(Bun.fileURLToPath("file://C:/firebase-gen-%7B%7B%20firebase.gen%20%7D%7D")).toEqual(
    process.platform === "win32" ? "C:\\firebase-gen-{{ firebase.gen }}" : "/C:/firebase-gen-{{ firebase.gen }}",
  );
});
