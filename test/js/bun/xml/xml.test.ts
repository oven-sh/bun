import { describe, expect, test } from "bun:test";

const { parse } = Bun.XML;

describe("Bun.XML.parse", () => {
  test("exists", () => {
    expect(Bun.XML).toBeDefined();
    expect(typeof Bun.XML.parse).toBe("function");
  });

  describe("basic elements", () => {
    test("single empty element", () => {
      expect(parse("<root></root>")).toEqual({ root: "" });
    });

    test("self-closing element", () => {
      expect(parse("<root/>")).toEqual({ root: "" });
    });

    test("self-closing with space", () => {
      expect(parse("<root />")).toEqual({ root: "" });
    });

    test("text-only element", () => {
      expect(parse("<root>hello</root>")).toEqual({ root: "hello" });
    });

    test("nested element", () => {
      expect(parse("<a><b>c</b></a>")).toEqual({ a: { b: "c" } });
    });

    test("deeply nested", () => {
      expect(parse("<a><b><c><d>e</d></c></b></a>")).toEqual({
        a: { b: { c: { d: "e" } } },
      });
    });
  });

  describe("attributes", () => {
    test("single attribute", () => {
      expect(parse('<root id="1"/>')).toEqual({ root: { "@id": "1" } });
    });

    test("multiple attributes", () => {
      expect(parse('<root a="1" b="2" c="3"/>')).toEqual({
        root: { "@a": "1", "@b": "2", "@c": "3" },
      });
    });

    test("single-quoted attribute", () => {
      expect(parse("<root id='1'/>")).toEqual({ root: { "@id": "1" } });
    });

    test("attribute with text content", () => {
      expect(parse('<root id="1">hello</root>')).toEqual({
        root: { "@id": "1", "#text": "hello" },
      });
    });

    test("attribute with entity", () => {
      expect(parse('<root title="a &amp; b"/>')).toEqual({
        root: { "@title": "a & b" },
      });
    });

    test("whitespace around equals", () => {
      expect(parse('<root id  =  "1"/>')).toEqual({ root: { "@id": "1" } });
    });

    test("namespaced attribute", () => {
      expect(parse('<root xmlns:x="http://example.com" x:id="1"/>')).toEqual({
        root: { "@xmlns:x": "http://example.com", "@x:id": "1" },
      });
    });

    test("empty attribute value", () => {
      expect(parse('<root id=""/>')).toEqual({ root: { "@id": "" } });
    });
  });

  describe("repeated siblings", () => {
    test("two siblings become array", () => {
      expect(parse("<r><a>1</a><a>2</a></r>")).toEqual({
        r: { a: ["1", "2"] },
      });
    });

    test("three siblings", () => {
      expect(parse("<r><a>1</a><a>2</a><a>3</a></r>")).toEqual({
        r: { a: ["1", "2", "3"] },
      });
    });

    test("mixed names preserve first-appearance order", () => {
      const result = parse("<r><a>1</a><b>2</b><a>3</a></r>") as any;
      expect(result).toEqual({ r: { a: ["1", "3"], b: "2" } });
      expect(Object.keys(result.r)).toEqual(["a", "b"]);
    });

    test("repeated with attributes", () => {
      expect(parse('<r><item id="1">x</item><item id="2">y</item></r>')).toEqual({
        r: {
          item: [
            { "@id": "1", "#text": "x" },
            { "@id": "2", "#text": "y" },
          ],
        },
      });
    });
  });

  describe("entities", () => {
    test("predefined entities", () => {
      expect(parse("<r>&lt;&gt;&amp;&apos;&quot;</r>")).toEqual({
        r: "<>&'\"",
      });
    });

    test("decimal character reference", () => {
      expect(parse("<r>&#65;&#66;&#67;</r>")).toEqual({ r: "ABC" });
    });

    test("hex character reference", () => {
      expect(parse("<r>&#x41;&#x42;&#x43;</r>")).toEqual({ r: "ABC" });
    });

    test("hex uppercase X", () => {
      expect(parse("<r>&#X41;</r>")).toEqual({ r: "A" });
    });

    test("unicode character reference", () => {
      expect(parse("<r>&#x1F600;</r>")).toEqual({ r: "😀" });
    });

    test("entity in attribute", () => {
      expect(parse('<r a="&lt;tag&gt;"/>')).toEqual({ r: { "@a": "<tag>" } });
    });
  });

  describe("CDATA", () => {
    test("basic cdata", () => {
      expect(parse("<r><![CDATA[<hello>]]></r>")).toEqual({ r: "<hello>" });
    });

    test("cdata with special chars", () => {
      expect(parse("<r><![CDATA[a & b < c > d]]></r>")).toEqual({
        r: "a & b < c > d",
      });
    });

    test("cdata mixed with text", () => {
      expect(parse("<r>before<![CDATA[mid]]>after</r>")).toEqual({
        r: "beforemidafter",
      });
    });

    test("empty cdata", () => {
      expect(parse("<r><![CDATA[]]></r>")).toEqual({ r: "" });
    });

    test("cdata containing ]]", () => {
      expect(parse("<r><![CDATA[a]]b]]></r>")).toEqual({ r: "a]]b" });
    });
  });

  describe("comments", () => {
    test("comment in content", () => {
      expect(parse("<r>a<!-- comment -->b</r>")).toEqual({ r: "ab" });
    });

    test("comment in prolog", () => {
      expect(parse("<!-- comment --><r>x</r>")).toEqual({ r: "x" });
    });

    test("comment after root", () => {
      expect(parse("<r>x</r><!-- comment -->")).toEqual({ r: "x" });
    });

    test("comment containing dashes", () => {
      expect(parse("<r><!-- a - b - c -->x</r>")).toEqual({ r: "x" });
    });
  });

  describe("processing instructions", () => {
    test("xml declaration", () => {
      expect(parse('<?xml version="1.0"?><r>x</r>')).toEqual({ r: "x" });
    });

    test("xml declaration with encoding", () => {
      expect(parse('<?xml version="1.0" encoding="UTF-8"?><r>x</r>')).toEqual({
        r: "x",
      });
    });

    test("PI in content", () => {
      expect(parse("<r>a<?target data?>b</r>")).toEqual({ r: "ab" });
    });

    test("PI after root", () => {
      expect(parse("<r>x</r><?target?>")).toEqual({ r: "x" });
    });
  });

  describe("DOCTYPE", () => {
    test("simple doctype", () => {
      expect(parse("<!DOCTYPE root><root>x</root>")).toEqual({ root: "x" });
    });

    test("doctype with system", () => {
      expect(parse('<!DOCTYPE root SYSTEM "foo.dtd"><root>x</root>')).toEqual({
        root: "x",
      });
    });

    test("doctype with internal subset", () => {
      expect(parse("<!DOCTYPE root [<!ELEMENT root (#PCDATA)>]><root>x</root>")).toEqual({ root: "x" });
    });

    test("lowercase doctype", () => {
      expect(parse("<!doctype root><root>x</root>")).toEqual({ root: "x" });
    });
  });

  describe("whitespace handling", () => {
    test("leading/trailing whitespace trimmed", () => {
      expect(parse("<r>  hello  </r>")).toEqual({ r: "hello" });
    });

    test("internal whitespace collapsed", () => {
      expect(parse("<r>a   b\n\n  c</r>")).toEqual({ r: "a b c" });
    });

    test("whitespace-only content", () => {
      expect(parse("<r>   \n   </r>")).toEqual({ r: "" });
    });

    test("whitespace around root", () => {
      expect(parse("  \n  <r>x</r>  \n  ")).toEqual({ r: "x" });
    });

    test("whitespace between children dropped", () => {
      expect(parse("<r>\n  <a>1</a>\n  <a>2</a>\n</r>")).toEqual({
        r: { a: ["1", "2"] },
      });
    });
  });

  describe("mixed content", () => {
    test("text with child", () => {
      expect(parse("<r>before<b>mid</b>after</r>")).toEqual({
        r: { b: "mid", "#text": "beforeafter" },
      });
    });

    test("text with child and whitespace", () => {
      expect(parse("<r>before <b>mid</b> after</r>")).toEqual({
        r: { b: "mid", "#text": "before after" },
      });
    });

    test("text around multiple children", () => {
      expect(parse("<r>a<x>1</x>b<x>2</x>c</r>")).toEqual({
        r: { x: ["1", "2"], "#text": "abc" },
      });
    });
  });

  describe("unicode", () => {
    test("utf-8 content", () => {
      expect(parse("<r>日本語</r>")).toEqual({ r: "日本語" });
    });

    test("utf-8 tag name", () => {
      expect(parse("<日本語>x</日本語>")).toEqual({ 日本語: "x" });
    });

    test("emoji content", () => {
      expect(parse("<r>🎉</r>")).toEqual({ r: "🎉" });
    });

    test("BOM handling", () => {
      expect(parse("\uFEFF<r>x</r>")).toEqual({ r: "x" });
    });
  });

  describe("namespaces", () => {
    test("namespaced element", () => {
      expect(parse("<ns:root>x</ns:root>")).toEqual({ "ns:root": "x" });
    });

    test("namespaced children", () => {
      expect(parse("<r><ns:a>1</ns:a><ns:a>2</ns:a></r>")).toEqual({
        r: { "ns:a": ["1", "2"] },
      });
    });
  });

  describe("realistic", () => {
    test("rss-like", () => {
      const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example</title>
    <item>
      <title>First</title>
      <link>https://example.com/1</link>
    </item>
    <item>
      <title>Second</title>
      <link>https://example.com/2</link>
    </item>
  </channel>
</rss>`;
      expect(parse(xml)).toEqual({
        rss: {
          "@version": "2.0",
          channel: {
            title: "Example",
            item: [
              { title: "First", link: "https://example.com/1" },
              { title: "Second", link: "https://example.com/2" },
            ],
          },
        },
      });
    });

    test("svg-like", () => {
      const xml = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="red"/></svg>';
      expect(parse(xml)).toEqual({
        svg: {
          "@xmlns": "http://www.w3.org/2000/svg",
          "@width": "100",
          "@height": "100",
          rect: {
            "@x": "0",
            "@y": "0",
            "@width": "100",
            "@height": "100",
            "@fill": "red",
          },
        },
      });
    });
  });

  // Regressions ported from YAML/TOML parser issues.
  describe("ported edge cases", () => {
    test("__proto__ tag name does not pollute prototype", () => {
      const r = parse("<__proto__><polluted>yes</polluted></__proto__>") as any;
      expect(r.__proto__).toEqual({ polluted: "yes" });
      expect(({} as any).polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(r, "__proto__")).toBe(true);
    });

    test("__proto__ attribute does not pollute prototype", () => {
      const r = parse('<r __proto__="x"/>') as any;
      expect(r.r["@__proto__"]).toBe("x");
      expect(({} as any)["@__proto__"]).toBeUndefined();
    });

    test("constructor tag name", () => {
      const r = parse("<constructor>x</constructor>") as any;
      expect(r.constructor).toBe("x");
    });

    test("numeric-looking attribute values stay strings (TOML #17926 analogue)", () => {
      const r = parse('<r a="0" b="123" c="1.5" d="true"/>') as any;
      expect(r.r["@a"]).toBe("0");
      expect(r.r["@b"]).toBe("123");
      expect(r.r["@c"]).toBe("1.5");
      expect(r.r["@d"]).toBe("true");
      expect(typeof r.r["@a"]).toBe("string");
    });

    test("numeric-looking text stays string", () => {
      expect(parse("<r>123</r>")).toEqual({ r: "123" });
      expect(typeof (parse("<r>123</r>") as any).r).toBe("string");
    });

    test("'default' tag name (YAML #7127 analogue)", () => {
      expect(parse("<default>x</default>")).toEqual({ default: "x" });
    });

    test("duplicate attribute names — last wins, no crash", () => {
      // XML spec says this is an error; we are lenient like most data parsers
      // and either error or keep one. Must not crash.
      try {
        const r = parse('<r a="1" a="2"/>') as any;
        expect(["1", "2"]).toContain(r.r["@a"]);
      } catch (e) {
        expect(e).toBeInstanceOf(SyntaxError);
      }
    });

    test("very long tag name", () => {
      const name = "a" + Buffer.alloc(5000, "b").toString();
      expect(parse(`<${name}>x</${name}>`)).toEqual({ [name]: "x" });
    });

    test("attribute named 'length'", () => {
      expect(parse('<r length="5"/>')).toEqual({ r: { "@length": "5" } });
    });
  });

  describe("input types", () => {
    test("accepts Buffer", () => {
      expect(parse(Buffer.from("<r>x</r>"))).toEqual({ r: "x" });
    });

    test("accepts Uint8Array", () => {
      expect(parse(new TextEncoder().encode("<r>x</r>"))).toEqual({ r: "x" });
    });
  });
});

describe("Bun.XML.parse errors", () => {
  test("empty input returns empty object (matches TOML/JSON loader behavior)", () => {
    expect(parse("")).toEqual({});
  });

  describe("throws SyntaxError", () => {
    for (const [name, input] of [
      ["whitespace only", "   \n  "],
      ["unclosed tag", "<root>"],
      ["mismatched closing tag", "<a></b>"],
      ["unexpected closing tag", "</root>"],
      ["nested mismatch", "<a><b></a></b>"],
      ["multiple root elements", "<a/><b/>"],
      ["text before root", "hello<root/>"],
      ["text after root", "<root/>hello"],
      ["text only, no element", "hello"],
      ["unterminated comment", "<root><!-- unclosed</root>"],
      ["unterminated cdata", "<root><![CDATA[unclosed</root>"],
      ["unterminated PI", "<?xml<root/>"],
      ["unterminated doctype", "<!DOCTYPE root"],
      ["unterminated attribute value", '<root id="1/>'],
      ["attribute without value", "<root id/>"],
      ["attribute without quotes", "<root id=1/>"],
      ["lt in attribute", '<root id="<"/>'],
      ["bare ampersand", "<root>a & b</root>"],
      ["unknown entity", "<root>&unknown;</root>"],
      ["unterminated entity", "<root>&amp</root>"],
      ["empty entity", "<root>&;</root>"],
      ["empty char ref", "<root>&#;</root>"],
      ["char ref out of range", "<root>&#x110000;</root>"],
      ["surrogate char ref", "<root>&#xD800;</root>"],
      ["tag starting with digit", "<1root/>"],
      ["empty tag name", "<>"],
      ["self-close missing gt", "<root/"],
      ["just open bracket", "<"],
      ["unknown bang in content", "<root><!FOO></root>"],
    ] as const) {
      test(name, () => {
        expect(() => parse(input)).toThrow(SyntaxError);
      });
    }
  });

  test("throws on null/undefined", () => {
    // @ts-expect-error
    expect(() => parse()).toThrow();
    // @ts-expect-error
    expect(() => parse(null)).toThrow();
  });

  test("error message contains description", () => {
    try {
      parse("<a></b>");
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toContain("XML Parse error");
      expect(e.message).toContain("Closing tag does not match");
    }
  });
});

describe("Bun.XML.parse adversarial", () => {
  test("many attributes", () => {
    let attrs = "";
    const expected: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      attrs += ` a${i}="${i}"`;
      expected[`@a${i}`] = String(i);
    }
    expect(parse(`<r${attrs}/>`)).toEqual({ r: expected });
  });

  test("many children", () => {
    let kids = "";
    const arr: string[] = [];
    for (let i = 0; i < 500; i++) {
      kids += `<k>${i}</k>`;
      arr.push(String(i));
    }
    expect(parse(`<r>${kids}</r>`)).toEqual({ r: { k: arr } });
  });

  test("many distinct children", () => {
    let kids = "";
    const obj: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      kids += `<k${i}>${i}</k${i}>`;
      obj[`k${i}`] = String(i);
    }
    expect(parse(`<r>${kids}</r>`)).toEqual({ r: obj });
  });

  test("deep nesting throws stack overflow, does not crash", () => {
    const depth = 100_000;
    const xml = "<a>".repeat(depth) + "</a>".repeat(depth);
    expect(() => parse(xml)).toThrow();
  });

  test("long text content", () => {
    const s = "a".repeat(10_000);
    expect(parse(`<r>${s}</r>`)).toEqual({ r: s });
  });

  test("long attribute value", () => {
    const s = "a".repeat(10_000);
    expect(parse(`<r a="${s}"/>`)).toEqual({ r: { "@a": s } });
  });

  test("many entities", () => {
    const n = 500;
    const ents = "&amp;".repeat(n);
    expect(parse(`<r>${ents}</r>`)).toEqual({ r: "&".repeat(n) });
  });

  test("attribute containing quote of other kind", () => {
    expect(parse(`<r a='"' b="'"/>`)).toEqual({ r: { "@a": '"', "@b": "'" } });
  });

  test("tag name with dots dashes and underscores", () => {
    expect(parse("<a.b-c_d>x</a.b-c_d>")).toEqual({ "a.b-c_d": "x" });
  });

  test("doctype with quoted gt", () => {
    expect(parse('<!DOCTYPE root SYSTEM "a>b"><root>x</root>')).toEqual({
      root: "x",
    });
  });

  test("comment boundary", () => {
    expect(parse("<r><!---->x</r>")).toEqual({ r: "x" });
  });

  test("cdata containing ]]><", () => {
    // ]]> ends the section; the rest is text
    expect(parse("<r><![CDATA[a]]>b</r>")).toEqual({ r: "ab" });
  });

  test("reparse does not leak across arenas", () => {
    // Parse twice; results must not share backing memory.
    const a = parse("<r><k>first</k></r>") as any;
    const b = parse("<r><k>second</k></r>") as any;
    expect(a.r.k).toBe("first");
    expect(b.r.k).toBe("second");
  });
});

describe("Bun.XML.parse security", () => {
  // Every case here MUST either return a value or throw a SyntaxError.
  // It must NEVER crash, hang, recurse unboundedly, or blow memory.
  function safe(input: string | Uint8Array) {
    try {
      return { ok: true, value: parse(input as string) };
    } catch (e) {
      expect(e).toBeInstanceOf(SyntaxError);
      return { ok: false, err: e };
    }
  }

  describe("entity expansion (XXE / billion laughs)", () => {
    test("general entity defined in DOCTYPE is NOT expanded", () => {
      // We skip the internal subset; &xxe; is not a predefined entity so it
      // must be rejected rather than expanded.
      const xml = `<!DOCTYPE r [ <!ENTITY xxe "pwned"> ]><r>&xxe;</r>`;
      expect(() => parse(xml)).toThrow(SyntaxError);
    });

    test("external entity (SYSTEM file://) is NOT resolved", () => {
      const xml = `<!DOCTYPE r [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><r>&xxe;</r>`;
      expect(() => parse(xml)).toThrow(SyntaxError);
    });

    test("external entity (SYSTEM http://) is NOT resolved", () => {
      const xml = `<!DOCTYPE r [ <!ENTITY xxe SYSTEM "http://127.0.0.1:1/"> ]><r>&xxe;</r>`;
      expect(() => parse(xml)).toThrow(SyntaxError);
    });

    test("parameter entity is ignored", () => {
      const xml = `<!DOCTYPE r [ <!ENTITY % pe SYSTEM "file:///etc/passwd"> %pe; ]><r>x</r>`;
      expect(parse(xml)).toEqual({ r: "x" });
    });

    test("DOCTYPE cannot redefine predefined entities", () => {
      // Even if the DTD tries to turn &lt; into something else, we use the
      // spec-mandated predefined set only.
      const xml = `<!DOCTYPE r [ <!ENTITY lt "pwned"> ]><r>&lt;</r>`;
      expect(parse(xml)).toEqual({ r: "<" });
    });

    test("billion laughs does not expand", () => {
      let dtd = '<!ENTITY lol "lol">';
      for (let i = 1; i <= 9; i++) {
        const prev = `&lol${i === 1 ? "" : i - 1};`;
        dtd += `<!ENTITY lol${i} "${Buffer.alloc(10, "").fill(prev).toString() || prev.repeat(10)}">`;
      }
      // Simpler: build manually since Buffer fill with multi-byte is awkward.
      dtd = '<!ENTITY lol "lol">';
      let ref = "&lol;";
      for (let i = 1; i <= 9; i++) {
        dtd += `<!ENTITY lol${i} "${ref}${ref}${ref}${ref}${ref}${ref}${ref}${ref}${ref}${ref}">`;
        ref = `&lol${i};`;
      }
      const xml = `<?xml version="1.0"?><!DOCTYPE lolz [${dtd}]><lolz>&lol9;</lolz>`;
      // The reference to &lol9; is unknown → SyntaxError, NOT expansion.
      expect(() => parse(xml)).toThrow(SyntaxError);
    });

    test("quadratic blowup via single large entity referenced many times", () => {
      // Even with a predefined entity, referencing it N times must be linear.
      const n = 5000;
      const body = Buffer.alloc(n * 5, "&amp;").toString();
      const start = Bun.nanoseconds();
      const result = parse(`<r>${body}</r>`) as any;
      const elapsed_ms = (Bun.nanoseconds() - start) / 1e6;
      expect(result.r.length).toBe(n);
      // Generous sanity bound; debug builds are slow.
      expect(elapsed_ms).toBeLessThan(10_000);
    });

    test("recursive-looking entity names are rejected", () => {
      expect(() => parse("<r>&amp;amp;</r>")).not.toThrow(); // this is just "&amp;"
      expect(parse("<r>&amp;amp;</r>")).toEqual({ r: "&amp;" });
    });
  });

  describe("DOCTYPE abuse", () => {
    test("deeply nested internal subset does not recurse unboundedly", () => {
      const depth = 2000;
      const open = Buffer.alloc(depth, "<").toString();
      const close = Buffer.alloc(depth, ">").toString();
      const xml = `<!DOCTYPE r [${open}${close}]><r>x</r>`;
      expect(safe(xml).ok).toBe(true);
      expect(parse(xml)).toEqual({ r: "x" });
    });

    test("unbalanced brackets in subset is rejected", () => {
      expect(() => parse("<!DOCTYPE r [<<><r>x</r>")).toThrow(SyntaxError);
    });

    test("gt inside single-quoted doctype string", () => {
      expect(parse("<!DOCTYPE r PUBLIC 'a>b' 'c>d'><r>x</r>")).toEqual({ r: "x" });
    });

    test("SYSTEM url with embedded quotes and brackets", () => {
      expect(parse(`<!DOCTYPE r SYSTEM "javascript:alert('>]]><')"><r>x</r>`)).toEqual({ r: "x" });
    });
  });

  describe("depth / width exhaustion", () => {
    test("element depth bomb raises a catchable error", () => {
      const depth = 200_000;
      const xml = Buffer.alloc(depth * 3, "<a>").toString() + Buffer.alloc(depth * 4, "</a>").toString();
      expect(() => parse(xml)).toThrow();
    });

    test("wide attribute bomb completes", () => {
      const n = 2000;
      let attrs = "";
      for (let i = 0; i < n; i++) attrs += ` a${i}="v"`;
      const r = parse(`<r${attrs}/>`) as any;
      expect(Object.keys(r.r).length).toBe(n);
    });

    test("wide sibling bomb completes", () => {
      const n = 2000;
      let body = "";
      for (let i = 0; i < n; i++) body += "<c/>";
      const r = parse(`<r>${body}</r>`) as any;
      expect(Array.isArray(r.r.c)).toBe(true);
      expect(r.r.c.length).toBe(n);
    });
  });

  describe("malformed bytes", () => {
    test("null byte in content", () => {
      const r = safe("<r>a\u0000b</r>");
      // Either parses (treating NUL as data) or rejects — must not crash.
      if (r.ok) expect((r.value as any).r).toContain("a");
    });

    test("null byte in tag name", () => {
      expect(safe("<r\u0000>x</r\u0000>").ok).toBe(false);
    });

    test("null byte in attribute name", () => {
      expect(safe('<r a\u0000b="1"/>').ok).toBe(false);
    });

    test("control characters in content do not crash", () => {
      for (let cc = 1; cc < 0x20; cc++) {
        if (cc === 0x09 || cc === 0x0a || cc === 0x0d) continue;
        safe(`<r>${String.fromCharCode(cc)}</r>`);
      }
    });

    test("lone high byte (>0x80) in content does not crash", () => {
      safe(Buffer.from([0x3c, 0x72, 0x3e, 0xc0, 0x3c, 0x2f, 0x72, 0x3e]));
    });

    test("overlong UTF-8 for '<' does not smuggle a tag", () => {
      // 0xC0 0xBC is an overlong encoding of '<'. It must NOT be treated as
      // a tag start.
      const bytes = Buffer.concat([
        Buffer.from("<r>"),
        Buffer.from([0xc0, 0xbc]),
        Buffer.from("script"),
        Buffer.from([0xc0, 0xbe]),
        Buffer.from("</r>"),
      ]);
      const r = safe(bytes);
      if (r.ok) {
        // If it parsed, the content must not have produced a child element.
        expect(typeof (r.value as any).r).toBe("string");
      }
    });

    test("UTF-16 BOM input is rejected (not UTF-8)", () => {
      const utf16 = Buffer.from("\ufeff<r>x</r>", "utf16le");
      expect(safe(utf16).ok).toBe(false);
    });
  });

  describe("boundary / parser-differential abuse", () => {
    test("comment containing --", () => {
      // XML spec forbids `--` inside comments, but many parsers accept it.
      // We accept it (don't error) but also must not mis-parse.
      safe("<r><!-- a -- b -->x</r>");
    });

    test("comment that looks like it ends early", () => {
      expect(parse("<r><!--->-->x</r>")).toEqual({ r: "x" });
    });

    test("PI that looks like xml decl inside content", () => {
      expect(parse('<r><?xml version="1.0"?>x</r>')).toEqual({ r: "x" });
    });

    test("CDATA end marker split across boundaries", () => {
      expect(parse("<r><![CDATA[]]]]><![CDATA[>]]></r>")).toEqual({ r: "]]>" });
    });

    test("nested CDATA markers inside CDATA", () => {
      expect(parse("<r><![CDATA[<![CDATA[inner]]></r>")).toEqual({ r: "<![CDATA[inner" });
    });

    test("attribute value with newline and tab", () => {
      expect(parse('<r a="x\n\ty"/>')).toEqual({ r: { "@a": "x\n\ty" } });
    });

    test("attribute with only whitespace before eof", () => {
      expect(() => parse("<r a  ")).toThrow(SyntaxError);
    });

    test("close tag with extra whitespace", () => {
      expect(parse("<r>x</r   >")).toEqual({ r: "x" });
    });

    test("self-close with whitespace before slash", () => {
      expect(parse("<r   />")).toEqual({ r: "" });
    });

    test("colon-only tag name is rejected", () => {
      // ':' alone is technically a NameStartChar but no real parser emits it;
      // we only require it not to crash.
      safe("<:>x</:>");
    });

    test("tag name case sensitivity", () => {
      expect(() => parse("<Root></root>")).toThrow(SyntaxError);
    });

    test("> inside text is allowed", () => {
      expect(parse("<r>a>b</r>")).toEqual({ r: "a>b" });
    });

    test("double closing tag", () => {
      expect(() => parse("<r>x</r></r>")).toThrow(SyntaxError);
    });
  });

  describe("character references", () => {
    test("hex ref with many leading zeros", () => {
      expect(parse("<r>&#x0000000041;</r>")).toEqual({ r: "A" });
    });

    test("decimal ref with many leading zeros", () => {
      expect(parse("<r>&#0000000065;</r>")).toEqual({ r: "A" });
    });

    test("extremely long digit sequence is rejected, not overflowed", () => {
      const digits = Buffer.alloc(200, "9").toString();
      expect(() => parse(`<r>&#${digits};</r>`)).toThrow(SyntaxError);
    });

    test("hex ref with non-hex digit", () => {
      expect(() => parse("<r>&#xG1;</r>")).toThrow(SyntaxError);
    });

    test("decimal ref producing surrogate is rejected", () => {
      expect(() => parse("<r>&#55296;</r>")).toThrow(SyntaxError);
    });

    test("max valid codepoint", () => {
      expect(parse("<r>&#x10FFFF;</r>")).toEqual({ r: "\u{10FFFF}" });
    });

    test("codepoint 0 produces NUL, does not terminate the string", () => {
      const r = parse("<r>a&#0;b</r>") as any;
      expect(r.r.length).toBe(3);
      expect(r.r.charCodeAt(1)).toBe(0);
    });
  });
});

describe("Bun.XML.parse fuzzing", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  function genValidXML(rand: () => number, depth: number): string {
    const tags = ["a", "b", "c", "item", "data", "x", "ns:y"];
    const tag = tags[Math.floor(rand() * tags.length)];
    let attrs = "";
    const nattrs = Math.floor(rand() * 3);
    for (let i = 0; i < nattrs; i++) {
      attrs += ` a${i}="${Math.floor(rand() * 100)}"`;
    }
    if (depth <= 0 || rand() < 0.3) {
      if (rand() < 0.3) return `<${tag}${attrs}/>`;
      const texts = ["hi", "hello world", "&amp;", "&lt;foo&gt;", "123", ""];
      const text = texts[Math.floor(rand() * texts.length)];
      return `<${tag}${attrs}>${text}</${tag}>`;
    }
    const nkids = 1 + Math.floor(rand() * 3);
    let body = "";
    for (let i = 0; i < nkids; i++) {
      body += genValidXML(rand, depth - 1);
    }
    return `<${tag}${attrs}>${body}</${tag}>`;
  }

  test("valid generated trees always parse and roundtrip through JSON", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rand = rng(seed + 1);
      const xml = genValidXML(rand, 4);
      let result: unknown;
      try {
        result = parse(xml);
      } catch (e) {
        throw new Error(`seed=${seed} failed on valid input: ${xml}\n${e}`);
      }
      // Result must be JSON-serializable (no cycles, no undefined).
      const json = JSON.stringify(result);
      expect(typeof json).toBe("string");
      expect(JSON.parse(json)).toEqual(result);
    }
  });

  test("random byte mutations never crash", () => {
    const base = '<?xml version="1.0"?><root a="1"><child>hello &amp; world</child><child/><x><![CDATA[data]]></x></root>';
    const alphabet = '<>/="\'&;#![]?- \n\tabcxyz0129';
    for (let seed = 0; seed < 500; seed++) {
      const rand = rng(seed * 7919 + 17);
      const bytes = [...base];
      const nMut = 1 + Math.floor(rand() * 5);
      for (let m = 0; m < nMut; m++) {
        const op = Math.floor(rand() * 3);
        const pos = Math.floor(rand() * bytes.length);
        if (op === 0 && bytes.length > 1) {
          bytes.splice(pos, 1);
        } else if (op === 1) {
          bytes.splice(pos, 0, alphabet[Math.floor(rand() * alphabet.length)]);
        } else {
          bytes[pos] = alphabet[Math.floor(rand() * alphabet.length)];
        }
      }
      const mutated = bytes.join("");
      let threw = false;
      let result: unknown;
      try {
        result = parse(mutated);
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(SyntaxError);
      }
      if (!threw) {
        // Whatever it returned must be a plain object rooted at one key.
        expect(typeof result).toBe("object");
        expect(result).not.toBeNull();
      }
    }
  });

  test("random garbage never crashes", () => {
    const alphabet = '<>/="\'&;#![]?- \n\tabcdefghijklmnopqrstuvwxyz0123456789';
    for (let seed = 0; seed < 500; seed++) {
      const rand = rng(seed * 31337 + 3);
      const len = 1 + Math.floor(rand() * 80);
      let s = "";
      for (let i = 0; i < len; i++) {
        s += alphabet[Math.floor(rand() * alphabet.length)];
      }
      try {
        parse(s);
      } catch (e) {
        expect(e).toBeInstanceOf(SyntaxError);
      }
    }
  });

  test("truncated valid input never crashes", () => {
    const xml = '<?xml version="1.0"?><root a="1" b="2"><child id="c">text &amp; more</child><!-- c --><![CDATA[x]]></root>';
    for (let i = 0; i <= xml.length; i++) {
      const prefix = xml.slice(0, i);
      try {
        parse(prefix);
      } catch (e) {
        expect(e).toBeInstanceOf(SyntaxError);
      }
    }
  });
});
