import {
  CDATASection,
  Comment,
  DOMParser,
  Document,
  DocumentType,
  Element,
  HTMLElement,
  ProcessingInstruction,
  SVGElement,
  Text,
  Window,
  XMLDocument,
  XMLSerializer,
} from "bun:dom";
import { describe, expect, test } from "bun:test";

const xhtmlNamespace = "http://www.w3.org/1999/xhtml";
const svgNamespace = "http://www.w3.org/2000/svg";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";
const xmlTypes = ["text/xml", "application/xml", "application/xhtml+xml", "image/svg+xml"] as const;
const xhtmlDoctype = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">`;

const parse = (text: string, type: (typeof xmlTypes)[number] = "text/xml") =>
  new DOMParser().parseFromString(text, type);
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);
const named = (name: string) => expect.objectContaining({ name });

/** The document, after a check that the text was well-formed. */
function parseWellFormed(text: string, type?: (typeof xmlTypes)[number]) {
  const document = parse(text, type);
  expect(document.querySelector("parsererror")?.textContent).toBeUndefined();
  return document;
}

/** What the <parsererror> of a text that is not well-formed says. */
function errorOf(text: string, type?: (typeof xmlTypes)[number]) {
  const document = parse(text, type);
  const errors = document.getElementsByTagName("parsererror");
  expect(errors.length).toBe(1);
  expect(document.querySelector("parsererror")).toBe(errors[0]);
  return errors[0].querySelector("div")!.textContent;
}

const describeNode = (node: Node) => [node.nodeType, node.nodeName, node.nodeValue];

describe("the document", () => {
  test.each(xmlTypes)("of type %s", type => {
    const document = parseWellFormed("<foo/>", type);
    expect(document).toBeInstanceOf(XMLDocument);
    expect(document).toBeInstanceOf(Document);
    expect([document.contentType, document.characterSet, document.compatMode, document.readyState]).toEqual([
      type,
      "UTF-8",
      "CSS1Compat",
      "complete",
    ]);
    expect(document.defaultView).toBeNull();
    const root = document.documentElement;
    expect(document.childNodes.length).toBe(1);
    expect(root.ownerDocument).toBe(document);
    expect([root.namespaceURI, root.prefix, root.localName, root.tagName]).toEqual([null, null, "foo", "foo"]);
    expect(root).toBeInstanceOf(Element);
    expect(root).not.toBeInstanceOf(HTMLElement);
  });

  test("any other type is a TypeError", () => {
    parseWellFormed("<a/>");
    for (const type of ["text/plain", "application/rss+xml", "TEXT/XML", ""])
      expect(() => new DOMParser().parseFromString("<a/>", type as "text/xml")).toThrow(TypeError);
  });

  test("has the URL of the window of its DOMParser", () => {
    const window = new Window({ url: "https://example.com/dir/page" });
    const document = new window.DOMParser().parseFromString(`<a href="x"/>`, "text/xml");
    expect([document.URL, document.baseURI, document.defaultView]).toEqual([
      "https://example.com/dir/page",
      "https://example.com/dir/page",
      null,
    ]);
    expect(document).toBeInstanceOf(window.XMLDocument);
  });

  test("names keep their case", () => {
    const document = parseWellFormed(`<Root><Item ID="a" id="b"/><item/></Root>`);
    const [upper, lower] = document.documentElement.children;
    expect([upper.tagName, lower.tagName]).toEqual(["Item", "item"]);
    for (const [name, expected] of [
      ["Item", [upper]],
      ["item", [lower]],
      ["ITEM", []],
    ] as const) {
      expect(Array.from(document.getElementsByTagName(name))).toEqual(expected);
      expect(Array.from(document.querySelectorAll(name))).toEqual(expected);
    }
    expect([upper.getAttribute("ID"), upper.getAttribute("id"), upper.getAttribute("Id")]).toEqual(["a", "b", null]);
    expect(document.querySelector("[Id]")).toBeNull();
    expect(document.getElementById("b")).toBe(upper);
    expect(document.getElementById("a")).toBeNull();

    const created = document.createElement("Foo");
    expect([created.localName, created.tagName, created.namespaceURI]).toEqual(["Foo", "Foo", null]);
    created.setAttribute("Bar", "1");
    expect(created.attributes[0].name).toBe("Bar");
  });

  test("white space outside the root element is dropped, inside it is kept", () => {
    const document = parseWellFormed("\n <a> <b/>\n</a>\n ");
    expect(Array.from(document.childNodes, describeNode)).toEqual([[1, "a", null]]);
    expect(Array.from(document.documentElement.childNodes, describeNode)).toEqual([
      [3, "#text", " "],
      [1, "b", null],
      [3, "#text", "\n"],
    ]);
  });

  test("a byte order mark at the start is dropped", () => {
    expect(serialize(parseWellFormed("\uFEFF<a/>"))).toBe("<a/>");
    expect(serialize(parseWellFormed(`\uFEFF<?xml version="1.0"?><a>\uFEFF</a>`))).toBe(
      `<?xml version="1.0"?><a>\uFEFF</a>`,
    );
  });

  test("the XML declaration", () => {
    const declared = (document: Document) => {
      const { xmlVersion, xmlEncoding, xmlStandalone } = document as any;
      return [xmlVersion, xmlEncoding, xmlStandalone];
    };
    expect(declared(parseWellFormed("<a/>"))).toEqual(["1.0", null, false]);
    expect(declared(parseWellFormed(`<?xml version="1.0"?><a/>`))).toEqual(["1.0", null, false]);

    // The text is a string: the encoding that it names decodes nothing.
    const text = `<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?><a>é€</a>`;
    const document = parseWellFormed(text);
    expect(declared(document)).toEqual(["1.0", "ISO-8859-1", true]);
    expect([document.characterSet, document.contentType]).toEqual(["UTF-8", "text/xml"]);
    expect(document.documentElement.textContent).toBe("é€");
    expect(document.childNodes.length).toBe(1);
    expect(serialize(document)).toBe(text);

    expect(serialize(parseWellFormed(`<?xml version='1.0' standalone='no' ?><a/>`))).toBe(
      `<?xml version="1.0" standalone="no"?><a/>`,
    );
    expect(errorOf(` <?xml version="1.0"?><a/>`)).toContain("only allowed at the very start of the document");
    expect(errorOf(`<?xml encoding="UTF-8"?><a/>`)).toContain("must start with version");
    expect(errorOf(`<?xml version="2.0"?><a/>`)).toContain("Unsupported XML version '2.0'");
  });
});

