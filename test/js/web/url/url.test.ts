import { jscDescribe } from "bun:jsc";
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
  it.skipIf(parseInt(process.versions.icu!) < 76)("special-scheme hosts use the Unicode 16 IDNA table", () => {
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

  it("rejects invalid punycode labels however they are spelled in the input (like Node)", () => {
    for (const input of [
      "https://xn--a.com/",
      "https://XN--a.com/",
      "https://x%6E--a.com/",
      "https://x\tn--a.com/",
      "https://xn-\n-a/",
      "https://xn-\r-a/",
      "  https://xn--a/",
      "https:xn--a/",
      "https:\\\\u:p@xn--a\\p",
    ]) {
      expect(() => new URL(input)).toThrow(TypeError);
      expect(URL.canParse(input)).toBe(false);
      expect(URL.parse(input)).toBe(null);
    }
    for (const [input, base] of [
      ["/p", "https://x%6E--a.com/"],
      ["//xn--a/p", "https://example.com/"],
      ["xn--a", "https://example.com/"],
    ]) {
      if (input === "xn--a") {
        // A relative path never supplies a host.
        expect(new URL(input, base).href).toBe("https://example.com/xn--a");
        continue;
      }
      expect(() => new URL(input, base)).toThrow(TypeError);
      expect(URL.canParse(input, base)).toBe(false);
      expect(URL.parse(input, base)).toBe(null);
    }
    expect(new URL("https://xn--ls8h.com/?q=%E3%81#xn--a").href).toBe("https://xn--ls8h.com/?q=%E3%81#xn--a");
    expect(new URL("https://\u{1F4A9}.com/p%20q?xn--a").hostname).toBe("xn--ls8h.com");
    expect(new URL("https://\u{1F4A9}.com/xn--a/%41").pathname).toBe("/xn--a/%41");
  });

  it("judges literal punycode labels like Node (fast path and ICU path)", () => {
    // [input, canParse] — expectations match Node 26 / ICU UTS #46 (CheckBidi, CheckJoiners, non-transitional).
    const cases: [string, boolean][] = [
      ["https://xn--ls8h.com/", true], // valid emoji label
      ["https://XN--LS8H.com/", true], // case-insensitive prefix and digits
      ["https://foo.xn--nxasmq6b/", true], // Greek
      ["https://xn--mgbh0fb.xn--kgbechtv/", true], // RTL labels (BiDi rule, ICU path)
      ["https://ab--cd.com/", true], // hyphens at 3-4 in a non-ACE label are allowed
      ["https://xn--53h.example/", true], // single non-ASCII code point
      ["https://xn--a.com/", false], // decodes to U+0080 (disallowed)
      ["https://xn--/", false], // empty ACE label
      ["https://xn---.com/", false], // fails Punycode decoding
      ["https://xn--ascii-.com/", false], // alternate encoding of an ASCII label
      ["https://xn--1ug.com/", false], // ZWJ alone (CONTEXTJ)
      ["https://xn--u-ccb.com/", false], // leading combining mark
      ["https://xn--0.com/", false], // truncated delta
      ["https://xn--9999999999999999999999999b/", false], // overflow
      ["https://xn--a-b.com/", false], // "a" + U+0080-ish: disallowed after decoding
    ];
    for (const [input, ok] of cases) {
      expect([input, URL.canParse(input)]).toEqual([input, ok]);
      expect([input, URL.parse(input)?.href ?? null]).toEqual([input, ok ? input.toLowerCase() : null]);
      if (ok) expect(new URL(input).href).toBe(input.toLowerCase());
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
      expect(URL.canParse("rel", "https://xn--a.example/")).toBe(false);
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

  // URL Standard, path start state: when "?" or "#" follows the host, only a special URL gets the path "/".
  // Every expected value is also what Node.js gives.
  describe("a non-special URL with credentials keeps an empty path before a query or fragment", () => {
    type Row = [input: string, href: string, user: string, pass: string, host: string, path: string, ...rest: string[]];
    const parts = (u: URL) => [u.href, u.username, u.password, u.host, u.pathname, u.search, u.hash];
    // The same text as a UTF-16 string. The parser has separate code for each string width.
    const wide = (text: string) => {
      const utf16 = new TextDecoder("utf-16le").decode(Buffer.from(text, "utf16le"));
      expect(jscDescribe(utf16)).toContain("8Bit:(0)");
      return utf16;
    };
    // Each row whose input is a Latin-1 string runs again as a UTF-16 string.
    const inBothWidths = (rows: Row[]) =>
      rows.flatMap(row => (/^[\x00-\xff]*$/.test(row[0]) ? [row, [wide(row[0]), ...row.slice(1)] as Row] : [row]));

    it("in the constructor and URL.parse", () => {
      const rows = inBothWidths([
        // a plain host
        ["zz://u@h?q", "zz://u@h?q", "u", "", "h", "", "?q", ""],
        ["zz://u@h#f", "zz://u@h#f", "u", "", "h", "", "", "#f"],
        ["zz://u:p@h?q#f", "zz://u:p@h?q#f", "u", "p", "h", "", "?q", "#f"],
        ["zz://u@h?", "zz://u@h?", "u", "", "h", "", "", ""],
        ["zz://u@h#", "zz://u@h#", "u", "", "h", "", "", ""],
        // a port, an IPv6 address, a percent sign or a non-ASCII character in the host
        ["zz://u:p@h:8?q", "zz://u:p@h:8?q", "u", "p", "h:8", "", "?q", ""],
        ["zz://u:p@h:8#f", "zz://u:p@h:8#f", "u", "p", "h:8", "", "", "#f"],
        ["zz://u@h:?q", "zz://u@h?q", "u", "", "h", "", "?q", ""],
        ["zz://u@[::1]?q", "zz://u@[::1]?q", "u", "", "[::1]", "", "?q", ""],
        ["zz://u@[::1]:8?q#f", "zz://u@[::1]:8?q#f", "u", "", "[::1]:8", "", "?q", "#f"],
        ["zz://u@h%41#f", "zz://u@h%41#f", "u", "", "h%41", "", "", "#f"],
        ["zz://u@h\u00e9?q", "zz://u@h%C3%A9?q", "u", "", "h%C3%A9", "", "?q", ""],
        // characters outside Latin-1
        ["zz://u@h?q\u4e2d", "zz://u@h?q%E4%B8%AD", "u", "", "h", "", "?q%E4%B8%AD", ""],
        ["zz://u@h#\u4e2d", "zz://u@h#%E4%B8%AD", "u", "", "h", "", "", "#%E4%B8%AD"],
        ["zz://u:p@h:8?q\u4e2d", "zz://u:p@h:8?q%E4%B8%AD", "u", "p", "h:8", "", "?q%E4%B8%AD", ""],
        ["zz://\u4e2d@h?q", "zz://%E4%B8%AD@h?q", "%E4%B8%AD", "", "h", "", "?q", ""],
        ["zz://u@\u4e2d#f", "zz://u@%E4%B8%AD#f", "u", "", "%E4%B8%AD", "", "", "#f"],
        // credentials that are empty after parsing
        ["zz://@h?q", "zz://h?q", "", "", "h", "", "?q", ""],
        ["zz://:@h#f", "zz://h#f", "", "", "h", "", "", "#f"],
        ["zz://u@@h?q", "zz://u%40@h?q", "u%40", "", "h", "", "?q", ""],
        // tab, newline and surrounding spaces are removed first
        ["zz://u@h\t?q", "zz://u@h?q", "u", "", "h", "", "?q", ""],
        ["zz://u@\nh#f", "zz://u@h#f", "u", "", "h", "", "", "#f"],
        [" zz://u@h?q ", "zz://u@h?q", "u", "", "h", "", "?q", ""],
        // other schemes
        ["postgres://u:p@h:5432?ssl=1", "postgres://u:p@h:5432?ssl=1", "u", "p", "h:5432", "", "?ssl=1", ""],
        ["redis://:p@h:6379?db=1", "redis://:p@h:6379?db=1", "", "p", "h:6379", "", "?db=1", ""],
        ["ssh://git@github.com#frag", "ssh://git@github.com#frag", "git", "", "github.com", "", "", "#frag"],
      ]);
      expect(rows.map(([input]) => [input, ...parts(new URL(input))])).toEqual(rows);
      expect(rows.map(([input]) => [input, ...parts(URL.parse(input)!)])).toEqual(rows);
      // The serialization parses to itself.
      expect(rows.map(([, href]) => new URL(href).href)).toEqual(rows.map(([, href]) => href));
    });

    it("against a base", () => {
      const rows: [input: string, base: string, ...expected: string[]][] = [
        ["//u@h?q", "zz://x/y", "zz://u@h?q", "u", "", "h", "", "?q", ""],
        ["//u:p@h:8#f", "zz://x/y", "zz://u:p@h:8#f", "u", "p", "h:8", "", "", "#f"],
        [wide("//u@h?q"), wide("zz://x/y"), "zz://u@h?q", "u", "", "h", "", "?q", ""],
        ["?r", "zz://u@h?q", "zz://u@h?r", "u", "", "h", "", "?r", ""],
        ["#g", "zz://u@h?q", "zz://u@h?q#g", "u", "", "h", "", "?q", "#g"],
        ["", "zz://u@h?q#f", "zz://u@h?q", "u", "", "h", "", "?q", ""],
        // A path in the reference starts at the host of the base.
        ["x", "zz://u@h?q", "zz://u@h/x", "u", "", "h", "/x", "", ""],
        [".", "zz://u:p@h:8#f", "zz://u:p@h:8/", "u", "p", "h:8", "/", "", ""],
        ["..", "zz://u@h?q", "zz://u@h/", "u", "", "h", "/", "", ""],
        ["x", wide("zz://u@h?q"), "zz://u@h/x", "u", "", "h", "/x", "", ""],
      ];
      expect(rows.map(([input, base]) => [input, base, ...parts(new URL(input, base))])).toEqual(rows);
      expect(rows.map(([input, base]) => [input, base, ...parts(new URL(input, new URL(base)))])).toEqual(rows);
    });

    it("in the setters", () => {
      // The href after each assignment, then the pathname.
      const steps = (start: string, ...assignments: [property: string, value: string][]) => {
        const u = new URL(start);
        const hrefs: string[] = [];
        for (const [property, value] of assignments) {
          (u as any)[property] = value;
          hrefs.push(u.href);
        }
        return [...hrefs, u.pathname];
      };
      expect([
        // Credentials, a query or a fragment that come and go leave the path empty.
        steps("zz://h?q", ["username", "u"], ["username", ""]),
        steps("zz://h#f", ["password", "p"], ["password", ""]),
        steps("zz://u@h", ["search", "?q"], ["search", ""]),
        steps("zz://u@h", ["hash", "#f"], ["hash", ""]),
        steps("zz://u@h/p?q", ["pathname", ""], ["pathname", "/"], ["pathname", ""]),
        steps("zz://u:p@h:8/p#f", ["pathname", ""]),
        steps(
          "zz://u@h?q",
          ["port", "8"],
          ["port", ""],
          ["host", "x:9"],
          ["hostname", "y"],
          ["protocol", "yy"],
          ["href", "zz://v@i#f"],
        ),
        steps(wide("zz://h?q"), ["username", wide("us")], ["search", wide("?r")], ["hash", wide("#f")]),
      ]).toEqual([
        ["zz://u@h?q", "zz://h?q", ""],
        ["zz://:p@h#f", "zz://h#f", ""],
        ["zz://u@h?q", "zz://u@h", ""],
        ["zz://u@h#f", "zz://u@h", ""],
        ["zz://u@h?q", "zz://u@h/?q", "zz://u@h?q", ""],
        ["zz://u:p@h:8#f", ""],
        ["zz://u@h:8?q", "zz://u@h?q", "zz://u@x:9?q", "zz://u@y:9?q", "yy://u@y:9?q", "zz://v@i#f", ""],
        ["zz://us@h?q", "zz://us@h?r", "zz://us@h?r#f", ""],
      ]);

      const u = new URL("zz://u@h");
      const hrefs: string[] = [];
      u.searchParams.append("a", "b");
      hrefs.push(u.href);
      u.searchParams.set("a", "c");
      hrefs.push(u.href);
      u.searchParams.delete("a");
      expect([...hrefs, u.href, u.pathname]).toEqual(["zz://u@h?a=b", "zz://u@h?a=c", "zz://u@h", ""]);

      expect(Response.redirect("zz://u@h?q").headers.get("location")).toBe("zz://u@h?q");
    });

    // A control: this test passes without the fix too.
    it("and nothing else changes", () => {
      const rows = inBothWidths([
        // a slash in the input stays
        ["zz://u@h/?q", "zz://u@h/?q", "u", "", "h", "/", "?q", ""],
        ["zz://u@h/#f", "zz://u@h/#f", "u", "", "h", "/", "", "#f"],
        ["zz://u@h/p?q", "zz://u@h/p?q", "u", "", "h", "/p", "?q", ""],
        // nothing after the host
        ["zz://u@h", "zz://u@h", "u", "", "h", "", "", ""],
        ["zz://u:p@h:8", "zz://u:p@h:8", "u", "p", "h:8", "", "", ""],
        // no credentials
        ["zz://h?q", "zz://h?q", "", "", "h", "", "?q", ""],
        ["zz://h:8#f", "zz://h:8#f", "", "", "h:8", "", "", "#f"],
        // a special URL gets the path "/"
        ["http://u@h?q", "http://u@h/?q", "u", "", "h", "/", "?q", ""],
        ["http://u@h#f", "http://u@h/#f", "u", "", "h", "/", "", "#f"],
        ["https://u:p@h:8?q", "https://u:p@h:8/?q", "u", "p", "h:8", "/", "?q", ""],
        ["https://u:p@h:8#f", "https://u:p@h:8/#f", "u", "p", "h:8", "/", "", "#f"],
        ["ws://u@h?q", "ws://u@h/?q", "u", "", "h", "/", "?q", ""],
        ["wss://u@[::1]#f", "wss://u@[::1]/#f", "u", "", "[::1]", "/", "", "#f"],
        ["ftp://u@h?q", "ftp://u@h/?q", "u", "", "h", "/", "?q", ""],
        ["http://u@h", "http://u@h/", "u", "", "h", "/", "", ""],
        ["https://u:p@h:8?q\u4e2d", "https://u:p@h:8/?q%E4%B8%AD", "u", "p", "h:8", "/", "?q%E4%B8%AD", ""],
        ["http://u@h\\p", "http://u@h/p", "u", "", "h", "/p", "", ""],
      ]);
      expect(rows.map(([input]) => [input, ...parts(new URL(input))])).toEqual(rows);
      expect(parts(new URL("//u@h?q", "http://x/y"))).toEqual(["http://u@h/?q", "u", "", "h", "/", "?q", ""]);
      // Credentials need a host.
      const invalid = ["zz://u@?q", "zz://u@#f", "zz://u@", "zz://u@h\\?q"];
      for (const input of invalid) expect(() => new URL(input)).toThrow(TypeError);
      expect(invalid.map(input => URL.canParse(input))).toEqual([false, false, false, false]);
      const special = new URL("http://h?q");
      special.username = "u";
      special.pathname = "";
      expect(special.href).toBe("http://u@h/?q");
    });
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

  it("createObjectURL without an argument reports its type, as in Node", () => {
    // @ts-expect-error
    expect(() => URL.createObjectURL()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
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
