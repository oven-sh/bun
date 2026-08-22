import { parse, urlToHttpOptions } from "url";

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

describe("urlToHttpOptions", () => {
  it("throws ERR_INVALID_ARG_TYPE for non-object arguments", () => {
    // Node.js: validateObject(url, "url", kValidateObjectAllowObjects)
    for (const value of ["http://h/", 42, true, null, undefined, Symbol("s"), 1n]) {
      expect(() => urlToHttpOptions(value as any)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: expect.stringContaining('"url" argument must be of type object'),
        }),
      );
    }
    expect(() => (urlToHttpOptions as any)()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  it("accepts arrays and functions (kValidateObjectAllowObjects)", () => {
    expect(() => urlToHttpOptions([] as any)).not.toThrow();
    expect(() => urlToHttpOptions(function () {} as any)).not.toThrow();
  });

  it("returns a null-prototype object", () => {
    const opts = urlToHttpOptions(new URL("http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test"));
    expect(Object.getPrototypeOf(opts)).toBe(null);
    expect(opts).toEqual({
      protocol: "http:",
      hostname: "foo.bar.com",
      hash: "#test",
      search: "?l=24",
      pathname: "/aaa/zzz",
      path: "/aaa/zzz?l=24",
      href: "http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test",
      port: 21,
      auth: "user:pass",
    });
  });
});

// https://github.com/oven-sh/bun/issues/16705
it("#16705", () => {
  expect(Bun.fileURLToPath("file://C:/firebase-gen-%7B%7B%20firebase.gen%20%7D%7D")).toEqual(
    process.platform === "win32" ? "C:\\firebase-gen-{{ firebase.gen }}" : "/C:/firebase-gen-{{ firebase.gen }}",
  );
});