describe("nodes", () => {
  test("every kind", () => {
    const text = `<a x="1">t<b/>&amp;<![CDATA[<c>&amp;]]><!-- c --><?p  d e ?></a>`;
    const nodes = Array.from(parseWellFormed(text).documentElement.childNodes);
    expect(nodes.map(describeNode)).toEqual([
      [3, "#text", "t"],
      [1, "b", null],
      [3, "#text", "&"],
      [4, "#cdata-section", "<c>&amp;"],
      [8, "#comment", " c "],
      [7, "p", "d e "],
    ]);
    expect(nodes.map(node => node.constructor)).toEqual([
      Text,
      Element,
      Text,
      CDATASection,
      Comment,
      ProcessingInstruction,
    ]);
    expect(nodes[3]).toBeInstanceOf(Text);
    expect((nodes[5] as ProcessingInstruction).target).toBe("p");
    expect((nodes[5] as ProcessingInstruction).data).toBe("d e ");
  });

  test("a CDATA section is a node of its own", () => {
    const { documentElement } = parseWellFormed(`<a>x<![CDATA[y]]>z<![CDATA[]]><![CDATA[]]]]><![CDATA[>]]></a>`);
    expect(Array.from(documentElement.childNodes, describeNode)).toEqual([
      [3, "#text", "x"],
      [4, "#cdata-section", "y"],
      [3, "#text", "z"],
      [4, "#cdata-section", ""],
      [4, "#cdata-section", "]]"],
      [4, "#cdata-section", ">"],
    ]);
    expect(documentElement.textContent).toBe("xyz]]>");
  });

  test("comments and processing instructions around the root element", () => {
    const text = `<?xml-stylesheet href="a.css"?><!--x--><!DOCTYPE a><!--y--><a/><!--z--><?q r?>`;
    const document = parseWellFormed(text);
    expect(Array.from(document.childNodes, describeNode)).toEqual([
      [7, "xml-stylesheet", `href="a.css"`],
      [8, "#comment", "x"],
      [10, "a", null],
      [8, "#comment", "y"],
      [1, "a", null],
      [8, "#comment", "z"],
      [7, "q", "r"],
    ]);
    expect(serialize(document)).toBe(text);
  });

  test("long text is one node", () => {
    for (const text of ["a".repeat(200_000), "\u4e00".repeat(200_000)]) {
      const { documentElement } = parseWellFormed(`<a>${text}</a>`);
      expect(documentElement.childNodes.length).toBe(1);
      expect((documentElement.firstChild as Text).data).toBe(text);
    }
  });

  test("line ends become line feeds", () => {
    const { documentElement } = parseWellFormed("<a>x\r\ny\rz<![CDATA[\r\n]]><!--\r--><?p q\r\nr?>&#13;</a>");
    expect(Array.from(documentElement.childNodes, node => node.nodeValue)).toEqual([
      "x\ny\nz",
      "\n",
      "\n",
      "q\nr",
      "\r",
    ]);
  });

  test("white space in an attribute value becomes spaces", () => {
    const { documentElement } = parseWellFormed(`<a x="a\n\tb\r\nc&#10;&#9;d" y=' "&quot;&apos; '/>`);
    expect(documentElement.getAttribute("x")).toBe("a  b c\n\td");
    expect(documentElement.getAttribute("y")).toBe(` ""' `);
  });

  test("characters outside the basic plane, in names too", () => {
    const { documentElement } = parseWellFormed(`<é𐐀 ñ="😀">😀&#x1F600;&#128512;</é𐐀>`);
    expect(documentElement.localName).toBe("é𐐀");
    expect(documentElement.getAttribute("ñ")).toBe("😀");
    expect(documentElement.textContent).toBe("😀😀😀");
  });

  test("an unpaired surrogate becomes U+FFFD", () => {
    expect(parseWellFormed("<a>x\uD83Cy<![CDATA[\uDC00]]></a>").documentElement.textContent).toBe("x\uFFFDy\uFFFD");
  });
});

describe("the doctype", () => {
  test.each([
    [`<!DOCTYPE a>`, "a", "", ""],
    [`<!DOCTYPE a SYSTEM 'sys"tem'>`, "a", "", `sys"tem`],
    [`<!DOCTYPE a PUBLIC "pub" "sys">`, "a", "pub", "sys"],
    [`<!DOCTYPE a PUBLIC "pub" "">`, "a", "pub", ""],
    [`<!DOCTYPE p:a [ <!ELEMENT p:a (#PCDATA)> <!-- c --> <?p d?> ]>`, "p:a", "", ""],
    [`<!DOCTYPE a SYSTEM "sys" [<!ENTITY e "x">]>`, "a", "", "sys"],
  ])("%s", (doctype, name, publicId, systemId) => {
    const document = parseWellFormed(`${doctype}<${name} xmlns:p="urn:p"/>`);
    expect(document.doctype).toBeInstanceOf(DocumentType);
    expect(document.doctype).toBe(document.firstChild as DocumentType);
    expect(document.childNodes.length).toBe(2);
    expect([document.doctype!.name, document.doctype!.publicId, document.doctype!.systemId]).toEqual([
      name,
      publicId,
      systemId,
    ]);
  });

  test("is written back without the internal subset", () => {
    expect(serialize(parseWellFormed(`<!DOCTYPE foo [ <!ENTITY x "y"> ]><foo>&x;</foo>`))).toBe(
      `<!DOCTYPE foo><foo>y</foo>`,
    );
    const text = `<!DOCTYPE a PUBLIC "pub" "sys"><a/>`;
    expect(serialize(parseWellFormed(text))).toBe(text);
  });

  test("a public identifier needs a system identifier", () => {
    const document = parse(
      `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"><html><div id="test"/></html>`,
      "application/xhtml+xml",
    );
    expect(document.getElementById("test")).toBeNull();
    expect(document.querySelector("parsererror")).not.toBeNull();
  });

  test("createDocument() and createDocumentType() make what the parser makes", () => {
    const parsed = parseWellFormed(`<!DOCTYPE p:root PUBLIC "pub" "sys"><p:root xmlns:p="urn:x" a="1"><b/></p:root>`);
    const { implementation } = parsed;
    const made = implementation.createDocument(
      "urn:x",
      "p:root",
      implementation.createDocumentType("p:root", "pub", "sys"),
    );
    expect(made.isEqualNode(parsed)).toBe(false);
    made.documentElement.setAttributeNS(xmlnsNamespace, "xmlns:p", "urn:x");
    made.documentElement.setAttribute("a", "1");
    made.documentElement.append(made.createElement("b"));
    expect(made.isEqualNode(parsed)).toBe(true);
    expect(made.constructor).toBe(parsed.constructor);
    expect(serialize(made)).toBe(serialize(parsed));
  });
});

