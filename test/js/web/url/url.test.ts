import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { resolveObjectURL } from "node:buffer";

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
    // "ftps" is not a special scheme, so its origin is opaque.
    url = new URL("ftps://example.com");
    expect(url.protocol).toBe("ftps:");
    expect(url.origin).toBe("null");
    url = new URL("ftps:/a");
    expect(url.protocol).toBe("ftps:");
    expect(url.origin).toBe("null");
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
    // https://url.spec.whatwg.org/#concept-url-origin: only an inner http(s) URL yields
    // a tuple origin. Everything else, including file (whose own origin is opaque), is "null".
    var url = new URL("blob:https://example.com/1234-5678");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("https://example.com");
    url = new URL("blob:http://example.com/x");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("http://example.com");
    url = new URL("blob:file://text.txt");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:kjka://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:blob://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:ftp://example.com/x");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:ws://example.com");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:wss://example.com/x");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
    url = new URL("blob:file:///folder/else/text.txt");
    expect(url.protocol).toBe("blob:");
    expect(url.origin).toBe("null");
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

  describe("setters", () => {
    // Each case assigns `url[prop] = value` to a URL parsed from `href` and checks the
    // listed getters afterward. Expected values follow the URL Standard's "basic URL
    // parse with a state override" setter steps (https://url.spec.whatwg.org/#api) and
    // agree with https://github.com/web-platform-tests/wpt/blob/master/url/resources/setters_tests.json
    const cases = [
      // The host setter clears the port when the new port equals the scheme's default.
      // https://github.com/oven-sh/bun/issues/28661
      {
        href: "http://example.net:8080",
        prop: "host",
        value: "example.com:80",
        expected: { href: "http://example.com/", host: "example.com", hostname: "example.com", port: "" },
      },
      {
        href: "https://example.net:3000/",
        prop: "host",
        value: "example.com:443",
        expected: { href: "https://example.com/", host: "example.com", port: "" },
      },
      {
        href: "ws://example.net:3000/",
        prop: "host",
        value: "example.com:80",
        expected: { href: "ws://example.com/", host: "example.com", port: "" },
      },
      // An out-of-range port fails the port state, but the host was already committed.
      {
        href: "http://example.net:8080",
        prop: "host",
        value: "newhost:99999",
        expected: { href: "http://newhost:8080/", host: "newhost:8080", hostname: "newhost", port: "8080" },
      },
      // The file host state never splits off a port, and ":" is a forbidden host code point.
      {
        href: "file:///a/b",
        prop: "host",
        value: "h2:x",
        expected: { href: "file:///a/b", host: "", hostname: "", port: "" },
      },
      // Only the empty string clears the port. A value that is entirely ASCII tab/newline
      // is stripped to nothing by the parser, which is a no-op, not a clear.
      {
        href: "http://example.net:123/",
        prop: "port",
        value: "\t\n",
        expected: { href: "http://example.net:123/", port: "123" },
      },
      // The hostname state fails on a ":" outside an IPv6 literal.
      {
        href: "http://example.net/",
        prop: "hostname",
        value: "[::1]:80",
        expected: { href: "http://example.net/", host: "example.net", port: "" },
      },
      {
        href: "http://example.net/path",
        prop: "hostname",
        value: "example.com:8080",
        expected: { href: "http://example.net/path", hostname: "example.net" },
      },
      {
        href: "file:///a/b",
        prop: "hostname",
        value: "h2:x",
        expected: { href: "file:///a/b", hostname: "" },
      },
      // An empty port part leaves the existing port alone.
      {
        href: "http://example.net:8080",
        prop: "host",
        value: "example.com:",
        expected: { href: "http://example.com:8080/", host: "example.com:8080", port: "8080" },
      },
      // A non-numeric port part leaves the existing port alone.
      {
        href: "http://example.net:8080",
        prop: "host",
        value: "example.com:invalid",
        expected: { href: "http://example.com:8080/", host: "example.com:8080", port: "8080" },
      },
      {
        href: "http://example.net",
        prop: "host",
        value: "example.com:8080",
        expected: { href: "http://example.com:8080/", host: "example.com:8080", port: "8080" },
      },
      // 80 is not the default for https, so it stays.
      {
        href: "https://example.net",
        prop: "host",
        value: "example.com:80",
        expected: { href: "https://example.com:80/", host: "example.com:80", port: "80" },
      },
      // A ":" inside an IPv6 literal does not start the port.
      {
        href: "http://example.net:8080/test",
        prop: "host",
        value: "[::1]:invalid",
        expected: { href: "http://[::1]:8080/test", host: "[::1]:8080", port: "8080" },
      },
      {
        href: "http://example.net",
        prop: "host",
        value: "[::0:01]:2",
        expected: { href: "http://[::1]:2/", host: "[::1]:2", port: "2" },
      },
      // A terminator (? / # \) before the ":" ends the host, so the port part is never reached.
      {
        href: "http://example.net/path",
        prop: "host",
        value: "example.com?stuff:8080",
        expected: { href: "http://example.com/path", host: "example.com", port: "" },
      },
      {
        href: "https://test.invalid/",
        prop: "host",
        value: "test/:aaa",
        expected: { href: "https://test/", host: "test" },
      },
      // A "\" after the ":" is a terminator for special schemes, so the port still parses.
      {
        href: "http://example.net/path",
        prop: "host",
        value: "example.com:8080\\stuff",
        expected: { href: "http://example.com:8080/path", host: "example.com:8080", port: "8080" },
      },
      // A ":" with an empty host before it fails the whole assignment.
      {
        href: "foo://path/to",
        prop: "host",
        value: ":80",
        expected: { href: "foo://path/to", host: "path", port: "" },
      },
      {
        href: "file://y/",
        prop: "host",
        value: "x:123",
        expected: { href: "file://y/", host: "y", port: "" },
      },
      {
        href: "file://hi/x",
        prop: "host",
        value: "",
        expected: { href: "file:///x", host: "" },
      },
      {
        href: "file://y/",
        prop: "host",
        value: "loc%41lhost",
        expected: { href: "file:///", host: "" },
      },
      // Special schemes cannot have an empty host.
      {
        href: "http://example.net",
        prop: "host",
        value: "",
        expected: { href: "http://example.net/", host: "example.net" },
      },
      {
        href: "view-source+http://example.net/foo",
        prop: "host",
        value: "",
        expected: { href: "view-source+http:///foo", host: "" },
      },
      {
        href: "sc://test:12/",
        prop: "host",
        value: "",
        expected: { href: "sc://test:12/", host: "test:12" },
      },
      {
        href: "http://example.net:8080",
        prop: "port",
        value: "",
        expected: { href: "http://example.net/", port: "" },
      },
      {
        href: "http://example.net:8080/path",
        prop: "port",
        value: "randomstring",
        expected: { href: "http://example.net:8080/path", port: "8080" },
      },
      {
        href: "http://example.net/path",
        prop: "port",
        value: "8080stuff2",
        expected: { href: "http://example.net:8080/path", port: "8080" },
      },
    ] as const;

    for (const { href, prop, value, expected } of cases) {
      it(`new URL(${JSON.stringify(href)}).${prop} = ${JSON.stringify(value)}`, () => {
        const url = new URL(href);
        (url as any)[prop] = value;
        const actual = Object.fromEntries(Object.keys(expected).map(key => [key, (url as any)[key]]));
        expect(actual).toEqual(expected);
      });
    }
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
