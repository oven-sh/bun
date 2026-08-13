import { XML } from "bun";
import { describe, expect, test } from "bun:test";

// Hand-written coverage beyond the W3C conformance suite (xml-test-suite.test.ts):
// the JS-facing API surface, the two result shapes, Bun-specific input types,
// what a non-validating processor that does not load external entities does at
// the edges, resource limits, and XML.stringify.

function syntaxError(input: string | Uint8Array, options?: XML.ParseOptions): SyntaxError {
  let err: unknown;
  try {
    XML.parse(input, options);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SyntaxError);
  expect((err as SyntaxError).message).toStartWith("XML Parse error: ");
  return err as SyntaxError;
}

const nodes = { compact: false } as const;

describe("input types", () => {
  const doc = `<config version="2"><name>app</name><port>8080</port><port>8081</port></config>`;
  const expected = { config: { "@version": "2", name: "app", port: ["8080", "8081"] } };

  test("string", () => {
    expect(XML.parse(doc)).toEqual(expected);
  });

  test("Buffer", () => {
    expect(XML.parse(Buffer.from(doc))).toEqual(expected);
  });

  test("Uint8Array subarray respects byteOffset and length", () => {
    const padded = Buffer.from("<<<" + doc + ">>>");
    expect(XML.parse(padded.subarray(3, 3 + doc.length))).toEqual(expected);
  });

  test("DataView", () => {
    const bytes = new TextEncoder().encode(doc);
    expect(XML.parse(new DataView(bytes.buffer))).toEqual(expected);
  });

  test("ArrayBuffer and SharedArrayBuffer", () => {
    const bytes = new TextEncoder().encode(doc);
    expect(XML.parse(bytes.buffer)).toEqual(expected);
    const sab = new SharedArrayBuffer(bytes.length);
    new Uint8Array(sab).set(bytes);
    expect(XML.parse(sab)).toEqual(expected);
  });

  test("Blob parses synchronously", () => {
    expect(XML.parse(new Blob([doc]))).toEqual(expected);
  });

  test("nullish input throws TypeError; other values are stringified", () => {
    expect(() => XML.parse(undefined as any)).toThrow(TypeError);
    expect(() => XML.parse(null as any)).toThrow(TypeError);
    expect(XML.parse({ toString: () => "<a>1</a>" } as any)).toEqual({ a: "1" });
  });

  test("options must be an object; compact must be a boolean", () => {
    expect(() => XML.parse("<a/>", 1 as any)).toThrow(TypeError);
    expect(() => XML.parse("<a/>", { compact: "no" } as any)).toThrow(TypeError);
    expect(XML.parse("<a/>", null as any)).toEqual({ a: "" });
    expect(XML.parse("<a/>", {})).toEqual({ a: "" });
    expect(XML.parse("<a/>", { compact: undefined })).toEqual({ a: "" });
  });
});

describe("compact shape", () => {
  test("leaf elements are their text; attributes and children make an object", () => {
    expect(XML.parse("<a/>")).toEqual({ a: "" });
    expect(XML.parse("<a></a>")).toEqual({ a: "" });
    expect(XML.parse("<a>text</a>")).toEqual({ a: "text" });
    expect(XML.parse(`<a x="1"/>`)).toEqual({ a: { "@x": "1" } });
    expect(XML.parse(`<a x="1">text</a>`)).toEqual({ a: { "@x": "1", "#text": "text" } });
    expect(XML.parse(`<a><b>1</b></a>`)).toEqual({ a: { b: "1" } });
    expect(XML.parse(`<a><b>1</b>t</a>`)).toEqual({ a: { b: "1", "#text": "t" } });
  });

  test("repeated names become arrays in document order, grouped at the first occurrence", () => {
    const result = XML.parse(`<r><a>1</a><b>x</b><a>2</a><c/><a>3</a></r>`) as any;
    expect(result).toEqual({ r: { a: ["1", "2", "3"], b: "x", c: "" } });
    expect(Object.keys(result.r)).toEqual(["a", "b", "c"]);
  });

  test("attributes come first, then children, then #text", () => {
    const result = XML.parse(`<r z="1"><b/>t<a/></r>`) as any;
    expect(Object.keys(result.r)).toEqual(["@z", "b", "a", "#text"]);
  });

  test("text is trimmed of XML whitespace at the ends only, and concatenated across children", () => {
    expect(XML.parse(`<a>\r\n\t x  y \n</a>`)).toEqual({ a: "x  y" });
    // U+00A0 and other Unicode spaces are not XML whitespace.
    expect(XML.parse(`<a> x </a>`)).toEqual({ a: " x " });
    expect(XML.parse(`<p>Hello <b>big</b> world</p>`)).toEqual({ p: { b: "big", "#text": "Hello  world" } });
    expect(XML.parse(`<a> <b/> </a>`)).toEqual({ a: { b: "" } });
  });

  test("CDATA and references are just text", () => {
    expect(XML.parse(`<a><![CDATA[ <not markup> & ]]></a>`)).toEqual({ a: "<not markup> &" });
    expect(XML.parse(`<a>&lt;&#65;&#x42;<![CDATA[]]>&amp;</a>`)).toEqual({ a: "<AB&" });
  });

  test("comments and processing instructions are dropped everywhere", () => {
    expect(
      XML.parse(`<?xml version="1.0"?><!--c--><?pi data?><a><!--c-->x<?pi?>y<!--c--></a><!--c--><?pi z?>`),
    ).toEqual({ a: "xy" });
  });

  test("nothing is coerced: numbers, booleans and null-ish stay strings", () => {
    expect(XML.parse(`<a b="1"><n>1.0</n><t>true</t><z>null</z><e>1e3</e><h>0x10</h></a>`)).toEqual({
      a: { "@b": "1", n: "1.0", t: "true", z: "null", e: "1e3", h: "0x10" },
    });
  });

  test("names are kept verbatim, including prefixes and xmlns declarations", () => {
    expect(XML.parse(`<s:Envelope xmlns:s="urn:s"><s:Body xml:lang="en" s:id="1"/></s:Envelope>`)).toEqual({
      "s:Envelope": { "@xmlns:s": "urn:s", "s:Body": { "@xml:lang": "en", "@s:id": "1" } },
    });
    expect(XML.parse(`<日本 属性="値">テキスト</日本>`)).toEqual({ 日本: { "@属性": "値", "#text": "テキスト" } });
    expect(XML.parse(`<a b="𝄞">𐀀</a>`)).toEqual({ a: { "@b": "𝄞", "#text": "𐀀" } });
  });

  test("__proto__ and constructor are plain own data properties", () => {
    const result = XML.parse(`<__proto__ constructor="1"><__proto__>x</__proto__></__proto__>`) as any;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    const root = result["__proto__"];
    expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
    expect(Object.hasOwn(root, "__proto__")).toBe(true);
    expect(root["@constructor"]).toBe("1");
    expect(root["__proto__"]).toBe("x");
    expect(({} as any)["@constructor"]).toBeUndefined();
  });
});