describe("namespaces", () => {
  test("elements and attributes", () => {
    const text = `<root xmlns="urn:d" xmlns:p="urn:p" p:a="1" b="2" xml:lang="en"><p:child><inner xmlns=""><deep/></inner><other/></p:child></root>`;
    const document = parseWellFormed(text);
    const root = document.documentElement;
    const child = root.firstElementChild!;
    const [inner, other] = child.children;
    expect(
      [root, child, inner, inner.firstElementChild!, other].map(element => [
        element.tagName,
        element.namespaceURI,
        element.prefix,
        element.localName,
      ]),
    ).toEqual([
      ["root", "urn:d", null, "root"],
      ["p:child", "urn:p", "p", "child"],
      ["inner", null, null, "inner"],
      ["deep", null, null, "deep"],
      ["other", "urn:d", null, "other"],
    ]);
    expect(Array.from(root.attributes, a => [a.name, a.namespaceURI, a.prefix, a.localName, a.value])).toEqual([
      ["xmlns", xmlnsNamespace, null, "xmlns", "urn:d"],
      ["xmlns:p", xmlnsNamespace, "xmlns", "p", "urn:p"],
      ["p:a", "urn:p", "p", "a", "1"],
      ["b", null, null, "b", "2"],
      ["xml:lang", xmlNamespace, "xml", "lang", "en"],
    ]);
    expect([
      root.getAttributeNS("urn:p", "a"),
      root.getAttributeNS(null, "b"),
      root.getAttributeNS("urn:d", "b"),
    ]).toEqual(["1", "2", null]);
    expect([inner.lookupNamespaceURI("p"), inner.lookupNamespaceURI(null), child.lookupNamespaceURI(null)]).toEqual([
      "urn:p",
      null,
      "urn:d",
    ]);
    expect([inner.lookupPrefix("urn:p"), root.isDefaultNamespace("urn:d"), inner.isDefaultNamespace("urn:d")]).toEqual([
      "p",
      true,
      false,
    ]);
    expect(Array.from(document.getElementsByTagNameNS("urn:d", "*"))).toEqual([root, other]);
    expect(Array.from(document.getElementsByTagNameNS("urn:p", "child"))).toEqual([child]);
    expect(Array.from(document.getElementsByTagName("p:child"))).toEqual([child]);
    expect(serialize(document)).toBe(text);
  });

  test("a prefix means what the nearest declaration says", () => {
    const document = parseWellFormed(
      `<p:a xmlns:p="urn:1"><p:b xmlns:p="urn:2" p:x="1"><p:c/></p:b><p:d/><q:e xmlns:q="urn:1"/></p:a>`,
    );
    expect(Array.from(document.querySelectorAll("*"), element => [element.tagName, element.namespaceURI])).toEqual([
      ["p:a", "urn:1"],
      ["p:b", "urn:2"],
      ["p:c", "urn:2"],
      ["p:d", "urn:1"],
      ["q:e", "urn:1"],
    ]);
    expect(document.querySelector("b")!.getAttributeNS("urn:2", "x")).toBe("1");
  });

  test("a declaration applies to the tag it stands in, wherever it stands", () => {
    const text = `<p:a p:x="1" xmlns:p="urn:p" q:y="2" xmlns:q="urn:q"/>`;
    const { documentElement } = parseWellFormed(text);
    expect(documentElement.namespaceURI).toBe("urn:p");
    expect(Array.from(documentElement.attributes, a => [a.name, a.namespaceURI])).toEqual([
      ["p:x", "urn:p"],
      ["xmlns:p", xmlnsNamespace],
      ["q:y", "urn:q"],
      ["xmlns:q", xmlnsNamespace],
    ]);
    expect(serialize(documentElement)).toBe(text);
  });

  test("the xml prefix needs no declaration and can have the right one", () => {
    expect(parseWellFormed(`<a xml:space="preserve"/>`).documentElement.attributes[0].namespaceURI).toBe(xmlNamespace);
    expect(parseWellFormed(`<xml:a/>`).documentElement.namespaceURI).toBe(xmlNamespace);
    expect(parseWellFormed(`<a xmlns:xml="${xmlNamespace}" xml:id="i"/>`).documentElement.attributes.length).toBe(2);
  });

  test("a declaration that the DTD defaults counts", () => {
    const { documentElement } = parseWellFormed(
      `<!DOCTYPE a [<!ATTLIST a xmlns CDATA "urn:d" xmlns:p CDATA "urn:p" x CDATA "y">]><a p:z="1"/>`,
    );
    expect(documentElement.namespaceURI).toBe("urn:d");
    expect(Array.from(documentElement.attributes, a => [a.name, a.namespaceURI, a.value])).toEqual([
      ["p:z", "urn:p", "1"],
      ["xmlns", xmlnsNamespace, "urn:d"],
      ["xmlns:p", xmlnsNamespace, "urn:p"],
      ["x", null, "y"],
    ]);
  });

  test.each([
    [`<p:a/>`, "The namespace prefix 'p' is not declared"],
    [`<a p:x="1"/>`, "The namespace prefix 'p' is not declared"],
    [`<a><p:b xmlns:p="urn:p"/><p:c/></a>`, "The namespace prefix 'p' is not declared"],
    [`<a:b:c xmlns:a="urn:a"/>`, "'a:b:c' is not a qualified name"],
    [`<:a/>`, "':a' is not a qualified name"],
    [`<a:/>`, "'a:' is not a qualified name"],
    [`<a :x="1"/>`, "':x' is not a qualified name"],
    [`<a ::="1"/>`, "'::' is not a qualified name"],
    [`<p:1 xmlns:p="urn:p"/>`, "'p:1' is not a qualified name"],
    [`<a xmlns:p="urn:p" p:-x="1"/>`, "'p:-x' is not a qualified name"],
    [`<a xmlns:="urn:p"/>`, "'xmlns:' does not declare a namespace prefix"],
    [`<a xmlns:p:q="urn:p"/>`, "'xmlns:p:q' does not declare a namespace prefix"],
    [`<a xmlns:1="urn:p"/>`, "'xmlns:1' does not declare a namespace prefix"],
    [`<a xmlns:p=""/>`, "The namespace prefix 'p' cannot be bound to an empty namespace"],
    [`<a xmlns:xmlns="urn:p"/>`, "The namespace prefix 'xmlns' cannot be declared"],
    [`<a xmlns:xmlns="${xmlnsNamespace}"/>`, "The namespace prefix 'xmlns' cannot be declared"],
    [`<a xmlns:xml="urn:p"/>`, "The namespace prefix 'xml' cannot be bound to another namespace"],
    [`<a xmlns:p="${xmlNamespace}"/>`, `The namespace '${xmlNamespace}' cannot be bound to another prefix`],
    [`<a xmlns:p="${xmlnsNamespace}"/>`, `The namespace '${xmlnsNamespace}' cannot be bound to another prefix`],
    [`<a xmlns="${xmlNamespace}"/>`, `The namespace '${xmlNamespace}' cannot be the default namespace`],
    [`<a xmlns="${xmlnsNamespace}"/>`, `The namespace '${xmlnsNamespace}' cannot be the default namespace`],
    [`<xmlns:a/>`, "The namespace prefix 'xmlns' is not declared"],
    [`<a xmlns:p="urn:p" xmlns:q="urn:p" p:x="1" q:x="2"/>`, "Two attributes have the same local name and namespace"],
    [`<a><?p:q d?></a>`, "Processing instruction target 'p:q' cannot have a colon in it"],
    [`<?p:q d?><a/>`, "Processing instruction target 'p:q' cannot have a colon in it"],
    [`<!DOCTYPE a [<!ENTITY p:q "x">]><a/>`, "Entity name 'p:q' cannot have a colon in it"],
    [`<!DOCTYPE a [<!NOTATION p:q SYSTEM "x">]><a/>`, "Notation name 'p:q' cannot have a colon in it"],
  ])("%s is an error", (text, message) => {
    expect(errorOf(text)).toEndWith(`: ${message}\n`);
  });

  test("the same local name in two namespaces, or with and without one, is fine", () => {
    const { attributes } = parseWellFormed(
      `<a xmlns="urn:p" xmlns:p="urn:p" xmlns:q="urn:q" x="0" p:x="1" q:x="2"/>`,
    ).documentElement;
    expect(Array.from(attributes, a => a.namespaceURI).slice(3)).toEqual([null, "urn:p", "urn:q"]);
  });
});

