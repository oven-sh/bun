import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { resolveObjectURL } from "node:buffer";
import util from "node:util";

describe("url", () => {
  it("URL throws", () => {
    // Node-compatible message: exactly "Invalid URL".
    expect(() => new URL("")).toThrow("Invalid URL");
    expect(() => new URL(" ")).toThrow("Invalid URL");
    expect(() => new URL("boop", "http!/example.com")).toThrow("Invalid URL");
    expect(() => new URL("boop", "http!/example.com")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_URL",
      }),
    );
    expect(() => new URL("boop", "https!!username:password@example.com")).toThrow("Invalid URL");
  });

  it("ERR_INVALID_URL carries input and, when given, base", () => {
    try {
      new URL("//[", "http://x");
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe("ERR_INVALID_URL");
      expect(e.input).toBe("//[");
      expect(e.base).toBe("http://x");
    }
    // base itself invalid: both still surface, base is the raw string.
    try {
      new URL("boop", "http!/example.com");
      expect.unreachable();
    } catch (e: any) {
      expect(e.input).toBe("boop");
      expect(e.base).toBe("http!/example.com");
    }
    // One-arg form: .base must be absent, not undefined-valued.
    try {
      new URL("::");
      expect.unreachable();
    } catch (e: any) {
      expect(e.input).toBe("::");
      expect("base" in e).toBe(false);
    }
    // href setter has no base argument, so no .base either.
    const u = new URL("http://x");
    try {
      u.href = "::";
      expect.unreachable();
    } catch (e: any) {
      expect(e.input).toBe("::");
      expect("base" in e).toBe(false);
    }
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
  it("leaves opaque (non-special-scheme) hosts unchanged", () => {
    expect(new URL("foo://\u1E9E.com/").href).toBe("foo://%E1%BA%9E.com/");
    expect(new URL("foo://a\u180Eb/").href).toBe("foo://a%E1%A0%8Eb/");
    const u = new URL("foo://x/");
    u.hostname = "\u1E9E";
    expect(u.hostname).toBe("%E1%BA%9E");
    expect(() => new URL("http://[::\u180E1]/")).toThrow();
    expect(() => new URL("http://foo:8\u180E0/")).toThrow();
    const h1 = new URL("http://x/");
    h1.host = "foo:8\u206A0";
    expect(h1.port).toBe("8");
  });

  // Unicode 16 changed these code points' UTS #46 status; ICU 76 is the first release with that table.
  it.skipIf(parseInt(process.versions.icu) < 76)("special-scheme hosts use the Unicode 16 IDNA table", () => {
    expect(new URL("http://\u1E9E.com/").href).toBe("http://xn--zca.com/");
    expect(new URL("file://\u1E9E/x").host).toBe("xn--zca");
    expect(new URL("http://foo\u180E:80/").href).toBe("http://foo/");
    const h = new URL("http://x/");
    h.host = "foo\u1E9E:81";
    expect(h.host).toBe("xn--foo-7ka:81");
    const hn = new URL("http://x/");
    hn.hostname = "\u04C0.com";
    expect(hn.hostname).toBe("xn--s5a.com");
  });

  // https://github.com/whatwg/url/pull/914: an ASCII domain is the result of the domain parser, lowercased, even when
  // an xn-- label fails Unicode ToASCII. Expected values are from Node v26.10.0 (ada 4.0.0).
  it("accepts an ASCII host whose xn-- label fails ToASCII, however the input spells it", () => {
    for (const [input, href] of [
      ["https://xn--a.com/", "https://xn--a.com/"],
      ["https://XN--a.com/", "https://xn--a.com/"],
      ["https://x%6E--a.com/", "https://xn--a.com/"],
      ["https://x\tn--a.com/", "https://xn--a.com/"],
      ["https://xn-\n-a/", "https://xn--a/"],
      ["https://xn-\r-a/", "https://xn--a/"],
      ["  https://xn--a/", "https://xn--a/"],
      ["https:xn--a/", "https://xn--a/"],
      ["https:\\\\u:p@xn--a\\p", "https://u:p@xn--a/p"],
      ["file://xn--a/p", "file://xn--a/p"],
      ["ws://xn--a/", "ws://xn--a/"],
      ["https://xn--8i7caa.famitei.net/sekou/all", "https://xn--8i7caa.famitei.net/sekou/all"],
    ]) {
      expect([input, new URL(input).href, URL.canParse(input), URL.parse(input)?.href]).toEqual([
        input,
        href,
        true,
        href,
      ]);
    }
    for (const [input, base, href] of [
      ["/p", "https://x%6E--a.com/", "https://xn--a.com/p"],
      ["//xn--a/p", "https://example.com/", "https://xn--a/p"],
      ["rel", "https://xn--a.example/", "https://xn--a.example/rel"],
      // A relative path never supplies a host.
      ["xn--a", "https://example.com/", "https://example.com/xn--a"],
    ]) {
      expect([input, new URL(input, base).href, URL.canParse(input, base), URL.parse(input, base)?.href]).toEqual([
        input,
        href,
        true,
        href,
      ]);
    }
    expect(new URL("https://xn--ls8h.com/?q=%E3%81#xn--a").href).toBe("https://xn--ls8h.com/?q=%E3%81#xn--a");
    expect(new URL("https://\u{1F4A9}.com/p%20q?xn--a").hostname).toBe("xn--ls8h.com");
    expect(new URL("https://\u{1F4A9}.com/xn--a/%41").pathname).toBe("/xn--a/%41");
  });

  it("still rejects a non-ASCII host with a bad xn-- label, forbidden code points and bad IPv4 endings", () => {
    for (const input of [
      "https://\u00e9.xn--a.com/", // Unicode ToASCII runs for a non-ASCII domain, and it fails
      "https://\u00e9.x%6E--a.com/",
      "https://%C3%A9.xn--a.com/",
      "https://\u00e9.xn--1ug.com/",
      "https://xn--a.1/", // ends in a number, so it must be an IPv4 address
      "https://xn--a b/",
      "https://xn--a%00/",
      "https://xn--a^b/",
    ]) {
      expect(() => new URL(input)).toThrow(TypeError);
      expect([input, URL.canParse(input), URL.parse(input)]).toEqual([input, false, null]);
    }
    for (const [input, base] of [
      ["rel", "https://\u00e9.xn--a.example/"],
      ["//\u00e9.xn--a/p", "https://example.com/"],
    ]) {
      expect(() => new URL(input, base)).toThrow(TypeError);
      expect([input, URL.canParse(input, base), URL.parse(input, base)]).toEqual([input, false, null]);
    }
    expect(new URL("https://\u00e9.xn--ls8h.com/").href).toBe("https://xn--9ca.xn--ls8h.com/");
    // A non-special scheme has an opaque host: no IDNA at all.
    expect(new URL("foo://\u00e9.xn--a/").href).toBe("foo://%C3%A9.xn--a/");
  });

  it("the host, hostname and href setters accept the same ASCII hosts as the constructor", () => {
    // [value, href after hostname=, after host=, after href = "https://" + value + "/q" (null: it throws)]
    for (const [value, viaHostname, viaHost, viaHref] of [
      ["xn--a.com", "https://xn--a.com:444/p", "https://xn--a.com:444/p", "https://xn--a.com/q"],
      ["XN--A.com", "https://xn--a.com:444/p", "https://xn--a.com:444/p", "https://xn--a.com/q"],
      ["xn--1ug.com", "https://xn--1ug.com:444/p", "https://xn--1ug.com:444/p", "https://xn--1ug.com/q"],
      ["x%6E--a.com", "https://xn--a.com:444/p", "https://xn--a.com:444/p", "https://xn--a.com/q"],
      ["xn--a.com:8080", "https://example.com:444/p", "https://xn--a.com:8080/p", "https://xn--a.com:8080/q"],
      [
        "\u00e9.xn--ls8h.com",
        "https://xn--9ca.xn--ls8h.com:444/p",
        "https://xn--9ca.xn--ls8h.com:444/p",
        "https://xn--9ca.xn--ls8h.com/q",
      ],
      ["\u00e9.xn--a.com", "https://example.com:444/p", "https://example.com:444/p", null],
      ["xn--a b", "https://example.com:444/p", "https://example.com:444/p", null],
    ] as const) {
      const viaHostnameURL = new URL("https://example.com:444/p");
      viaHostnameURL.hostname = value;
      const viaHostURL = new URL("https://example.com:444/p");
      viaHostURL.host = value;
      const viaHrefURL = new URL("https://example.com:444/p");
      let hrefResult: string | null = null;
      try {
        viaHrefURL.href = "https://" + value + "/q";
        hrefResult = viaHrefURL.href;
      } catch (e: any) {
        expect(e.code).toBe("ERR_INVALID_URL");
      }
      expect([value, viaHostnameURL.href, viaHostURL.href, hrefResult]).toEqual([value, viaHostname, viaHost, viaHref]);
    }
  });

  it("Request, Response.redirect, blob: origins, fetch and WebSocket take the same hosts as new URL", async () => {
    expect([
      URL.canParse("https://xn--a.com/p"),
      new Request("https://XN--a.com/p").url,
      Response.redirect("https://xn--a.com/r").headers.get("location"),
      new URL("blob:https://xn--a.com/x").origin,
    ]).toEqual([true, "https://xn--a.com/p", "https://xn--a.com/r", "https://xn--a.com"]);
    expect(() => new Request("https://\u00e9.xn--a.com/")).toThrow(TypeError);
    expect(new URL("blob:https://\u00e9.xn--a.com/x").origin).toBe("null");

    // A proxy keeps the test off the network. Its request lines show that fetch and WebSocket took the host.
    const requestLines: string[] = [];
    const { promise: sawBoth, resolve } = Promise.withResolvers<void>();
    using proxy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, chunk) {
          requestLines.push(chunk.toString().split("\r\n")[0]);
          socket.end();
          if (requestLines.length === 2) resolve();
        },
      },
    });
    const proxyURL = `http://127.0.0.1:${proxy.port}`;
    await fetch("http://xn--a.com/x", { proxy: proxyURL }).catch(() => {});
    const ws = new WebSocket("ws://xn--a.com/", { proxy: proxyURL } as any);
    ws.onerror = () => {};
    await sawBoth;
    ws.close();
    expect(requestLines.sort()).toEqual(["CONNECT xn--a.com:80 HTTP/1.1", "GET http://xn--a.com/x HTTP/1.1"]);
  });

  it("parses literal punycode labels like Node", () => {
    // [input, href (null: it does not parse)]. Expected values are from Node v26.10.0.
    const cases: [string, string | null][] = [
      ["https://xn--ls8h.com/", "https://xn--ls8h.com/"], // valid emoji label
      ["https://XN--LS8H.com/", "https://xn--ls8h.com/"], // case-insensitive prefix and digits
      ["https://foo.xn--nxasmq6b/", "https://foo.xn--nxasmq6b/"], // Greek
      ["https://xn--mgbh0fb.xn--kgbechtv/", "https://xn--mgbh0fb.xn--kgbechtv/"], // RTL labels
      ["https://ab--cd.com/", "https://ab--cd.com/"], // hyphens at 3-4 in a non-ACE label
      ["https://xn--53h.example/", "https://xn--53h.example/"], // single non-ASCII code point
      // These labels fail Unicode ToASCII. The host is ASCII, so it passes through.
      ["https://xn--a.com/", "https://xn--a.com/"], // decodes to U+0080 (disallowed)
      ["https://xn--/", "https://xn--/"], // empty ACE label
      ["https://xn---.com/", "https://xn---.com/"], // fails Punycode decoding
      ["https://xn--ascii-.com/", "https://xn--ascii-.com/"], // alternate encoding of an ASCII label
      ["https://xn--1ug.com/", "https://xn--1ug.com/"], // ZWJ alone (CONTEXTJ)
      ["https://xn--u-ccb.com/", "https://xn--u-ccb.com/"], // leading combining mark
      ["https://xn--0.com/", "https://xn--0.com/"], // truncated delta
      ["https://xn--9999999999999999999999999b/", "https://xn--9999999999999999999999999b/"], // overflow
      ["https://xn--a-b.com/", "https://xn--a-b.com/"], // disallowed after decoding
      ["https://xn--xn--zca-hia.com/", "https://xn--xn--zca-hia.com/"], // decodes to "xn--zca£"
      // The same labels beside a non-ASCII label: Unicode ToASCII runs and fails.
      ["https://\u00e9.xn--a.com/", null],
      ["https://\u00e9.xn--/", null],
      ["https://\u00e9.xn--1ug.com/", null],
      ["https://\u00e9.xn--ls8h.com/", "https://xn--9ca.xn--ls8h.com/"],
    ];
    // ICU fails this label from 76 on (Unicode 15.1). macOS 14 has an older system ICU.
    if (parseInt(process.versions.icu) >= 76) cases.push(["https://\u00e9.xn--xn--zca-hia.com/", null]);
    for (const [input, href] of cases) {
      expect([input, URL.canParse(input), URL.parse(input)?.href ?? null]).toEqual([input, href !== null, href]);
      if (href !== null) expect(new URL(input).href).toBe(href);
      else expect(() => new URL(input)).toThrow(TypeError);
    }
  });

  it("resolves against repeated, alternating and invalid string bases consistently", () => {
    // The last successfully parsed base string is cached; make sure hits, misses and failures all behave.
    const a = "https://a.example/dir/page";
    const b = "http://b.example:8080/x/y/";
    for (let i = 0; i < 3; i++) {
      expect(new URL("rel", a).href).toBe("https://a.example/dir/rel");
      expect(new URL("rel", a).href).toBe("https://a.example/dir/rel");
      expect(new URL("../up", b).href).toBe("http://b.example:8080/x/up");
      expect(URL.canParse("?q", a)).toBe(true);
      expect(URL.parse("#f", b)!.href).toBe("http://b.example:8080/x/y/#f");
      expect(() => new URL("rel", "not a url")).toThrow(TypeError);
      expect(() => new URL("rel", "not a url")).toThrow(TypeError);
      expect(URL.canParse("rel", "https://\u00e9.xn--a.example/")).toBe(false);
      expect(URL.canParse("rel", "https://xn--a.example/")).toBe(true);
      expect(URL.parse("rel", "")).toBe(null);
      expect(new URL("rel", a + "\u00e9/").href).toBe("https://a.example/dir/page%C3%A9/rel");
      expect(new URL("rel", "HTTPS://A.example/dir/page").href).toBe("https://a.example/dir/rel");
    }
    try {
      new URL("http://[bad", a);
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe("ERR_INVALID_URL");
      expect(e.input).toBe("http://[bad");
      expect(e.base).toBe(a);
    }
  });

  it("href, toString and toJSON agree before and after mutation", () => {
    const s = "https://example.com/a?b#c";
    const u = new URL(s);
    expect(u.href).toBe(s);
    Bun.gc(true);
    expect(u.toString()).toBe(s);
    expect(u.toJSON()).toBe(s);
    Bun.gc(true);
    expect(`${u}`).toBe(s);
    u.pathname = "/z";
    Bun.gc(true);
    expect(u.href).toBe("https://example.com/z?b#c");
    expect(u.toString()).toBe(u.href);
    u.searchParams.append("d", "1");
    expect(u.toJSON()).toBe("https://example.com/z?b=&d=1#c");
    u.href = "http://other/";
    expect([u.href, String(u), JSON.stringify(u)]).toEqual(["http://other/", "http://other/", '"http://other/"']);
    const v = new URL("HTTP://Example.COM");
    expect(v.href).toBe("http://example.com/");
  });

  it("prints", () => {
    // URL.prototype carries [Symbol.for("nodejs.util.inspect.custom")], so
    // Bun.inspect matches node's util.inspect output.
    expect(Bun.inspect(new URL("https://example.com"))).toBe(`URL {
  href: 'https://example.com/',
  origin: 'https://example.com',
  protocol: 'https:',
  username: '',
  password: '',
  host: 'example.com',
  hostname: 'example.com',
  port: '',
  pathname: '/',
  search: '',
  searchParams: URLSearchParams {},
  hash: ''
}`);

    expect(
      Bun.inspect(
        new URL("https://github.com/oven-sh/bun/issues/135?hello%20i%20have%20spaces%20thank%20you%20good%20night"),
      ),
    ).toBe(`URL {
  href: 'https://github.com/oven-sh/bun/issues/135?hello%20i%20have%20spaces%20thank%20you%20good%20night',
  origin: 'https://github.com',
  protocol: 'https:',
  username: '',
  password: '',
  host: 'github.com',
  hostname: 'github.com',
  port: '',
  pathname: '/oven-sh/bun/issues/135',
  search: '?hello%20i%20have%20spaces%20thank%20you%20good%20night',
  searchParams: URLSearchParams { 'hello i have spaces thank you good night' => '' },
  hash: ''
}`);
  });

  it("URLContext offsets account for the /. pathname guard", () => {
    // URL Standard section 4.5 step 3: null host + empty first path segment
    // serializes with a /. guard the pathname getter omits, so offsets from
    // pathname_start on are shifted by 2 in the href.
    expect(util.inspect(new URL("foo:/.//?x"), { showHidden: true })).toBe(`URL {
  href: 'foo:/.//?x',
  origin: 'null',
  protocol: 'foo:',
  username: '',
  password: '',
  host: '',
  hostname: '',
  port: '',
  pathname: '//',
  search: '?x',
  searchParams: URLSearchParams { 'x' => '' },
  hash: '',
  Symbol(context): URLContext {
    href: 'foo:/.//?x',
    protocol_end: 4,
    username_end: 4,
    host_start: 4,
    host_end: 4,
    pathname_start: 6,
    search_start: 8,
    hash_start: 4294967295,
    port: 4294967295,
    scheme_type: 1,
    [hasPort]: [Getter],
    [hasSearch]: [Getter],
    [hasHash]: [Getter]
  }
}`);
    // A path whose first segment merely starts with "." gets no guard.
    expect(util.inspect(new URL("foo:/.foo"), { showHidden: true })).toContain("pathname_start: 4,");
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

  // Web IDL record conversion interleaves Get with value conversion: mutations made by a
  // value's toString() are observed by the keys that follow it. Node agrees.
  it("URLSearchParams constructed from an object interleaves Get with value conversion", () => {
    const record: any = {
      first: {
        toString() {
          record.second = "replaced";
          delete record.third;
          return "1";
        },
      },
      second: "2",
      third: "3",
    };
    const params = new URLSearchParams(record);
    expect(params.get("first")).toBe("1");
    expect(params.get("second")).toBe("replaced");
    expect(params.get("third")).toBeNull();
  });
});