describe("node shape", () => {
  test("root element as { name, attributes, children }, everything in document order", () => {
    expect(XML.parse(`<p class="x" id="y">Hello <b>big</b> world<br/></p>`, nodes)).toEqual({
      name: "p",
      attributes: { class: "x", id: "y" },
      children: [
        "Hello ",
        { name: "b", attributes: {}, children: ["big"] },
        " world",
        { name: "br", attributes: {}, children: [] },
      ],
    });
  });

  test("whitespace is kept exactly, adjacent text is one string", () => {
    expect(XML.parse(`<a>\n  <b> x </b>\n</a>`, nodes)).toEqual({
      name: "a",
      attributes: {},
      children: ["\n  ", { name: "b", attributes: {}, children: [" x "] }, "\n"],
    });
    expect(XML.parse(`<a>x<!--c--><![CDATA[y]]>&amp;<?p?>z</a>`, nodes)).toEqual({
      name: "a",
      attributes: {},
      children: ["xy&z"],
    });
  });

  test("attribute order is document order, defaults appended", () => {
    const node = XML.parse(`<!DOCTYPE a [<!ATTLIST a d CDATA "0" e CDATA "1">]><a z="1" b="2" e="3"/>`, nodes);
    expect(Object.entries(node.attributes)).toEqual([
      ["z", "1"],
      ["b", "2"],
      ["e", "3"],
      ["d", "0"],
    ]);
  });
});