describe("entities", () => {
  test("the five of XML and character references", () => {
    const { documentElement } = parseWellFormed(
      `<a v="&lt;&gt;&amp;&apos;&quot;&#65;&#x42;">&lt;&gt;&amp;&apos;&quot;&#65;&#x42;</a>`,
    );
    expect(documentElement.textContent).toBe(`<>&'"AB`);
    expect(documentElement.getAttribute("v")).toBe(`<>&'"AB`);
    expect(documentElement.childNodes.length).toBe(1);
  });

  test("those that the internal subset declares", () => {
    const document = parseWellFormed(
      `<!DOCTYPE a [<!ENTITY e "x<b c='&f;'>&f;</b>y"><!ENTITY f "1 &amp; 2"><!ENTITY e "second">]><a v="&f;">[&e;]</a>`,
    );
    expect(serialize(document.documentElement)).toBe(`<a v="1 &amp; 2">[x<b c="1 &amp; 2">1 &amp; 2</b>y]</a>`);
    expect(Array.from(document.documentElement.childNodes, describeNode)).toEqual([
      [3, "#text", "[x"],
      [1, "b", null],
      [3, "#text", "y]"],
    ]);
  });

  test.each([
    [`<a>&nbsp;</a>`, "Entity 'nbsp' is not declared"],
    [`<a v="&nbsp;"/>`, "Entity 'nbsp' is not declared"],
    [`<!DOCTYPE a SYSTEM "a.dtd"><a>&nbsp;</a>`, "Entity 'nbsp' is not declared"],
    [`<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent"> %p;]><a>&nbsp;</a>`, "Entity 'nbsp' is not declared"],
    [`<!DOCTYPE html><html xmlns="${xhtmlNamespace}">&nbsp;</html>`, "Entity 'nbsp' is not declared"],
    [`<!DOCTYPE a [<!ENTITY e "&e;">]><a>&e;</a>`, "Entity 'e' refers to itself"],
    [`<!DOCTYPE a [<!ENTITY e "&f;"><!ENTITY f "&e;">]><a>&e;</a>`, "Entity 'e' refers to itself"],
    [`<!DOCTYPE a [<!ENTITY e "<b>">]><a>&e;</b></a>`, "must start and end within the same entity"],
    [`<!DOCTYPE a [<!ENTITY e "<">]><a v="&e;"/>`, "'<' is not allowed in attribute values"],
    [`<a>&#0;</a>`, "Character reference '&#0;' is not a valid XML character"],
    [`<a>&#xD800;</a>`, "is not a valid XML character"],
    [`<a>&amp</a>`, "Expected ';' after the entity name"],
    [`<a>& </a>`, "Expected an entity name after '&'"],
  ])("%s is an error", (text, message) => {
    expect(errorOf(text)).toContain(message);
  });

  test("nothing external is read", () => {
    const document = parseWellFormed(
      `<!DOCTYPE a SYSTEM "file:///etc/passwd" [<!ENTITY e SYSTEM "file:///etc/passwd"><!ENTITY % p SYSTEM "file:///etc/passwd"> %p;]><a>[&e;]</a>`,
    );
    expect(Array.from(document.documentElement.childNodes, describeNode)).toEqual([[3, "#text", "[]"]]);
    expect(errorOf(`<!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><a v="&e;"/>`)).toContain(
      "Attribute values cannot reference external entity 'e'",
    );
  });

  test("an XHTML doctype brings the names of HTML", () => {
    const document = parseWellFormed(
      `${xhtmlDoctype}<html xmlns="${xhtmlNamespace}"><body title="&eacute;&nbsp;">&nbsp;&copy;&CounterClockwiseContourIntegral;&bopf;&nvlt;&LT;&AMP;amp;</body></html>`,
      "application/xhtml+xml",
    );
    expect(document.body.textContent).toBe("\u00A0©∳𝕓<\u20D2<&amp;");
    expect(document.body.title).toBe("é\u00A0");
    expect(document.body.childNodes.length).toBe(1);
    expect(errorOf(`${xhtmlDoctype}<html xmlns="${xhtmlNamespace}">&nosuchname;</html>`)).toContain(
      "Entity 'nosuchname' is not declared",
    );
    // A declaration in the document comes first.
    expect(
      parseWellFormed(xhtmlDoctype.replace(">", ` [<!ENTITY nbsp "mine">]>`) + `<html>&nbsp;</html>`).documentElement
        .textContent,
    ).toBe("mine");
  });

  test("a billion laughs end at once", () => {
    const levels = Array.from({ length: 9 }, (_, i) => `<!ENTITY l${i + 1} "${`&l${i};`.repeat(10)}">`).join("");
    const doctype = `<!DOCTYPE lolz [<!ENTITY l0 "lol">${levels}]>`;
    expect(errorOf(`${doctype}<lolz>&l9;</lolz>`)).toContain("Entity expansion exceeds the amplification limit");
    expect(errorOf(`${doctype}<lolz a="&l9;"/>`)).toContain("Entity expansion exceeds the amplification limit");
    expect(parseWellFormed(`${doctype}<lolz>&l3;</lolz>`).documentElement.textContent).toBe("lol".repeat(1000));
  });

  test("one long entity used many times ends at once too", () => {
    const text = `<!DOCTYPE a [<!ENTITY e "${"x".repeat(1000)}">]><a>${"&e;".repeat(5000)}</a>`;
    expect(errorOf(text)).toContain("Entity expansion exceeds the amplification limit");
  });
});