describe("url.searchParams lazy href sync", () => {
  // The URLSearchParams update steps are applied lazily to the associated
  // URL's serialized string: each getter below must observe the change without
  // any intermediate href read having forced a sync.
  it("reflects mutations in every URL getter and across component setters", () => {
    const u = new URL("http://user:pw@host:81/path?initial=1#frag");
    const sp = u.searchParams;

    sp.append("a", "1");
    sp.append("b", "2");
    sp.set("initial", "x");
    expect({
      href: u.href,
      search: u.search,
      toString: u.toString(),
      toJSON: u.toJSON(),
      hash: u.hash,
      pathname: u.pathname,
      protocol: u.protocol,
      origin: u.origin,
      username: u.username,
      password: u.password,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      spSize: sp.size,
      spString: sp.toString(),
      inspect: Bun.inspect(u).includes("initial=x&a=1&b=2"),
    }).toEqual({
      href: "http://user:pw@host:81/path?initial=x&a=1&b=2#frag",
      search: "?initial=x&a=1&b=2",
      toString: "http://user:pw@host:81/path?initial=x&a=1&b=2#frag",
      toJSON: "http://user:pw@host:81/path?initial=x&a=1&b=2#frag",
      hash: "#frag",
      pathname: "/path",
      protocol: "http:",
      origin: "http://host:81",
      username: "user",
      password: "pw",
      host: "host:81",
      hostname: "host",
      port: "81",
      spSize: 3,
      spString: "initial=x&a=1&b=2",
      inspect: true,
    });

    // Setting an unrelated component while a searchParams mutation is pending
    // must keep the pending query.
    sp.append("c", "3");
    u.pathname = "/p2";
    expect({ href: u.href, get: sp.get("c") }).toEqual({
      href: "http://user:pw@host:81/p2?initial=x&a=1&b=2&c=3#frag",
      get: "3",
    });

    sp.set("d", "4");
    u.hash = "#h2";
    expect(u.href).toBe("http://user:pw@host:81/p2?initial=x&a=1&b=2&c=3&d=4#h2");

    // Setting search directly discards any pending searchParams mutation
    // (the new search wins) and rebuilds searchParams from it.
    sp.append("dropped", "y");
    u.search = "?only=1";
    expect({ href: u.href, entries: [...sp] }).toEqual({
      href: "http://user:pw@host:81/p2?only=1#h2",
      entries: [["only", "1"]],
    });

    // Setting href discards any pending searchParams mutation and rebuilds
    // searchParams from the new href.
    sp.append("dropped", "z");
    u.href = "https://other/?n=v";
    expect({ href: u.href, entries: [...sp] }).toEqual({
      href: "https://other/?n=v",
      entries: [["n", "v"]],
    });

    // Deleting all params removes the '?' entirely.
    sp.delete("n");
    expect({ href: u.href, search: u.search, size: sp.size }).toEqual({
      href: "https://other/",
      search: "",
      size: 0,
    });

    // sort() is also a mutation; href must reflect the sorted order.
    sp.append("z", "1");
    sp.append("a", "2");
    sp.sort();
    expect(u.search).toBe("?a=2&z=1");
  });

  // N appends through a URL-bound URLSearchParams used to re-serialize and
  // re-parse the full href on every mutation, so 10000 appends ran for tens of
  // seconds. With the sync deferred to the next href/search read, this is O(N)
  // and finishes near-instantly; the spawn timeout is the discriminator.
  test("N appends through url.searchParams are O(N), not O(N^2)", async () => {
    const fixture = `
      const N = 10000;
      const u = new URL("http://h/");
      for (let i = 0; i < N; i++) u.searchParams.append("k" + i, "v" + i);
      const href = u.href;
      if (u.searchParams.size !== N) throw new Error("size=" + u.searchParams.size);
      if (!href.startsWith("http://h/?k0=v0&")) throw new Error("href=" + href.slice(0, 40));
      if (!href.endsWith("&k9999=v9999")) throw new Error("hrefEnd=" + href.slice(-20));
      console.log("done");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
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
  }, 60_000);
});

describe("object URL prefix check", () => {
  // The "blob:" prefix check dispatches on encoding and only reads
  // prefix.len() code units; these inputs must not be transcoded first.
  it("revokeObjectURL / resolveObjectURL handle non-blob inputs across encodings", () => {
    const latin1 = "\u00e9not-a-blob";
    const utf16 = "\u{1f600}not-a-blob";
    const blobish = "blob:" + "\u{1f600}";
    const real = URL.createObjectURL(new Blob(["hi"]));
    expect({
      revokeLatin1: URL.revokeObjectURL(latin1),
      revokeUtf16: URL.revokeObjectURL(utf16),
      revokeBlobish: URL.revokeObjectURL(blobish),
      resolveLatin1: resolveObjectURL(latin1),
      resolveUtf16: resolveObjectURL(utf16),
      resolveBlobish: resolveObjectURL(blobish),
      resolveUtf16Real: resolveObjectURL(real + "\u{1f600}"),
      resolveReal: resolveObjectURL(real) instanceof Blob,
    }).toEqual({
      revokeLatin1: undefined,
      revokeUtf16: undefined,
      revokeBlobish: undefined,
      resolveLatin1: undefined,
      resolveUtf16: undefined,
      resolveBlobish: undefined,
      resolveUtf16Real: undefined,
      resolveReal: true,
    });
    URL.revokeObjectURL(real);
    expect(resolveObjectURL(real)).toBeUndefined();
  });

  // `is_string()` admits `StringObject`, so `to_bun_string` can hit a user
  // `toString` that throws; that must surface as a catchable JS exception.
  test("revokeObjectURL propagates a throwing toString on a String object", async () => {
    const fixture = `
      const s = new String("blob:x");
      s.toString = () => { throw new Error("boom"); };
      s[Symbol.toPrimitive] = () => { throw new Error("boom"); };
      try { URL.revokeObjectURL(s); } catch (e) { console.log("caught", e.message); }
      console.log("survived");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "caught boom\nsurvived\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // bun_core::String::{has_prefix_comptime, eql_comptime} used to scan or
  // transcode the entire string before comparing a short ASCII literal. With
  // an O(literal) check this workload is effectively free; with an O(n) check
  // it allocates and transcodes tens of GB and cannot finish inside the spawn
  // timeout. Covers both encoding arms (UTF-16 and 8-bit Latin-1) and both
  // helpers (has_prefix_comptime via revoke/resolveObjectURL, eql_comptime via
  // fetch's protocol option).
  test("ASCII prefix/equality checks on huge strings are O(k), not O(n)", async () => {
    const fixture = `
      const { resolveObjectURL } = require("node:buffer");
      const n = 16 * 1024 * 1024;
      const huge16 = Buffer.alloc(n * 2, "\\u0100", "utf16le").toString("utf16le");
      const huge8 = Buffer.alloc(n, 0xe9).toString("latin1");
      if (huge16.length !== n || huge16.charCodeAt(0) !== 0x100) throw new Error("setup");
      if (huge8.length !== n || huge8.charCodeAt(0) !== 0xe9) throw new Error("setup");
      for (const huge of [huge16, huge8]) {
        for (let i = 0; i < 2000; i++) {
          URL.revokeObjectURL(huge);
          resolveObjectURL(huge);
          try { fetch("http://x", { protocol: huge }).catch(() => {}); } catch {}
        }
      }
      console.log("done");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 60_000);
});