describe("well-formedness", () => {
  test("errors are SyntaxErrors with a location-free message", () => {
    expect(syntaxError("").message).toBe("XML Parse error: XML document must have a root element");
    expect(syntaxError("<a>").message).toBe("XML Parse error: Missing closing tag for element 'a'");
    expect(syntaxError("<a></b>").message).toBe("XML Parse error: Expected closing tag </a> but found </b>");
    expect(syntaxError("<a/><b/>").message).toBe("XML Parse error: Only one root element is allowed");
    expect(syntaxError("<a/>junk").message).toBe("XML Parse error: Unexpected 'junk' after the root element");
    expect(syntaxError("junk<a/>").message).toBe("XML Parse error: Expected the root element but found 'junk'");
    expect(syntaxError(`<a b="1" b="2"/>`).message).toBe("XML Parse error: Duplicate attribute 'b'");
    expect(syntaxError(`<a b=1/>`).message).toBe("XML Parse error: Expected a quoted attribute value but found '1'");
    expect(syntaxError(`<a b/>`).message).toBe("XML Parse error: Expected '=' after the attribute name but found '/>'");
    expect(syntaxError(`<a b="<"/>`).message).toBe("XML Parse error: '<' is not allowed in attribute values");
    expect(syntaxError(`<A></a>`).message).toBe("XML Parse error: Expected closing tag </A> but found </a>");
    // A stray token is named where it stands, not scanned for what it might have started.
    expect(syntaxError(`<r/>\n'junk`).message).toBe("XML Parse error: Unexpected ''' after the root element");
    expect(syntaxError(`'<r/>`).message).toBe("XML Parse error: Expected the root element but found '''");
    expect(syntaxError(`<a <!--x--> b="1"/>`).message).toBe(
      "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found a comment",
    );
    expect(syntaxError(`<a %b;/>`).message).toBe(
      "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '%b;'",
    );
  });

  test("character rules", () => {
    expect(syntaxError("<a>\x00</a>").message).toBe(
      "XML Parse error: Invalid character in XML: control character 0x00",
    );
    expect(syntaxError("<a>\x1f</a>").message).toBe(
      "XML Parse error: Invalid character in XML: control character 0x1F",
    );
    expect(syntaxError("<a b='\x01'/>").message).toContain("Invalid character");
    expect(syntaxError("<a><!-- \x0c --></a>").message).toContain("Invalid character");
    expect(syntaxError("<a>￾</a>").message).toBe("XML Parse error: Invalid character in XML: '￾' (U+FFFE)");
    expect(syntaxError("<a>￿</a>").message).toContain("U+FFFF");
    expect(XML.parse("<a>\t\n\r �\u{10ffff}</a>")).toEqual({ a: "�\u{10ffff}" });
    // Bytes must be valid UTF-8; lone surrogates cannot be encoded.
    expect(syntaxError(Buffer.from([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e])).message).toBe(
      "XML Parse error: Invalid UTF-8",
    );
    expect(syntaxError(Buffer.from([0x3c, 0x61, 0x3e, 0xed, 0xa0, 0x80, 0x3c, 0x2f, 0x61, 0x3e])).message).toBe(
      "XML Parse error: Invalid UTF-8",
    );
    // Nor are lone surrogates characters when they arrive in a string; pairs are.
    expect(syntaxError("<a>\uD800</a>").message).toBe("XML Parse error: Invalid character in XML: U+D800");
    expect(syntaxError("<a b='\uDFFF'/>").message).toContain("U+DFFF");
    expect(syntaxError("<a>x\uD83Dy\uDE00</a>").message).toContain("U+D83D");
    expect(syntaxError(`<!DOCTYPE a [<!ENTITY e "\uDC00">]><a/>`).message).toContain("U+DC00");
    expect(syntaxError("<a>ok</a>\uD800").message).toContain("U+D800");
    expect(XML.parse("<a \u{1F600}='\u{1F600}'>\uD83D\uDE00</a>")).toEqual({
      a: { "@\u{1F600}": "\u{1F600}", "#text": "\u{1F600}" },
    });
  });

  test("character references must name a Char", () => {
    expect(XML.parse("<a>&#65;&#x1F600;&#0000009;</a>")).toEqual({ a: "A\u{1F600}" });
    for (const ref of [
      "&#0;",
      "&#x0;",
      "&#8;",
      "&#xB;",
      "&#xD800;",
      "&#xDFFF;",
      "&#xFFFE;",
      "&#x110000;",
      "&#99999999999999999999;",
    ]) {
      expect(syntaxError(`<a>${ref}</a>`).message).toContain("is not a valid XML character");
    }
    expect(syntaxError("<a>&#;</a>").message).toContain("Invalid character reference");
    expect(syntaxError("<a>&#x;</a>").message).toContain("Invalid character reference");
    expect(syntaxError("<a>&#1a;</a>").message).toContain("Invalid character reference");
    expect(syntaxError("<a>&# 1;</a>").message).toContain("Invalid character reference");
  });

  test("names", () => {
    expect(XML.parse("<_.-:0/>")).toEqual({ "_.-:0": "" });
    expect(XML.parse("<:a/>")).toEqual({ ":a": "" });
    expect(syntaxError("<0a/>").message).toBe("XML Parse error: Expected an element name after '<' but found '0'");
    expect(syntaxError("<-a/>").message).toContain("Expected an element name");
    expect(syntaxError("<a×/>").message).toBe(
      "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '×' (U+00D7)",
    );
    expect(syntaxError("< a/>").message).toContain("but found space");
    expect(syntaxError("<a>< /a>").message).toContain("but found space");
    expect(syntaxError("<a></ a>").message).toContain("but found space");
    expect(XML.parse("<a></a >")).toEqual({ a: "" });
    expect(XML.parse("<a\n\tb='1'\r\n/>")).toEqual({ a: { "@b": "1" } });
  });

  test("comments, CDATA and processing instructions", () => {
    expect(syntaxError("<a><!-- -- --></a>").message).toBe("XML Parse error: '--' is not allowed inside a comment");
    expect(syntaxError("<a><!--->").message).toContain("comment");
    expect(syntaxError("<a><!-- x").message).toBe("XML Parse error: Unterminated comment");
    expect(syntaxError("<a><![CDATA[x").message).toBe("XML Parse error: Unterminated CDATA section");
    expect(syntaxError("<a>x]]>y</a>").message).toBe(
      "XML Parse error: ']]>' is only allowed as the end of a CDATA section",
    );
    expect(XML.parse("<a>x]] >]></a>")).toEqual({ a: "x]] >]>" });
    expect(syntaxError("<![CDATA[x]]><a/>").message).toContain("CDATA sections are only allowed inside elements");
    expect(syntaxError("<a/><![CDATA[x]]>").message).toContain("CDATA sections are only allowed inside elements");
    expect(syntaxError("<a><?xml version='1.0'?></a>").message).toContain("'<?xml' is reserved");
    expect(syntaxError("<?XML version='1.0'?><a/>").message).toContain("'<?xml' is reserved");
    expect(syntaxError(" <?xml version='1.0'?><a/>").message).toContain("only allowed at the very start");
    expect(syntaxError("<a><? ?></a>").message).toContain("processing instruction target");
    expect(syntaxError("<a><?p").message).toContain("after the processing instruction target but found end of input");
    expect(syntaxError("<a><?p ").message).toBe("XML Parse error: Unterminated processing instruction");
    expect(syntaxError("<a><?p!?></a>").message).toContain("Expected whitespace or '?>'");
    expect(XML.parse("<?xml-stylesheet href='a'?><a><?p?><?p ?><?p x?y ?></a>")).toEqual({ a: "" });
  });

  test("XML declaration", () => {
    expect(XML.parse(`<?xml version="1.0"?><a/>`)).toEqual({ a: "" });
    expect(XML.parse(`<?xml version='1.0' encoding="UTF-8" standalone='yes' ?><a/>`)).toEqual({ a: "" });
    // XML 1.0 processors accept any 1.x and process it as 1.0 (§2.8, fifth edition).
    expect(XML.parse(`<?xml version="1.7"?><a/>`)).toEqual({ a: "" });
    expect(syntaxError(`<?xml version="2.0"?><a/>`).message).toBe(
      "XML Parse error: Unsupported XML version '2.0' (this is an XML 1.0 parser)",
    );
    expect(syntaxError(`<?xml version="1"?><a/>`).message).toContain("Unsupported XML version '1'");
    expect(syntaxError(`<?xml?><a/>`).message).toBe("XML Parse error: The XML declaration must specify the version");
    expect(syntaxError(`<?xml ?><a/>`).message).toBe("XML Parse error: The XML declaration must specify the version");
    expect(syntaxError(`<?xml encoding="UTF-8"?><a/>`).message).toBe(
      `XML Parse error: The XML declaration must start with version="1.0"`,
    );
    expect(syntaxError(`<?xml version="1.0" standalone="yes" encoding="UTF-8"?><a/>`).message).toContain(
      "Misplaced 'encoding'",
    );
    expect(syntaxError(`<?xml version="1.0" version="1.0"?><a/>`).message).toContain("Misplaced 'version'");
    expect(syntaxError(`<?xml version="1.0" foo="1"?><a/>`).message).toContain("Unexpected 'foo'");
    expect(syntaxError(`<?xml version="1.0" standalone="maybe"?><a/>`).message).toContain("expected yes or no");
    expect(syntaxError(`<?xml version="1.0"encoding="UTF-8"?><a/>`).message).toBe(
      "XML Parse error: Whitespace is required before 'encoding'",
    );
    expect(syntaxError(`<?xml version="1.0" encoding="UTF 8"?><a/>`).message).toContain("Invalid encoding name");
    expect(syntaxError(`<?xml version="1.0" encoding="8UTF"?><a/>`).message).toContain("Invalid encoding name '8UTF'");
    expect(syntaxError(`<?xml version="1.0"`).message).toContain("Unterminated XML declaration");
    expect(syntaxError(`<?xml VERSION="1.0"?><a/>`).message).toBe(
      `XML Parse error: Expected version="1.0" in the XML declaration but found 'VERSION'`,
    );
    expect(syntaxError(`<?xml vérsion="1.0"?><a/>`).message).toContain(`in the XML declaration but found 'vérsion'`);
    // The declaration is read before the bytes are known to be valid UTF-8.
    expect(syntaxError(Buffer.from([0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0xc3])).message).toContain("XML declaration");
    expect(syntaxError(Buffer.from([0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x76, 0xf0, 0x9f])).message).toContain(
      "XML declaration",
    );
    expect(syntaxError(Buffer.from([...Buffer.from(`<?xml version="1.`), 0xf0, 0x9f])).message).toBe(
      "XML Parse error: Invalid UTF-8",
    );
  });

  test("deep nesting is a catchable error, not a crash", () => {
    // Release frames are much smaller than debug/ASAN frames, so use a depth
    // no stack survives; the parse stops at the guard, so this stays cheap.
    const depth = 2_000_000;
    const doc = Buffer.alloc(depth * 3, "<a>").toString() + Buffer.alloc(depth * 4, "</a>").toString();
    expect(() => XML.parse(doc)).toThrow(RangeError);
    expect(() => XML.parse(doc, nodes)).toThrow(RangeError);
    const model = `<!DOCTYPE a [<!ELEMENT a ${Buffer.alloc(depth, "(").toString()}b${Buffer.alloc(depth, ")").toString()}>]><a/>`;
    expect(() => XML.parse(model)).toThrow(RangeError);
  });

  test("many attributes: duplicates and defaults are still exact past the pairwise limit", () => {
    const n = 2000;
    const attrs = Array.from({ length: n }, (_, i) => `a${i}="${i}"`).join(" ");
    const parsed = XML.parse(`<r ${attrs}/>`) as any;
    expect(Object.keys(parsed.r).length).toBe(n);
    expect(parsed.r["@a1999"]).toBe("1999");
    expect(syntaxError(`<r ${attrs} a0="dup"/>`).message).toBe("XML Parse error: Duplicate attribute 'a0'");
    expect(syntaxError(`<r ${attrs} a1234="dup"/>`).message).toBe("XML Parse error: Duplicate attribute 'a1234'");
    expect(syntaxError(`<r a="1" b="2" c="3" d="4" e="5" f="6" g="7" h="8" i="9" e="dup"/>`).message).toBe(
      "XML Parse error: Duplicate attribute 'e'",
    );
    const defaults = Array.from({ length: 20 }, (_, i) => `d${i} CDATA "${i}"`).join(" ");
    const withDefaults = XML.parse(
      `<!DOCTYPE r [<!ATTLIST r ${defaults} d5 CDATA "ignored">]><r ${attrs} d7="set"/>`,
    ) as any;
    expect(withDefaults.r["@d7"]).toBe("set");
    expect(withDefaults.r["@d5"]).toBe("5");
    expect(withDefaults.r["@d19"]).toBe("19");
    expect(Object.keys(withDefaults.r).length).toBe(n + 20);
  });

  test("'>' inside attribute values does not disturb what follows", () => {
    // A literal '>' in a value, then more attributes with whitespace to
    // normalize, characters to reject, and a long tail so the rest of the
    // tag is far from the '>' that started it.
    expect(XML.parse(`<a b="x>y" c="1\t2"\n d='p"q>' e="&amp;>"/>`)).toEqual({
      a: { "@b": "x>y", "@c": "1 2", "@d": 'p"q>', "@e": "&>" },
    });
    expect(syntaxError('<a b=">" c="\uFFFE"/>').message).toContain("U+FFFE");
    expect(syntaxError('<a b="1>2\x01"/>').message).toContain("control character 0x01");
    expect(syntaxError('<a b=">" c="<"/>').message).toContain("'<' is not allowed in attribute values");
    const pad = Buffer.alloc(20_000, "z").toString();
    expect(XML.parse(`<r><a b=">${pad}" c="v\tw">t</a><a d="q">${pad}</a></r>`)).toEqual({
      r: {
        a: [
          { "@b": ">" + pad, "@c": "v w", "#text": "t" },
          { "@d": "q", "#text": pad },
        ],
      },
    });
    expect(XML.parse(`<!DOCTYPE r [<!ATTLIST r x CDATA "1>2" y CDATA "a\tb">]><r/>`)).toEqual({
      r: { "@x": "1>2", "@y": "a b" },
    });
  });

  test("keys of every kind reach JS intact", () => {
    // Index-like, non-ASCII and long names, in both shapes.
    const doc = `<r _0="i" éé="n" ${"k".repeat(40)}="l"><_1>a</_1><ünïcödé>b</ünïcödé><${"w".repeat(64)}>c</${"w".repeat(64)}></r>`;
    const result = XML.parse(doc) as any;
    expect(result.r["@_0"]).toBe("i");
    expect(result.r["@éé"]).toBe("n");
    expect(result.r["@" + "k".repeat(40)]).toBe("l");
    expect(result.r._1).toBe("a");
    expect(result.r["ünïcödé"]).toBe("b");
    expect(result.r["w".repeat(64)]).toBe("c");
    expect(Object.keys(result.r)).toEqual(["@_0", "@éé", "@" + "k".repeat(40), "_1", "ünïcödé", "w".repeat(64)]);
    const node = XML.parse(doc, nodes) as any;
    expect(node.attributes).toEqual({ _0: "i", éé: "n", ["k".repeat(40)]: "l" });
    expect(node.children.map((c: any) => c.name)).toEqual(["_1", "ünïcödé", "w".repeat(64)]);
    // Values: empty, single characters, short repeated (cached) and long.
    expect(XML.parse(`<r><a></a><b>x</b><c>x</c><d>${"y".repeat(100)}</d><e>true</e><e>true</e></r>`)).toEqual({
      r: { a: "", b: "x", c: "x", d: "y".repeat(100), e: ["true", "true"] },
    });
  });

  test("wide elements: many distinct and many repeated children", () => {
    const n = 5_000;
    const doc = "<r>" + Array.from({ length: n }, (_, i) => `<k${i} a="${i}">${i}</k${i}>`).join("") + "</r>";
    const result = XML.parse(doc) as any;
    expect(Object.keys(result.r).length).toBe(n);
    expect(result.r.k4999).toEqual({ "@a": "4999", "#text": "4999" });
    const repeated = "<r>" + Buffer.alloc(n * 8, "<k>1</k>").toString() + "</r>";
    expect((XML.parse(repeated) as any).r.k.length).toBe(n);
    expect(XML.parse(repeated, nodes).children.length).toBe(n);
  });
});

