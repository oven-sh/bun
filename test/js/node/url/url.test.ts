import { parse } from "url";

describe("Url.prototype.parse", () => {
  describe("strips \\t, \\n, \\r from the authority", () => {
    it.each([
      [
        "http://trusted.com\t.evil.com/x",
        {
          protocol: "http:",
          slashes: true,
          auth: null,
          host: "trusted.com.evil.com",
          port: null,
          hostname: "trusted.com.evil.com",
          hash: null,
          search: null,
          query: null,
          pathname: "/x",
          path: "/x",
          href: "http://trusted.com.evil.com/x",
        },
      ],
      [
        "http://good.example\n.attacker.io/",
        {
          protocol: "http:",
          slashes: true,
          auth: null,
          host: "good.example.attacker.io",
          port: null,
          hostname: "good.example.attacker.io",
          hash: null,
          search: null,
          query: null,
          pathname: "/",
          path: "/",
          href: "http://good.example.attacker.io/",
        },
      ],
      [
        "http://a\t\n\r.b.c/x",
        {
          protocol: "http:",
          slashes: true,
          auth: null,
          host: "a.b.c",
          port: null,
          hostname: "a.b.c",
          hash: null,
          search: null,
          query: null,
          pathname: "/x",
          path: "/x",
          href: "http://a.b.c/x",
        },
      ],
      [
        "http://u\tser:p\rw@h\nost/x",
        {
          protocol: "http:",
          slashes: true,
          auth: "user:pw",
          host: "host",
          port: null,
          hostname: "host",
          hash: null,
          search: null,
          query: null,
          pathname: "/x",
          path: "/x",
          href: "http://user:pw@host/x",
        },
      ],
      [
        "http://a\tb:8\t1/x",
        {
          protocol: "http:",
          slashes: true,
          auth: null,
          host: "ab:81",
          port: "81",
          hostname: "ab",
          hash: null,
          search: null,
          query: null,
          pathname: "/x",
          path: "/x",
          href: "http://ab:81/x",
        },
      ],
      // \t \n \r after the first host-ending char (/, ?, #) are percent-encoded, not stripped
      [
        "http://a\t.b/pa\tth?q\tu#h\ta",
        {
          protocol: "http:",
          slashes: true,
          auth: null,
          host: "a.b",
          port: null,
          hostname: "a.b",
          hash: "#h%09a",
          search: "?q%09u",
          query: "q%09u",
          pathname: "/pa%09th",
          path: "/pa%09th?q%09u",
          href: "http://a.b/pa%09th?q%09u#h%09a",
        },
      ],
      [
        "http://a\n.b/pa\nth?q\nu#h\na",
        {
          protocol: "http:",
          slashes: true,
          auth: null,
          host: "a.b",
          port: null,
          hostname: "a.b",
          hash: "#h%0Aa",
          search: "?q%0Au",
          query: "q%0Au",
          pathname: "/pa%0Ath",
          path: "/pa%0Ath?q%0Au",
          href: "http://a.b/pa%0Ath?q%0Au#h%0Aa",
        },
      ],
      [
        "http://a\r.b/pa\rth?q\ru#h\ra",
        {
          protocol: "http:",
          slashes: true,
          auth: null,
          host: "a.b",
          port: null,
          hostname: "a.b",
          hash: "#h%0Da",
          search: "?q%0Du",
          query: "q%0Du",
          pathname: "/pa%0Dth",
          path: "/pa%0Dth?q%0Du",
          href: "http://a.b/pa%0Dth?q%0Du#h%0Da",
        },
      ],
    ])("%j", (input, expected) => {
      expect(parse(input)).toEqual(expected);
      // url.parse and WHATWG URL must agree on the host
      expect(parse(input).host).toBe(new URL(input).host);
    });
  });

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