describe("a text that is not well-formed", () => {
  test("gives WebKit's <parsererror> in front of what was parsed", () => {
    const document = parse(`<a x="1"><b>one</b><c>two</d></a>`);
    expect(document).toBeInstanceOf(XMLDocument);
    expect([document.contentType, document.readyState]).toEqual(["text/xml", "complete"]);
    const root = document.documentElement;
    expect(root.tagName).toBe("a");
    const error = root.firstElementChild!;
    expect([error.localName, error.namespaceURI, error.prefix]).toEqual(["parsererror", xhtmlNamespace, null]);
    expect(error).toBeInstanceOf(HTMLElement);
    expect(error.getAttribute("style")).toStartWith("display: block; white-space: pre;");
    expect(Array.from(error.children, child => [child.localName, child.textContent])).toEqual([
      ["h3", "This page contains the following errors:"],
      ["div", "error on line 1 at column 26: Expected closing tag </c> but found </d>\n"],
      ["h3", "Below is a rendering of the page up to the first error."],
    ]);
    error.remove();
    expect(serialize(document)).toBe(`<a x="1"><b>one</b><c>two</c></a>`);
  });

  test("without a root element the error is in an HTML body", () => {
    for (const text of ["", " \n", "<!-- c -->", "text", "<"]) {
      const document = parse(text);
      expect(document.documentElement.namespaceURI).toBe(xhtmlNamespace);
      expect(Array.from(document.querySelectorAll("*"), element => element.localName)).toEqual([
        "html",
        "body",
        "parsererror",
        "h3",
        "div",
        "h3",
      ]);
    }
    expect(errorOf("")).toBe("error on line 1 at column 1: XML document must have a root element\n");
  });

  test("an SVG root element moves into an HTML body, after the error", () => {
    const document = parse(`<svg xmlns="${svgNamespace}"><g></svg>`, "image/svg+xml");
    expect(document.contentType).toBe("image/svg+xml");
    expect(Array.from(document.body.children, child => child.localName)).toEqual(["parsererror", "svg"]);
    expect(document.querySelector("svg > g")).toBeInstanceOf(SVGElement);
    expect(document.head.firstElementChild!.localName).toBe("style");
  });

  test.each(xmlTypes)("keeps the type %s", type => {
    const document = parse(`<span x:test="testing">1</span>`, type);
    expect(document.contentType).toBe(type);
    expect(document.getElementsByTagName("parsererror").length).toBe(1);
  });

  test("the line and the column", () => {
    expect(errorOf("<a>\n  <b>\n</a>")).toStartWith("error on line 3 at column 1: ");
    expect(errorOf("<a>\r\n  <b>\r\n</a>")).toStartWith("error on line 3 at column 1: ");
    expect(errorOf("<a>\r  <b>\r</a>")).toStartWith("error on line 3 at column 1: ");
    expect(errorOf("<a>\n<b/>\n  <p:c/></a>")).toStartWith("error on line 3 at column 3: ");
    expect(errorOf("<a>😀é</b>")).toStartWith("error on line 1 at column 7: ");
  });

  test.each([
    ["mismatched tags", `<a><b></a></b>`, "Expected closing tag </b> but found </a>"],
    ["a tag that is not closed", `<a><b>`, "Missing closing tag for element 'b'"],
    ["a closing tag too many", `<a/></a>`, "after the root element"],
    ["text after the root", `<a/>text`, "Unexpected 'text' after the root element"],
    ["text before the root", `text<a/>`, "Expected the root element but found 'text'"],
    ["a reference after the root", `<a/>&amp;`, "after the root element"],
    ["a CDATA section after the root", `<a/><![CDATA[x]]>`, "CDATA sections are only allowed inside elements"],
    ["two roots", `<a/><b/>`, "Only one root element is allowed"],
    ["two doctypes", `<!DOCTYPE a><!DOCTYPE a><a/>`, "Only one document type declaration is allowed"],
    ["a doctype after the root", `<a/><!DOCTYPE a>`, "after the root element"],
    ["a duplicate attribute", `<a x="1" x="2"/>`, "Duplicate attribute 'x'"],
    [
      "a duplicate among many",
      `<a ${Array.from({ length: 40 }, (_, i) => `x${i % 39}=""`).join(" ")}/>`,
      "Duplicate attribute 'x0'",
    ],
    ["an attribute without a value", `<a x/>`, "Expected '=' after the attribute name"],
    ["a value without quotes", `<a x=1/>`, "Expected a quoted attribute value"],
    ["a value without a name", `<a ="1"/>`, "Expected an attribute name"],
    ["attributes without a space between", `<a x="1"y="2"/>`, "Whitespace is required"],
    ["< in a value", `<a x="<"/>`, "'<' is not allowed in attribute values"],
    ["a value that does not end", `<a x="1/>`, "Unterminated attribute value"],
    ["a space after <", `< a/>`, "Expected an element name after '<'"],
    ["a space after </", `<a></ a>`, "Expected an element name after '</'"],
    ["a name that starts with a digit", `<1a/>`, "Expected an element name after '<'"],
    ["a tag that does not end", `<a><b`, "in the start tag"],
    ["]]> in text", `<a>]]></a>`, "']]>' is only allowed as the end of a CDATA section"],
    ["-- in a comment", `<a><!-- a -- b --></a>`, "'--' is not allowed inside a comment"],
    ["a comment that ends with --->", `<a><!-- a ---></a>`, "'--' is not allowed inside a comment"],
    ["a comment that does not end", `<a><!-- a </a>`, "Unterminated comment"],
    ["a CDATA section that does not end", `<a><![CDATA[ ]] ></a>`, "Unterminated CDATA section"],
    ["a processing instruction that does not end", `<a><?p ></a>`, "Unterminated processing instruction"],
    ["a processing instruction named XML", `<a><?XML d?></a>`, "'<?xml' is reserved"],
    ["a doctype in content", `<a><!DOCTYPE a></a>`, "Expected a comment or CDATA section after '<!'"],
    ["U+0000", `<a>\0</a>`, "Invalid character in XML"],
    ["a control character", `<a>\x01</a>`, "Invalid character in XML"],
    ["a control character in a value", `<a x="\x1F"/>`, "Invalid character in XML"],
    ["U+FFFE", `<a>\uFFFE</a>`, "Invalid character in XML"],
    ["U+FFFF in a comment", `<a><!--\uFFFF--></a>`, "Invalid character in XML"],
  ])("%s", (_, text, message) => {
    const error = errorOf(text);
    expect(error).toMatch(/^error on line \d+ at column \d+: .+\n$/);
    expect(error).toContain(message);
  });

  test("]]> and -- where they are allowed", () => {
    expect(parseWellFormed(`<a x="]]>">]]&gt;]] ><!-- - - --></a>`).documentElement.textContent).toBe("]]>]] >");
  });
});