describe("document type declaration", () => {
  test("the internal subset must be well-formed even though nothing is validated", () => {
    expect(XML.parse(`<!DOCTYPE a><a/>`)).toEqual({ a: "" });
    expect(XML.parse(`<!DOCTYPE a SYSTEM "a.dtd"><a/>`)).toEqual({ a: "" });
    expect(XML.parse(`<!DOCTYPE a PUBLIC "-//X//Y//EN" 'a.dtd' [ <!-- c --> <?pi?> ]><a/>`)).toEqual({ a: "" });
    // Invalid (root name mismatch, undeclared elements) but well-formed: accepted.
    expect(XML.parse(`<!DOCTYPE x [<!ELEMENT x (y)>]><a><b/></a>`)).toEqual({ a: { b: "" } });
    expect(syntaxError(`<!DOCTYPE a [ <!ELEMENT> ]><a/>`).message).toBe(
      "XML Parse error: Expected an element name after '<!ELEMENT' but found '>'",
    );
    expect(syntaxError(`<!DOCTYPE a [ <!ELEMENT a (b|c,d)> ]><a/>`).message).toContain("cannot mix ',' and '|'");
    expect(syntaxError(`<!DOCTYPE a [ <!ELEMENT a (#PCDATA|b)> ]><a/>`).message).toContain("must end with ')*'");
    expect(syntaxError(`<!DOCTYPE a [ <!ATTLIST a b CDATA > ]><a/>`).message).toContain(
      "#REQUIRED, #IMPLIED, #FIXED or a quoted default value",
    );
    expect(syntaxError(`<!DOCTYPE a [ <!ENTITY e> ]><a/>`).message).toBe(
      "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found '>'",
    );
    expect(syntaxError(`<!DOCTYPE a [ <![INCLUDE[]]> ]><a/>`).message).toContain("Conditional sections");
    expect(syntaxError(`<!DOCTYPE a [ junk ]><a/>`).message).toBe(
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found 'junk'",
    );
    expect(syntaxError(`<!DOCTYPE a [`).message).toContain("Unterminated internal subset");
    expect(syntaxError(`<!DOCTYPE a><!DOCTYPE a><a/>`).message).toBe(
      "XML Parse error: Only one document type declaration is allowed",
    );
    expect(syntaxError(`<a/><!DOCTYPE a>`).message).toBe(
      "XML Parse error: Unexpected '<!DOCTYPE' after the root element",
    );
    expect(syntaxError(`<!doctype a><a/>`).message).toContain("'<!' must begin a comment");
  });

  test("internal general entities are expanded, including markup, in content and attributes", () => {
    const doc = `<!DOCTYPE d [
      <!ENTITY plain "text">
      <!ENTITY markup "<b>bold</b> &plain;">
      <!ENTITY nl "line&#10;break">
    ]><d a="[&plain;] [&nl;]">&markup; &markup;</d>`;
    expect(XML.parse(doc)).toEqual({ d: { "@a": "[text] [line break]", b: ["bold", "bold"], "#text": "text  text" } });
    expect(XML.parse(doc, nodes).children).toEqual([
      { name: "b", attributes: {}, children: ["bold"] },
      " text ",
      { name: "b", attributes: {}, children: ["bold"] },
      " text",
    ]);
  });

  test("the first declaration of an entity is binding; predefined entities cannot be overridden", () => {
    expect(XML.parse(`<!DOCTYPE d [<!ENTITY e "1"><!ENTITY e "2"><!ENTITY lt "less">]><d>&e;&lt;</d>`)).toEqual({
      d: "1<",
    });
  });

  test("entity replacement text must be well-formed in context", () => {
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY e "</d><d>">]><d>&e;</d>`).message).toBe(
      "XML Parse error: Element 'd' must start and end within the same entity",
    );
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY e "<x>">]><d>&e;</x></d>`).message).toBe(
      "XML Parse error: Element 'x' must start and end within the same entity",
    );
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY e "<!-- x">]><d>&e; --></d>`).message).toBe(
      "XML Parse error: Unterminated comment",
    );
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY e "a<b">]><d x="&e;"/>`).message).toBe(
      "XML Parse error: '<' is not allowed in attribute values",
    );
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY a "&b;"><!ENTITY b "&a;">]><d>&a;</d>`).message).toBe(
      "XML Parse error: Entity 'a' refers to itself",
    );
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY a "&a;">]><d x="&a;"/>`).message).toBe(
      "XML Parse error: Entity 'a' refers to itself",
    );
    // A reference to an undeclared entity inside an entity value is only an
    // error when that entity is used (§4.4.7: bypassed at declaration).
    expect(XML.parse(`<!DOCTYPE d [<!ENTITY e "&nope;">]><d/>`)).toEqual({ d: "" });
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY e "&nope;">]><d>&e;</d>`).message).toBe(
      "XML Parse error: Entity 'nope' is not declared",
    );
    // The classic double escape from Appendix D of the spec.
    expect(
      XML.parse(
        `<!DOCTYPE d [<!ENTITY example "<p>An ampersand (&#38;#38;) may be escaped numerically (&#38;#38;#38;) or with a general entity (&amp;amp;).</p>">]><d>&example;</d>`,
      ),
    ).toEqual({
      d: { p: "An ampersand (&) may be escaped numerically (&#38;) or with a general entity (&amp;)." },
    });
  });

  test("attribute defaults and attribute-value normalization by declared type", () => {
    const doc = `<!DOCTYPE d [
      <!ATTLIST d id ID #IMPLIED tokens NMTOKENS " a  b " text CDATA " a  b " fixed CDATA #FIXED "f" req CDATA #REQUIRED>
      <!ATTLIST d text CDATA "ignored: first declaration wins">
      <!ATTLIST e n NMTOKEN #IMPLIED>
    ]><d id="  x  " other="  y  "><e n="
      z
    " c="
      z
    "/></d>`;
    expect(XML.parse(doc)).toEqual({
      d: {
        "@id": "x",
        "@other": "  y  ",
        "@tokens": "a b",
        "@text": " a  b ",
        "@fixed": "f",
        e: { "@n": "z", "@c": "       z     " },
      },
    });
  });

  test("attribute values: whitespace characters become spaces, character references do not", () => {
    expect(XML.parse(`<d a="x\ty\nz\r\nw"/>`)).toEqual({ d: { "@a": "x y z w" } });
    expect(XML.parse(`<d a="x&#9;y&#10;z&#13;w"/>`)).toEqual({ d: { "@a": "x\ty\nz\rw" } });
    // Whitespace inside an entity's replacement text is normalized where it
    // is used (§3.3.3 and the table in Appendix E)...
    expect(
      XML.parse(
        `<!DOCTYPE d [<!ENTITY d "&#xD;"><!ENTITY a "&#xA;"><!ENTITY da "&#xD;&#xA;">]><d x="&d;&d;A&a;&#x20;&a;B&da;"/>`,
      ),
    ).toEqual({
      d: { "@x": "  A   B  " },
    });
    // ...unless it got there as a character reference to a character reference.
    expect(XML.parse(`<!DOCTYPE d [<!ENTITY nl "&#38;#10;">]><d x="a&nl;b"/>`)).toEqual({ d: { "@x": "a\nb" } });
  });

  test("internal parameter entities are expanded between declarations", () => {
    const doc = `<!DOCTYPE d [
      <!ENTITY % decls "<!ENTITY e 'from pe'><!ATTLIST d a CDATA 'default'>">
      %decls;
    ]><d>&e;</d>`;
    expect(XML.parse(doc)).toEqual({ d: { "@a": "default", "#text": "from pe" } });
    // In the internal subset parameter entities may only appear between declarations.
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY % v "'x'"><!ENTITY e %v;>]><d/>`).message).toBe(
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY % v "x"><!ENTITY e "%v;">]><d/>`).message).toContain(
      "Parameter entity references are not allowed inside markup declarations",
    );
    // ...and must contain whole declarations.
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY % half "<!ENTITY e 'x'">%half;>]><d/>`).message).toBe(
      "XML Parse error: A markup declaration must begin and end in the same entity",
    );
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY % e "]"> %e; ]><d/>`).message).toBe(
      "XML Parse error: ']' inside a parameter entity cannot close the internal subset",
    );
    // Inside replacement text, though, a reference may stand for any tokens of a
    // declaration (here: the system literal), as in the external subset.
    expect(
      XML.parse(`<!DOCTYPE d [<!ENTITY % l "'x.dtd'"><!ENTITY % decl "<!ENTITY e SYSTEM &#37;l;>">%decl;]><d>&e;</d>`),
    ).toEqual({ d: "&e;" });
    // `<!ENTITY %name` reads as a declaration missing its space, not as a reference.
    expect(syntaxError(`<!DOCTYPE d [<!ENTITY %e "x">]><d/>`).message).toBe(
      "XML Parse error: Whitespace is required between '%' and the name in a parameter entity declaration",
    );
  });

  describe("external entities are never loaded", () => {
    test("an external subset or unread parameter entity turns undeclared entities into kept references", () => {
      // Without a DTD (or with standalone="yes") an undeclared entity is a well-formedness error...
      expect(syntaxError(`<a>&nbsp;</a>`).message).toBe("XML Parse error: Entity 'nbsp' is not declared");
      expect(syntaxError(`<!DOCTYPE a [<!ENTITY x "y">]><a>&nbsp;</a>`).message).toBe(
        "XML Parse error: Entity 'nbsp' is not declared",
      );
      expect(
        syntaxError(`<?xml version="1.0" standalone="yes"?><!DOCTYPE html SYSTEM "xhtml.dtd"><a>&nbsp;</a>`).message,
      ).toBe("XML Parse error: Entity 'nbsp' is not declared");
      // ...but when the declaration could be in the part of the DTD that is not
      // loaded it is only a validity error, and the reference is kept as text.
      expect(XML.parse(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "x.dtd"><p>a&nbsp;b</p>`)).toEqual({
        p: "a&nbsp;b",
      });
      expect(XML.parse(`<!DOCTYPE p [<!ENTITY % ext SYSTEM "x.ent">%ext;]><p title="&t;">&t;</p>`)).toEqual({
        p: { "@title": "&t;", "#text": "&t;" },
      });
    });

    test("declared external entities are kept as references in content and rejected in attributes", () => {
      const dtd = `<!DOCTYPE d [<!ENTITY ext SYSTEM "file:///etc/passwd"><!ENTITY pub PUBLIC "-//X//Y" "http://example.com/e.xml">]>`;
      expect(XML.parse(`${dtd}<d>&ext;|&pub;</d>`)).toEqual({ d: "&ext;|&pub;" });
      expect(syntaxError(`${dtd}<d a="&ext;"/>`).message).toBe(
        "XML Parse error: Attribute values cannot reference external entity 'ext'",
      );
    });

    test("unparsed entities cannot be referenced at all", () => {
      expect(
        syntaxError(`<!DOCTYPE d [<!NOTATION gif SYSTEM "gif"><!ENTITY img SYSTEM "a.gif" NDATA gif>]><d>&img;</d>`)
          .message,
      ).toBe("XML Parse error: Unparsed entity 'img' cannot be referenced");
    });

    test("declarations after an unread parameter entity are not processed unless standalone", () => {
      const doc = (standalone: string) =>
        `<?xml version="1.0" standalone="${standalone}"?><!DOCTYPE d [
          <!ATTLIST d before CDATA "1">
          <!ENTITY % ext SYSTEM "ext.ent">
          %ext;
          <!ATTLIST d after CDATA "2">
          <!ENTITY e "after">
        ]><d/>`;
      expect(XML.parse(doc("no"))).toEqual({ d: { "@before": "1" } });
      expect(XML.parse(doc("yes"))).toEqual({ d: { "@before": "1", "@after": "2" } });
    });
  });

  test("entity expansion is bounded (billion laughs)", () => {
    let decls = `<!ENTITY l0 "ha">`;
    for (let i = 1; i <= 12; i++)
      decls += `<!ENTITY l${i} "${Buffer.alloc(10 * `&l${i - 1};`.length, `&l${i - 1};`)}">`;
    expect(syntaxError(`<!DOCTYPE d [${decls}]><d>&l12;</d>`).message).toBe(
      "XML Parse error: Entity expansion exceeds the amplification limit",
    );
    expect(syntaxError(`<!DOCTYPE d [${decls}]><d a="&l12;"/>`).message).toBe(
      "XML Parse error: Entity expansion exceeds the amplification limit",
    );
    // Heavy but honest use of entities is fine.
    const big = Buffer.alloc(50_000, "x").toString();
    const result = XML.parse(`<!DOCTYPE d [<!ENTITY e "${big}">]><d>${Buffer.alloc(3 * 40, "&e;")}</d>`) as any;
    expect(result.d.length).toBe(40 * 50_000);
  });
});

describe("encodings", () => {
  const text = `<doc attr="café">naïve – 日本</doc>`;
  const expected = { doc: { "@attr": "café", "#text": "naïve – 日本" } };

  test("strings are already decoded: the encoding declaration is checked but not applied", () => {
    expect(XML.parse(`<?xml version="1.0" encoding="ISO-8859-1"?>${text}`)).toEqual(expected);
    // ...including values that get coerced to a string.
    expect(XML.parse(new String(`<?xml version="1.0" encoding="ISO-8859-1"?>${text}`) as any)).toEqual(expected);
    expect(XML.parse({ toString: () => `<?xml version="1.0" encoding="UTF-16"?>${text}` } as any)).toEqual(expected);
    expect(XML.parse(`<?xml version="1.0" encoding="UTF-16"?>${text}`)).toEqual(expected);
    expect(XML.parse(`<?xml version="1.0" encoding="x-anything"?>${text}`)).toEqual(expected);
    expect(XML.parse(`﻿${text}`)).toEqual(expected);
    expect(syntaxError(`<?xml version="1.0" encoding="not valid"?>${text}`).message).toContain("Invalid encoding name");
  });

  test("UTF-8 bytes, with or without a BOM or declaration", () => {
    expect(syntaxError(Buffer.from([0x3c, 0x80, 0x61, 0x2f, 0x3e])).message).toBe("XML Parse error: Invalid UTF-8");
    expect(
      syntaxError(Buffer.concat([Buffer.from(`<?xml version="1.0"?>`), Buffer.from([0x3c, 0x80, 0x61, 0x2f, 0x3e])]))
        .message,
    ).toBe("XML Parse error: Invalid UTF-8");
    expect(XML.parse(Buffer.from(text))).toEqual(expected);
    expect(XML.parse(Buffer.from("﻿" + text))).toEqual(expected);
    expect(XML.parse(Buffer.from(`<?xml version="1.0" encoding="utf-8"?>${text}`))).toEqual(expected);
  });

  test("UTF-16 bytes in either byte order, by BOM or by declaration", () => {
    const le = Buffer.from("﻿" + text, "utf16le");
    const be = Buffer.from(le).swap16();
    expect(XML.parse(le)).toEqual(expected);
    expect(XML.parse(be)).toEqual(expected);
    const declared = `<?xml version="1.0" encoding="UTF-16"?>${text}`;
    expect(XML.parse(Buffer.from(declared, "utf16le"))).toEqual(expected);
    expect(XML.parse(Buffer.from(declared.replace("UTF-16", "Utf-16le"), "utf16le"))).toEqual(expected);
    expect(XML.parse(Buffer.from(declared, "utf16le").swap16())).toEqual(expected);
    expect(syntaxError(Buffer.from(text, "utf16le")).message).toBe(
      `XML Parse error: UTF-16 input must start with a byte-order mark or declare encoding="UTF-16"`,
    );
    // A lone surrogate is not decodable.
    const bad = Buffer.from("﻿<a>x</a>", "utf16le");
    bad[6] = 0x00;
    bad[7] = 0xd8;
    expect(syntaxError(bad).message).toBe("XML Parse error: Invalid UTF-16");
  });

  test("ISO-8859-1 bytes by declaration", () => {
    expect(
      XML.parse(Buffer.from(`<?xml version='1.0' encoding="ISO-8859-1"?><doc attr="caf\xe9">na\xefve</doc>`, "latin1")),
    ).toEqual({
      doc: { "@attr": "café", "#text": "naïve" },
    });
    expect(XML.parse(Buffer.from(`<?xml version='1.0' encoding="latin1"?><d>\xff</d>`, "latin1"))).toEqual({ d: "ÿ" });
    // Transcoding restarts the buffer; that must not make a second declaration legal.
    expect(
      syntaxError(Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?><?xml version="1.0"?><r>\xe9</r>`, "latin1"))
        .message,
    ).toContain("'<?xml' is reserved for the XML declaration");
  });

  test("mismatches between the bytes and the declaration are errors", () => {
    expect(syntaxError(Buffer.from(`<?xml version="1.0" encoding="UTF-16"?><a/>`)).message).toBe(
      "XML Parse error: Document is not UTF-16 but declares encoding 'UTF-16'",
    );
    expect(syntaxError(Buffer.from(`﻿<?xml version="1.0" encoding="UTF-8"?><a/>`, "utf16le")).message).toBe(
      "XML Parse error: Document is UTF-16 but declares encoding 'UTF-8'",
    );
    expect(syntaxError(Buffer.from(`﻿<?xml version="1.0" encoding="ISO-8859-1"?><a/>`)).message).toBe(
      "XML Parse error: Document has a UTF-8 byte-order mark but declares encoding 'ISO-8859-1'",
    );
    expect(syntaxError(Buffer.from(`<?xml version="1.0" encoding="Shift_JIS"?><a/>`)).message).toBe(
      "XML Parse error: Unsupported encoding 'Shift_JIS' (supported: UTF-8, UTF-16, ISO-8859-1)",
    );
    expect(syntaxError(Buffer.from(`<a>caf\xe9</a>`, "latin1")).message).toBe("XML Parse error: Invalid UTF-8");
  });
});

