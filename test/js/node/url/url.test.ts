import { format, parse, resolve } from "url";

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

// ws: and wss: are slashed protocols in node, so they always carry an authority.
describe.each(["ws", "wss"])("%s: is a slashed protocol", protocol => {
  it("does not invent a host for an authority-less URL", () => {
    expect(parse(`${protocol}:host/p`)).toEqual({
      protocol: `${protocol}:`,
      slashes: null,
      auth: null,
      host: null,
      port: null,
      hostname: null,
      hash: null,
      search: null,
      query: null,
      pathname: "host/p",
      path: "host/p",
      href: `${protocol}:host/p`,
    });
  });

  it("defaults the pathname to / when there is a host", () => {
    expect(parse(`${protocol}://h`)).toEqual({
      protocol: `${protocol}:`,
      slashes: true,
      auth: null,
      host: "h",
      port: null,
      hostname: "h",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: `${protocol}://h/`,
    });
  });

  it("formats with // even when slashes is absent", () => {
    expect(format({ protocol, host: "h", pathname: "/p" })).toBe(`${protocol}://h/p`);
    expect(format({ protocol: `${protocol}:`, host: "h", pathname: "/p" })).toBe(`${protocol}://h/p`);
    expect(format({ protocol, hostname: "h", port: 8080, pathname: "/p" })).toBe(`${protocol}://h:8080/p`);
  });

  it("resolve keeps the host instead of taking it from the relative path", () => {
    expect(resolve(`${protocol}://h/a/b`, "../../x")).toBe(`${protocol}://h/x`);
    expect(resolve(`${protocol}://h/a/b`, "../../../../x")).toBe(`${protocol}://h/x`);
    expect(resolve(`${protocol}://127.0.0.1/`, "../x")).toBe(`${protocol}://127.0.0.1/x`);
    expect(resolve(`${protocol}://h/a/b`, "/c")).toBe(`${protocol}://h/c`);
    expect(resolve(`${protocol}://h/a/b`, "c")).toBe(`${protocol}://h/a/c`);
    expect(resolve(`${protocol}://h/a/b`, "")).toBe(`${protocol}://h/a/b`);
  });

  it("resolve still honors an explicit authority in the relative reference", () => {
    expect(resolve(`${protocol}://h/a/b`, "//other/c")).toBe(`${protocol}://other/c`);
    expect(resolve(`http://h/a`, `${protocol}://other/b`)).toBe(`${protocol}://other/b`);
    expect(resolve(`${protocol}://h/a`, "http://other/b")).toBe("http://other/b");
  });
});

it("mailto: keeps crawling up into the host (not a slashed protocol)", () => {
  expect(resolve("mailto://h/a/b", "../../x")).toBe("mailto://x");
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