describe("elements of HTML and SVG", () => {
  test("an element in the XHTML namespace has its HTML class", () => {
    delete (globalThis as any).ranXMLScript;
    const document = parseWellFormed(
      `<html xmlns="${xhtmlNamespace}"><head><title>T</title></head><body onload="globalThis.ranXMLScript = 1"><P>x</P><p class="a b">y</p><br/><h:input xmlns:h="${xhtmlNamespace}" value="v"/><template><i>z</i></template><script>globalThis.ranXMLScript = 2</script><x xmlns="">n</x></body></html>`,
      "application/xhtml+xml",
    );
    expect(Array.from(document.body.children, child => [child.tagName, child.constructor.name])).toEqual([
      ["P", "HTMLUnknownElement"],
      ["p", "HTMLParagraphElement"],
      ["br", "HTMLBRElement"],
      ["h:input", "HTMLInputElement"],
      ["template", "HTMLTemplateElement"],
      ["script", "HTMLScriptElement"],
      ["x", "Element"],
    ]);
    expect(document.documentElement.constructor.name).toBe("HTMLHtmlElement");
    expect(document.title).toBe("T");
    expect(Array.from(document.querySelector("p")!.classList)).toEqual(["a", "b"]);
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("v");
    expect(document.querySelector("p.b:nth-child(2)")).toBe(document.body.children[1]);

    const template = document.querySelector("template") as HTMLTemplateElement;
    expect(template.childNodes.length).toBe(0);
    expect(serialize(template.content)).toBe(`<i xmlns="${xhtmlNamespace}">z</i>`);
    expect(template.content.firstChild!.ownerDocument).not.toBe(document);

    expect(document.createElement("DIV").constructor.name).toBe("HTMLUnknownElement");
    expect(document.createElement("div").constructor.name).toBe("HTMLDivElement");
    expect("ranXMLScript" in globalThis).toBe(false);
  });

  test("the type of the document does not matter", () => {
    const document = parseWellFormed(`<a><div xmlns="${xhtmlNamespace}"/><svg xmlns="${svgNamespace}"/><div/></a>`);
    const [div, svg, other] = document.documentElement.children;
    expect(div.constructor.name).toBe("HTMLDivElement");
    expect(svg).toBeInstanceOf(SVGElement);
    expect(other.constructor).toBe(Element);
  });

  test("SVG", () => {
    const text = `<svg xmlns="${svgNamespace}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><linearGradient id="g"/><use xlink:href="#g"/><foreignObject><div xmlns="${xhtmlNamespace}">x</div></foreignObject></svg>`;
    const document = parseWellFormed(text, "image/svg+xml");
    expect(document.documentElement).toBeInstanceOf(SVGElement);
    expect(document.documentElement.getAttribute("viewBox")).toBe("0 0 1 1");
    expect(document.querySelector("linearGradient")).toBe(document.getElementById("g"));
    expect(document.querySelector("lineargradient")).toBeNull();
    expect(document.querySelector("use")!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#g");
    expect(document.querySelector("foreignObject > div")).toBeInstanceOf(HTMLElement);
    expect(serialize(document)).toBe(text);
  });
});

describe("XMLSerializer writes back what was parsed", () => {
  test.each([
    `<a/>`,
    `<a>text</a>`,
    `<a b="1" c="2"><d/><e>f</e></a>`,
    `<a>&lt;&amp;&gt;"'</a>`,
    `<a b="&lt;&amp;&gt;&quot;'"/>`,
    `<a b="&#9;&#10;&#13;"/>`,
    `<a><![CDATA[<b>&amp;]]></a>`,
    `<root><htmlDefn><![CDATA[<div><![CDATA[  Just Rubbish Data $#$^#^$ ]]]]><![CDATA[></div><div></div>]]></htmlDefn></root>`,
    `<root><![CDATA[\n${"1234567890".repeat(100)}\n]]></root>`,
    `<a><!-- c --><?p d?><?q-r s="t"?></a>`,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE a SYSTEM "a.dtd"><!--c--><a/><?p d?>`,
    `<p:a xmlns:p="urn:p" p:b="c"><p:d/><e xmlns="urn:e"><f/></e></p:a>`,
    `<a xmlns="urn:a"><b xmlns=""><c xmlns="urn:a"/></b></a>`,
    `<a xml:lang="en" xml:space="preserve"> </a>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>T &amp; U</title><atom:link href="https://example.com/?a=1&amp;b=2" rel="self"/></channel></rss>`,
    `<é ñ="ü">日本語😀</é>`,
  ])("%s", text => {
    expect(serialize(parseWellFormed(text))).toBe(text);
  });
});

describe("markup in an XML document is parsed as XML", () => {
  const make = () => parseWellFormed(`<root xmlns:p="urn:p"><a xmlns="urn:a"><old/></a><z/></root>`);

  test("innerHTML", () => {
    const document = make();
    const a = document.documentElement.firstElementChild!;
    a.innerHTML = `<B x="1"/>text&amp;<p:c/><![CDATA[d]]><!--e--><?f g?><h xmlns=""/>`;
    expect(Array.from(a.childNodes, node => [...describeNode(node), (node as Element).namespaceURI])).toEqual([
      [1, "B", null, "urn:a"],
      [3, "#text", "text&", undefined],
      [1, "p:c", null, "urn:p"],
      [4, "#cdata-section", "d", undefined],
      [8, "#comment", "e", undefined],
      [7, "f", "g", undefined],
      [1, "h", null, null],
    ]);
    expect(a.firstChild!.ownerDocument).toBe(document);
    expect(a.innerHTML).toBe(
      `<B xmlns="urn:a" x="1"/>text&amp;<p:c xmlns:p="urn:p"/><![CDATA[d]]><!--e--><?f g?><h xmlns=""/>`,
    );
    a.innerHTML = "";
    expect(a.childNodes.length).toBe(0);
    a.innerHTML = "  ";
    expect(Array.from(a.childNodes, describeNode)).toEqual([[3, "#text", "  "]]);
  });

  test.each([
    `<b>`,
    `</b>`,
    `<b></c>`,
    `<br>`,
    `x</root>`,
    `</root><root>`,
    `</root><!--c-->`,
    `</a>`,
    `<q:b/>`,
    `<b q:c=""/>`,
    `<b c="1" c="2"/>`,
    `&nbsp;`,
    `&`,
    `<`,
    `<!DOCTYPE b>`,
    `<?xml version="1.0"?>`,
    `<?xml version="1.0"?><b/>`,
    `<![CDATA[`,
    `<!--`,
    `]]>`,
    `\0`,
  ])("%j is a SyntaxError and changes nothing", markup => {
    const document = make();
    const before = serialize(document);
    const a = document.documentElement.firstElementChild!;
    expect(() => (a.innerHTML = markup)).toThrow(named("SyntaxError"));
    expect(() => (a.outerHTML = markup)).toThrow(named("SyntaxError"));
    expect(() => a.insertAdjacentHTML("beforeend", markup)).toThrow(named("SyntaxError"));
    expect(() => document.createRange().createContextualFragment(markup)).toThrow(named("SyntaxError"));
    expect(serialize(document)).toBe(before);
  });

  test("outerHTML", () => {
    const document = make();
    document.documentElement.firstElementChild!.outerHTML = `<b/>c<p:d/>`;
    expect(serialize(document)).toBe(`<root xmlns:p="urn:p"><b/>c<p:d/><z/></root>`);
    expect(document.documentElement.firstElementChild!.namespaceURI).toBeNull();
  });

  test("insertAdjacentHTML()", () => {
    const document = make();
    const a = document.documentElement.firstElementChild!;
    a.insertAdjacentHTML("beforebegin", "<b1/>");
    a.insertAdjacentHTML("afterbegin", "<b2/>");
    a.insertAdjacentHTML("beforeend", "<b3/>");
    a.insertAdjacentHTML("afterend", "<b4/>");
    expect(Array.from(document.querySelectorAll("*"), element => [element.localName, element.namespaceURI])).toEqual([
      ["root", null],
      ["b1", null],
      ["a", "urn:a"],
      ["b2", "urn:a"],
      ["old", "urn:a"],
      ["b3", "urn:a"],
      ["b4", null],
      ["z", null],
    ]);
  });

  test("createContextualFragment()", () => {
    const document = make();
    const range = document.createRange();
    range.selectNodeContents(document.documentElement.firstElementChild!);
    const fragment = range.createContextualFragment(`<b/><p:c/>`);
    expect(Array.from(fragment.children, child => child.namespaceURI)).toEqual(["urn:a", "urn:p"]);
  });

  test("in XHTML the elements are HTML elements, and void elements need their slash", () => {
    const document = parseWellFormed(`<html xmlns="${xhtmlNamespace}"><body/></html>`, "application/xhtml+xml");
    document.body.innerHTML = `<p>x<br/></p><svg xmlns="${svgNamespace}"/><script>globalThis.ranXMLScript = 1</script>`;
    expect(document.body.firstElementChild!.constructor.name).toBe("HTMLParagraphElement");
    expect(document.body.children[1]).toBeInstanceOf(SVGElement);
    expect(document.body.innerHTML).toBe(
      `<p xmlns="${xhtmlNamespace}">x<br /></p><svg xmlns="${svgNamespace}"/><script xmlns="${xhtmlNamespace}">globalThis.ranXMLScript = 1</script>`,
    );
    expect("ranXMLScript" in globalThis).toBe(false);
    expect(() => (document.body.innerHTML = "<p>x<br></p>")).toThrow(named("SyntaxError"));
  });

  test("the markup of a script or a style is its text", () => {
    const document = parseWellFormed(`<html xmlns="${xhtmlNamespace}"><style/></html>`);
    const style = document.documentElement.firstElementChild!;
    style.innerHTML = "a > b { } <";
    expect(Array.from(style.childNodes, describeNode)).toEqual([[3, "#text", "a > b { } <"]]);
  });

  test("a document made by createDocument() does the same, and the HTML document that made it does not", () => {
    const window = new Window();
    window.document.body.innerHTML = "<p>x<br>";
    expect(window.document.body.innerHTML).toBe("<p>x<br></p>");
    const document = window.document.implementation.createDocument("urn:a", "a", null);
    document.documentElement.innerHTML = "<B/>";
    expect(serialize(document)).toBe(`<a xmlns="urn:a"><B/></a>`);
    expect(() => (document.documentElement.innerHTML = "<b>")).toThrow(named("SyntaxError"));
  });
});

describe("large and hostile input", () => {
  test("elements nested 4,000 deep are a tree", () => {
    const document = parseWellFormed("<a>".repeat(4000) + "x" + "</a>".repeat(4000));
    let depth = 0;
    for (let element = document.documentElement as Element | null; element; element = element.firstElementChild)
      depth++;
    expect(depth).toBe(4000);
    expect(document.documentElement.textContent).toBe("x");
  });

  test.each([5001, 100_000, 300_000])("elements nested %i deep are an error, as in WebKit", depth => {
    expect(errorOf("<a>".repeat(depth) + "</a>".repeat(depth))).toEndWith(": Excessive node nesting.\n");
    expect(errorOf("<a>".repeat(depth))).toEndWith(": Excessive node nesting.\n");
  });

  test("markup nested too deep is a SyntaxError", () => {
    const { documentElement } = parseWellFormed("<a/>");
    expect(() => (documentElement.innerHTML = "<a>".repeat(100_000) + "</a>".repeat(100_000))).toThrow(
      named("SyntaxError"),
    );
  });

  test("a content model nested 100,000 deep", () => {
    const text = `<!DOCTYPE a [<!ELEMENT a ${"(".repeat(100_000)}b${")".repeat(100_000)}>]><a/>`;
    expect(parse(text).documentElement).not.toBeNull();
  });

  test("50,000 attributes", () => {
    const names = Array.from({ length: 50_000 }, (_, i) => `a${i}`);
    const { documentElement } = parseWellFormed(`<a ${names.map((name, i) => `${name}="${i}"`).join(" ")}/>`);
    expect(documentElement.attributes.length).toBe(50_000);
    expect(documentElement.getAttributeNames()).toEqual(names);
    expect(documentElement.getAttribute("a49999")).toBe("49999");
  });

  test("20,000 attributes with prefixes, and a duplicate among them", () => {
    const attributes = Array.from({ length: 20_000 }, (_, i) => `p:a${i}="${i}"`).join(" ");
    const start = `<a xmlns:p="urn:p" xmlns:q="urn:p" ${attributes}`;
    expect(parseWellFormed(`${start}/>`).documentElement.getAttributeNS("urn:p", "a19999")).toBe("19999");
    expect(errorOf(`${start} q:a19999=""/>`)).toContain("Two attributes have the same local name and namespace");
  });

  test("10,000 prefixes, each used 3 times", () => {
    const declarations = Array.from({ length: 10_000 }, (_, i) => `xmlns:p${i}="urn:${i}"`).join(" ");
    const children = Array.from({ length: 30_000 }, (_, i) => `<p${i % 10_000}:b/>`).join("");
    const { documentElement } = parseWellFormed(`<a ${declarations}>${children}</a>`);
    expect(documentElement.childElementCount).toBe(30_000);
    expect(documentElement.lastElementChild!.namespaceURI).toBe("urn:9999");
  });

  test("50,000 siblings", () => {
    const { documentElement } = parseWellFormed(`<a>${"<b>x</b>".repeat(50_000)}</a>`);
    expect(documentElement.childElementCount).toBe(50_000);
    expect(documentElement.textContent).toBe("x".repeat(50_000));
  });
});

test("works in Workers at the same time as on the main thread", async () => {
  function countNodes(Parser: typeof DOMParser) {
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const children = '<p:a b="1">x&amp;<![CDATA[y]]></p:a>'.repeat(50);
      const text = '<r xmlns:p="urn:' + i + '">' + children + (i % 2 ? "</r>" : "");
      const document = new Parser().parseFromString(text, "text/xml");
      total += document.getElementsByTagNameNS("urn:" + i, "a").length;
      total += document.getElementsByTagName("parsererror").length;
    }
    return total;
  }
  const source = `import { DOMParser } from "bun:dom"; postMessage((${countNodes})(DOMParser));`;
  const url = URL.createObjectURL(new Blob([source], { type: "application/typescript" }));
  const workers = Array.from({ length: 4 }, () => new Worker(url));
  const results = workers.map(worker => new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
  expect(countNodes(DOMParser)).toBe(5050);
  expect(await Promise.all(results)).toEqual([5050, 5050, 5050, 5050]);
  for (const worker of workers) worker.terminate();
});