describe("XML.stringify", () => {
  test("compact objects", () => {
    expect(XML.stringify({ a: "" })).toBe("<a/>");
    expect(XML.stringify({ a: null })).toBe("<a/>");
    expect(XML.stringify({ a: {} })).toBe("<a/>");
    expect(XML.stringify({ a: "text" })).toBe("<a>text</a>");
    expect(XML.stringify({ a: 1.5 })).toBe("<a>1.5</a>");
    expect(XML.stringify({ a: false })).toBe("<a>false</a>");
    expect(XML.stringify({ a: 10n })).toBe("<a>10</a>");
    expect(XML.stringify({ a: new Date(0) })).toBe("<a>1970-01-01T00:00:00.000Z</a>");
    expect(XML.stringify({ a: { "@x": 1, "@y": "two", "@n": null, "@u": undefined } })).toBe(`<a x="1" y="two"/>`);
    expect(XML.stringify({ a: { "#text": "t" } })).toBe("<a>t</a>");
    expect(XML.stringify({ a: { "@x": "1", "#text": "t" } })).toBe(`<a x="1">t</a>`);
    expect(XML.stringify({ a: { b: ["1", "2", null, ""], c: { d: "e" } } })).toBe(
      "<a><b>1</b><b>2</b><b/><b/><c><d>e</d></c></a>",
    );
    // Children and text are written in key order; attributes always land on the start tag.
    expect(XML.stringify({ a: { "#text": "t", b: "1", "@z": "last" } })).toBe(`<a z="last">t<b>1</b></a>`);
    // Skipped values, and arrays holding only skipped values, are not content.
    expect(XML.stringify({ a: { b: undefined, c: () => {}, d: Symbol("s"), e: "kept" } })).toBe("<a><e>kept</e></a>");
    expect(XML.stringify({ a: { b: [] } })).toBe("<a/>");
    expect(XML.stringify({ a: { b: [undefined, () => {}] } })).toBe("<a/>");
    expect(XML.stringify({ a: { b: [undefined], c: [] } }, null, 2)).toBe("<a/>");
    expect(XML.stringify({ a: { b: [undefined, "x"] } }, null, 2)).toBe("<a>\n  <b>x</b>\n</a>");
    expect(XML.stringify({ skip: undefined, a: "1" } as any)).toBe("<a>1</a>");
  });

  test("nodes", () => {
    expect(XML.stringify({ name: "a", attributes: {}, children: [] })).toBe("<a/>");
    expect(XML.stringify({ name: "a", children: [] })).toBe("<a/>");
    expect(XML.stringify({ name: "a", attributes: { x: "1" } })).toBe(`<a x="1"/>`);
    expect(XML.stringify({ name: "a", attributes: null, children: null } as any)).toBe(`<a/>`);
    expect(
      XML.stringify({
        name: "p",
        attributes: { class: "x" },
        children: ["Hello ", { name: "b", children: ["big", 1, true] }, " world", { name: "br" }, null, undefined],
      }),
    ).toBe(`<p class="x">Hello <b>big1true</b> world<br/></p>`);
    // A top-level object needs children or attributes to be taken as a node
    // (present counts, even holding undefined)...
    expect(XML.stringify({ name: "a" })).toBe("<name>a</name>");
    expect(XML.stringify({ name: "br", attributes: undefined, children: undefined })).toBe("<br/>");
    class El {
      constructor(
        public name: string,
        public kids: string[],
      ) {}
      get children() {
        return this.kids;
      }
    }
    expect(XML.stringify(new El("i", ["x"]))).toBe("<i>x</i>");
    // ...inside children any object is a node.
    expect(() => XML.stringify({ name: "a", children: [{ foo: "bar" }] } as any)).toThrow("with a string name");
    expect(() => XML.stringify({ name: "a", children: "text" } as any)).toThrow("children must be an array");
    expect(() => XML.stringify({ name: "a", children: [], attributes: [] } as any)).toThrow(
      "attributes must be an object",
    );
    expect(() => XML.stringify({ name: "a", children: [["nested"]] } as any)).toThrow("cannot contain arrays");
    expect(() => XML.stringify({ name: "a", children: [], attributes: { x: {} } } as any)).toThrow(
      "an attribute value must be",
    );
  });

  test("escaping keeps the document well-formed and round-trippable", () => {
    expect(XML.stringify({ a: `<&>'"` })).toBe(`<a>&lt;&amp;&gt;'"</a>`);
    expect(XML.stringify({ a: { "@v": `<&>'"` } })).toBe(`<a v="&lt;&amp;&gt;'&quot;"/>`);
    expect(XML.stringify({ a: "]]>" })).toBe("<a>]]&gt;</a>");
    // Whitespace that a parser would normalize away is written as references.
    expect(XML.stringify({ a: { "@v": "a\tb\nc\rd  e" } })).toBe(`<a v="a&#x9;b&#xA;c&#xD;d  e"/>`);
    expect(XML.stringify({ a: "a\tb\nc\r\nd" })).toBe("<a>a\tb\nc&#xD;\nd</a>");
    expect(XML.parse(XML.stringify({ a: { "@v": "a\tb\nc\rd  e", "#text": "x\r\ny" } }))).toEqual({
      a: { "@v": "a\tb\nc\rd  e", "#text": "x\r\ny" },
    });
    expect(XML.stringify({ a: { "@b": "𝄞", "#text": "\u{10000}é" } })).toBe(`<a b="𝄞">\u{10000}é</a>`);
  });

  test("what XML cannot represent throws", () => {
    expect(() => XML.stringify({ a: "\0" })).toThrow("XML cannot represent the character U+0000");
    expect(() => XML.stringify({ a: { "@b": "\x01" } })).toThrow("U+0001");
    expect(() => XML.stringify({ a: "￾" })).toThrow("U+FFFE");
    expect(() => XML.stringify({ a: "\ud800" })).toThrow("U+D800");
    expect(() => XML.stringify({ a: "a\udc00b" })).toThrow("U+DC00");
    for (const bad of ["", "1a", "-a", ".a", "a b", "a>", "a/", "×"]) {
      expect(() => XML.stringify({ [bad]: "x" })).toThrow("is not a valid XML element name");
      expect(() => XML.stringify({ a: { ["@" + bad]: "x" } })).toThrow("is not a valid XML attribute name");
      expect(() => XML.stringify({ name: bad, children: [] })).toThrow("is not a valid XML element name");
    }
    expect(XML.stringify({ "_a-b.c:d·": { "@xml:lang": "en", 名前: "v" } })).toBe(
      `<_a-b.c:d· xml:lang="en"><名前>v</名前></_a-b.c:d·>`,
    );
    expect(() => XML.stringify({ a: { "#comment": "x" } })).toThrow("keys starting with '#' are reserved");
    expect(() => XML.stringify({ a: { b: [["x"]] } })).toThrow("nested arrays");
    expect(() => XML.stringify({ a: { b: { c: {} } }, extra: "1" })).toThrow("more than one key");
    expect(() => XML.stringify({ a: ["1", "2"] })).toThrow("cannot be an array");
    expect(() => XML.stringify({})).toThrow("must have one key naming the root element");
    expect(() => XML.stringify({ "@a": "1" })).toThrow("can only contain the root element");
    expect(() => XML.stringify({ "#text": "1" })).toThrow("can only contain the root element");
    // In element position an object is an element; its function-valued keys are skipped.
    expect(XML.stringify({ a: { b: { toString: () => "no" } } as any })).toBe("<a><b/></a>");
    expect(() => XML.stringify({ a: { "@b": { toString: () => "no" } } as any })).toThrow("an attribute value must be");
    expect(() => XML.stringify({ a: Symbol("s") as any })).toThrow("must have one key");
    const circular: any = { a: { b: {} } };
    circular.a.b.c = circular.a;
    expect(() => XML.stringify(circular)).toThrow("Converting circular structure to XML");
    const node: any = { name: "a", children: [] };
    node.children.push(node);
    expect(() => XML.stringify(node)).toThrow("Converting circular structure to XML");
    const shared = { c: "1" };
    expect(XML.stringify({ a: { b: [shared, shared], d: shared } })).toBe(
      "<a><b><c>1</c></b><b><c>1</c></b><d><c>1</c></d></a>",
    );
    expect(() => XML.stringify({ a: new Date(NaN) })).toThrow("invalid Date");
  });

  test("signature parity with JSON.stringify", () => {
    expect(XML.stringify(undefined)).toBeUndefined();
    expect(XML.stringify(() => {})).toBeUndefined();
    expect(XML.stringify(Symbol("s"))).toBeUndefined();
    expect(() => XML.stringify(null)).toThrow("expects an object");
    expect(() => XML.stringify("x")).toThrow("expects an object");
    expect(() => XML.stringify([{ a: 1 }])).toThrow("expects an object");
    expect(() => XML.stringify({ a: "1" }, (() => 1) as any)).toThrow("does not support the replacer");
    expect(() => XML.stringify({ a: "1" }, ["a"] as any)).toThrow("does not support the replacer");
    expect(XML.stringify({ a: "1" }, null)).toBe("<a>1</a>");
    expect(() => XML.stringify(new String("<a/>") as any)).toThrow("expects an object");
  });

  test("space indents element-only content and leaves text content inline", () => {
    // Repeated children inside mixed content stay inline too.
    expect(XML.stringify({ p: { "#text": "hi", b: ["1", "2"] } }, null, 2)).toBe("<p>hi<b>1</b><b>2</b></p>");
    expect(XML.stringify({ root: { p: { "#text": "hi", b: ["1", "2"] } } }, null, 2)).toBe(
      "<root>\n  <p>hi<b>1</b><b>2</b></p>\n</root>",
    );
    const value = {
      root: { "@id": "1", list: { item: ["a", "b"], empty: [] }, mixed: { b: "x", "#text": "t" }, leaf: "" },
    };
    expect(XML.stringify(value, null, 2)).toBe(
      `<root id="1">\n  <list>\n    <item>a</item>\n    <item>b</item>\n  </list>\n  <mixed><b>x</b>t</mixed>\n  <leaf/>\n</root>`,
    );
    expect(XML.stringify(value, null, "\t")).toBe(XML.stringify(value, null, 2).replaceAll("  ", "\t"));
    expect(XML.stringify(value, null, 100)).toBe(XML.stringify(value, null, 10));
    expect(XML.stringify(value, null, "abcdefghijklmnop")).toBe(
      XML.stringify(value, null, 10).replaceAll("          ", "abcdefghij"),
    );
    for (const minified of [0, -1, NaN, "", null, undefined, true, {}]) {
      expect(XML.stringify(value, null, minified as any)).toBe(XML.stringify(value));
    }
    const node = XML.parse(`<a><b><c>1</c></b><d/></a>`, nodes);
    expect(XML.stringify(node, null, 1)).toBe("<a>\n <b>\n  <c>1</c>\n </b>\n <d/>\n</a>");
    // Whitespace-only text children still count as text: the tree round-trips exactly.
    const spaced = XML.parse(`<a>\n  <b/>\n</a>`, nodes);
    expect(XML.stringify(spaced, null, 4)).toBe(`<a>\n  <b/>\n</a>`);
  });

  test("parse(stringify(x)) round-trips both shapes", () => {
    const docs = [
      `<a/>`,
      `<a x="1" y="">t</a>`,
      `<r><a>1</a><b><c d="1"><e/></c></b><a>2</a></r>`,
      `<p>Hello <b>big</b> <i>w</i>orld!</p>`,
      `<d a="1&#10;2&#9;3&#13;4  5">x&#13;y]]&gt;z&lt;&amp;</d>`,
      `<!DOCTYPE d [<!ENTITY e "<i>e</i>"><!ATTLIST d z NMTOKENS " a b ">]><d>&e;&e;<__proto__/></d>`,
      `<s:Envelope xmlns:s="urn:s"><s:Body 日本="語"/></s:Envelope>`,
    ];
    for (const doc of docs) {
      const compact = XML.parse(doc);
      expect(XML.parse(XML.stringify(compact))).toEqual(compact);
      expect(XML.parse(XML.stringify(compact, null, 2))).toEqual(compact);
      const node = XML.parse(doc, nodes);
      expect(XML.parse(XML.stringify(node), nodes)).toEqual(node);
      // Pretty-printing element-only content adds whitespace text nodes, so
      // compare through the compact projection instead.
      expect(XML.parse(XML.stringify(node, null, 2))).toEqual(compact);
    }
  });

  test("deep values are a catchable error", () => {
    // Must overflow on every build: release frames are far smaller than
    // debug/ASAN ones, so use a depth no native stack survives.
    const depth = 1_000_000;
    let deep: any = "x";
    for (let i = 0; i < depth; i++) deep = { a: deep };
    expect(() => XML.stringify(deep)).toThrow(RangeError);
    deep = undefined;
    let node: any = { name: "a", children: ["x"] };
    for (let i = 0; i < depth; i++) node = { name: "a", children: [node] };
    expect(() => XML.stringify(node)).toThrow(RangeError);
  });
});
