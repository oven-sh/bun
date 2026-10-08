// Tests generated from the W3C XML Conformance Test Suite, 20130923 release
// (https://www.w3.org/XML/Test/ — xmlts20130923.tar.gz, SHA-256 9b61db9f5dbffa545f4b8d78422167083a8568c59bd1129f94138f936cf6fc1f).
// The suite was contributed by James Clark, Sun Microsystems, OASIS/NIST, IBM,
// Fuji Xerox and Richard Tobin / the University of Edinburgh; test documents are
// (c) their contributors ("Copyright 1998-1999 by Sun Microsystems, Inc.",
// "Modifications copyright 1999-2001 by OASIS", IBM 2000-2003, ...) and are
// inlined here verbatim as conformance inputs.
//
// Scope: 1995 cases applicable to an XML 1.0 (Fifth Edition) processor —
// 927 must-reject + 752 must-accept (262 with canonical output) + 316 whose
// verdict depends on processor class (pinned to Bun's behaviour, see below).
// Skipped: 1 XML 1.1 / Namespaces 1.1 cases, 310 cases restricted to editions 1-4
// (superseded by Fifth Edition erratum E09), 6 large japanese/pr-xml-* samples
// (advisory only; the japanese/weekly-* cases cover the same encodings).
// Regenerate with: bun bd test/js/bun/xml/generate_xml_test_suite.ts [path-to-xmlconf]
//
// Bun.XML is a non-validating processor that does not read external entities
// (XML 1.0 §5.1), so:
//   - not-wf cases with ENTITIES="none" must throw SyntaxError (exact message
//     asserted);
//   - valid and invalid cases with ENTITIES="none" must parse (non-validating
//     processors accept invalid-but-well-formed documents); when the suite gives
//     a canonical output, the { compact: false } tree must serialize to it
//     exactly (Second Canonical Form, minus the DOCTYPE/notation block and
//     processing instructions, which Bun.XML does not represent), the compact
//     object must equal the projection of that output, and XML.stringify of
//     either shape must parse back to the same value;
//   - cases with external entities, TYPE="error" cases, and the Namespaces 1.0
//     collection (names are opaque strings to Bun.XML; namespace constraints are
//     not enforced) are pinned to the in-tree behaviour, with the upstream
//     verdict in the comment.
// Inputs whose bytes carry encoding information the processor must act on (an
// encoding declaration, a UTF-16 BOM, non-UTF-8 bytes) are passed as bytes; a JS
// string is already-decoded text and its encoding declaration is not acted upon.
import { XML } from "bun";
import { describe, expect, test } from "bun:test";

type XMLNode = XML.Node;

const CANON_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};
function codePointCompare(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < x.length && i < y.length; i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
/** James Clark's Canonical XML for an element tree. */
function canonicalize(node: XMLNode | XML.Comment | XML.ProcessingInstruction | string): string {
  if (typeof node === "string") return node.replace(/[&<>"\t\n\r]/g, c => CANON_ESCAPES[c]);
  if ("comment" in node) return "";
  if ("target" in node) return `<?${node.target} ${node.data}?>`;
  const attrs = Object.keys(node.attributes)
    .sort(codePointCompare)
    .map(k => ` ${k}="${node.attributes[k].replace(/[&<>"\t\n\r]/g, c => CANON_ESCAPES[c])}"`)
    .join("");
  return `<${node.name}${attrs}>${node.children.map(canonicalize).join("")}</${node.name}>`;
}

function tree(input: string | Buffer): XMLNode {
  return XML.parse(input, { compact: false });
}

function expectParses(input: string | Buffer, canonical?: string, compact?: unknown): void {
  const node = tree(input);
  const object = XML.parse(input);
  if (canonical !== undefined) {
    expect(canonicalize(node)).toBe(canonical);
    expect(object).toEqual(compact);
  }
  // stringify of either shape reads back as the same value.
  expect(canonicalize(tree(XML.stringify(node)))).toBe(canonicalize(node));
  expect(XML.parse(XML.stringify(object))).toEqual(object);
}

function expectRejects(input: string | Buffer, message?: string): void {
  let err: unknown;
  try {
    XML.parse(input);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SyntaxError);
  if (message !== undefined) expect((err as SyntaxError).message).toBe(message);
  expect(() => tree(input)).toThrow(SyntaxError);
}

describe("xmltest", () => {
  test("not-wf-sa-001", () => {
    // 3.1 [41] — Attribute values must start with attribute names, not "?".
    const input: string = "<doc>\r\n<doc\r\n?\r\n<a</a>\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '?'");
  });

  test("not-wf-sa-002", () => {
    // 2.3 [4] — Names may not start with "."; it's not a Letter.
    const input: string = "<doc>\r\n<.doc></.doc>\r\n</doc>\r\n\r\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '.'");
  });

  test("not-wf-sa-003", () => {
    // 2.6 [16] — Processing Instruction target name is required.
    const input: string = "<doc><? ?></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected a processing instruction target after '<?' but found space");
  });

  test("not-wf-sa-004", () => {
    // 2.6 [16] — SGML-ism: processing instructions end in '?>' not '>'.
    const input: string = "<doc><?target some data></doc>\r\n";
    expectRejects(input, "XML Parse error: Unterminated processing instruction");
  });

  test("not-wf-sa-005", () => {
    // 2.6 [16] — Processing instructions end in '?>' not '?'.
    const input: string = "<doc><?target some data?</doc>\r\n";
    expectRejects(input, "XML Parse error: Unterminated processing instruction");
  });

  test("not-wf-sa-006", () => {
    // 2.5 [16] — XML comments may not contain "--"
    const input: string = "<doc><!-- a comment -- another --></doc>\r\n";
    expectRejects(input, "XML Parse error: '--' is not allowed inside a comment");
  });

  test("not-wf-sa-007", () => {
    // 4.1 [68] — General entity references have no whitespace after the entity name and before the
    // semicolon.
    const input: string = "<doc>&amp no refc</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found space");
  });

  test("not-wf-sa-008", () => {
    // 2.3 [5] — Entity references must include names, which don't begin with '.' (it's not a Letter or
    // other name start character).
    const input: string = "<doc>&.entity;</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found '.'");
  });

  test("not-wf-sa-009", () => {
    // 4.1 [66] — Character references may have only decimal or numeric strings.
    const input: string = "<doc>&#RE;</doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found 'R'",
    );
  });

  test("not-wf-sa-010", () => {
    // 4.1 [68] — Ampersand may only appear as part of a general entity reference.
    const input: string = "<doc>A & B</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found space");
  });

  test("not-wf-sa-011", () => {
    // 3.1 [41] — SGML-ism: attribute values must be explicitly assigned a value, it can't act as a boolean
    // toggle.
    const input: string = "<doc a1></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected '=' after the attribute name but found '>'");
  });

  test("not-wf-sa-012", () => {
    // 2.3 [10] — SGML-ism: attribute values must be quoted in all cases.
    const input: string = "<doc a1=v1></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected a quoted attribute value but found 'v1'");
  });

  test("not-wf-sa-013", () => {
    // 2.3 [10] — The quotes on both ends of an attribute value must match.
    const input: string = "<doc a1=\"v1'></doc>\r\n";
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("not-wf-sa-014", () => {
    // 2.3 [10] — Attribute values may not contain literal '<' characters.
    const input: string = '<doc a1="<foo>"></doc>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("not-wf-sa-015", () => {
    // 3.1 [41] — Attribute values need a value, not just an equals sign.
    const input: string = "<doc a1=></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected a quoted attribute value but found '>'");
  });

  test("not-wf-sa-016", () => {
    // 3.1 [41] — Attribute values need an associated name.
    const input: string = '<doc a1="v1" "v2"></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '\"'");
  });

  test("not-wf-sa-017", () => {
    // 2.7 [18] — CDATA sections need a terminating ']]>'.
    const input: string = "<doc><![CDATA[</doc>\r\n";
    expectRejects(input, "XML Parse error: Unterminated CDATA section");
  });

  test("not-wf-sa-018", () => {
    // 2.7 [19] — CDATA sections begin with a literal '<![CDATA[', no space.
    const input: string = "<doc><![CDATA [ stuff]]></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("not-wf-sa-019", () => {
    // 3.1 [42] — End tags may not be abbreviated as '</>'.
    const input: string = "<doc></>\r\n";
    expectRejects(input, "XML Parse error: Expected an element name after '</' but found '>'");
  });

  test("not-wf-sa-020", () => {
    // 2.3 [10] — Attribute values may not contain literal '&' characters except as part of an entity
    // reference.
    const input: string = '<doc a1="A & B"></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found space");
  });

  test("not-wf-sa-021", () => {
    // 2.3 [10] — Attribute values may not contain literal '&' characters except as part of an entity
    // reference.
    const input: string = '<doc a1="a&b"></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found '\"'");
  });

  test("not-wf-sa-022", () => {
    // 4.1 [66] — Character references end with semicolons, always!
    const input: string = '<doc a1="&#123:"></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found ':'",
    );
  });

  test("not-wf-sa-023", () => {
    // 2.3 [5] — Digits are not valid name start characters.
    const input: string = '<doc 12="34"></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '12'");
  });

  test("not-wf-sa-024", () => {
    // 2.3 [5] — Digits are not valid name start characters.
    const input: string = "<doc>\r\n<123></123>\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '1'");
  });

  test("not-wf-sa-025", () => {
    // 2.4 [14] — Text may not contain a literal ']]>' sequence.
    const input: string = "<doc>]]></doc>\r\n";
    expectRejects(input, "XML Parse error: ']]>' is only allowed as the end of a CDATA section");
  });

  test("not-wf-sa-026", () => {
    // 2.4 [14] — Text may not contain a literal ']]>' sequence.
    const input: string = "<doc>]]]></doc>\r\n";
    expectRejects(input, "XML Parse error: ']]>' is only allowed as the end of a CDATA section");
  });

  test("not-wf-sa-027", () => {
    // 2.5 [15] — Comments must be terminated with "-->".
    const input: string = "<doc>\r\n<!-- abc\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Unterminated comment");
  });

  test("not-wf-sa-028", () => {
    // 2.6 [16] — Processing instructions must end with '?>'.
    const input: string = "<doc>\r\n<?a pi that is not closed\r\n</doc>\r\n\r\n";
    expectRejects(input, "XML Parse error: Unterminated processing instruction");
  });

  test("not-wf-sa-029", () => {
    // 2.4 [14] — Text may not contain a literal ']]>' sequence.
    const input: string = "<doc>abc]]]>def</doc>\r\n";
    expectRejects(input, "XML Parse error: ']]>' is only allowed as the end of a CDATA section");
  });

  test("not-wf-sa-030", () => {
    // 2.2 [2] — A form feed is not a legal XML character.
    const input: string = "<doc>A form feed (\f) is not legal in data</doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0C");
  });

  test("not-wf-sa-031", () => {
    // 2.2 [2] — A form feed is not a legal XML character.
    const input: string = "<doc><?pi a form feed (\f) is not allowed in a pi?></doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0C");
  });

  test("not-wf-sa-032", () => {
    // 2.2 [2] — A form feed is not a legal XML character.
    const input: string = "<doc><!-- a form feed (\f) is not allowed in a comment --></doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0C");
  });

  test("not-wf-sa-033", () => {
    // 2.2 [2] — An ESC (octal 033) is not a legal XML character.
    const input: string = "<doc>abc\u001bdef</doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1B");
  });

  test("not-wf-sa-034", () => {
    // 2.2 [2] — A form feed is not a legal XML character.
    const input: string = "<doc\f>A form-feed is not white space or a name character</doc\f>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0C");
  });

  test("not-wf-sa-035", () => {
    // 3.1 [43] — The '<' character is a markup delimiter and must start an element, CDATA section, PI, or
    // comment.
    const input: string = "<doc>1 < 2 but not in XML</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found space");
  });

  test("not-wf-sa-036", () => {
    // 2.8 [27] — Text may not appear after the root element.
    const input: string = "<doc></doc>\r\nIllegal data\r\n";
    expectRejects(input, "XML Parse error: Unexpected 'Illegal' after the root element");
  });

  test("not-wf-sa-037", () => {
    // 2.8 [27] — Character references may not appear after the root element.
    const input: string = "<doc></doc>\r\n&#32;\r\n";
    expectRejects(input, "XML Parse error: Unexpected '&' after the root element");
  });

  test("not-wf-sa-038", () => {
    // 3.1 — Tests the "Unique Att Spec" WF constraint by providing multiple values for an attribute.
    const input: string = '<doc x="foo" y="bar" x="baz"></doc>\r\n';
    expectRejects(input, "XML Parse error: Duplicate attribute 'x'");
  });

  test("not-wf-sa-039", () => {
    // 3 — Tests the Element Type Match WFC - end tag name must match start tag name.
    const input: string = "<doc><a></aa></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected closing tag </a> but found </aa>");
  });

  test("not-wf-sa-040", () => {
    // 2.8 [27] — Provides two document elements.
    const input: string = "<doc></doc>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Only one root element is allowed");
  });

  test("not-wf-sa-041", () => {
    // 2.8 [27] — Provides two document elements.
    const input: string = "<doc/>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Only one root element is allowed");
  });

  test("not-wf-sa-042", () => {
    // 3.1 [42] — Invalid End Tag
    const input: string = "<doc/></doc/>\r\n";
    expectRejects(input, "XML Parse error: Unexpected '</doc' after the root element");
  });

  test("not-wf-sa-043", () => {
    // 2.8 [27] — Provides #PCDATA text after the document element.
    const input: string = "<doc/>\r\nIllegal data\r\n";
    expectRejects(input, "XML Parse error: Unexpected 'Illegal' after the root element");
  });

  test("not-wf-sa-044", () => {
    // 2.8 [27] — Provides two document elements.
    const input: string = "<doc/><doc/>\r\n";
    expectRejects(input, "XML Parse error: Only one root element is allowed");
  });

  test("not-wf-sa-045", () => {
    // 3.1 [44] — Invalid Empty Element Tag
    const input: string = "<doc>\r\n<a/\r\n</doc>\r\n\r\n";
    expectRejects(input, "XML Parse error: Expected '>' after '/' but found newline");
  });

  test("not-wf-sa-046", () => {
    // 3.1 [40] — This start (or empty element) tag was not terminated correctly.
    const input: string = "<doc>\r\n<a/</a>\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected '>' after '/' but found '<'");
  });

  test("not-wf-sa-047", () => {
    // 3.1 [44] — Invalid empty element tag invalid whitespace
    const input: string = "<doc>\r\n<a / >\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected '>' after '/' but found space");
  });

  test("not-wf-sa-048", () => {
    // 2.8 [27] — Provides a CDATA section after the root element.
    const input: string = "<doc>\r\n</doc>\r\n<![CDATA[]]>\r\n";
    expectRejects(input, "XML Parse error: CDATA sections are only allowed inside elements");
  });

  test("not-wf-sa-049", () => {
    // 3.1 [40] — Missing start tag
    const input: string = "<doc>\r\n<a><![CDATA[xyz]]]></a>\r\n<![CDATA[]]></a>\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected closing tag </doc> but found </a>");
  });

  test("not-wf-sa-050", () => {
    // 2.1 [1] — Empty document, with no root element.
    const input: string = "";
    expectRejects(input, "XML Parse error: XML document must have a root element");
  });

  test("not-wf-sa-051", () => {
    // 2.7 [18] — CDATA is invalid at top level of document.
    const input: string = "<!-- a comment -->\r\n<![CDATA[]]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: CDATA sections are only allowed inside elements");
  });

  test("not-wf-sa-052", () => {
    // 4.1 [66] — Invalid character reference.
    const input: string = "<!-- a comment -->\r\n&#32;\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected the root element but found '&'");
  });

  test("not-wf-sa-053", () => {
    // 3.1 [42] — End tag does not match start tag.
    const input: string = "<doc></DOC>\r\n";
    expectRejects(input, "XML Parse error: Expected closing tag </doc> but found </DOC>");
  });

  test("not-wf-sa-054", () => {
    // 4.2.2 [75] — PUBLIC requires two literals.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY foo PUBLIC "some public id">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a quoted system identifier after the public identifier but found '>'",
    );
  });

  test("not-wf-sa-055", () => {
    // 2.8 [28] — Invalid Document Type Definition format.
    const input: string = "<!DOCTYPE doc [\r\n<doc></doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '<doc'",
    );
  });

  test("not-wf-sa-056", () => {
    // 2.8 [28] — Invalid Document Type Definition format - misplaced comment.
    const input: string = "<!DOCTYPE doc -- a comment -- []>\r\n<doc></doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '--'",
    );
  });

  test("not-wf-sa-057", () => {
    // 3.2 [45] — This isn't SGML; comments can't exist in declarations.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "whatever" -- a comment -->\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found '--'");
  });

  test("not-wf-sa-058", () => {
    // 3.3.1 [54] — Invalid character , in ATTLIST enumeration
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 (foo,bar) #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found ','");
  });

  test("not-wf-sa-059", () => {
    // 3.3.1 [59] — String literal must be in quotes.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 NMTOKEN v1>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found 'v1'",
    );
  });

  test("not-wf-sa-060", () => {
    // 3.3.1 [56] — Invalid type NAME defined in ATTLIST.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 NAME #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NAME'",
    );
  });

  test("not-wf-sa-061", () => {
    // 4.2.2 [75] — External entity declarations require whitespace between public and system IDs.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e PUBLIC "whatever""e.ent">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("not-wf-sa-062", () => {
    // 4.2 [71] — Entity declarations need space after the entity name.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY foo"some text">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("not-wf-sa-063", () => {
    // 2.8 [29] — Conditional sections may only appear in the external DTD subset.
    const input: string = "<!DOCTYPE doc [\r\n<![INCLUDE[ ]]>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Conditional sections are only allowed in the external DTD subset");
  });

  test("not-wf-sa-064", () => {
    // 3.3 [53] — Space is required between attribute type and default values in <!ATTLIST...>
    // declarations.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST e a1 CDATA"foo">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("not-wf-sa-065", () => {
    // 3.3 [53] — Space is required between attribute name and type in <!ATTLIST...> declarations.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1(foo|bar) #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("not-wf-sa-066", () => {
    // 3.3 [52] — Required whitespace is missing.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 (foo|bar)#IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Whitespace is required before '#IMPLIED'");
  });

  test("not-wf-sa-067", () => {
    // 3.3 [53] — Space is required between attribute type and default values in <!ATTLIST...>
    // declarations.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 (foo)"foo">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("not-wf-sa-068", () => {
    // 3.3.1 [58] — Space is required between NOTATION keyword and list of enumerated choices in
    // <!ATTLIST...> declarations.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 NOTATION(foo) #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("not-wf-sa-069", () => {
    // 4.2.2 [76] — Space is required before an NDATA entity annotation.
    const input: string =
      '<!DOCTYPE doc [\r\n<!NOTATION eps SYSTEM "eps.exe">\r\n<!-- missing space before NDATA -->\r\n<!ENTITY foo SYSTEM "foo.eps"NDATA eps>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'NDATA'");
  });

  test("not-wf-sa-070", () => {
    // 2.5 [16] — XML comments may not contain "--"
    const input: string = "<!-- a comment ending with three dashes --->\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: '--' is not allowed inside a comment");
  });

  test("not-wf-sa-071", () => {
    // 4.1 [68] — ENTITY can't reference itself directly or indirectly.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e1 "&e2;">\r\n<!ENTITY e2 "&e3;">\r\n<!ENTITY e3 "&e1;">\r\n]>\r\n<doc>&e1;</doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'e1' refers to itself");
  });

  test("not-wf-sa-072", () => {
    // 4.1 [68] — Undefined ENTITY foo.
    const input: string = "<doc>&foo;</doc>\r\n";
    expectRejects(input, "XML Parse error: Entity 'foo' is not declared");
  });

  test("not-wf-sa-073", () => {
    // 4.1 [68] — Undefined ENTITY f.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "whatever">\r\n]>\r\n<doc>&f;</doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'f' is not declared");
  });

  test("not-wf-sa-074", () => {
    // 4.3.2 — Internal general parsed entities are only well formed if they match the "content"
    // production.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "</foo><foo>">\r\n]>\r\n<doc>\r\n<foo>&e;</foo>\r\n</doc>\r\n';
    expectRejects(input, "XML Parse error: Element 'foo' must start and end within the same entity");
  });

  test("not-wf-sa-075", () => {
    // 4.1 [68] — ENTITY can't reference itself directly or indirectly.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e1 "&e2;">\r\n<!ENTITY e2 "&e3;">\r\n<!ENTITY e3 "&e1;">\r\n]>\r\n<doc a="&e1;"></doc>\r\n\r\n';
    expectRejects(input, "XML Parse error: Entity 'e1' refers to itself");
  });

  test("not-wf-sa-076", () => {
    // 4.1 [68] — Undefined ENTITY foo.
    const input: string = '<doc a="&foo;"></doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'foo' is not declared");
  });

  test("not-wf-sa-077", () => {
    // 41. [68] — Undefined ENTITY bar.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY foo "&bar;">\r\n]>\r\n<doc a="&foo;"></doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'bar' is not declared");
  });

  test("not-wf-sa-078", () => {
    // 4.1 [68] — Undefined ENTITY foo.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA "&foo;">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'foo' is not declared");
  });

  test("not-wf-sa-079", () => {
    // 4.1 [68] — ENTITY can't reference itself directly or indirectly.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e1 "&e2;">\r\n<!ENTITY e2 "&e3;">\r\n<!ENTITY e3 "&e1;">\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA "&e1;">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'e1' refers to itself");
  });

  test("not-wf-sa-080", () => {
    // 4.1 [68] — ENTITY can't reference itself directly or indirectly.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e1 "&e2;">\r\n<!ENTITY e2 "&e3;">\r\n<!ENTITY e3 "&e1;">\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #FIXED "&e1;">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'e1' refers to itself");
  });

  test("not-wf-sa-081", () => {
    // 3.1 — This tests the No External Entity References WFC, since the entity is referred to within an
    // attribute. (upstream: not-wf; external general entities are not read)
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e SYSTEM "nul">\r\n]>\r\n<doc a="&e;"></doc>\r\n';
    expectRejects(input, "XML Parse error: Attribute values cannot reference external entity 'e'");
  });

  test("not-wf-sa-082", () => {
    // 3.1 — This tests the No External Entity References WFC, since the entity is referred to within an
    // attribute. (upstream: not-wf; external general entities are not read)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e SYSTEM "nul">\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA "&e;">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Attribute values cannot reference external entity 'e'");
  });

  test("not-wf-sa-083", () => {
    // 4.2.2 [76] — Undefined NOTATION n.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e SYSTEM "nul" NDATA n>\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectRejects(input, "XML Parse error: Unparsed entity 'e' cannot be referenced");
  });

  test("not-wf-sa-084", () => {
    // 4.1 — Tests the Parsed Entity WFC by referring to an unparsed entity. (This precedes the error of
    // not declaring that entity's notation, which may be detected any time before the DTD parsing is
    // completed.)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e SYSTEM "nul" NDATA n>\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA "&e;">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Unparsed entity 'e' cannot be referenced");
  });

  test("not-wf-sa-085", () => {
    // 2.3 [13] — Public IDs may not contain "[".
    const input: string = '<!DOCTYPE doc PUBLIC "[" "null.ent">\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '['");
  });

  test("not-wf-sa-086", () => {
    // 2.3 [13] — Public IDs may not contain "[".
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY foo PUBLIC "[" "null.xml">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '['");
  });

  test("not-wf-sa-087", () => {
    // 2.3 [13] — Public IDs may not contain "[".
    const input: string = '<!DOCTYPE doc [\r\n<!NOTATION foo PUBLIC "[" "null.ent">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '['");
  });

  test("not-wf-sa-088", () => {
    // 2.3 [10] — Attribute values are terminated by literal quote characters, and any entity expansion is
    // done afterwards.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n<!ENTITY e '\"'>\r\n]>\r\n<doc a=\"&e;></doc>\r\n";
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("not-wf-sa-089", () => {
    // 4.2 [74] — Parameter entities "are" always parsed; NDATA annotations are not permitted.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY % foo SYSTEM "foo.xml" NDATA bar>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Parameter entities cannot have NDATA");
  });

  test("not-wf-sa-090", () => {
    // 2.3 [10] — Attributes may not contain a literal "<" character; this one has one because of reference
    // expansion.
    const input: string = "<!DOCTYPE doc [\r\n<!ENTITY e \"<foo a='&#60;'></foo>\">\r\n]>\r\n<doc>&e;</doc>\r\n";
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("not-wf-sa-091", () => {
    // 4.2 [74] — Parameter entities "are" always parsed; NDATA annotations are not permitted.
    const input: string =
      '<!DOCTYPE doc [\r\n<!NOTATION n SYSTEM "n">\r\n<!ENTITY % foo SYSTEM "foo.xml" NDATA n>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Parameter entities cannot have NDATA");
  });

  test("not-wf-sa-092", () => {
    // 4.5 — The replacement text of this entity has an illegal reference, because the character reference
    // is expanded immediately.
    const input: string = "<!DOCTYPE doc [\r\n<!ENTITY e \"<foo a='&#38;'></foo>\">\r\n]>\r\n<doc>&e;</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found '''");
  });

  test("not-wf-sa-093", () => {
    // 4.1 [66] — Hexadecimal character references may not use the uppercase 'X'.
    const input: string = "<doc>&#X58;</doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found 'X'",
    );
  });

  test("not-wf-sa-094", () => {
    // 2.8 [24] — Prolog VERSION must be lowercase.
    const input: string = '<?xml VERSION="1.0"?>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected version=\"1.0\" in the XML declaration but found 'VERSION'");
  });

  test("not-wf-sa-095", () => {
    // 2.8 [23] — VersionInfo must come before EncodingDecl.
    const input = Buffer.from('<?xml encoding="UTF-8" version="1.0"?>\r\n<doc></doc>\r\n');
    expectRejects(input, 'XML Parse error: The XML declaration must start with version="1.0"');
  });

  test("not-wf-sa-096", () => {
    // 2.9 [32] — Space is required before the standalone declaration.
    const input = Buffer.from('<?xml version="1.0"encoding="UTF-8" ?>\r\n<doc></doc>');
    expectRejects(input, "XML Parse error: Whitespace is required before 'encoding'");
  });

  test("not-wf-sa-097", () => {
    // 2.8 [24] — Both quotes surrounding VersionNum must be the same.
    const input = Buffer.from('<?xml version="1.0\' encoding="UTF-8" ?>\r\n<doc></doc>');
    expectRejects(input, "XML Parse error: Unsupported XML version '1.0' encoding=' (this is an XML 1.0 parser)");
  });

  test("not-wf-sa-098", () => {
    // 2.8 [23] — Only one "version=..." string may appear in an XML declaration.
    const input: string = '<?xml version="1.0" version="1.0"?>\r\n<doc></doc>';
    expectRejects(
      input,
      "XML Parse error: Misplaced 'version' in the XML declaration (the order is version, encoding, standalone)",
    );
  });

  test("not-wf-sa-099", () => {
    // 2.8 [23] — Only three pseudo-attributes are in the XML declaration, and "valid=..." is not one of
    // them.
    const input: string = '<?xml version="1.0" valid="no" ?>\r\n<doc></doc>';
    expectRejects(
      input,
      "XML Parse error: Unexpected 'valid' in the XML declaration (expected version, encoding or standalone)",
    );
  });

  test("not-wf-sa-100", () => {
    // 2.9 [32] — Only "yes" and "no" are permitted as values of "standalone".
    const input: string = '<?xml version="1.0" standalone="YES" ?>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid value 'YES' for standalone in the XML declaration (expected yes or no)",
    );
  });

  test("not-wf-sa-101", () => {
    // 4.3.3 [81] — Space is not permitted in an encoding name.
    const input = Buffer.from('<?xml version="1.0" encoding=" UTF-8"?>\r\n<doc></doc>\r\n');
    expectRejects(input, "XML Parse error: Invalid encoding name ' UTF-8' in the XML declaration");
  });

  test("not-wf-sa-102", () => {
    // 2.8 [26] — Provides an illegal XML version number; spaces are illegal.
    const input: string = '<?xml version="1.0 " ?>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Unsupported XML version '1.0 ' (this is an XML 1.0 parser)");
  });

  test("not-wf-sa-103", () => {
    // 4.3.2 — End-tag required for element foo.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#60;foo>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected closing tag </foo> but found </doc>");
  });

  test("not-wf-sa-104", () => {
    // 4.3.2 — Internal general parsed entities are only well formed if they match the "content"
    // production.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "<foo>">\r\n]>\r\n<doc>&e;</foo></doc>\r\n';
    expectRejects(input, "XML Parse error: Element 'foo' must start and end within the same entity");
  });

  test("not-wf-sa-105", () => {
    // 2.7  — Invalid placement of CDATA section.
    const input: string = "<?pi stuff?>\r\n<![CDATA[]]>\r\n<doc>\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: CDATA sections are only allowed inside elements");
  });

  test("not-wf-sa-106", () => {
    // 4.2 — Invalid placement of entity declaration.
    const input: string = "<?pi data?>\r\n&#32;<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected the root element but found '&'");
  });

  test("not-wf-sa-107", () => {
    // 2.8 [28] — Invalid document type declaration. CDATA alone is invalid.
    const input: string = "<!DOCTYPE doc [\r\n<![CDATA[]]>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: CDATA sections are only allowed inside elements");
  });

  test("not-wf-sa-108", () => {
    // 2.7 [19] — No space in '<![CDATA['.
    const input: string = "<doc>\r\n<![CDATA [  ]]>\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("not-wf-sa-109", () => {
    // 4.2 [70] — Tags invalid within EntityDecl.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "<doc></doc>">\r\n]>\r\n&e;\r\n';
    expectRejects(input, "XML Parse error: Expected the root element but found '&'");
  });

  test("not-wf-sa-110", () => {
    // 4.1 [68] — Entity reference must be in content of element.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "">\r\n]>\r\n<doc></doc>\r\n&e;\r\n';
    expectRejects(input, "XML Parse error: Unexpected '&' after the root element");
  });

  test("not-wf-sa-111", () => {
    // 3.1 [43] — Entiry reference must be in content of element not Start-tag.
    const input: string = "<!DOCTYPE doc [\r\n<!ENTITY e \"foo='bar'\">\r\n]>\r\n<doc &e;></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '&'");
  });

  test("not-wf-sa-112", () => {
    // 2.7 [19] — CDATA sections start '<![CDATA[', not '<!cdata['.
    const input: string = "<doc>\r\n<![cdata[data]]>\r\n</doc>\r\n";
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("not-wf-sa-113", () => {
    // 2.3 [9] — Parameter entity values must use valid reference syntax; this reference is malformed.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY % foo "&">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found '\"'");
  });

  test("not-wf-sa-114", () => {
    // 2.3 [9] — General entity values must use valid reference syntax; this reference is malformed.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY foo "&">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found '\"'");
  });

  test("not-wf-sa-115", () => {
    // 4.5 — The replacement text of this entity is an illegal character reference, which must be rejected
    // when it is parsed in the context of an attribute value.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#38;">\r\n]>\r\n<doc a="&e;"></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found the end of entity 'e'");
  });

  test("not-wf-sa-116", () => {
    // 4.3.2 — Internal general parsed entities are only well formed if they match the "content"
    // production. This is a partial character reference, not a full one.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#38;#9">\r\n]>\r\n<doc>&e;7;</doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found the end of entity 'e'",
    );
  });

  test("not-wf-sa-117", () => {
    // 4.3.2 — Internal general parsed entities are only well formed if they match the "content"
    // production. This is a partial character reference, not a full one.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#38;">\r\n]>\r\n<doc>&e;#97;</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found the end of entity 'e'");
  });

  test("not-wf-sa-118", () => {
    // 4.1 [68] — Entity reference expansion is not recursive.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "#">\r\n]>\r\n<doc>&&e;97;</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found '&'");
  });

  test("not-wf-sa-119", () => {
    // 4.3.2 — Internal general parsed entities are only well formed if they match the "content"
    // production. This is a partial character reference, not a full one.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#38;">\r\n]>\r\n<doc>\r\n&e;#38;\r\n</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found the end of entity 'e'");
  });

  test("not-wf-sa-120", () => {
    // 4.5 — Character references are expanded in the replacement text of an internal entity, which is then
    // parsed as usual. Accordingly, & must be doubly quoted - encoded either as &amp; or as &#38;#38;.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#38;">\r\n]>\r\n<doc>\r\n&e;\r\n</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found the end of entity 'e'");
  });

  test("not-wf-sa-121", () => {
    // 4.1 [68] — A name of an ENTITY was started with an invalid character.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY #DEFAULT "default">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name or '%' after '<!ENTITY' but found '#DEFAULT'");
  });

  test("not-wf-sa-122", () => {
    // 3.2.1 [47] — Invalid syntax mixed connectors are used.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (a, (b) | c)?>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: A content model group cannot mix ',' and '|'");
  });

  test("not-wf-sa-123", () => {
    // 3.2.1 [48] — Invalid syntax mismatched parenthesis.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc ((doc?)))>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found ')'");
  });

  test("not-wf-sa-124", () => {
    // 3.2.2 [51] — Invalid format of Mixed-content declaration.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (doc|#PCDATA)*>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: #PCDATA must come first in a content model, as (#PCDATA|a|b)*");
  });

  test("not-wf-sa-125", () => {
    // 3.2.2 [51] — Invalid syntax extra set of parenthesis not necessary.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc ((#PCDATA))>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: #PCDATA must come first in a content model, as (#PCDATA|a|b)*");
  });

  test("not-wf-sa-126", () => {
    // 3.2.2 [51] — Invalid syntax Mixed-content must be defined as zero or more.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)+>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: A mixed content model may only be followed by '*'");
  });

  test("not-wf-sa-127", () => {
    // 3.2.2 [51] — Invalid syntax Mixed-content must be defined as zero or more.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)?>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: A mixed content model may only be followed by '*'");
  });

  test("not-wf-sa-128", () => {
    // 2.7 [18] — Invalid CDATA syntax.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc CDATA>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'CDATA'");
  });

  test("not-wf-sa-129", () => {
    // 3.2 [45] — Invalid syntax for Element Type Declaration.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc - - (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '-'");
  });

  test("not-wf-sa-130", () => {
    // 3.2 [45] — Invalid syntax for Element Type Declaration.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (doc?) +(foo)>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("not-wf-sa-131", () => {
    // 3.2 [45] — Invalid syntax for Element Type Declaration.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (doc?) -(foo)>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '-'");
  });

  test("not-wf-sa-132", () => {
    // 3.2.1 [50] — Invalid syntax mixed connectors used.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (a, (b, c), (d, (e, f) | g))?>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: A content model group cannot mix ',' and '|'");
  });

  test("not-wf-sa-133", () => {
    // 3.2.1 — Illegal whitespace before optional character causes syntax error.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (a *)>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("not-wf-sa-134", () => {
    // 3.2.1 — Illegal whitespace before optional character causes syntax error.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (a) *>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("not-wf-sa-135", () => {
    // 3.2.1 [47] — Invalid character used as connector.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (a & b)?>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found '&'");
  });

  test("not-wf-sa-136", () => {
    // 3.2 [45] — Tag omission is invalid in XML.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc O O (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'O'");
  });

  test("not-wf-sa-137", () => {
    // 3.2 [45] — Space is required before a content model.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc(#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("not-wf-sa-138", () => {
    // 3.2.1 [48] — Invalid syntax for content particle.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (doc*?)>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found '?'");
  });

  test("not-wf-sa-139", () => {
    // 3.2.1 [46] — The element-content model should not be empty.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc ()>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found ')'");
  });

  test("not-wf-sa-142", () => {
    // 2.2 [2] — Character #x0000 is not legal anywhere in an XML document.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#0;</doc>\r\n";
    expectRejects(input, "XML Parse error: Character reference '&#0;' is not a valid XML character");
  });

  test("not-wf-sa-143", () => {
    // 2.2 [2] — Character #x001F is not legal anywhere in an XML document.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#31;</doc>\r\n";
    expectRejects(input, "XML Parse error: Character reference '&#31;' is not a valid XML character");
  });

  test("not-wf-sa-144", () => {
    // 2.2 [2] — Character #xFFFF is not legal anywhere in an XML document.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#xFFFF;</doc>\r\n";
    expectRejects(input, "XML Parse error: Character reference '&#xFFFF;' is not a valid XML character");
  });

  test("not-wf-sa-145", () => {
    // 2.2 [2] — Character #xD800 is not legal anywhere in an XML document. (If it appeared in a UTF-16
    // surrogate pair, it'd represent half of a UCS-4 character and so wouldn't really be in the document.)
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#xD800;</doc>\r\n";
    expectRejects(input, "XML Parse error: Character reference '&#xD800;' is not a valid XML character");
  });

  test("not-wf-sa-146", () => {
    // 2.2 [2] — Character references must also refer to legal XML characters; #x00110000 is one more than
    // the largest legal character.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#x110000;</doc>\r\n";
    expectRejects(input, "XML Parse error: Character reference '&#x110000;' is not a valid XML character");
  });

  test("not-wf-sa-147", () => {
    // 2.8 [22] — XML Declaration may not be preceded by whitespace.
    const input: string = '\r\n<?xml version="1.0"?>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-148", () => {
    // 2.8 [22] — XML Declaration may not be preceded by comments or whitespace.
    const input: string = '<!-- -->\r\n<?xml version="1.0"?>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-149", () => {
    // 2.8 [28] — XML Declaration may not be within a DTD.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<?xml version="1.0"?>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-150", () => {
    // 3.1 [43] — XML declarations may not be within element content.
    const input: string = '<doc>\r\n<?xml version="1.0"?>\r\n</doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-151", () => {
    // 2.8 [27] — XML declarations may not follow document content.
    const input: string = '<doc>\r\n</doc>\r\n<?xml version="1.0"?>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-152", () => {
    // 2.8 [22] — XML declarations must include the "version=..." string.
    const input = Buffer.from('<?xml encoding="UTF-8"?>\r\n<doc></doc>\r\n');
    expectRejects(input, 'XML Parse error: The XML declaration must start with version="1.0"');
  });

  test("not-wf-sa-153", () => {
    // 4.3.2 — Text declarations may not begin internal parsed entities; they may only appear at the
    // beginning of external parsed (parameter or general) entities.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e \"<?xml encoding='UTF-8'?>\">\r\n]>\r\n<doc>&e;</doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-154", () => {
    // 2.8 2.6 [23, 17] — '<?XML ...?>' is neither an XML declaration nor a legal processing instruction
    // target name.
    const input: string = '<?XML version="1.0"?>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-155", () => {
    // 2.8 2.6 [23, 17] — '<?xmL ...?>' is neither an XML declaration nor a legal processing instruction
    // target name.
    const input: string = '<?xmL version="1.0"?>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-156", () => {
    // 2.8 2.6 [23, 17] — '<?xMl ...?>' is neither an XML declaration nor a legal processing instruction
    // target name.
    const input: string = '<doc>\r\n<?xMl version="1.0"?>\r\n</doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-157", () => {
    // 2.6 [17] — '<?xmL ...?>' is not a legal processing instruction target name.
    const input: string = "<doc>\r\n<?xmL?>\r\n</doc>\r\n";
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-sa-158", () => {
    // 3.3 [52] — SGML-ism: "#NOTATION gif" can't have attributes.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION gif PUBLIC "image/gif" "">\r\n<!ATTLIST #NOTATION gif a1 CDATA #IMPLIED>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<!ATTLIST' but found '#NOTATION'");
  });

  test("not-wf-sa-159", () => {
    // 2.3 [9] — Uses '&' unquoted in an entity declaration, which is illegal syntax for an entity
    // reference.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "<![CDATA[Tim & Michael]]>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found space");
  });

  test("not-wf-sa-160", () => {
    // 2.8 — Violates the PEs in Internal Subset WFC by using a PE reference within a declaration.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e "">\r\n<!ENTITY foo "%e;">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("not-wf-sa-161", () => {
    // 2.8 — Violates the PEs in Internal Subset WFC by using a PE reference within a declaration.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY % e "#PCDATA">\r\n<!ELEMENT doc (%e;)>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("not-wf-sa-162", () => {
    // 2.8 — Violates the PEs in Internal Subset WFC by using a PE reference within a declaration.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e1 "">\r\n<!ENTITY % e2 "%e1;">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("not-wf-sa-163", () => {
    // 4.1 [69] — Invalid placement of Parameter entity reference.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e "">\r\n]>\r\n%e;\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Markup declarations and parameter-entity references are only allowed in the document type declaration",
    );
  });

  test("not-wf-sa-164", () => {
    // 4.1 [69] — Invalid placement of Parameter entity reference.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e "">\r\n] %e; >\r\n<doc></doc>\r\n';
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("not-wf-sa-165", () => {
    // 4.2 [72] — Parameter entity declarations must have a space before the '%'.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY% e "">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before '%'");
  });

  test("not-wf-sa-166", () => {
    // 2.2 [2] — Character FFFF is not legal anywhere in an XML document.
    const input: string = "<doc>\uffff</doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("not-wf-sa-167", () => {
    // 2.2 [2] — Character FFFE is not legal anywhere in an XML document.
    const input: string = "<doc>\ufffe</doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\ufffe' (U+FFFE)");
  });

  test("not-wf-sa-168", () => {
    // 2.2 [2] — An unpaired surrogate (D800) is not legal anywhere in an XML document.
    const input = Buffer.from("PGRvYz7toIA8L2RvYz4NCg==", "base64");
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("not-wf-sa-169", () => {
    // 2.2 [2] — An unpaired surrogate (DC00) is not legal anywhere in an XML document.
    const input = Buffer.from("PGRvYz7tsIA8L2RvYz4NCg==", "base64");
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("not-wf-sa-170", () => {
    // 2.2 [2] — Four byte UTF-8 encodings can encode UCS-4 characters which are beyond the range of legal
    // XML characters (and can't be expressed in Unicode surrogate pairs). This document holds such a
    // character.
    const input = Buffer.from("PGRvYz73gICAPC9kb2M+DQo=", "base64");
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("not-wf-sa-171", () => {
    // 2.2 [2] — Character FFFF is not legal anywhere in an XML document.
    const input: string = "<!-- \uffff -->\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("not-wf-sa-172", () => {
    // 2.2 [2] — Character FFFF is not legal anywhere in an XML document.
    const input: string = "<?pi \uffff?>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("not-wf-sa-173", () => {
    // 2.2 [2] — Character FFFF is not legal anywhere in an XML document.
    const input: string = '<doc a="\uffff"></doc>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("not-wf-sa-174", () => {
    // 2.2 [2] — Character FFFF is not legal anywhere in an XML document.
    const input: string = "<doc><![CDATA[\uffff]]></doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("not-wf-sa-175", () => {
    // 2.2 [2] — Character FFFF is not legal anywhere in an XML document.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e "\uffff">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("not-wf-sa-176", () => {
    // 3 [39] — Start tags must have matching end tags.
    const input: string = "<!DOCTYPE doc [\n<!ELEMENT doc (#PCDATA)>\n]>\n<doc>\n";
    expectRejects(input, "XML Parse error: Missing closing tag for element 'doc'");
  });

  test("not-wf-sa-177", () => {
    // 2.2 [2] — Character FFFF is not legal anywhere in an XML document.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>A\uffff</doc>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("not-wf-sa-178", () => {
    // 3.1 [41] — Invalid syntax matching double quote is missing.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="&#34;></doc>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("not-wf-sa-179", () => {
    // 4.1 [66] — Invalid syntax matching double quote is missing.
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#34;>\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Unterminated entity value");
  });

  test("not-wf-sa-180", () => {
    // 4.1 — The Entity Declared WFC requires entities to be declared before they are used in an attribute
    // list declaration.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA "&e;">\r\n<!ENTITY e "v">\r\n]>\r\n<doc></doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'e' is not declared");
  });

  test("not-wf-sa-181", () => {
    // 4.3.2 — Internal parsed entities must match the content production to be well formed.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e "&#60;![CDATA[">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&e;]]></doc>\r\n';
    expectRejects(input, "XML Parse error: Unterminated CDATA section");
  });

  test("not-wf-sa-182", () => {
    // 4.3.2 — Internal parsed entities must match the content production to be well formed.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e "&#60;!--">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&e;--></doc>\r\n';
    expectRejects(input, "XML Parse error: Unterminated comment");
  });

  test("not-wf-sa-183", () => {
    // 3.2.2 [51] — Mixed content declarations may not include content particles.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA | foo*)* >\r\n<!ELEMENT foo EMPTY>\r\n]>\r\n<doc></doc>\r\n";
    expectRejects(input, "XML Parse error: Names in a mixed content model cannot have occurrence indicators");
  });

  test("not-wf-sa-184", () => {
    // 3.2.2 [51] — In mixed content models, element names must not be parenthesized.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA | (foo))* >\r\n<!ELEMENT foo EMPTY>\r\n]>\r\n<doc></doc>\r\n\r\n";
    expectRejects(input, "XML Parse error: Only element names may follow #PCDATA in a mixed content model");
  });

  test("not-wf-sa-185", () => {
    // 4.1 — Tests the Entity Declared WFC. Note: a nonvalidating parser is permitted not to report this
    // WFC violation, since it would need to read an external parameter entity to distinguish it from a
    // violation of the Standalone Declaration VC. (upstream: not-wf; external parameter entities are not
    // read)
    const input: string =
      '<?xml version="1.0" standalone="yes"?>\r\n<!DOCTYPE doc SYSTEM "185.ent">\r\n<doc>&e;</doc>\r\n';
    expectRejects(input, "XML Parse error: Entity 'e' is not declared");
  });

  test("not-wf-sa-186", () => {
    // 3.1 [44] — Whitespace is required between attribute/value pairs.
    const input: string =
      '<!DOCTYPE a [\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a b CDATA #IMPLIED d CDATA #IMPLIED>\r\n]>\r\n<a b="c"d="e"/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'd'");
  });

  test("not-wf-not-sa-001", () => {
    // 3.4 [62] — Conditional sections must be properly terminated ("]>" used instead of "]]>"). (upstream:
    // not-wf; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "001.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-not-sa-002", () => {
    // 2.6 [17] — Processing instruction target names may not be "XML" in any combination of cases.
    // (upstream: not-wf; external general and parameter entities are not read)
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e \"<?xml version='1.0' encoding='UTF-8'?>\">\r\n%e;\r\n]>\r\n<doc></doc>";
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("not-wf-not-sa-003", () => {
    // 3.4 [62] — Conditional sections must be properly terminated ("]]>" omitted). (upstream: not-wf;
    // external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "003.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-not-sa-004", () => {
    // 3.4 [62] — Conditional sections must be properly terminated ("]]>" omitted). (upstream: not-wf;
    // external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "004.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-not-sa-005", () => {
    // 4.1 — Tests the Entity Declared VC by referring to an undefined parameter entity within an external
    // entity. (upstream: optional error)
    const input: string = '<!DOCTYPE doc SYSTEM "005.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-not-sa-006", () => {
    // 3.4 [62] — Conditional sections need a '[' after the INCLUDE or IGNORE. (upstream: not-wf; external
    // general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "006.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-not-sa-007", () => {
    // 4.3.2 [79] — A <!DOCTYPE ...> declaration may not begin any external entity; it's only found once,
    // in the document entity. (upstream: not-wf; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "007.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-not-sa-008", () => {
    // 4.1 [69] — In DTDs, the '%' character must be part of a parameter entity reference. (upstream:
    // not-wf; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "008.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-not-sa-009", () => {
    // 2.8 — This test violates WFC:PE Between Declarations in Production 28a. The last character of a
    // markup declaration is not contained in the same parameter-entity text replacement. (upstream:
    // not-wf; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "009.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("not-wf-ext-sa-001", () => {
    // 4.1 — Tests the No Recursion WFC by having an external general entity be self-recursive. (upstream:
    // not-wf; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e SYSTEM "001.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("not-wf-ext-sa-002", () => {
    // 4.3.1 4.3.2 [77, 78] — External entities have "text declarations", which do not permit the
    // "standalone=..." attribute that's allowed in XML declarations. (upstream: not-wf; external general
    // and parameter entities are not read)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "002.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("not-wf-ext-sa-003", () => {
    // 2.6 [17] — Only one text declaration is permitted; a second one looks like an illegal processing
    // instruction (target names of "xml" in any case are not allowed). (upstream: not-wf; external general
    // and parameter entities are not read)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "003.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("invalid--002", () => {
    // 3.2.1 — Tests the "Proper Group/PE Nesting" validity constraint by fragmenting a content model
    // between two parameter entities. (upstream: invalid; external general and parameter entities are not
    // read)
    const input: string = '<!DOCTYPE doc SYSTEM "002.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("invalid--005", () => {
    // 2.8 — Tests the "Proper Declaration/PE Nesting" validity constraint by fragmenting an element
    // declaration between two parameter entities. (upstream: invalid; external general and parameter
    // entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "005.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("invalid--006", () => {
    // 2.8 — Tests the "Proper Declaration/PE Nesting" validity constraint by fragmenting an element
    // declaration between two parameter entities. (upstream: invalid; external general and parameter
    // entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "006.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("invalid-not-sa-022", () => {
    // 3.4 [62] — Test the "Proper Conditional Section/ PE Nesting" validity constraint. (upstream:
    // invalid; external general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "022.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-sa-001", () => {
    // 3.2.2 [51] — Test demonstrates an Element Type Declaration with Mixed Content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-002", () => {
    // 3.1 [40] — Test demonstrates that whitespace is permitted after the tag name in a Start-tag.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc ></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-003", () => {
    // 3.1 [42] — Test demonstrates that whitespace is permitted after the tag name in an End-tag.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc >\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-004", () => {
    // 3.1 [41] — Test demonstrates a valid attribute specification within a Start-tag.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n]>\r\n<doc a1="v1"></doc>\r\n';
    const canonical = '<doc a1="v1"></doc>';
    const compact: unknown = { doc: { "@a1": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-005", () => {
    // 3.1 [40] — Test demonstrates a valid attribute specification within a Start-tag that contains
    // whitespace on both sides of the equal sign.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n]>\r\n<doc a1 = "v1"></doc>\r\n';
    const canonical = '<doc a1="v1"></doc>';
    const compact: unknown = { doc: { "@a1": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-006", () => {
    // 3.1 [41] — Test demonstrates that the AttValue within a Start-tag can use a single quote as a
    // delimter.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n]>\r\n<doc a1='v1'></doc>\r\n";
    const canonical = '<doc a1="v1"></doc>';
    const compact: unknown = { doc: { "@a1": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-007", () => {
    // 3.1 4.6 [43] — Test demonstrates numeric character references can be used for element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#32;</doc>\r\n";
    const canonical = "<doc> </doc>";
    const compact: unknown = { doc: " " };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-008", () => {
    // 2.4 3.1 [43] — Test demonstrates character references can be used for element content.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&amp;&lt;&gt;&quot;&apos;</doc>\r\n";
    const canonical = "<doc>&amp;&lt;&gt;&quot;'</doc>";
    const compact: unknown = { doc: "&<>\"'" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-009", () => {
    // 2.3 3.1 [43] — Test demonstrates that PubidChar can be used for element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#x20;</doc>\r\n";
    const canonical = "<doc> </doc>";
    const compact: unknown = { doc: " " };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-010", () => {
    // 3.1 [40] — Test demonstrates that whitespace is valid after the Attribute in a Start-tag.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n]>\r\n<doc a1="v1" ></doc>\r\n';
    const canonical = '<doc a1="v1"></doc>';
    const compact: unknown = { doc: { "@a1": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-011", () => {
    // 3.1 [40] — Test demonstrates mutliple Attibutes within the Start-tag.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED a2 CDATA #IMPLIED>\r\n]>\r\n<doc a1="v1" a2="v2"></doc>\r\n';
    const canonical = '<doc a1="v1" a2="v2"></doc>';
    const compact: unknown = { doc: { "@a1": "v1", "@a2": "v2" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-012", () => {
    // 2.3 [4] — Uses a legal XML 1.0 name consisting of a single colon character (disallowed by the latest
    // XML Namespaces draft).
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc : CDATA #IMPLIED>\r\n]>\r\n<doc :="v1"></doc>\r\n';
    const canonical = '<doc :="v1"></doc>';
    const compact: unknown = { doc: { "@:": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-013", () => {
    // 2.3 3.1 [13] [40] — Test demonstrates that the Attribute in a Start-tag can consist of numerals
    // along with special characters.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc _.-0123456789 CDATA #IMPLIED>\r\n]>\r\n<doc _.-0123456789="v1"></doc>\r\n';
    const canonical = '<doc _.-0123456789="v1"></doc>';
    const compact: unknown = { doc: { "@_.-0123456789": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-014", () => {
    // 2.3 3.1 [13] [40] — Test demonstrates that all lower case letters are valid for the Attribute in a
    // Start-tag.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc abcdefghijklmnopqrstuvwxyz CDATA #IMPLIED>\r\n]>\r\n<doc abcdefghijklmnopqrstuvwxyz="v1"></doc>\r\n';
    const canonical = '<doc abcdefghijklmnopqrstuvwxyz="v1"></doc>';
    const compact: unknown = { doc: { "@abcdefghijklmnopqrstuvwxyz": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-015", () => {
    // 2.3 3.1 [13] [40] — Test demonstrates that all upper case letters are valid for the Attribute in a
    // Start-tag.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc ABCDEFGHIJKLMNOPQRSTUVWXYZ CDATA #IMPLIED>\r\n]>\r\n<doc ABCDEFGHIJKLMNOPQRSTUVWXYZ="v1"></doc>\r\n';
    const canonical = '<doc ABCDEFGHIJKLMNOPQRSTUVWXYZ="v1"></doc>';
    const compact: unknown = { doc: { "@ABCDEFGHIJKLMNOPQRSTUVWXYZ": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-016", () => {
    // 2.6 3.1 [16] [43] — Test demonstrates that Processing Instructions are valid element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><?pi?></doc>\r\n";
    const canonical = "<doc><?pi ?></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-017", () => {
    // 2.6 3.1 [16] [43] — Test demonstrates that Processing Instructions are valid element content and
    // there can be more than one.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><?pi some data ?><?x?></doc>\r\n";
    const canonical = "<doc><?pi some data ?><?x ?></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-018", () => {
    // 2.7 3.1 [18] [43] — Test demonstrates that CDATA sections are valid element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><![CDATA[<foo>]]></doc>\r\n";
    const canonical = "<doc>&lt;foo&gt;</doc>";
    const compact: unknown = { doc: "<foo>" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-019", () => {
    // 2.7 3.1 [18] [43] — Test demonstrates that CDATA sections are valid element content and that
    // ampersands may occur in their literal form.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><![CDATA[<&]]></doc>\r\n";
    const canonical = "<doc>&lt;&amp;</doc>";
    const compact: unknown = { doc: "<&" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-020", () => {
    // 2.7 3.1 [18] [43] — Test demonstractes that CDATA sections are valid element content and that
    // everyting between the CDStart and CDEnd is recognized as character data not markup.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><![CDATA[<&]>]]]></doc>\r\n";
    const canonical = "<doc>&lt;&amp;]&gt;]</doc>";
    const compact: unknown = { doc: "<&]>]" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-021", () => {
    // 2.5 3.1 [15] [43] — Test demonstrates that comments are valid element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><!-- a comment --></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-022", () => {
    // 2.5 3.1 [15] [43] — Test demonstrates that comments are valid element content and that all
    // characters before the double-hypen right angle combination are considered part of thecomment.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><!-- a comment ->--></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-023", () => {
    // 3.1 [43] — Test demonstrates that Entity References are valid element content.
    const input: string = '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "">\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-024", () => {
    // 3.1 4.1 [43] [66] — Test demonstrates that Entity References are valid element content and also
    // demonstrates a valid Entity Declaration.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (foo)>\r\n<!ELEMENT foo (#PCDATA)>\r\n<!ENTITY e "&#60;foo></foo>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc><foo></foo></doc>";
    const compact: unknown = { doc: { foo: "" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-025", () => {
    // 3.2 [46] — Test demonstrates an Element Type Declaration and that the contentspec can be of mixed
    // content.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (foo*)>\r\n<!ELEMENT foo (#PCDATA)>\r\n]>\r\n<doc><foo/><foo></foo></doc>\r\n";
    const canonical = "<doc><foo></foo><foo></foo></doc>";
    const compact: unknown = { doc: { foo: ["", ""] } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-026", () => {
    // 3.2 [46] — Test demonstrates an Element Type Declaration and that EMPTY is a valid contentspec.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (foo*)>\r\n<!ELEMENT foo EMPTY>\r\n]>\r\n<doc><foo/><foo></foo></doc>\r\n";
    const canonical = "<doc><foo></foo><foo></foo></doc>";
    const compact: unknown = { doc: { foo: ["", ""] } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-027", () => {
    // 3.2 [46] — Test demonstrates an Element Type Declaration and that ANY is a valid contenspec.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (foo*)>\r\n<!ELEMENT foo ANY>\r\n]>\r\n<doc><foo/><foo></foo></doc>\r\n";
    const canonical = "<doc><foo></foo><foo></foo></doc>";
    const compact: unknown = { doc: { foo: ["", ""] } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-028", () => {
    // 2.8 [24] — Test demonstrates a valid prolog that uses double quotes as delimeters around the
    // VersionNum.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-029", () => {
    // 2.8 [24] — Test demonstrates a valid prolog that uses single quotes as delimters around the
    // VersionNum.
    const input: string =
      "<?xml version='1.0'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-030", () => {
    // 2.8 [25] — Test demonstrates a valid prolog that contains whitespace on both sides of the equal sign
    // in the VersionInfo.
    const input: string =
      '<?xml version = "1.0"?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-031", () => {
    // 4.3.3 [80] — Test demonstrates a valid EncodingDecl within the prolog.
    const input = Buffer.from(
      "<?xml version='1.0' encoding=\"UTF-8\"?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n",
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-032", () => {
    // 2.9 [32] — Test demonstrates a valid SDDecl within the prolog.
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-033", () => {
    // 2.8 [23] — Test demonstrates that both a EncodingDecl and SDDecl are valid within the prolog.
    const input = Buffer.from(
      "<?xml version='1.0' encoding=\"UTF-8\" standalone='yes'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n",
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-034", () => {
    // 3.1 [44] — Test demonstrates the correct syntax for an Empty element tag.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-035", () => {
    // 3.1 [44] — Test demonstrates that whitespace is permissible after the name in an Empty element tag.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc />\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-036", () => {
    // 2.6 [16] — Test demonstrates a valid processing instruction.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n<?pi data?>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-017a", () => {
    // 2.6 3.1 [16] [43] — Test demonstrates that two apparently wrong Processing Instructions make a right
    // one, with very odd content "some data ? > <?".
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><?pi some data ? > <??></doc>";
    const canonical = "<doc><?pi some data ? > <??></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-037", () => {
    // 2.6 [15] — Test demonstrates a valid comment and that it may appear anywhere in the document
    // including at the end.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n<!-- comment -->\r\n\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-038", () => {
    // 2.6 [15] — Test demonstrates a valid comment and that it may appear anywhere in the document
    // including the beginning.
    const input: string =
      "<!-- comment -->\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-039", () => {
    // 2.6 [16] — Test demonstrates a valid processing instruction and that it may appear at the beginning
    // of the document.
    const input: string = "<?pi data?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-040", () => {
    // 3.3 3.3.1 [52] [54] — Test demonstrates an Attribute List declaration that uses a StringType as the
    // AttType.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n]>\r\n<doc a1="&quot;&lt;&amp;&gt;&apos;"></doc>\r\n';
    const canonical = '<doc a1="&quot;&lt;&amp;&gt;\'"></doc>';
    const compact: unknown = { doc: { "@a1": "\"<&>'" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-041", () => {
    // 3.3.1 4.1 [54] [66] — Test demonstrates an Attribute List declaration that uses a StringType as the
    // AttType and also expands the CDATA attribute with a character reference.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n]>\r\n<doc a1="&#65;"></doc>\r\n';
    const canonical = '<doc a1="A"></doc>';
    const compact: unknown = { doc: { "@a1": "A" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-042", () => {
    // 3.3.1 4.1 [54] [66] — Test demonstrates an Attribute List declaration that uses a StringType as the
    // AttType and also expands the CDATA attribute with a character reference. The test also shows that
    // the leading zeros in the character reference are ignored.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#00000000000000000000000000000000065;</doc>\r\n";
    const canonical = "<doc>A</doc>";
    const compact: unknown = { doc: "A" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-043", () => {
    // 3.3 — An element's attributes may be declared before its content model; and attribute values may
    // contain newlines.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc a1="foo\r\nbar"></doc>\r\n';
    const canonical = '<doc a1="foo bar"></doc>';
    const compact: unknown = { doc: { "@a1": "foo bar" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-044", () => {
    // 3.1 [44] — Test demonstrates that the empty-element tag must be use for an elements that are
    // declared EMPTY.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (e*)>\r\n<!ELEMENT e EMPTY>\r\n<!ATTLIST e a1 CDATA "v1" a2 CDATA "v2" a3 CDATA #IMPLIED>\r\n]>\r\n<doc>\r\n<e a3="v3"/>\r\n<e a1="w1"/>\r\n<e a2="w2" a3="v3"/>\r\n</doc>\r\n';
    const canonical =
      '<doc>&#10;<e a1="v1" a2="v2" a3="v3"></e>&#10;<e a1="w1" a2="v2"></e>&#10;<e a1="v1" a2="w2" a3="v3"></e>&#10;</doc>';
    const compact: unknown = {
      doc: {
        e: [
          { "@a1": "v1", "@a2": "v2", "@a3": "v3" },
          { "@a1": "w1", "@a2": "v2" },
          { "@a1": "v1", "@a2": "w2", "@a3": "v3" },
        ],
      },
    };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-045", () => {
    // 3.3 [52] — Tests whether more than one definition can be provided for the same attribute of a given
    // element type with the first declaration being binding.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA "v1">\r\n<!ATTLIST doc a1 CDATA "z1">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a1="v1"></doc>';
    const compact: unknown = { doc: { "@a1": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-046", () => {
    // 3.3 [52] — Test demonstrates that when more than one AttlistDecl is provided for a given element
    // type, the contents of all those provided are merged.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA "v1">\r\n<!ATTLIST doc a2 CDATA "v2">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a1="v1" a2="v2"></doc>';
    const compact: unknown = { doc: { "@a1": "v1", "@a2": "v2" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-047", () => {
    // 3.1 [43] — Test demonstrates that extra whitespace is normalized into single space character.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>X\r\nY</doc>\r\n";
    const canonical = "<doc>X&#10;Y</doc>";
    const compact: unknown = { doc: "X\nY" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-048", () => {
    // 2.4 3.1 [14] [43] — Test demonstrates that character data is valid element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>]</doc>\r\n";
    const canonical = "<doc>]</doc>";
    const compact: unknown = { doc: "]" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-049", () => {
    // 2.2 [2] — Test demonstrates that characters outside of normal ascii range can be used as element
    // content.
    const input = Buffer.from(
      "//48ACEARABPAEMAVABZAFAARQAgAGQAbwBjACAAWwANAAoAPAAhAEUATABFAE0ARQBOAFQAIABkAG8AYwAgACgAIwBQAEMARABBAFQAQQApAD4ADQAKAF0APgANAAoAPABkAG8AYwA+AKMAPAAvAGQAbwBjAD4ADQAKAA==",
      "base64",
    );
    const canonical = "<doc>£</doc>";
    const compact: unknown = { doc: "£" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-050", () => {
    // 2.2 [2] — Test demonstrates that characters outside of normal ascii range can be used as element
    // content.
    const input = Buffer.from(
      "//48ACEARABPAEMAVABZAFAARQAgAGQAbwBjACAAWwANAAoAPAAhAEUATABFAE0ARQBOAFQAIABkAG8AYwAgACgAIwBQAEMARABBAFQAQQApAD4ADQAKAF0APgANAAoAPABkAG8AYwA+AEAOCA4hDioOTA48AC8AZABvAGMAPgANAAoA",
      "base64",
    );
    const canonical = "<doc>เจมส์</doc>";
    const compact: unknown = { doc: "เจมส์" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-051", () => {
    // 2.2 [2] — The document is encoded in UTF-16 and uses some name characters well outside of the normal
    // ASCII range.
    const input = Buffer.from(
      "//48ACEARABPAEMAVABZAFAARQAgAEAOCA4hDioOTA4gAFsADQAKADwAIQBFAEwARQBNAEUATgBUACAAQA4IDiEOKg5MDiAAIAAoACMAUABDAEQAQQBUAEEAKQA+AA0ACgBdAD4ADQAKADwAQA4IDiEOKg5MDj4APAAvAEAOCA4hDioOTA4+AA0ACgA=",
      "base64",
    );
    const canonical = "<เจมส์></เจมส์>";
    const compact: unknown = { "เจมส์": "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-052", () => {
    // 2.2 [2] — The document is encoded in UTF-8 and the text inside the root element uses two non-ASCII
    // characters, encoded in UTF-8 and each of which expands to a Unicode surrogate pair.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>𐀀􏿽</doc>\r\n";
    const canonical = "<doc>𐀀􏿽</doc>";
    const compact: unknown = { doc: "𐀀􏿽" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-053", () => {
    // 4.4.2 — Tests inclusion of a well-formed internal entity, which holds an element required by the
    // content model.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e "<e/>">\r\n<!ELEMENT doc (e)>\r\n<!ELEMENT e EMPTY>\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc><e></e></doc>";
    const compact: unknown = { doc: { e: "" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-054", () => {
    // 3.1 [40] [42] — Test demonstrates that extra whitespace within Start-tags and End-tags are nomalized
    // into single spaces.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n\r\n\r\n<doc\r\n></doc\r\n>\r\n\r\n\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-055", () => {
    // 2.6 2.10 [16] — Test demonstrates that extra whitespace within a processing instruction
    // willnormalized into s single space character.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<?pi  data?>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-056", () => {
    // 3.3.1 4.1 [54] [66] — Test demonstrates an Attribute List declaration that uses a StringType as the
    // AttType and also expands the CDATA attribute with a character reference. The test also shows that
    // the leading zeros in the character reference are ignored.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#x0000000000000000000000000000000000000041;</doc>\r\n";
    const canonical = "<doc>A</doc>";
    const compact: unknown = { doc: "A" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-057", () => {
    // 3.2.1 [47] — Test demonstrates an element content model whose element can occur zero or more times.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (a*)>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-058", () => {
    // 3.3.3 — Test demonstrates that extra whitespace be normalized into a single space character in an
    // attribute of type NMTOKENS.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ATTLIST doc a1 NMTOKENS #IMPLIED>\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc a1=" 1  \t2 \t"></doc>\r\n';
    const canonical = '<doc a1="1 2"></doc>';
    const compact: unknown = { doc: { "@a1": "1 2" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-059", () => {
    // 3.2 3.3 [46] [53] — Test demonstrates an Element Type Declaration that uses the contentspec of
    // EMPTY. The element cannot have any contents and must always appear as an empty element in the
    // document. The test also shows an Attribute-list declaration with multiple AttDef's.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (e*)>\r\n<!ELEMENT e EMPTY>\r\n<!ATTLIST e a1 CDATA #IMPLIED a2 CDATA #IMPLIED a3 CDATA #IMPLIED>\r\n]>\r\n<doc>\r\n<e a1="v1" a2="v2" a3="v3"/>\r\n<e a1="w1" a2="v2"/>\r\n<e a1="v1" a2="w2" a3="v3"/>\r\n</doc>\r\n';
    const canonical =
      '<doc>&#10;<e a1="v1" a2="v2" a3="v3"></e>&#10;<e a1="w1" a2="v2"></e>&#10;<e a1="v1" a2="w2" a3="v3"></e>&#10;</doc>';
    const compact: unknown = {
      doc: {
        e: [
          { "@a1": "v1", "@a2": "v2", "@a3": "v3" },
          { "@a1": "w1", "@a2": "v2" },
          { "@a1": "v1", "@a2": "w2", "@a3": "v3" },
        ],
      },
    };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-060", () => {
    // 4.1 [66] — Test demonstrates the use of decimal Character References within element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>X&#10;Y</doc>\r\n";
    const canonical = "<doc>X&#10;Y</doc>";
    const compact: unknown = { doc: "X\nY" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-061", () => {
    // 4.1 [66] — Test demonstrates the use of decimal Character References within element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#163;</doc>\r\n";
    const canonical = "<doc>£</doc>";
    const compact: unknown = { doc: "£" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-062", () => {
    // 4.1 [66] — Test demonstrates the use of hexadecimal Character References within element.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#xe40;&#xe08;&#xe21;ส์</doc>\r\n";
    const canonical = "<doc>เจมส์</doc>";
    const compact: unknown = { doc: "เจมส์" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-063", () => {
    // 2.3 [5] — The document is encoded in UTF-8 and the name of the root element type uses non-ASCII
    // characters.
    const input: string = "<!DOCTYPE เจมส์ [\r\n<!ELEMENT เจมส์ (#PCDATA)>\r\n]>\r\n<เจมส์></เจมส์>\r\n";
    const canonical = "<เจมส์></เจมส์>";
    const compact: unknown = { "เจมส์": "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-064", () => {
    // 4.1 [66] — Tests in-line handling of two legal character references, which each expand to a Unicode
    // surrogate pair.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#x10000;&#x10FFFD;</doc>\r\n";
    const canonical = "<doc>𐀀􏿽</doc>";
    const compact: unknown = { doc: "𐀀􏿽" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-065", () => {
    // 4.5 — Tests ability to define an internal entity which can't legally be expanded (contains an
    // unquoted <).
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "&#60;">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-066", () => {
    // 4.1 [66] — Expands a CDATA attribute with a character reference.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n<!-- 34 is double quote -->\r\n<!ENTITY e1 "&#34;">\r\n]>\r\n<doc a1="&e1;"></doc>\r\n';
    const canonical = '<doc a1="&quot;"></doc>';
    const compact: unknown = { doc: { "@a1": '"' } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-067", () => {
    // 4.1 [66] — Test demonstrates the use of decimal character references within element content.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#13;</doc>\r\n";
    const canonical = "<doc>&#13;</doc>";
    const compact: unknown = { doc: "\r" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-068", () => {
    // 2.11, 4.5 — Tests definition of an internal entity holding a carriage return character reference,
    // which must not be normalized before reporting to the application. Line break normalization only
    // occurs when parsing external parsed entities.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "&#13;">\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc>&#13;</doc>";
    const compact: unknown = { doc: "\r" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-069", () => {
    // 4.7 — Verifies that an XML parser will parse a NOTATION declaration; the output phase of this test
    // ensures that it's reported to the application.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION n PUBLIC "whatever">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-070", () => {
    // 4.4.8 — Verifies that internal parameter entities are correctly expanded within the internal subset.
    // (upstream: valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY % e "<!ELEMENT doc (#PCDATA)>">\r\n%e;\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-071", () => {
    // 3.3 3.3.1 [52] [56] — Test demonstrates that an AttlistDecl can use ID as the TokenizedType within
    // the Attribute type. The test also shows that IMPLIED is a valid DefaultDecl.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a ID #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-072", () => {
    // 3.3 3.3.1 [52] [56] — Test demonstrates that an AttlistDecl can use IDREF as the TokenizedType
    // within the Attribute type. The test also shows that IMPLIED is a valid DefaultDecl.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a IDREF #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-073", () => {
    // 3.3 3.3.1 [52] [56] — Test demonstrates that an AttlistDecl can use IDREFS as the TokenizedType
    // within the Attribute type. The test also shows that IMPLIED is a valid DefaultDecl.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a IDREFS #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-074", () => {
    // 3.3 3.3.1 [52] [56] — Test demonstrates that an AttlistDecl can use ENTITY as the TokenizedType
    // within the Attribute type. The test also shows that IMPLIED is a valid DefaultDecl.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a ENTITY #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-075", () => {
    // 3.3 3.3.1 [52] [56] — Test demonstrates that an AttlistDecl can use ENTITIES as the TokenizedType
    // within the Attribute type. The test also shows that IMPLIED is a valid DefaultDecl.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a ENTITIES #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-076", () => {
    // 3.3.1 — Verifies that an XML parser will parse a NOTATION attribute; the output phase of this test
    // ensures that both notations are reported to the application.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a NOTATION (n1|n2) #IMPLIED>\r\n<!NOTATION n1 SYSTEM "http://www.w3.org/">\r\n<!NOTATION n2 SYSTEM "http://www.w3.org/">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-077", () => {
    // 3.3 3.3.1 [52] [54] — Test demonstrates that an AttlistDecl can use an EnumeratedType within the
    // Attribute type. The test also shows that IMPLIED is a valid DefaultDecl.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a (1|2) #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-078", () => {
    // 3.3 3.3.1 [52] [54] — Test demonstrates that an AttlistDecl can use an StringType of CDATA within
    // the Attribute type. The test also shows that REQUIRED is a valid DefaultDecl.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #REQUIRED>\r\n]>\r\n<doc a="v"></doc>\r\n';
    const canonical = '<doc a="v"></doc>';
    const compact: unknown = { doc: { "@a": "v" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-079", () => {
    // 3.3 3.3.2 [52] [60] — Test demonstrates that an AttlistDecl can use an StringType of CDATA within
    // the Attribute type. The test also shows that FIXED is a valid DefaultDecl and that a value can be
    // given to the attribute in the Start-tag as well as the AttListDecl.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #FIXED "v">\r\n]>\r\n<doc a="v"></doc>\r\n';
    const canonical = '<doc a="v"></doc>';
    const compact: unknown = { doc: { "@a": "v" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-080", () => {
    // 3.3 3.3.2 [52] [60] — Test demonstrates that an AttlistDecl can use an StringType of CDATA within
    // the Attribute type. The test also shows that FIXED is a valid DefaultDecl and that an value can be
    // given to the attribute.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #FIXED "v">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a="v"></doc>';
    const compact: unknown = { doc: { "@a": "v" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-081", () => {
    // 3.2.1 [50] — Test demonstrates the use of the optional character following a name or list to govern
    // the number of times an element or content particles in the list occur.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (a, b, c)>\r\n<!ELEMENT a (a?)>\r\n<!ELEMENT b (b*)>\r\n<!ELEMENT c (a | b)+>\r\n]>\r\n<doc><a/><b/><c><a/></c></doc>\r\n";
    const canonical = "<doc><a></a><b></b><c><a></a></c></doc>";
    const compact: unknown = { doc: { a: "", b: "", c: { a: "" } } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-082", () => {
    // 4.2 [72] — Tests that an external PE may be defined (but not referenced).
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY % e SYSTEM "e.dtd">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-083", () => {
    // 4.2 [72] — Tests that an external PE may be defined (but not referenced).
    const input: string =
      "<!DOCTYPE doc [\r\n<!ENTITY % e PUBLIC 'whatever' \"e.dtd\">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-084", () => {
    // 2.10 — Test demonstrates that although whitespace can be used to set apart markup for greater
    // readability it is not necessary.
    const input: string = "<!DOCTYPE doc [<!ELEMENT doc (#PCDATA)>]><doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-085", () => {
    // 4 — Parameter and General entities use different namespaces, so there can be an entity of each type
    // with a given name.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e "<foo>">\r\n<!ENTITY e "">\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-086", () => {
    // 4.2 — Tests whether entities may be declared more than once, with the first declaration being the
    // binding one.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "">\r\n<!ENTITY e "<foo>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-087", () => {
    // 4.5 — Tests whether character references in internal entities are expanded early enough, by relying
    // on correct handling to make the entity be well formed.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e "<foo/&#62;">\r\n<!ELEMENT doc (foo)>\r\n<!ELEMENT foo EMPTY>\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc><foo></foo></doc>";
    const compact: unknown = { doc: { foo: "" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-088", () => {
    // 4.5 — Tests whether entity references in internal entities are expanded late enough, by relying on
    // correct handling to make the expanded text be valid. (If it's expanded too early, the entity will
    // parse as an element that's not valid in that context.)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "&lt;foo>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc>&lt;foo&gt;</doc>";
    const compact: unknown = { doc: "<foo>" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-089", () => {
    // 4.1 [66] — Tests entity expansion of three legal character references, which each expand to a
    // Unicode surrogate pair.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e "&#x10000;&#x10FFFD;&#x10FFFF;">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc>𐀀􏿽􏿿</doc>";
    const compact: unknown = { doc: "𐀀􏿽􏿿" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-090", () => {
    // 3.3.1 — Verifies that an XML parser will parse a NOTATION attribute; the output phase of this test
    // ensures that the notation is reported to the application.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ATTLIST e a NOTATION (n) #IMPLIED>\r\n<!ELEMENT doc (e)*>\r\n<!ELEMENT e (#PCDATA)>\r\n<!NOTATION n PUBLIC "whatever">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-091", () => {
    // 3.3.1 — Verifies that an XML parser will parse an ENTITY attribute; the output phase of this test
    // ensures that the notation is reported to the application, and for validating parsers it further
    // tests that the entity is so reported.
    const input: string =
      '<!DOCTYPE doc [\r\n<!NOTATION n SYSTEM "http://www.w3.org/">\r\n<!ENTITY e SYSTEM "http://www.w3.org/" NDATA n>\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a ENTITY "e">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a="e"></doc>';
    const compact: unknown = { doc: { "@a": "e" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-092", () => {
    // 2.3 2.10 — Test demostrates that extra whitespace is normalized into a single space character.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (a)*>\r\n<!ELEMENT a EMPTY>\r\n]>\r\n<doc>\r\n<a/>\r\n    <a/>\t<a/>\r\n\r\n\r\n</doc>\r\n";
    const canonical = "<doc>&#10;<a></a>&#10;    <a></a>&#9;<a></a>&#10;&#10;&#10;</doc>";
    const compact: unknown = { doc: { a: ["", "", ""] } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-093", () => {
    // 2.10 — Test demonstrates that extra whitespace is not intended for inclusion in the delivered
    // version of the document.
    const input: string = "<!DOCTYPE doc [\n<!ELEMENT doc (#PCDATA)>\n]>\n<doc>\n\n\n</doc>\n";
    const canonical = "<doc>&#10;&#10;&#10;</doc>";
    const compact: unknown = { doc: "\n\n\n" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-094", () => {
    // 2.8 — Attribute defaults with a DTD have special parsing rules, different from other strings. That
    // means that characters found there may look like an undefined parameter entity reference "within a
    // markup declaration", but they aren't ... so they can't be violating the PEs in Internal Subset WFC.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY % e "foo">\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a1 CDATA "%e;">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a1="%e;"></doc>';
    const compact: unknown = { doc: { "@a1": "%e;" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-095", () => {
    // 3.3.3 — Basically an output test, this requires extra whitespace to be normalized into a single
    // space character in an attribute of type NMTOKENS.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ATTLIST doc a1 CDATA #IMPLIED>\r\n<!ATTLIST doc a1 NMTOKENS #IMPLIED>\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc a1="1  2"></doc>\r\n';
    const canonical = '<doc a1="1  2"></doc>';
    const compact: unknown = { doc: { "@a1": "1  2" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-096", () => {
    // 3.3.3 — Test demonstrates that extra whitespace is normalized into a single space character in an
    // attribute of type NMTOKENS.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ATTLIST doc a1 NMTOKENS " 1  \t2 \t">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a1="1 2"></doc>';
    const compact: unknown = { doc: { "@a1": "1 2" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-097", () => {
    // 3.3 — Basically an output test, this tests whether an externally defined attribute declaration (with
    // a default) takes proper precedence over a subsequent internal declaration. (upstream: valid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % e SYSTEM "097.ent">\r\n<!ATTLIST doc a1 CDATA "v1">\r\n%e;\r\n<!ATTLIST doc a2 CDATA "v2">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a1="v1"></doc>';
    const compact: unknown = { doc: { "@a1": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-098", () => {
    // 2.6 2.10 [16] — Test demonstrates that extra whitespace within a processing instruction is converted
    // into a single space character.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><?pi x\r\ny?></doc>\r\n";
    const canonical = "<doc><?pi x\ny?></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-099", () => {
    // 4.3.3 [81] — Test demonstrates the name of the encoding can be composed of lowercase characters.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n',
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-100", () => {
    // 2.3 [12] — Makes sure that PUBLIC identifiers may have some strange characters. NOTE: The XML
    // editors have said that the XML specification errata will specify that parameter entity expansion
    // does not occur in PUBLIC identifiers, so that the '%' character will not flag a malformed parameter
    // entity reference.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e PUBLIC ";!*#@$_%" "100.xml">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-101", () => {
    // 4.5 — This tests whether entity expansion is (incorrectly) done while processing entity
    // declarations; if it is, the entity value literal will terminate prematurely.
    const input: string = '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "&#34;">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-102", () => {
    // 3.3.3 — Test demonstrates that a CDATA attribute can pass a double quote as its value.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="&#34;"></doc>\r\n';
    const canonical = '<doc a="&quot;"></doc>';
    const compact: unknown = { doc: { "@a": '"' } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-103", () => {
    // 3.3.3 — Test demonstrates that an attribute can pass a less than sign as its value.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&#60;doc></doc>\r\n";
    const canonical = "<doc>&lt;doc&gt;</doc>";
    const compact: unknown = { doc: "<doc>" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-104", () => {
    // 3.1 [40] — Test demonstrates that extra whitespace within an Attribute of a Start-tag is normalized
    // to a single space character.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="x\ty"></doc>\r\n';
    const canonical = '<doc a="x y"></doc>';
    const compact: unknown = { doc: { "@a": "x y" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-105", () => {
    // 3.3.3 — Basically an output test, this requires a CDATA attribute with a tab character to be passed
    // through as one space.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="x&#9;y"></doc>\r\n';
    const canonical = '<doc a="x&#9;y"></doc>';
    const compact: unknown = { doc: { "@a": "x\ty" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-106", () => {
    // 3.3.3 — Basically an output test, this requires a CDATA attribute with a newline character to be
    // passed through as one space.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="x&#10;y"></doc>\r\n';
    const canonical = '<doc a="x&#10;y"></doc>';
    const compact: unknown = { doc: { "@a": "x\ny" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-107", () => {
    // 3.3.3 — Basically an output test, this requires a CDATA attribute with a return character to be
    // passed through as one space.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="x&#13;y"></doc>\r\n';
    const canonical = '<doc a="x&#13;y"></doc>';
    const compact: unknown = { doc: { "@a": "x\ry" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-108", () => {
    // 2.11, 3.3.3 — This tests normalization of end-of-line characters (CRLF) within entities to LF,
    // primarily as an output test.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "\r\n">\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="x&e;y"></doc>\r\n';
    const canonical = '<doc a="x y"></doc>';
    const compact: unknown = { doc: { "@a": "x y" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-109", () => {
    // 2.3 3.1 [10][40][41] — Test demonstrates that an attribute can have a null value.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a=""></doc>\r\n';
    const canonical = '<doc a=""></doc>';
    const compact: unknown = { doc: { "@a": "" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-110", () => {
    // 3.3.3 — Basically an output test, this requires that a CDATA attribute with a CRLF be normalized to
    // one space.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "&#13;&#10;">\r\n<!ATTLIST doc a CDATA #IMPLIED>\r\n]>\r\n<doc a="x&e;y"></doc>\r\n';
    const canonical = '<doc a="x  y"></doc>';
    const compact: unknown = { doc: { "@a": "x  y" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-111", () => {
    // 3.3.3 — Character references expanding to spaces doesn't affect treatment of attributes.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST doc a NMTOKENS #IMPLIED>\r\n]>\r\n<doc a="&#32;x&#32;&#32;y&#32;"></doc>\r\n';
    const canonical = '<doc a="x y"></doc>';
    const compact: unknown = { doc: { "@a": "x y" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-112", () => {
    // 3.2.1 [48][49] — Test demonstrates shows the use of content particles within the element content.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (a | b)>\r\n<!ELEMENT a (#PCDATA)>\r\n]>\r\n<doc><a></a></doc>\r\n";
    const canonical = "<doc><a></a></doc>";
    const compact: unknown = { doc: { a: "" } };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-113", () => {
    // 3.3 [52][53] — Test demonstrates that it is not an error to have attributes declared for an element
    // not itself declared.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ATTLIST e a CDATA #IMPLIED>\r\n]>\r\n<doc></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-114", () => {
    // 2.7 [20] — Test demonstrates that all text within a valid CDATA section is considered text and not
    // recognized as markup.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e "<![CDATA[&foo;]]>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    const canonical = "<doc>&amp;foo;</doc>";
    const compact: unknown = { doc: "&foo;" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-115", () => {
    // 3.3.3 — Test demonstrates that an entity reference is processed by recursively processing the
    // replacement text of the entity.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e1 "&e2;">\r\n<!ENTITY e2 "v">\r\n]>\r\n<doc>&e1;</doc>\r\n';
    const canonical = "<doc>v</doc>";
    const compact: unknown = { doc: "v" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-116", () => {
    // 2.11 — Test demonstrates that a line break within CDATA will be normalized.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc><![CDATA[\r\n]]></doc>\r\n";
    const canonical = "<doc>&#10;</doc>";
    const compact: unknown = { doc: "\n" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-117", () => {
    // 4.5 — Test demonstrates that entity expansion is done while processing entity declarations.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY rsqb "]">\r\n]>\r\n<doc>&rsqb;</doc>\r\n';
    const canonical = "<doc>]</doc>";
    const compact: unknown = { doc: "]" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-118", () => {
    // 4.5 — Test demonstrates that entity expansion is done while processing entity declarations.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY rsqb "]]">\r\n]>\r\n<doc>&rsqb;</doc>\r\n';
    const canonical = "<doc>]]</doc>";
    const compact: unknown = { doc: "]]" };
    expectParses(input, canonical, compact);
  });

  test("valid-sa-119", () => {
    // 2.5 — Comments may contain any legal XML characters; only the string "--" is disallowed.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc ANY>\r\n]>\r\n<doc><!-- -á --></doc>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-not-sa-001", () => {
    // 4.2.2 [75] — Test demonstrates the use of an ExternalID within a document type definition.
    // (upstream: valid; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "001.ent" [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-not-sa-002", () => {
    // 4.2.2 [75] — Test demonstrates the use of an ExternalID within a document type definition.
    // (upstream: valid; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "002.ent" [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-not-sa-003", () => {
    // 4.1 [69] — Test demonstrates the expansion of an external parameter entity that declares an
    // attribute. (upstream: valid; external general and parameter entities are not read; output depends on
    // them)
    const input: string = '<!DOCTYPE doc SYSTEM "003-1.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-004", () => {
    // 4.1 [69] — Expands an external parameter entity in two different ways, with one of them declaring an
    // attribute. (upstream: valid; external general and parameter entities are not read; output depends on
    // them)
    const input: string = '<!DOCTYPE doc SYSTEM "004-1.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-005", () => {
    // 4.1 [69] — Test demonstrates the expansion of an external parameter entity that declares an
    // attribute. (upstream: valid; external general and parameter entities are not read; output depends on
    // them)
    const input: string = '<!DOCTYPE doc SYSTEM "005-1.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-006", () => {
    // 3.3 [52] — Test demonstrates that when more than one definition is provided for the same attribute
    // of a given element type only the first declaration is binding. (upstream: valid; external general
    // and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "006.ent" [\r\n<!ATTLIST doc a1 CDATA "v1">\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-007", () => {
    // 3.3 [52] — Test demonstrates the use of an Attribute list declaration within an external entity.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "007.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-008", () => {
    // 4.2.2 [75] — Test demonstrates that an external identifier may include a public identifier.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc PUBLIC "whatever" "008.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-009", () => {
    // 4.2.2 [75] — Test demonstrates that an external identifier may include a public identifier.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc PUBLIC "whatever" "009.ent" [\r\n<!ATTLIST doc a2 CDATA "v2">\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-010", () => {
    // 3.3 [52] — Test demonstrates that when more that one definition is provided for the same attribute
    // of a given element type only the first declaration is binding. (upstream: valid; external general
    // and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "010.ent" [\r\n<!ATTLIST doc a1 CDATA "v1">\r\n]>\r\n<doc></doc>\r\n';
    const canonical = '<doc a1="v1"></doc>';
    const compact: unknown = { doc: { "@a1": "v1" } };
    expectParses(input, canonical, compact);
  });

  test("valid-not-sa-011", () => {
    // 4.2 4.2.1 [72] [75] — Test demonstrates a parameter entity declaration whose parameter entity
    // definition is an ExternalID. (upstream: valid; external general and parameter entities are not read;
    // output depends on them)
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY % e SYSTEM "011.ent">\r\n%e;\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-012", () => {
    // 4.3.1 [77] — Test demonstrates an enternal parsed entity that begins with a text declaration.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY % e SYSTEM "012.ent">\r\n%e;\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-013", () => {
    // 3.4 [62] — Test demonstrates the use of the conditional section INCLUDE that will include its
    // contents as part of the DTD. (upstream: valid; external general and parameter entities are not read;
    // output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "013.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-014", () => {
    // 3.4 [62] — Test demonstrates the use of the conditional section INCLUDE that will include its
    // contents as part of the DTD. The keyword is a parameter-entity reference. (upstream: valid; external
    // general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "014.ent" [\r\n<!ENTITY % e "INCLUDE">\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-015", () => {
    // 3.4 [63] — Test demonstrates the use of the conditonal section IGNORE the will ignore its content
    // from being part of the DTD. The keyword is a parameter-entity reference. (upstream: valid; external
    // general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "015.ent" [\r\n<!ENTITY % e "IGNORE">\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-016", () => {
    // 3.4 [62] — Test demonstrates the use of the conditional section INCLUDE that will include its
    // contents as part of the DTD. The keyword is a parameter-entity reference. (upstream: valid; external
    // general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "016.ent" [\r\n<!ENTITY % e "INCLUDE">\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-017", () => {
    // 4.2 [72] — Test demonstrates a parameter entity declaration that contains an attribute list
    // declaration. (upstream: valid; external general and parameter entities are not read; output depends
    // on them)
    const input: string = '<!DOCTYPE doc SYSTEM "017.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-018", () => {
    // 4.2.2 [75] — Test demonstrates an EnternalID whose contents contain an parameter entity declaration
    // and a attribute list definition. (upstream: valid; external general and parameter entities are not
    // read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "018.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-019", () => {
    // 4.4.8 — Test demonstrates that a parameter entity will be expanded with spaces on either side.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "019.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-020", () => {
    // 4.4.8 — Parameter entities expand with spaces on either side. (upstream: valid; external general and
    // parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "020.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-021", () => {
    // 4.2 [72] — Test demonstrates a parameter entity declaration that contains a partial attribute list
    // declaration. (upstream: valid; external general and parameter entities are not read; output depends
    // on them)
    const input: string = '<!DOCTYPE doc SYSTEM "021.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-023", () => {
    // 2.3 4.1 [10] [69] — Test demonstrates the use of a parameter entity reference within an attribute
    // list declaration. (upstream: valid; external general and parameter entities are not read; output
    // depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "023.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-024", () => {
    // 2.8, 4.1 [69] — Constructs an <!ATTLIST...> declaration from several PEs. (upstream: valid; external
    // general and parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "024.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-025", () => {
    // 4.2 — Test demonstrates that when more that one definition is provided for the same entity only the
    // first declaration is binding. (upstream: valid; external general and parameter entities are not
    // read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "025.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-026", () => {
    // 3.3 [52] — Test demonstrates that when more that one definition is provided for the same attribute
    // of a given element type only the first declaration is binding. (upstream: valid; external general
    // and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc ANY>\r\n<!ENTITY % e SYSTEM "026.ent">\r\n%e;\r\n<!ATTLIST doc a1 CDATA "x1" a2 CDATA "x2">\r\n]>\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-027", () => {
    // 4.1 [69] — Test demonstrates a parameter entity reference whose value is NULL. (upstream: valid;
    // external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "027.ent">\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-not-sa-028", () => {
    // 3.4 [62] — Test demonstrates the use of the conditional section INCLUDE that will include its
    // contents. (upstream: valid; external general and parameter entities are not read; output depends on
    // them)
    const input: string = '<!DOCTYPE doc SYSTEM "028.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-029", () => {
    // 3.4 [62] — Test demonstrates the use of the conditonal section IGNORE the will ignore its content
    // from being used. (upstream: valid; external general and parameter entities are not read; output
    // depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "029.ent">\r\n<doc></doc>\r\n';
    expectParses(input);
  });

  test("valid-not-sa-030", () => {
    // 3.4 [62] — Test demonstrates the use of the conditonal section IGNORE the will ignore its content
    // from being used. (upstream: valid; external general and parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "030.ent">\r\n<doc></doc>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("valid-not-sa-031", () => {
    // 2.7 — Expands a general entity which contains a CDATA section with what looks like a markup
    // declaration (but is just text since it's in a CDATA section). (upstream: valid; external general and
    // parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE doc SYSTEM "031-1.ent">\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-001", () => {
    // 2.11 — A combination of carriage return line feed in an external entity must be normalized to a
    // single newline. (upstream: valid; external general and parameter entities are not read; output
    // depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "001.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-002", () => {
    // 2.11 — A carriage return (also CRLF) in an external entity must be normalized to a single newline.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "002.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-003", () => {
    // 3.1 4.1 [43] [68] — Test demonstrates that the content of an element can be empty. In this case the
    // external entity is an empty file. (upstream: valid; external general and parameter entities are not
    // read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "003.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-004", () => {
    // 2.11 — A carriage return (also CRLF) in an external entity must be normalized to a single newline.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "004.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-005", () => {
    // 3.2.1 4.2.2 [48] [75] — Test demonstrates the use of optional character and content particles within
    // an element content. The test also show the use of external entity. (upstream: valid; external
    // general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (e*)>\r\n<!ELEMENT e EMPTY>\r\n<!ENTITY e SYSTEM "005.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-006", () => {
    // 2.11 3.2.1 3.2.2 4.2.2 [48] [51] [75] — Test demonstrates the use of optional character and content
    // particles within mixed element content. The test also shows the use of an external entity and that a
    // carriage control line feed in an external entity must be normalized to a single newline. (upstream:
    // valid; external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA|e)*>\r\n<!ELEMENT e EMPTY>\r\n<!ENTITY e SYSTEM "006.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-007", () => {
    // 4.2.2 4.4.3 [75] — Test demonstrates the use of external entity and how replacement text is
    // retrieved and processed. (upstream: valid; external general and parameter entities are not read;
    // output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "007.ent">\r\n]>\r\n<doc>X&e;Z</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-008", () => {
    // 4.2.2 4.3.3. 4.4.3 [75] [80] — Test demonstrates the use of external entity and how replacement text
    // is retrieved and processed. Also tests the use of an EncodingDecl of UTF-16. (upstream: valid;
    // external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "008.ent">\r\n]>\r\n<doc>X&e;Z</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-009", () => {
    // 2.11 — A carriage return (also CRLF) in an external entity must be normalized to a single newline.
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "009.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-011", () => {
    // 2.11 4.2.2 [75] — Test demonstrates the use of a public identifier with and external entity. The
    // test also show that a carriage control line feed combination in an external entity must be
    // normalized to a single newline. (upstream: valid; external general and parameter entities are not
    // read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e PUBLIC "a not very interesting file" "011.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-012", () => {
    // 4.2.1 4.2.2 — Test demonstrates both internal and external entities and that processing of entity
    // references may be required to produce the correct replacement text. (upstream: valid; external
    // general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY e1 "&e2;">\r\n<!ENTITY e2 "&e3;">\r\n<!ENTITY e3 SYSTEM "012.ent">\r\n<!ENTITY e4 "&e5;">\r\n<!ENTITY e5 "(e5)">\r\n<!ELEMENT doc (#PCDATA)>\r\n]>\r\n<doc>&e1;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-013", () => {
    // 3.3.3 — Test demonstrates that whitespace is handled by adding a single whitespace to the normalized
    // value in the attribute list. (upstream: valid; external general and parameter entities are not read;
    // output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (e)>\r\n<!ELEMENT e (#PCDATA)>\r\n<!ATTLIST e\r\n  a1 CDATA "a1 default"\r\n  a2 NMTOKENS "a2 default"\r\n>\r\n<!ENTITY x SYSTEM "013.ent">\r\n]>\r\n<doc>&x;</doc>\r\n';
    expectParses(input);
  });

  test("valid-ext-sa-014", () => {
    // 4.1 4.4.3 [68] — Test demonstrates use of characters outside of normal ASCII range. (upstream:
    // valid; external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY e SYSTEM "014.ent">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });
});

describe("japanese", () => {
  test("weekly-euc-jp", () => {
    // 4.3.3 [4,84] — Test support for EUC-JP encoding, and XML names which contain Japanese characters. If
    // a processor does not support this encoding, it must report a fatal error. (upstream: optional error)
    const input = Buffer.from(
      "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iZXVjLWpwIj8+DQo8IURPQ1RZUEUgvbXK8yBTWVNURU0gIndlZWtseS1ldWMtanAuZHRkIj4NCjwhLS0gvbXK86W1pfOl16XrIC0tPg0KPL21yvM+DQogIDzHr7fuvbU+DQogICAgPMevxdk+MTk5Nzwvx6/F2T4NCiAgICA8t+7F2T4xPC+37sXZPg0KICAgIDy9tT4xPC+9tT4NCiAgPC/Hr7fuvbU+DQoNCiAgPLvhzL4+DQogICAgPLvhPruzxcQ8L7vhPg0KICAgIDzMvj7CwM+6PC/Mvj4NCiAgPC+74cy+Pg0KDQogIDy2yMyzyvO58KXqpbmlyD4NCiAgICA8tsjMs8rzufA+DQogICAgICA8tsjMs8y+PlhNTKWopcelo6W/obykzrruwK48L7bIzLPMvj4NCiAgICAgIDy2yMyzpbOhvKXJPlgzMzU1LTIzPC+2yMyzpbOhvKXJPg0KICAgICAgPLmpv/S0yc39Pg0KICAgICAgICA8uKvA0aTipOq5qb/0PjE2MDA8L7irwNGk4qTquam/9D4NCiAgICAgICAgPLzCwNO5qb/0PjMyMDwvvMLA07mpv/Q+DQogICAgICAgIDzF9rfuuKvA0aTipOq5qb/0PjE2MDwvxfa37rirwNGk4qTquam/9D4NCiAgICAgICAgPMX2t+68wsDTuam/9D4yNDwvxfa37rzCwNO5qb/0Pg0KICAgICAgPC+5qb/0tMnN/T4NCiAgICAgIDzNvcTqueDM3KXqpbmlyD4NCiAgICAgICAgPM29xOq54MzcPg0KICAgICAgICAgIDxQPlhNTKWopcelo6W/obykzrTwy9y7xc3NpM667sCuPC9QPg0KICAgICAgICA8L829xOq54MzcPg0KICAgICAgPC/NvcTqueDM3KXqpbmlyD4NCiAgICAgIDy8wrvcu/a54KXqpbmlyD4NCiAgICAgICAgPLzCu9y79rngPg0KICAgICAgICAgIDxQPlhNTKWopcelo6W/obykzrTwy9y7xc3NpM667sCuPC9QPg0KICAgICAgICA8L7zCu9y79rngPg0KICAgICAgICA8vMK73Lv2ueA+DQogICAgICAgICAgPFA+tqW558K+vNLAvcnKpM61oce9xLS6ujwvUD4NCiAgICAgICAgPC+8wrvcu/a54D4NCiAgICAgIDwvvMK73Lv2ueCl6qW5pcg+DQogICAgICA8vuXEuaTYpM7N18DBu/a54KXqpbmlyD4NCiAgICAgICAgPL7lxLmk2KTOzdfAwbv2ueA+DQogICAgICAgICAgPFA+xsOky6TKpLc8L1A+DQogICAgICAgIDwvvuXEuaTYpM7N18DBu/a54D4NCiAgICAgIDwvvuXEuaTYpM7N18DBu/a54KXqpbmlyD4NCiAgICAgIDzM5MLqxcDC0Lr2Pg0KICAgICAgICA8UD5YTUykyKTPsr+kq6TvpKuk6aTKpKShozwvUD4NCiAgICAgIDwvzOTC6sXAwtC69j4NCiAgICA8L7bIzLPK87nwPg0KDQogICAgPLbIzLPK87nwPg0KICAgICAgPLbIzLPMvj64obr3pail86W4pfOkzrOryK88L7bIzLPMvj4NCiAgICAgIDy2yMyzpbOhvKXJPlM4ODIxLTc2PC+2yMyzpbOhvKXJPg0KICAgICAgPLmpv/S0yc39Pg0KICAgICAgICA8uKvA0aTipOq5qb/0PjEyMDwvuKvA0aTipOq5qb/0Pg0KICAgICAgICA8vMLA07mpv/Q+NjwvvMLA07mpv/Q+DQogICAgICAgIDzF9rfuuKvA0aTipOq5qb/0PjMyPC/F9rfuuKvA0aTipOq5qb/0Pg0KICAgICAgICA8xfa37rzCwNO5qb/0PjI8L8X2t+68wsDTuam/9D4NCiAgICAgIDwvuam/9LTJzf0+DQogICAgICA8zb3E6rngzNyl6qW5pcg+DQogICAgICAgIDzNvcTqueDM3D4NCiAgICAgICAgICA8UD48QSBocmVmPSJodHRwOi8vd3d3Lmdvby5uZS5qcCI+Z29vPC9BPqTOtaHHvaTyxLSk2aTGpN+k6zwvUD4NCiAgICAgICAgPC/NvcTqueDM3D4NCiAgICAgIDwvzb3E6rngzNyl6qW5pcg+DQogICAgICA8vMK73Lv2ueCl6qW5pcg+DQogICAgICAgIDy8wrvcu/a54D4NCiAgICAgICAgICA8UD65uaTLoaKkyaSmpKSkprihuvelqKXzpbil86SspKKk66SrxLS6uqS5pOs8L1A+DQogICAgICAgIDwvvMK73Lv2ueA+DQogICAgICA8L7zCu9y79rngpeqluaXIPg0KICAgICAgPL7lxLmk2KTOzdfAwbv2ueCl6qW5pcg+DQogICAgICAgIDy+5cS5pNikzs3XwMG79rngPg0KICAgICAgICAgIDxQPrOryK+k8qS5pOukzqTPpOGk86TJpKakyqTOpMehollhaG9vIaTyx+O8/aS3pMayvKS1pKShozwvUD4NCiAgICAgICAgPC++5cS5pNikzs3XwMG79rngPg0KICAgICAgPC++5cS5pNikzs3XwMG79rngpeqluaXIPg0KICAgICAgPMzkwurFwMLQuvY+DQogICAgICAgIDxQPrihuvelqKXzpbil86THvNak8sH2pOmku6TrpLOkyKSspMekraTKpKSho6HKzdfEtLq6ocs8L1A+DQogICAgICA8L8zkwurFwMLQuvY+DQogICAgPC+2yMyzyvO58D4NCiAgPC+2yMyzyvO58KXqpbmlyD4NCjwvvbXK8z4NCg==",
      "base64",
    );
    expectRejects(input, "XML Parse error: Unsupported encoding 'euc-jp' (supported: UTF-8, UTF-16, ISO-8859-1)");
  });

  test("weekly-iso-2022-jp", () => {
    // 4.3.3 [4,84] — Test support for ISO-2022-JP encoding, and XML names which contain Japanese
    // characters. If a processor does not support this encoding, it must report a fatal error. (upstream:
    // optional error)
    const input = Buffer.from(
      '<?xml version="1.0" encoding="iso-2022-jp"?>\r\n<!DOCTYPE \u001b$B=5Js\u001b(B SYSTEM "weekly-iso-2022-jp.dtd">\r\n<!-- \u001b$B=5Js%5%s%W%k\u001b(B -->\r\n<\u001b$B=5Js\u001b(B>\r\n  <\u001b$BG/7n=5\u001b(B>\r\n    <\u001b$BG/EY\u001b(B>1997</\u001b$BG/EY\u001b(B>\r\n    <\u001b$B7nEY\u001b(B>1</\u001b$B7nEY\u001b(B>\r\n    <\u001b$B=5\u001b(B>1</\u001b$B=5\u001b(B>\r\n  </\u001b$BG/7n=5\u001b(B>\r\n\r\n  <\u001b$B;aL>\u001b(B>\r\n    <\u001b$B;a\u001b(B>\u001b$B;3ED\u001b(B</\u001b$B;a\u001b(B>\r\n    <\u001b$BL>\u001b(B>\u001b$BB@O:\u001b(B</\u001b$BL>\u001b(B>\r\n  </\u001b$B;aL>\u001b(B>\r\n\r\n  <\u001b$B6HL3Js9p%j%9%H\u001b(B>\r\n    <\u001b$B6HL3Js9p\u001b(B>\r\n      <\u001b$B6HL3L>\u001b(B>XML\u001b$B%(%G%#%?!<$N:n@.\u001b(B</\u001b$B6HL3L>\u001b(B>\r\n      <\u001b$B6HL3%3!<%I\u001b(B>X3355-23</\u001b$B6HL3%3!<%I\u001b(B>\r\n      <\u001b$B9)?t4IM}\u001b(B>\r\n        <\u001b$B8+@Q$b$j9)?t\u001b(B>1600</\u001b$B8+@Q$b$j9)?t\u001b(B>\r\n        <\u001b$B<B@S9)?t\u001b(B>320</\u001b$B<B@S9)?t\u001b(B>\r\n        <\u001b$BEv7n8+@Q$b$j9)?t\u001b(B>160</\u001b$BEv7n8+@Q$b$j9)?t\u001b(B>\r\n        <\u001b$BEv7n<B@S9)?t\u001b(B>24</\u001b$BEv7n<B@S9)?t\u001b(B>\r\n      </\u001b$B9)?t4IM}\u001b(B>\r\n      <\u001b$BM=Dj9`L\\%j%9%H\u001b(B>\r\n        <\u001b$BM=Dj9`L\\\u001b(B>\r\n          <P>XML\u001b$B%(%G%#%?!<$N4pK\\;EMM$N:n@.\u001b(B</P>\r\n        </\u001b$BM=Dj9`L\\\u001b(B>\r\n      </\u001b$BM=Dj9`L\\%j%9%H\u001b(B>\r\n      <\u001b$B<B;\\;v9`%j%9%H\u001b(B>\r\n        <\u001b$B<B;\\;v9`\u001b(B>\r\n          <P>XML\u001b$B%(%G%#%?!<$N4pK\\;EMM$N:n@.\u001b(B</P>\r\n        </\u001b$B<B;\\;v9`\u001b(B>\r\n        <\u001b$B<B;\\;v9`\u001b(B>\r\n          <P>\u001b$B6%9gB><R@=IJ$N5!G=D4::\u001b(B</P>\r\n        </\u001b$B<B;\\;v9`\u001b(B>\r\n      </\u001b$B<B;\\;v9`%j%9%H\u001b(B>\r\n      <\u001b$B>eD9$X$NMW@A;v9`%j%9%H\u001b(B>\r\n        <\u001b$B>eD9$X$NMW@A;v9`\u001b(B>\r\n          <P>\u001b$BFC$K$J$7\u001b(B</P>\r\n        </\u001b$B>eD9$X$NMW@A;v9`\u001b(B>\r\n      </\u001b$B>eD9$X$NMW@A;v9`%j%9%H\u001b(B>\r\n      <\u001b$BLdBjE@BP:v\u001b(B>\r\n        <P>XML\u001b$B$H$O2?$+$o$+$i$J$$!#\u001b(B</P>\r\n      </\u001b$BLdBjE@BP:v\u001b(B>\r\n    </\u001b$B6HL3Js9p\u001b(B>\r\n\r\n    <\u001b$B6HL3Js9p\u001b(B>\r\n      <\u001b$B6HL3L>\u001b(B>\u001b$B8!:w%(%s%8%s$N3+H/\u001b(B</\u001b$B6HL3L>\u001b(B>\r\n      <\u001b$B6HL3%3!<%I\u001b(B>S8821-76</\u001b$B6HL3%3!<%I\u001b(B>\r\n      <\u001b$B9)?t4IM}\u001b(B>\r\n        <\u001b$B8+@Q$b$j9)?t\u001b(B>120</\u001b$B8+@Q$b$j9)?t\u001b(B>\r\n        <\u001b$B<B@S9)?t\u001b(B>6</\u001b$B<B@S9)?t\u001b(B>\r\n        <\u001b$BEv7n8+@Q$b$j9)?t\u001b(B>32</\u001b$BEv7n8+@Q$b$j9)?t\u001b(B>\r\n        <\u001b$BEv7n<B@S9)?t\u001b(B>2</\u001b$BEv7n<B@S9)?t\u001b(B>\r\n      </\u001b$B9)?t4IM}\u001b(B>\r\n      <\u001b$BM=Dj9`L\\%j%9%H\u001b(B>\r\n        <\u001b$BM=Dj9`L\\\u001b(B>\r\n          <P><A href="http://www.goo.ne.jp">goo</A>\u001b$B$N5!G=$rD4$Y$F$_$k\u001b(B</P>\r\n        </\u001b$BM=Dj9`L\\\u001b(B>\r\n      </\u001b$BM=Dj9`L\\%j%9%H\u001b(B>\r\n      <\u001b$B<B;\\;v9`%j%9%H\u001b(B>\r\n        <\u001b$B<B;\\;v9`\u001b(B>\r\n          <P>\u001b$B99$K!"$I$&$$$&8!:w%(%s%8%s$,$"$k$+D4::$9$k\u001b(B</P>\r\n        </\u001b$B<B;\\;v9`\u001b(B>\r\n      </\u001b$B<B;\\;v9`%j%9%H\u001b(B>\r\n      <\u001b$B>eD9$X$NMW@A;v9`%j%9%H\u001b(B>\r\n        <\u001b$B>eD9$X$NMW@A;v9`\u001b(B>\r\n          <P>\u001b$B3+H/$r$9$k$N$O$a$s$I$&$J$N$G!"\u001b(BYahoo!\u001b$B$rGc<}$7$F2<$5$$!#\u001b(B</P>\r\n        </\u001b$B>eD9$X$NMW@A;v9`\u001b(B>\r\n      </\u001b$B>eD9$X$NMW@A;v9`%j%9%H\u001b(B>\r\n      <\u001b$BLdBjE@BP:v\u001b(B>\r\n        <P>\u001b$B8!:w%(%s%8%s$G<V$rAv$i$;$k$3$H$,$G$-$J$$!#!JMWD4::!K\u001b(B</P>\r\n      </\u001b$BLdBjE@BP:v\u001b(B>\r\n    </\u001b$B6HL3Js9p\u001b(B>\r\n  </\u001b$B6HL3Js9p%j%9%H\u001b(B>\r\n</\u001b$B=5Js\u001b(B>\r\n',
    );
    expectRejects(input, "XML Parse error: Unsupported encoding 'iso-2022-jp' (supported: UTF-8, UTF-16, ISO-8859-1)");
  });

  test("weekly-little", () => {
    // 4.3.3 [4,84] — Test support for little-endian UTF-16 encoding, and XML names which contain Japanese
    // characters. (upstream: valid; external parameter entities are not read)
    const input = Buffer.from(
      "//48AD8AeABtAGwAIAB2AGUAcgBzAGkAbwBuAD0AIgAxAC4AMAAiAD8APgANAAoAPAAhAEQATwBDAFQAWQBQAEUAIAAxkDFYIABTAFkAUwBUAEUATQAgACIAdwBlAGUAawBsAHkALQB1AHQAZgAtADEANgAuAGQAdABkACIAPgANAAoAPAAhAC0ALQAgADGQMVi1MPMw1zDrMCAALQAtAD4ADQAKADwAMZAxWD4ADQAKACAAIAA8AHReCGcxkD4ADQAKACAAIAAgACAAPAB0XqZePgAxADkAOQA3ADwALwB0XqZePgANAAoAIAAgACAAIAA8AAhnpl4+ADEAPAAvAAhnpl4+AA0ACgAgACAAIAAgADwAMZA+ADEAPAAvADGQPgANAAoAIAAgADwALwB0XghnMZA+AA0ACgANAAoAIAAgADwAD2wNVD4ADQAKACAAIAAgACAAPAAPbD4AcVwwdTwALwAPbD4ADQAKACAAIAAgACAAPAANVD4AKlnOkDwALwANVD4ADQAKACAAIAA8AC8AD2wNVD4ADQAKAA0ACgAgACAAPABtadlSMVhKVOowuTDIMD4ADQAKACAAIAAgACAAPABtadlSMVhKVD4ADQAKACAAIAAgACAAIAAgADwAbWnZUg1UPgBYAE0ATACoMMcwozC/MPwwbjBcTxBiPAAvAG1p2VINVD4ADQAKACAAIAAgACAAIAAgADwAbWnZUrMw/DDJMD4AWAAzADMANQA1AC0AMgAzADwALwBtadlSszD8MMkwPgANAAoAIAAgACAAIAAgACAAPADlXXBloXsGdD4ADQAKACAAIAAgACAAIAAgACAAIAA8AIuJTXqCMIow5V1wZT4AMQA2ADAAMAA8AC8Ai4lNeoIwijDlXXBlPgANAAoAIAAgACAAIAAgACAAIAAgADwAn1s+fuVdcGU+ADMAMgAwADwALwCfWz5+5V1wZT4ADQAKACAAIAAgACAAIAAgACAAIAA8AFNfCGeLiU16gjCKMOVdcGU+ADEANgAwADwALwBTXwhni4lNeoIwijDlXXBlPgANAAoAIAAgACAAIAAgACAAIAAgADwAU18IZ59bPn7lXXBlPgAyADQAPAAvAFNfCGefWz5+5V1wZT4ADQAKACAAIAAgACAAIAAgADwALwDlXXBloXsGdD4ADQAKACAAIAAgACAAIAAgADwAiE6aWwWY7nbqMLkwyDA+AA0ACgAgACAAIAAgACAAIAAgACAAPACITppbBZjudj4ADQAKACAAIAAgACAAIAAgACAAIAAgACAAPABQAD4AWABNAEwAqDDHMKMwvzD8MG4w+lcsZ9VO2GluMFxPEGI8AC8AUAA+AA0ACgAgACAAIAAgACAAIAAgACAAPAAvAIhOmlsFmO52PgANAAoAIAAgACAAIAAgACAAPAAvAIhOmlsFmO526jC5MMgwPgANAAoAIAAgACAAIAAgACAAPACfW71li04FmOowuTDIMD4ADQAKACAAIAAgACAAIAAgACAAIAA8AJ9bvWWLTgWYPgANAAoAIAAgACAAIAAgACAAIAAgACAAIAA8AFAAPgBYAE0ATACoMMcwozC/MPwwbjD6Vyxn1U7YaW4wXE8QYjwALwBQAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AC8An1u9ZYtOBZg+AA0ACgAgACAAIAAgACAAIAAgACAAPACfW71li04FmD4ADQAKACAAIAAgACAAIAAgACAAIAAgACAAPABQAD4A9noIVNZOPnn9iMFUbjBfav2Av4r7ZzwALwBQAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AC8An1u9ZYtOBZg+AA0ACgAgACAAIAAgACAAIAA8AC8An1u9ZYtOBZjqMLkwyDA+AA0ACgAgACAAIAAgACAAIAA8AApOd5V4MG4wgYnLiotOBZjqMLkwyDA+AA0ACgAgACAAIAAgACAAIAAgACAAPAAKTneVeDBuMIGJy4qLTgWYPgANAAoAIAAgACAAIAAgACAAIAAgACAAIAA8AFAAPgB5cmswajBXMDwALwBQAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AC8ACk53lXgwbjCBicuKi04FmD4ADQAKACAAIAAgACAAIAAgADwALwAKTneVeDBuMIGJy4qLTgWY6jC5MMgwPgANAAoAIAAgACAAIAAgACAAPABPVUyYuXD+W1Z7PgANAAoAIAAgACAAIAAgACAAIAAgADwAUAA+AFgATQBMAGgwbzBVT0swjzBLMIkwajBEMAIwPAAvAFAAPgANAAoAIAAgACAAIAAgACAAPAAvAE9VTJi5cP5bVns+AA0ACgAgACAAIAAgADwALwBtadlSMVhKVD4ADQAKAA0ACgAgACAAIAAgADwAbWnZUjFYSlQ+AA0ACgAgACAAIAAgACAAIAA8AG1p2VINVD4AHGkifagw8zC4MPMwbjCLlXp2PAAvAG1p2VINVD4ADQAKACAAIAAgACAAIAAgADwAbWnZUrMw/DDJMD4AUwA4ADgAMgAxAC0ANwA2ADwALwBtadlSszD8MMkwPgANAAoAIAAgACAAIAAgACAAPADlXXBloXsGdD4ADQAKACAAIAAgACAAIAAgACAAIAA8AIuJTXqCMIow5V1wZT4AMQAyADAAPAAvAIuJTXqCMIow5V1wZT4ADQAKACAAIAAgACAAIAAgACAAIAA8AJ9bPn7lXXBlPgA2ADwALwCfWz5+5V1wZT4ADQAKACAAIAAgACAAIAAgACAAIAA8AFNfCGeLiU16gjCKMOVdcGU+ADMAMgA8AC8AU18IZ4uJTXqCMIow5V1wZT4ADQAKACAAIAAgACAAIAAgACAAIAA8AFNfCGefWz5+5V1wZT4AMgA8AC8AU18IZ59bPn7lXXBlPgANAAoAIAAgACAAIAAgACAAPAAvAOVdcGWhewZ0PgANAAoAIAAgACAAIAAgACAAPACITppbBZjuduowuTDIMD4ADQAKACAAIAAgACAAIAAgACAAIAA8AIhOmlsFmO52PgANAAoAIAAgACAAIAAgACAAIAAgACAAIAA8AFAAPgA8AEEAIABoAHIAZQBmAD0AIgBoAHQAdABwADoALwAvAHcAdwB3AC4AZwBvAG8ALgBuAGUALgBqAHAAIgA+AGcAbwBvADwALwBBAD4AbjBfav2AkjC/inkwZjB/MIswPAAvAFAAPgANAAoAIAAgACAAIAAgACAAIAAgADwALwCITppbBZjudj4ADQAKACAAIAAgACAAIAAgADwALwCITppbBZjuduowuTDIMD4ADQAKACAAIAAgACAAIAAgADwAn1u9ZYtOBZjqMLkwyDA+AA0ACgAgACAAIAAgACAAIAAgACAAPACfW71li04FmD4ADQAKACAAIAAgACAAIAAgACAAIAAgACAAPABQAD4A9GZrMAEwaTBGMEQwRjAcaSJ9qDDzMLgw8zBMMEIwizBLML+K+2dZMIswPAAvAFAAPgANAAoAIAAgACAAIAAgACAAIAAgADwALwCfW71li04FmD4ADQAKACAAIAAgACAAIAAgADwALwCfW71li04FmOowuTDIMD4ADQAKACAAIAAgACAAIAAgADwACk53lXgwbjCBicuKi04FmOowuTDIMD4ADQAKACAAIAAgACAAIAAgACAAIAA8AApOd5V4MG4wgYnLiotOBZg+AA0ACgAgACAAIAAgACAAIAAgACAAIAAgADwAUAA+AIuVenaSMFkwizBuMG8wgTCTMGkwRjBqMG4wZzABMFkAYQBoAG8AbwAhAJIwt4zOU1cwZjALTlUwRDACMDwALwBQAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AC8ACk53lXgwbjCBicuKi04FmD4ADQAKACAAIAAgACAAIAAgADwALwAKTneVeDBuMIGJy4qLTgWY6jC5MMgwPgANAAoAIAAgACAAIAAgACAAPABPVUyYuXD+W1Z7PgANAAoAIAAgACAAIAAgACAAIAAgADwAUAA+ABxpIn2oMPMwuDDzMGcwyo6SMHCNiTBbMIswUzBoMEwwZzBNMGowRDACMAj/gYm/ivtnCf88AC8AUAA+AA0ACgAgACAAIAAgACAAIAA8AC8AT1VMmLlw/ltWez4ADQAKACAAIAAgACAAPAAvAG1p2VIxWEpUPgANAAoAIAAgADwALwBtadlSMVhKVOowuTDIMD4ADQAKADwALwAxkDFYPgANAAoA",
      "base64",
    );
    expectParses(input);
  });

  test("weekly-shift_jis", () => {
    // 4.3.3 [4,84] — Test support for Shift_JIS encoding, and XML names which contain Japanese characters.
    // If a processor does not support this encoding, it must report a fatal error. (upstream: optional
    // error)
    const input = Buffer.from(
      "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iU2hpZnRfSklTIj8+DQo8IURPQ1RZUEUgj1SV8SBTWVNURU0gIndlZWtseS1zaGlmdF9qaXMuZHRkIj4NCjwhLS0gj1SV8YNUg5ODdoOLIC0tPg0KPI9UlfE+DQogIDyUToyOj1Q+DQogICAgPJROk3g+MTk5NzwvlE6TeD4NCiAgICA8jI6TeD4xPC+MjpN4Pg0KICAgIDyPVD4xPC+PVD4NCiAgPC+UToyOj1Q+DQoNCiAgPI6Blrw+DQogICAgPI6BPo5Sk2M8L46BPg0KICAgIDyWvD6RvphZPC+WvD4NCiAgPC+OgZa8Pg0KDQogIDyLxpaxlfGNkIOKg1iDZz4NCiAgICA8i8aWsZXxjZA+DQogICAgICA8i8aWsZa8PlhNTINHg2aDQoNegVuCzI3skKw8L4vGlrGWvD4NCiAgICAgIDyLxpaxg1KBW4NoPlgzMzU1LTIzPC+Lxpaxg1KBW4NoPg0KICAgICAgPI1IkJSKx5edPg0KICAgICAgICA8jKmQz4LgguiNSJCUPjE2MDA8L4ypkM+C4ILojUiQlD4NCiAgICAgICAgPI7AkNGNSJCUPjMyMDwvjsCQ0Y1IkJQ+DQogICAgICAgIDyTloyOjKmQz4LgguiNSJCUPjE2MDwvk5aMjoypkM+C4ILojUiQlD4NCiAgICAgICAgPJOWjI6OwJDRjUiQlD4yNDwvk5aMjo7AkNGNSJCUPg0KICAgICAgPC+NSJCUiseXnT4NCiAgICAgIDyXXJLojYCW2oOKg1iDZz4NCiAgICAgICAgPJdckuiNgJbaPg0KICAgICAgICAgIDxQPlhNTINHg2aDQoNegVuCzIrulnuOZJdsgsyN7JCsPC9QPg0KICAgICAgICA8L5dckuiNgJbaPg0KICAgICAgPC+XXJLojYCW2oOKg1iDZz4NCiAgICAgIDyOwI57jpaNgIOKg1iDZz4NCiAgICAgICAgPI7AjnuOlo2APg0KICAgICAgICAgIDxQPlhNTINHg2aDQoNegVuCzIrulnuOZJdsgsyN7JCsPC9QPg0KICAgICAgICA8L47AjnuOlo2APg0KICAgICAgICA8jsCOe46WjYA+DQogICAgICAgICAgPFA+i6ONh5G8jtCQu5VpgsyLQJRckrKNuDwvUD4NCiAgICAgICAgPC+OwI57jpaNgD4NCiAgICAgIDwvjsCOe46WjYCDioNYg2c+DQogICAgICA8j+OSt4LWgsyXdpC/jpaNgIOKg1iDZz4NCiAgICAgICAgPI/jkreC1oLMl3aQv46WjYA+DQogICAgICAgICAgPFA+k8GCyYLIgrU8L1A+DQogICAgICAgIDwvj+OSt4LWgsyXdpC/jpaNgD4NCiAgICAgIDwvj+OSt4LWgsyXdpC/jpaNgIOKg1iDZz4NCiAgICAgIDyW4pHok1+Rzo30Pg0KICAgICAgICA8UD5YTUyCxoLNib2CqYLtgqmC54LIgqKBQjwvUD4NCiAgICAgIDwvluKR6JNfkc6N9D4NCiAgICA8L4vGlrGV8Y2QPg0KDQogICAgPIvGlrGV8Y2QPg0KICAgICAgPIvGlrGWvD6Mn431g0eDk4NXg5OCzIpKlK08L4vGlrGWvD4NCiAgICAgIDyLxpaxg1KBW4NoPlM4ODIxLTc2PC+Lxpaxg1KBW4NoPg0KICAgICAgPI1IkJSKx5edPg0KICAgICAgICA8jKmQz4LgguiNSJCUPjEyMDwvjKmQz4LgguiNSJCUPg0KICAgICAgICA8jsCQ0Y1IkJQ+NjwvjsCQ0Y1IkJQ+DQogICAgICAgIDyTloyOjKmQz4LgguiNSJCUPjMyPC+TloyOjKmQz4LgguiNSJCUPg0KICAgICAgICA8k5aMjo7AkNGNSJCUPjI8L5OWjI6OwJDRjUiQlD4NCiAgICAgIDwvjUiQlIrHl50+DQogICAgICA8l1yS6I2AltqDioNYg2c+DQogICAgICAgIDyXXJLojYCW2j4NCiAgICAgICAgICA8UD48QSBocmVmPSJodHRwOi8vd3d3Lmdvby5uZS5qcCI+Z29vPC9BPoLMi0CUXILwkrKC14LEgt2C6TwvUD4NCiAgICAgICAgPC+XXJLojYCW2j4NCiAgICAgIDwvl1yS6I2AltqDioNYg2c+DQogICAgICA8jsCOe46WjYCDioNYg2c+DQogICAgICAgIDyOwI57jpaNgD4NCiAgICAgICAgICA8UD6NWILJgUGCx4KkgqKCpIyfjfWDR4OTg1eDk4KqgqCC6YKpkrKNuIK3guk8L1A+DQogICAgICAgIDwvjsCOe46WjYA+DQogICAgICA8L47AjnuOlo2Ag4qDWINnPg0KICAgICAgPI/jkreC1oLMl3aQv46WjYCDioNYg2c+DQogICAgICAgIDyP45K3gtaCzJd2kL+Olo2APg0KICAgICAgICAgIDxQPopKlK2C8IK3gumCzILNgt+C8YLHgqSCyILMgsWBQVlhaG9vIYLwlIOO+4K1gsSJuoKzgqKBQjwvUD4NCiAgICAgICAgPC+P45K3gtaCzJd2kL+Olo2APg0KICAgICAgPC+P45K3gtaCzJd2kL+Olo2Ag4qDWINnPg0KICAgICAgPJbikeiTX5HOjfQ+DQogICAgICAgIDxQPoyfjfWDR4OTg1eDk4LFjtSC8JGWgueCuYLpgrGCxoKqgsWCq4LIgqKBQoFpl3aSso24gWo8L1A+DQogICAgICA8L5bikeiTX5HOjfQ+DQogICAgPC+LxpaxlfGNkD4NCiAgPC+LxpaxlfGNkIOKg1iDZz4NCjwvj1SV8T4NCg==",
      "base64",
    );
    expectRejects(input, "XML Parse error: Unsupported encoding 'Shift_JIS' (supported: UTF-8, UTF-16, ISO-8859-1)");
  });

  test("weekly-utf-16", () => {
    // 4.3.3 [4,84] — Test support for UTF-16 encoding, and XML names which contain Japanese characters.
    // (upstream: valid; external parameter entities are not read)
    const input = Buffer.from(
      "/v8APAA/AHgAbQBsACAAdgBlAHIAcwBpAG8AbgA9ACIAMQAuADAAIgA/AD4ADQAKADwAIQBEAE8AQwBUAFkAUABFACCQMVgxACAAUwBZAFMAVABFAE0AIAAiAHcAZQBlAGsAbAB5AC0AdQB0AGYALQAxADYALgBkAHQAZAAiAD4ADQAKADwAIQAtAC0AIJAxWDEwtTDzMNcw6wAgAC0ALQA+AA0ACgA8kDFYMQA+AA0ACgAgACAAPF50ZwiQMQA+AA0ACgAgACAAIAAgADxedF6mAD4AMQA5ADkANwA8AC9edF6mAD4ADQAKACAAIAAgACAAPGcIXqYAPgAxADwAL2cIXqYAPgANAAoAIAAgACAAIAA8kDEAPgAxADwAL5AxAD4ADQAKACAAIAA8AC9edGcIkDEAPgANAAoADQAKACAAIAA8bA9UDQA+AA0ACgAgACAAIAAgADxsDwA+XHF1MAA8AC9sDwA+AA0ACgAgACAAIAAgADxUDQA+WSqQzgA8AC9UDQA+AA0ACgAgACAAPAAvbA9UDQA+AA0ACgANAAoAIAAgADxpbVLZWDFUSjDqMLkwyAA+AA0ACgAgACAAIAAgADxpbVLZWDFUSgA+AA0ACgAgACAAIAAgACAAIAA8aW1S2VQNAD4AWABNAEwwqDDHMKMwvzD8MG5PXGIQADwAL2ltUtlUDQA+AA0ACgAgACAAIAAgACAAIAA8aW1S2TCzMPwwyQA+AFgAMwAzADUANQAtADIAMwA8AC9pbVLZMLMw/DDJAD4ADQAKACAAIAAgACAAIAAgADxd5WVwe6F0BgA+AA0ACgAgACAAIAAgACAAIAAgACAAPImLek0wgjCKXeVlcAA+ADEANgAwADAAPAAviYt6TTCCMIpd5WVwAD4ADQAKACAAIAAgACAAIAAgACAAIAA8W59+Pl3lZXAAPgAzADIAMAA8AC9bn34+XeVlcAA+AA0ACgAgACAAIAAgACAAIAAgACAAPF9TZwiJi3pNMIIwil3lZXAAPgAxADYAMAA8AC9fU2cIiYt6TTCCMIpd5WVwAD4ADQAKACAAIAAgACAAIAAgACAAIAA8X1NnCFuffj5d5WVwAD4AMgA0ADwAL19TZwhbn34+XeVlcAA+AA0ACgAgACAAIAAgACAAIAA8AC9d5WVwe6F0BgA+AA0ACgAgACAAIAAgACAAIAA8TohbmpgFdu4w6jC5MMgAPgANAAoAIAAgACAAIAAgACAAIAAgADxOiFuamAV27gA+AA0ACgAgACAAIAAgACAAIAAgACAAIAAgADwAUAA+AFgATQBMMKgwxzCjML8w/DBuV/pnLE7Vadgwbk9cYhAAPAAvAFAAPgANAAoAIAAgACAAIAAgACAAIAAgADwAL06IW5qYBXbuAD4ADQAKACAAIAAgACAAIAAgADwAL06IW5qYBXbuMOowuTDIAD4ADQAKACAAIAAgACAAIAAgADxbn2W9TouYBTDqMLkwyAA+AA0ACgAgACAAIAAgACAAIAAgACAAPFufZb1Oi5gFAD4ADQAKACAAIAAgACAAIAAgACAAIAAgACAAPABQAD4AWABNAEwwqDDHMKMwvzD8MG5X+mcsTtVp2DBuT1xiEAA8AC8AUAA+AA0ACgAgACAAIAAgACAAIAAgACAAPAAvW59lvU6LmAUAPgANAAoAIAAgACAAIAAgACAAIAAgADxbn2W9TouYBQA+AA0ACgAgACAAIAAgACAAIAAgACAAIAAgADwAUAA+evZUCE7WeT6I/VTBMG5qX4D9ir9n+wA8AC8AUAA+AA0ACgAgACAAIAAgACAAIAAgACAAPAAvW59lvU6LmAUAPgANAAoAIAAgACAAIAAgACAAPAAvW59lvU6LmAUw6jC5MMgAPgANAAoAIAAgACAAIAAgACAAPE4KlXcweDBuiYGKy06LmAUw6jC5MMgAPgANAAoAIAAgACAAIAAgACAAIAAgADxOCpV3MHgwbomBistOi5gFAD4ADQAKACAAIAAgACAAIAAgACAAIAAgACAAPABQAD5yeTBrMGowVwA8AC8AUAA+AA0ACgAgACAAIAAgACAAIAAgACAAPAAvTgqVdzB4MG6JgYrLTouYBQA+AA0ACgAgACAAIAAgACAAIAA8AC9OCpV3MHgwbomBistOi5gFMOowuTDIAD4ADQAKACAAIAAgACAAIAAgADxVT5hMcLlb/ntWAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AFAAPgBYAE0ATDBoMG9PVTBLMI8wSzCJMGowRDACADwALwBQAD4ADQAKACAAIAAgACAAIAAgADwAL1VPmExwuVv+e1YAPgANAAoAIAAgACAAIAA8AC9pbVLZWDFUSgA+AA0ACgANAAoAIAAgACAAIAA8aW1S2VgxVEoAPgANAAoAIAAgACAAIAAgACAAPGltUtlUDQA+aRx9IjCoMPMwuDDzMG6Vi3Z6ADwAL2ltUtlUDQA+AA0ACgAgACAAIAAgACAAIAA8aW1S2TCzMPwwyQA+AFMAOAA4ADIAMQAtADcANgA8AC9pbVLZMLMw/DDJAD4ADQAKACAAIAAgACAAIAAgADxd5WVwe6F0BgA+AA0ACgAgACAAIAAgACAAIAAgACAAPImLek0wgjCKXeVlcAA+ADEAMgAwADwAL4mLek0wgjCKXeVlcAA+AA0ACgAgACAAIAAgACAAIAAgACAAPFuffj5d5WVwAD4ANgA8AC9bn34+XeVlcAA+AA0ACgAgACAAIAAgACAAIAAgACAAPF9TZwiJi3pNMIIwil3lZXAAPgAzADIAPAAvX1NnCImLek0wgjCKXeVlcAA+AA0ACgAgACAAIAAgACAAIAAgACAAPF9TZwhbn34+XeVlcAA+ADIAPAAvX1NnCFuffj5d5WVwAD4ADQAKACAAIAAgACAAIAAgADwAL13lZXB7oXQGAD4ADQAKACAAIAAgACAAIAAgADxOiFuamAV27jDqMLkwyAA+AA0ACgAgACAAIAAgACAAIAAgACAAPE6IW5qYBXbuAD4ADQAKACAAIAAgACAAIAAgACAAIAAgACAAPABQAD4APABBACAAaAByAGUAZgA9ACIAaAB0AHQAcAA6AC8ALwB3AHcAdwAuAGcAbwBvAC4AbgBlAC4AagBwACIAPgBnAG8AbwA8AC8AQQA+MG5qX4D9MJKKvzB5MGYwfzCLADwALwBQAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AC9OiFuamAV27gA+AA0ACgAgACAAIAAgACAAIAA8AC9OiFuamAV27jDqMLkwyAA+AA0ACgAgACAAIAAgACAAIAA8W59lvU6LmAUw6jC5MMgAPgANAAoAIAAgACAAIAAgACAAIAAgADxbn2W9TouYBQA+AA0ACgAgACAAIAAgACAAIAAgACAAIAAgADwAUAA+ZvQwazABMGkwRjBEMEZpHH0iMKgw8zC4MPMwTDBCMIswS4q/Z/swWTCLADwALwBQAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AC9bn2W9TouYBQA+AA0ACgAgACAAIAAgACAAIAA8AC9bn2W9TouYBTDqMLkwyAA+AA0ACgAgACAAIAAgACAAIAA8TgqVdzB4MG6JgYrLTouYBTDqMLkwyAA+AA0ACgAgACAAIAAgACAAIAAgACAAPE4KlXcweDBuiYGKy06LmAUAPgANAAoAIAAgACAAIAAgACAAIAAgACAAIAA8AFAAPpWLdnowkjBZMIswbjBvMIEwkzBpMEYwajBuMGcwAQBZAGEAaABvAG8AITCSjLdTzjBXMGZOCzBVMEQwAgA8AC8AUAA+AA0ACgAgACAAIAAgACAAIAAgACAAPAAvTgqVdzB4MG6JgYrLTouYBQA+AA0ACgAgACAAIAAgACAAIAA8AC9OCpV3MHgwbomBistOi5gFMOowuTDIAD4ADQAKACAAIAAgACAAIAAgADxVT5hMcLlb/ntWAD4ADQAKACAAIAAgACAAIAAgACAAIAA8AFAAPmkcfSIwqDDzMLgw8zBnjsowko1wMIkwWzCLMFMwaDBMMGcwTTBqMEQwAv8IiYGKv2f7/wkAPAAvAFAAPgANAAoAIAAgACAAIAAgACAAPAAvVU+YTHC5W/57VgA+AA0ACgAgACAAIAAgADwAL2ltUtlYMVRKAD4ADQAKACAAIAA8AC9pbVLZWDFUSjDqMLkwyAA+AA0ACgA8AC+QMVgxAD4ADQAK",
      "base64",
    );
    expectParses(input);
  });

  test("weekly-utf-8", () => {
    // 4.3.3 [4,84] — Test support for UTF-8 encoding and XML names which contain Japanese characters.
    // (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE 週報 SYSTEM "weekly-utf-8.dtd">\r\n<!-- 週報サンプル -->\r\n<週報>\r\n  <年月週>\r\n    <年度>1997</年度>\r\n    <月度>1</月度>\r\n    <週>1</週>\r\n  </年月週>\r\n\r\n  <氏名>\r\n    <氏>山田</氏>\r\n    <名>太郎</名>\r\n  </氏名>\r\n\r\n  <業務報告リスト>\r\n    <業務報告>\r\n      <業務名>XMLエディターの作成</業務名>\r\n      <業務コード>X3355-23</業務コード>\r\n      <工数管理>\r\n        <見積もり工数>1600</見積もり工数>\r\n        <実績工数>320</実績工数>\r\n        <当月見積もり工数>160</当月見積もり工数>\r\n        <当月実績工数>24</当月実績工数>\r\n      </工数管理>\r\n      <予定項目リスト>\r\n        <予定項目>\r\n          <P>XMLエディターの基本仕様の作成</P>\r\n        </予定項目>\r\n      </予定項目リスト>\r\n      <実施事項リスト>\r\n        <実施事項>\r\n          <P>XMLエディターの基本仕様の作成</P>\r\n        </実施事項>\r\n        <実施事項>\r\n          <P>競合他社製品の機能調査</P>\r\n        </実施事項>\r\n      </実施事項リスト>\r\n      <上長への要請事項リスト>\r\n        <上長への要請事項>\r\n          <P>特になし</P>\r\n        </上長への要請事項>\r\n      </上長への要請事項リスト>\r\n      <問題点対策>\r\n        <P>XMLとは何かわからない。</P>\r\n      </問題点対策>\r\n    </業務報告>\r\n\r\n    <業務報告>\r\n      <業務名>検索エンジンの開発</業務名>\r\n      <業務コード>S8821-76</業務コード>\r\n      <工数管理>\r\n        <見積もり工数>120</見積もり工数>\r\n        <実績工数>6</実績工数>\r\n        <当月見積もり工数>32</当月見積もり工数>\r\n        <当月実績工数>2</当月実績工数>\r\n      </工数管理>\r\n      <予定項目リスト>\r\n        <予定項目>\r\n          <P><A href="http://www.goo.ne.jp">goo</A>の機能を調べてみる</P>\r\n        </予定項目>\r\n      </予定項目リスト>\r\n      <実施事項リスト>\r\n        <実施事項>\r\n          <P>更に、どういう検索エンジンがあるか調査する</P>\r\n        </実施事項>\r\n      </実施事項リスト>\r\n      <上長への要請事項リスト>\r\n        <上長への要請事項>\r\n          <P>開発をするのはめんどうなので、Yahoo!を買収して下さい。</P>\r\n        </上長への要請事項>\r\n      </上長への要請事項リスト>\r\n      <問題点対策>\r\n        <P>検索エンジンで車を走らせることができない。（要調査）</P>\r\n      </問題点対策>\r\n    </業務報告>\r\n  </業務報告リスト>\r\n</週報>\r\n';
    expectParses(input);
  });
});

describe("sun", () => {
  test("pe01", () => {
    // 2.8 — Parameter entities references are NOT RECOGNIZED in default attribute values. (upstream:
    // valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE root SYSTEM "pe01.dtd">\n<root/>\n';
    expectParses(input);
  });

  test("dtd00", () => {
    // 3.2.2 [51] — Tests parsing of alternative forms of text-only mixed content declaration.
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!ELEMENT x (#PCDATA)>\n    <!ELEMENT y (#PCDATA)*>\n]>\n\n<root/>\n";
    const canonical = "<root></root>";
    const compact: unknown = { root: "" };
    expectParses(input, canonical, compact);
  });

  test("dtd01", () => {
    // 2.5 [15] — Comments don't get parameter entity expansion
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!ENTITY % PE "this is a PE">\n    <!-- %these; %are; %not; %PEs; -->\n]>\n<root/>\n';
    const canonical = "<root></root>";
    const compact: unknown = { root: "" };
    expectParses(input, canonical, compact);
  });

  test("element", () => {
    // 3 — Tests clauses 1, 3, and 4 of the Element Valid validity constraint.
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT empty EMPTY>\n<!ELEMENT mixed1 (#PCDATA)>\n<!ELEMENT mixed2 (#PCDATA)*>\n<!ELEMENT mixed3 (#PCDATA|empty)*>\n]>\n\n<root>\n    <empty/>\n\n    <mixed1/>\n    <mixed1></mixed1>\n\n    <mixed2/>\n    <mixed2></mixed2>\n\n    <mixed3/>\n    <mixed3></mixed3>\n\n    <mixed1>allowed</mixed1>\n    <mixed1><![CDATA[<allowed>]]></mixed1>\n\n    <mixed2>also</mixed2>\n    <mixed2><![CDATA[<% illegal otherwise %>]]></mixed2>\n\n    <mixed3>moreover</mixed3>\n\n    <mixed1>allowed &amp; stuff</mixed1>\n\n    <mixed2>also</mixed2>\n\n    <mixed3>moreover <empty></empty> </mixed3>\n    <mixed3>moreover <empty/> </mixed3>\n    <mixed3><empty/> </mixed3>\n    <mixed3><empty/> too</mixed3>\n\n</root>\n";
    const canonical =
      "<root>&#10;    <empty></empty>&#10;&#10;    <mixed1></mixed1>&#10;    <mixed1></mixed1>&#10;&#10;    <mixed2></mixed2>&#10;    <mixed2></mixed2>&#10;&#10;    <mixed3></mixed3>&#10;    <mixed3></mixed3>&#10;&#10;    <mixed1>allowed</mixed1>&#10;    <mixed1>&lt;allowed&gt;</mixed1>&#10;&#10;    <mixed2>also</mixed2>&#10;    <mixed2>&lt;% illegal otherwise %&gt;</mixed2>&#10;&#10;    <mixed3>moreover</mixed3>&#10;&#10;    <mixed1>allowed &amp; stuff</mixed1>&#10;&#10;    <mixed2>also</mixed2>&#10;&#10;    <mixed3>moreover <empty></empty> </mixed3>&#10;    <mixed3>moreover <empty></empty> </mixed3>&#10;    <mixed3><empty></empty> </mixed3>&#10;    <mixed3><empty></empty> too</mixed3>&#10;&#10;</root>";
    const compact: unknown = {
      root: {
        empty: "",
        mixed1: ["", "", "allowed", "<allowed>", "allowed & stuff"],
        mixed2: ["", "", "also", "<% illegal otherwise %>", "also"],
        mixed3: [
          "",
          "",
          "moreover",
          { "#text": "moreover ", empty: "" },
          { "#text": "moreover ", empty: "" },
          { empty: "" },
          { empty: "", "#text": " too" },
        ],
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ext01", () => {
    // 4.3.1 4.3.2 [77] [78] — Tests use of external parsed entities with and without content. (upstream:
    // valid; external general entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT foo ANY>\n<!ELEMENT bar ANY>\n<!ELEMENT is ANY>\n<!ENTITY root SYSTEM "ext01.ent">\n<!ENTITY null SYSTEM "null.ent">\n]>\n<root> &root; &root; &null; &null; </root>\n';
    expectParses(input);
  });

  test("ext02", () => {
    // 4.3.2 [78] — Tests use of external parsed entities with different encodings than the base document.
    // (upstream: valid; external general entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo (root*)>\n<!ELEMENT root EMPTY>\n<!ENTITY utf16b SYSTEM "../invalid/utf16b.xml">\n<!ENTITY utf16l SYSTEM "../invalid/utf16l.xml">\n]>\n\n<foo> &utf16b; &utf16l; </foo>\n';
    expectParses(input);
  });

  test("not-sa01", () => {
    // 2.9 — A non-standalone document is valid if declared as such. (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      "<?xml version='1.0' standalone='no'?>\n\n<!DOCTYPE root SYSTEM \"sa.dtd\">\n\n<root>\n    <child>\n    The whitespace before and after this element keeps\n    this from being standalone.\n    </child>\n</root>\n";
    const canonical =
      "<root>&#10;    <child>&#10;    The whitespace before and after this element keeps&#10;    this from being standalone.&#10;    </child>&#10;</root>";
    const compact: unknown = {
      root: {
        child: "\n    The whitespace before and after this element keeps\n    this from being standalone.\n    ",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("not-sa02", () => {
    // 2.9 — A non-standalone document is valid if declared as such. (upstream: valid; external parameter
    // entities are not read; output depends on them)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'no\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!ENTITY internal " number99">\n]>\n\n    <!-- sync with ../invalid/not-sa02.xml -->\n\n    <!--\n\tlots of normalized/defaulted attributes\n\tkeep this from being standalone\n\n\tXXX not the best basis for negative tests!!\n    -->\n\n<attributes\n    notation =\t" nonce "\n    nmtoken =\t" this-gets-normalized "\n    nmtokens =\t" this \t\n also\t gets normalized "\n    id =\t"\t&internal; "\n    idref =\t" &internal;\n    "\n    idrefs =\t" &internal;  &internal;    &internal;"\n    entity =\t" unparsed-1 "\n    entities =\t"unparsed-1\n    unparsed-2\t\t\n"\n    cdata =\t"nothing happens to this one!"\n    />\n';
    expectParses(input);
  });

  test("not-sa03", () => {
    // 2.9 — A non-standalone document is valid if declared as such. (upstream: valid; external parameter
    // entities are not read; output depends on them)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'no\'?>\n\n<!DOCTYPE attributes SYSTEM "sa.dtd" [\n    <!--\n\tThis one is almost standalone since the values\n\tare pre-normalized in this document, and the\n\tdefaulted attribute is explicit.\n    \n\tBUT the entity refs are both external and need\n\tnormalization.\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    notation =\t"foo"\n    nmtoken =\t"this-gets-normalized"\n    nmtokens =\t"this also gets normalized"\n    id =\t"&internal;"\n    idref =\t"&internal;"\n    idrefs =\t"&internal; &internal; &internal;"\n    entity =\t"unparsed-1"\n    entities =\t"unparsed-1 unparsed-2"\n    cdata =\t"nothing happens to this one!"\n    />\n';
    expectParses(input);
  });

  test("not-sa04", () => {
    // 2.9 — A non-standalone document is valid if declared as such. (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'no\'?>\n\n<!DOCTYPE attributes SYSTEM "sa.dtd" [\n    <!--\n\tThis one isn\'t standalone since it\'s got a defaulted\n\tattribute (token) and one needing normalization\n\t(notation).\n    -->\n\n    <!ATTLIST attributes\n\ttoken\t\t(a|b|c)\t\t"a"\n\tnotation\t(nonce|foo|bar)\t#IMPLIED\n\t>\n    <!ENTITY internal "internal&number;">\n    <!ENTITY number "42">\n]>\n\n<attributes\n    notation =\t" nonce "\n    nmtoken =\t"this-gets-normalized"\n    nmtokens =\t"this also gets normalized"\n    id =\t"&internal;"\n    idref =\t"&internal;"\n    idrefs =\t"&internal; &internal; &internal;"\n    entity =\t"unparsed-1"\n    entities =\t"unparsed-1 unparsed-2"\n    cdata =\t"nothing happens to this one!"\n    />\n\n<?pi equals three?>\n';
    const canonical =
      '<attributes cdata="nothing happens to this one!" entities="unparsed-1 unparsed-2" entity="unparsed-1" id="internal42" idref="internal42" idrefs="internal42 internal42 internal42" nmtoken="this-gets-normalized" nmtokens="this also gets normalized" notation="nonce" token="a"></attributes>';
    const compact: unknown = {
      attributes: {
        "@cdata": "nothing happens to this one!",
        "@entities": "unparsed-1 unparsed-2",
        "@entity": "unparsed-1",
        "@id": "internal42",
        "@idref": "internal42",
        "@idrefs": "internal42 internal42 internal42",
        "@nmtoken": "this-gets-normalized",
        "@nmtokens": "this also gets normalized",
        "@notation": "nonce",
        "@token": "a",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("notation01", () => {
    // 4.7 [82] — NOTATION declarations don't need SYSTEM IDs; and externally declared notations may be
    // used to declare unparsed entities in the internal DTD subset. The notation must be reported to the
    // application. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\n<!DOCTYPE test SYSTEM "notation01.dtd" [\n    <!ENTITY applydsssl SYSTEM "applydsssl.gif" NDATA GIF>\n]>\n<test>test</test>\n';
    const canonical = "<test>test</test>";
    const compact: unknown = { test: "test" };
    expectParses(input, canonical, compact);
  });

  test("optional", () => {
    // 3 3.2.1 [47] — Tests declarations of "children" content models, and the validity constraints
    // associated with them. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "dtdtest.dtd">\n<root>\n    <!--\n\tThis primarily bangs on different ways of expressing\n\toptionality in content models.\n    -->\n    <once><e/></once>\n\n    <twice><e/><e/></twice>\n\n\n    <once-or-twice-a><e/></once-or-twice-a>\n    <once-or-twice-b><e/></once-or-twice-b>\n    <once-or-twice-c><e/></once-or-twice-c>\n    <once-or-twice-d><e/></once-or-twice-d>\n    <once-or-twice-e><e/></once-or-twice-e>\n\n    <once-or-twice-a><e/><e/></once-or-twice-a>\n    <once-or-twice-b><e/><e/></once-or-twice-b>\n    <once-or-twice-c><e/><e/></once-or-twice-c>\n    <once-or-twice-d><e/><e/></once-or-twice-d>\n    <once-or-twice-e><e/><e/></once-or-twice-e>\n\n\n    <once-or-more-a><e/></once-or-more-a>\n    <once-or-more-b><e/></once-or-more-b>\n    <once-or-more-c><e/></once-or-more-c>\n    <once-or-more-d><e/></once-or-more-d>\n    <once-or-more-e><e/></once-or-more-e>\n\n    <once-or-more-a><e/><e/></once-or-more-a>\n    <once-or-more-b><e/><e/></once-or-more-b>\n    <once-or-more-c><e/><e/></once-or-more-c>\n    <once-or-more-d><e/><e/></once-or-more-d>\n    <once-or-more-e><e/><e/></once-or-more-e>\n\n    <once-or-more-a><e/><e/><e/></once-or-more-a>\n    <once-or-more-b><e/><e/><e/></once-or-more-b>\n    <once-or-more-c><e/><e/><e/></once-or-more-c>\n    <once-or-more-d><e/><e/><e/></once-or-more-d>\n    <once-or-more-e><e/><e/><e/></once-or-more-e>\n\n    <once-or-more-a><e/><e/><e/><e/></once-or-more-a>\n    <once-or-more-b><e/><e/><e/><e/></once-or-more-b>\n    <once-or-more-c><e/><e/><e/><e/></once-or-more-c>\n    <once-or-more-d><e/><e/><e/><e/></once-or-more-d>\n    <once-or-more-e><e/><e/><e/><e/></once-or-more-e>\n\n\n</root>\n';
    const canonical =
      "<root>&#10;    &#10;    <once><e></e></once>&#10;&#10;    <twice><e></e><e></e></twice>&#10;&#10;&#10;    <once-or-twice-a><e></e></once-or-twice-a>&#10;    <once-or-twice-b><e></e></once-or-twice-b>&#10;    <once-or-twice-c><e></e></once-or-twice-c>&#10;    <once-or-twice-d><e></e></once-or-twice-d>&#10;    <once-or-twice-e><e></e></once-or-twice-e>&#10;&#10;    <once-or-twice-a><e></e><e></e></once-or-twice-a>&#10;    <once-or-twice-b><e></e><e></e></once-or-twice-b>&#10;    <once-or-twice-c><e></e><e></e></once-or-twice-c>&#10;    <once-or-twice-d><e></e><e></e></once-or-twice-d>&#10;    <once-or-twice-e><e></e><e></e></once-or-twice-e>&#10;&#10;&#10;    <once-or-more-a><e></e></once-or-more-a>&#10;    <once-or-more-b><e></e></once-or-more-b>&#10;    <once-or-more-c><e></e></once-or-more-c>&#10;    <once-or-more-d><e></e></once-or-more-d>&#10;    <once-or-more-e><e></e></once-or-more-e>&#10;&#10;    <once-or-more-a><e></e><e></e></once-or-more-a>&#10;    <once-or-more-b><e></e><e></e></once-or-more-b>&#10;    <once-or-more-c><e></e><e></e></once-or-more-c>&#10;    <once-or-more-d><e></e><e></e></once-or-more-d>&#10;    <once-or-more-e><e></e><e></e></once-or-more-e>&#10;&#10;    <once-or-more-a><e></e><e></e><e></e></once-or-more-a>&#10;    <once-or-more-b><e></e><e></e><e></e></once-or-more-b>&#10;    <once-or-more-c><e></e><e></e><e></e></once-or-more-c>&#10;    <once-or-more-d><e></e><e></e><e></e></once-or-more-d>&#10;    <once-or-more-e><e></e><e></e><e></e></once-or-more-e>&#10;&#10;    <once-or-more-a><e></e><e></e><e></e><e></e></once-or-more-a>&#10;    <once-or-more-b><e></e><e></e><e></e><e></e></once-or-more-b>&#10;    <once-or-more-c><e></e><e></e><e></e><e></e></once-or-more-c>&#10;    <once-or-more-d><e></e><e></e><e></e><e></e></once-or-more-d>&#10;    <once-or-more-e><e></e><e></e><e></e><e></e></once-or-more-e>&#10;&#10;&#10;</root>";
    const compact: unknown = {
      root: {
        once: { e: "" },
        twice: { e: ["", ""] },
        "once-or-twice-a": [{ e: "" }, { e: ["", ""] }],
        "once-or-twice-b": [{ e: "" }, { e: ["", ""] }],
        "once-or-twice-c": [{ e: "" }, { e: ["", ""] }],
        "once-or-twice-d": [{ e: "" }, { e: ["", ""] }],
        "once-or-twice-e": [{ e: "" }, { e: ["", ""] }],
        "once-or-more-a": [{ e: "" }, { e: ["", ""] }, { e: ["", "", ""] }, { e: ["", "", "", ""] }],
        "once-or-more-b": [{ e: "" }, { e: ["", ""] }, { e: ["", "", ""] }, { e: ["", "", "", ""] }],
        "once-or-more-c": [{ e: "" }, { e: ["", ""] }, { e: ["", "", ""] }, { e: ["", "", "", ""] }],
        "once-or-more-d": [{ e: "" }, { e: ["", ""] }, { e: ["", "", ""] }, { e: ["", "", "", ""] }],
        "once-or-more-e": [{ e: "" }, { e: ["", ""] }, { e: ["", "", ""] }, { e: ["", "", "", ""] }],
      },
    };
    expectParses(input, canonical, compact);
  });

  test("required00", () => {
    // 3.3.2 [60] — Tests the #REQUIRED attribute declaration syntax, and the associated validity
    // constraint.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!ATTLIST root\n\treq CDATA #REQUIRED\n\t>\n]>\n\n<root req="foo"/>\n';
    const canonical = '<root req="foo"></root>';
    const compact: unknown = { root: { "@req": "foo" } };
    expectParses(input, canonical, compact);
  });

  test("sa01", () => {
    // 2.9 [32] — A document may be marked 'standalone' if any optional whitespace is defined within the
    // internal DTD subset.
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\n\n<!DOCTYPE root [\n    <!ELEMENT root (child)*>\n    <!ELEMENT child (#PCDATA)>\n]>\n\n<root>\n    <child>\n    The whitespace around this element would be\n    invalid as standalone were the DTD external.\n    </child>\n</root>\n";
    const canonical =
      "<root>&#10;    <child>&#10;    The whitespace around this element would be&#10;    invalid as standalone were the DTD external.&#10;    </child>&#10;</root>";
    const compact: unknown = {
      root: {
        child:
          "\n    The whitespace around this element would be\n    invalid as standalone were the DTD external.\n    ",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("sa02", () => {
    // 2.9 [32] — A document may be marked 'standalone' if any attributes that need normalization are
    // defined within the internal DTD subset.
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes [\n    <!ELEMENT attributes EMPTY>\n\n    <!--\n\t2.9 gives validity constraints applying to attributes\n\tin standalone docs:  no external defaults or decls\n\tcausing normalization.\n\n\t3.3.3 describes the normalization rules\n    -->\n\n    <!ATTLIST attributes\n\ttoken\t\t(a|b|c)\t\t"a"\n\tnotation\t(nonce|foo|bar)\t#IMPLIED\n\tnmtoken\t\tNMTOKEN\t\t#IMPLIED\n\tnmtokens\tNMTOKENS\t#IMPLIED\n\tid\t\tID\t\t#IMPLIED\n\tidref\t\tIDREF\t\t#IMPLIED\n\tidrefs\t\tIDREFS\t\t#IMPLIED\n\tentity\t\tENTITY\t\t#IMPLIED\n\tentities\tENTITIES\t#IMPLIED\n\tcdata\t\tCDATA\t\t#IMPLIED\n\t>\n    \n    <!ENTITY internal " internal&number; ">\n    <!ENTITY number "42">\n\n    <!NOTATION nonce SYSTEM "file:/dev/null">\n    <!NOTATION foo PUBLIC "-//public id//foo" "file:/dev/null">\n    <!NOTATION bar SYSTEM "file:/dev/tty">\n\n    <!ENTITY unparsed-1 PUBLIC "-//some public//ID" "file:/dev/console"\n\t\t\tNDATA nonce>\n    <!ENTITY unparsed-2 SYSTEM "scheme://host/data"\n\t\t\tNDATA foo>\n]>\n\n<attributes\n    notation =\t" nonce "\n    nmtoken =\t" this-gets-normalized "\n    nmtokens =\t" this\t\n also\t gets normalized "\n    id =\t"\t&internal; "\n    idref =\t" &internal;\n    "\n    idrefs =\t" &internal;  &internal;    &internal;"\n    entity =\t" unparsed-1 "\n    entities =\t"unparsed-1 unparsed-2"\n    cdata =\t"nothing happens to this one!"\n    />\n';
    const canonical =
      '<attributes cdata="nothing happens to this one!" entities="unparsed-1 unparsed-2" entity="unparsed-1" id="internal42" idref="internal42" idrefs="internal42 internal42 internal42" nmtoken="this-gets-normalized" nmtokens="this also gets normalized" notation="nonce" token="a"></attributes>';
    const compact: unknown = {
      attributes: {
        "@cdata": "nothing happens to this one!",
        "@entities": "unparsed-1 unparsed-2",
        "@entity": "unparsed-1",
        "@id": "internal42",
        "@idref": "internal42",
        "@idrefs": "internal42 internal42 internal42",
        "@nmtoken": "this-gets-normalized",
        "@nmtokens": "this also gets normalized",
        "@notation": "nonce",
        "@token": "a",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("sa03", () => {
    // 2.9 [32] — A document may be marked 'standalone' if any the defined entities need expanding are
    // internal, and no attributes need defaulting or normalization. On output, requires notations to be
    // correctly reported. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "sa.dtd" [\n    <!--\n\tThis one is standalone since the values are\n\tpre-normalized in this document, and the\n\tdefaulted attribute is explicit.\n    \n\tSimilarly the entity refs are internal and\n\tdon\'t need normalization ... the unparsed\n\tentities (and entities) aren\'t "references"\n    -->\n    <!ENTITY internal "internal&number;">\n    <!ENTITY number "42">\n]>\n\n<attributes\n    token =\t"b"\n    notation =\t"foo"\n    nmtoken =\t"this-gets-normalized"\n    nmtokens =\t"this also gets normalized"\n    id =\t"&internal;"\n    idref =\t"&internal;"\n    idrefs =\t"&internal; &internal; &internal;"\n    entity =\t"unparsed-1"\n    entities =\t"unparsed-1 unparsed-2"\n    cdata =\t"nothing happens to this one!"\n    />\n';
    const canonical =
      '<attributes cdata="nothing happens to this one!" entities="unparsed-1 unparsed-2" entity="unparsed-1" id="internal42" idref="internal42" idrefs="internal42 internal42 internal42" nmtoken="this-gets-normalized" nmtokens="this also gets normalized" notation="foo" token="b"></attributes>';
    const compact: unknown = {
      attributes: {
        "@cdata": "nothing happens to this one!",
        "@entities": "unparsed-1 unparsed-2",
        "@entity": "unparsed-1",
        "@id": "internal42",
        "@idref": "internal42",
        "@idrefs": "internal42 internal42 internal42",
        "@nmtoken": "this-gets-normalized",
        "@nmtokens": "this also gets normalized",
        "@notation": "foo",
        "@token": "b",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("sa04", () => {
    // 2.9 [32] — Like sa03 but relies on attribute defaulting defined in the internal subset. On output,
    // requires notations to be correctly reported. (upstream: valid; external parameter entities are not
    // read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "sa.dtd" [\n    <!--\n\tThis one is standalone since the values are\n\tpre-normalized in this document, except that\n\tone defaulted attribute is (re)defined internally\n\tand so is one normalized one.\n    \n        Similarly the entity refs are internal.  Unparsed\n        entities and notations are not listed among the\n        items that must not be externally declared in\n        standalone documents, even though processors must\n        in theory report their identifiers.\n\n    -->\n\n    <!ATTLIST attributes\n\ttoken\t\t(a|b|c)\t\t"a"\n\tnotation\t(nonce|foo|bar)\t#IMPLIED\n\t>\n    <!ENTITY internal "internal&number;">\n    <!ENTITY number "42">\n]>\n\n<attributes\n    notation =\t" nonce "\n    nmtoken =\t"this-gets-normalized"\n    nmtokens =\t"this also gets normalized"\n    id =\t"&internal;"\n    idref =\t"&internal;"\n    idrefs =\t"&internal; &internal; &internal;"\n    entity =\t"unparsed-1"\n    entities =\t"unparsed-1 unparsed-2"\n    cdata =\t"nothing happens to this one!"\n    />\n\n<?pi equals three?>\n';
    const canonical =
      '<attributes cdata="nothing happens to this one!" entities="unparsed-1 unparsed-2" entity="unparsed-1" id="internal42" idref="internal42" idrefs="internal42 internal42 internal42" nmtoken="this-gets-normalized" nmtokens="this also gets normalized" notation="nonce" token="a"></attributes>';
    const compact: unknown = {
      attributes: {
        "@cdata": "nothing happens to this one!",
        "@entities": "unparsed-1 unparsed-2",
        "@entity": "unparsed-1",
        "@id": "internal42",
        "@idref": "internal42",
        "@idrefs": "internal42 internal42 internal42",
        "@nmtoken": "this-gets-normalized",
        "@nmtokens": "this also gets normalized",
        "@notation": "nonce",
        "@token": "a",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("sa05", () => {
    // 2.9 [32] — Like sa01 but this document is standalone since it has no optional whitespace. On output,
    // requires notations to be correctly reported. (upstream: valid; external parameter entities are not
    // read)
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\n\n<!DOCTYPE root SYSTEM \"sa.dtd\">\n\n<root><child>\n    No whitespace before or after this standalone element.\n</child></root>\n";
    const canonical =
      "<root><child>&#10;    No whitespace before or after this standalone element.&#10;</child></root>";
    const compact: unknown = {
      root: { child: "\n    No whitespace before or after this standalone element.\n" },
    };
    expectParses(input, canonical, compact);
  });

  test("v-sgml01", () => {
    // 3.3.1 [59] — XML permits token reuse, while SGML does not.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!--\n\tSGML dislikes token reuse.  It\'s legal XML, so any\n\tXML parser must accept it, though it\'s discouraged\n\tin documents "for interoperability"\n    -->\n    <!ATTLIST root\n\tstatus\t\t(initial-draft|revision|final) "initial-draft"\n\tposition\t(first|intermediate|final) "first"\n\t>\n]>\n\n<root/>\n';
    const canonical = '<root position="first" status="initial-draft"></root>';
    const compact: unknown = { root: { "@position": "first", "@status": "initial-draft" } };
    expectParses(input, canonical, compact);
  });

  test("v-lang01", () => {
    // 2.12 [35] — Tests a lowercase ISO language code.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root xml:lang CDATA #IMPLIED>\n]>\n<root xml:lang="en"/>\n';
    const canonical = '<root xml:lang="en"></root>';
    const compact: unknown = { root: { "@xml:lang": "en" } };
    expectParses(input, canonical, compact);
  });

  test("v-lang02", () => {
    // 2.12 [35] — Tests a ISO language code with a subcode.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root xml:lang CDATA #IMPLIED>\n]>\n<root xml:lang="en-IN"/>\n\n';
    const canonical = '<root xml:lang="en-IN"></root>';
    const compact: unknown = { root: { "@xml:lang": "en-IN" } };
    expectParses(input, canonical, compact);
  });

  test("v-lang03", () => {
    // 2.12 [36] — Tests a IANA language code with a subcode.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root xml:lang CDATA #IMPLIED>\n]>\n<root xml:lang="i-klingon-whorf"/>\n\n';
    const canonical = '<root xml:lang="i-klingon-whorf"></root>';
    const compact: unknown = { root: { "@xml:lang": "i-klingon-whorf" } };
    expectParses(input, canonical, compact);
  });

  test("v-lang04", () => {
    // 2.12 [37] — Tests a user language code with a subcode.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root xml:lang CDATA #IMPLIED>\n]>\n<root xml:lang="x-dialect-valleygirl"/>\n\n';
    const canonical = '<root xml:lang="x-dialect-valleygirl"></root>';
    const compact: unknown = { root: { "@xml:lang": "x-dialect-valleygirl" } };
    expectParses(input, canonical, compact);
  });

  test("v-lang05", () => {
    // 2.12 [35] — Tests an uppercase ISO language code.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root xml:lang CDATA #IMPLIED>\n]>\n<root xml:lang="DE"/>\n\n';
    const canonical = '<root xml:lang="DE"></root>';
    const compact: unknown = { root: { "@xml:lang": "DE" } };
    expectParses(input, canonical, compact);
  });

  test("v-lang06", () => {
    // 2.12 [37] — Tests a user language code.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root xml:lang CDATA #IMPLIED>\n]>\n<root xml:lang="X-Java"/>\n\n';
    const canonical = '<root xml:lang="X-Java"></root>';
    const compact: unknown = { root: { "@xml:lang": "X-Java" } };
    expectParses(input, canonical, compact);
  });

  test("v-pe00", () => {
    // 4.5 — Tests construction of internal entity replacement text, using an example in the XML
    // specification. (upstream: valid; external parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE root SYSTEM "pe00.dtd">\n<root>&book;</root>\n';
    expectParses(input);
  });

  test("v-pe03", () => {
    // 4.5 — Tests construction of internal entity replacement text, using an example in the XML
    // specification.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root (p)>\n<!ELEMENT p (#PCDATA)>\n<!-- Example 1 from XML spec 1.0 Appendix D -->\n<!ENTITY example "<p>An ampersand (&#38;#38;) may be escaped\nnumerically (&#38;#38;#38) or with a general entity (&amp;amp;).</p>" >\n]>\n<root>&example;</root>\n';
    const canonical =
      "<root><p>An ampersand (&amp;) may be escaped&#10;numerically (&amp;#38) or with a general entity (&amp;amp;).</p></root>";
    const compact: unknown = {
      root: {
        p: "An ampersand (&) may be escaped\nnumerically (&#38) or with a general entity (&amp;).",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("v-pe02", () => {
    // 4.5 — Tests construction of internal entity replacement text, using a complex example in the XML
    // specification. (upstream: valid; external parameter entities are not read)
    const input: string =
      "<?xml version='1.0'?>\n<!DOCTYPE test [\n<!ELEMENT test (#PCDATA) >\n<!ENTITY % xx '&#37;zz;'>\n<!ENTITY % zz '&#60;!ENTITY tricky \"error-prone\" >' >\n%xx;\n]>\n<test>This sample shows a &tricky; method.</test>\n<!-- Example 2 from XML spec 1.0 Appendix D -->\n";
    const canonical = "<test>This sample shows a error-prone method.</test>";
    const compact: unknown = { test: "This sample shows a error-prone method." };
    expectParses(input, canonical, compact);
  });

  test("inv-dtd01", () => {
    // 3.2.2 — Tests the No Duplicate Types VC
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT y (#PCDATA|x|x)*>\n    <!-- element types can't repeat in mixed content -->\n    <!ELEMENT root ANY>\n]>\n\n<root/>\n";
    expectParses(input);
  });

  test("inv-dtd02", () => {
    // 4.2.2 — Tests the "Notation Declared" VC by using an undeclared notation name.
    const input: string =
      '<!DOCTYPE paper [\n<!ELEMENT paper EMPTY>\n<!ENTITY Brittannica SYSTEM "http://www.eb.com" NDATA Encyclopaedia>\n]>\n<paper/>\n';
    expectParses(input);
  });

  test("inv-dtd03", () => {
    // 3 — Tests the "Element Valid" VC (clause 2) by omitting a required element.
    const input: string =
      '<!DOCTYPE violation [\n<!ELEMENT violation (a,a,a,b)>\n<!ELEMENT a EMPTY>\n<!ELEMENT b EMPTY>\n    <!-- tests the "element valid" constraint for content\n\twhich doesn\'t match the declared content model.\n\t(there can be an infinite number of such tests...)\n\t-->\n]>\n<violation>\n    <a/>\n    <a/>\n    <b/>\n</violation>\n';
    expectParses(input);
  });

  test("el01", () => {
    // 3 — Tests the Element Valid VC (clause 4) by including an undeclared child element.
    const input: string = "<!DOCTYPE root [\n<!ELEMENT root ANY>\n]>\n<root> <undeclared/> </root>\n\n";
    expectParses(input);
  });

  test("el02", () => {
    // 3 — Tests the Element Valid VC (clause 1) by including elements in an EMPTY content model.
    const input: string = "<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n]>\n<root><root/></root>\n";
    expectParses(input);
  });

  test("el03", () => {
    // 3 — Tests the Element Valid VC (clause 3) by including a child element not permitted by a mixed
    // content model.
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root (#PCDATA|root)*>\n<!ELEMENT exception (#PCDATA)>\n]>\n<root>this is ok <exception>this isn't</exception> </root>\n";
    expectParses(input);
  });

  test("el04", () => {
    // 3.2 — Tests the Unique Element Type Declaration VC.
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT exception (#PCDATA)>\n<!ELEMENT exception (#PCDATA)>\n]>\n<root/>\n";
    expectParses(input);
  });

  test("el05", () => {
    // 3.2.2 — Tests the No Duplicate Types VC.
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root (#PCDATA|repeat-till-done|repeat-till-done)*>\n<!ELEMENT repeat-till-done (#PCDATA)>\n]>\n<root/>\n";
    expectParses(input);
  });

  test("el06", () => {
    // 3 — Tests the Element Valid VC (clause 1), using one of the predefined internal entities inside an
    // EMPTY content model.
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n    <!-- in case parsers special-case builtin entities incorrectly -->\n]>\n<root>&amp;</root>\n\n";
    expectParses(input);
  });

  test("id01", () => {
    // 3.3.1 — Tests the ID (is a Name) VC (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/sa.dtd">\n\n<!-- values of type ID must match "name" -->\n\n<root>\n    <attributes id="42a"/>\n</root>\n';
    expectParses(input);
  });

  test("id02", () => {
    // 3.3.1 — Tests the ID (appears once) VC (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/sa.dtd">\n\n<!-- a name must not appear more than once as a value of type id -->\n\n<root>\n    <attributes id="a42"/>\n    <attributes id="a42"/>\n</root>\n\n';
    expectParses(input);
  });

  test("id03", () => {
    // 3.3.1 — Tests the One ID per Element Type VC (upstream: invalid; external parameter entities are not
    // read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/sa.dtd" [\n    <!ATTLIST attributes\n\tid2\tID\t#IMPLIED\n\t>\n]>\n\n<!-- no element type may have more than one ID attribute specified -->\n\n<root/>\n\n';
    expectParses(input);
  });

  test("id04", () => {
    // 3.3.1 — Tests the ID Attribute Default VC
    const input: string =
      '<!DOCTYPE root [\n    <!ATTLIST root\n\tid2\tID\t"x23"\n\t>\n]>\n\n<!-- an ID attribute must have a declared default\n    of #IMPLIED or #REQUIRED\n-->\n\n<root/>\n\n';
    expectParses(input);
  });

  test("id05", () => {
    // 3.3.1 — Tests the ID Attribute Default VC
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root ANY>\n    <!ATTLIST root\n\tid2\tID\t#FIXED "x23"\n\t>\n]>\n\n<!-- an ID attribute must have a declared default\n    of #IMPLIED or #REQUIRED\n-->\n\n<root/>\n\n\n';
    expectParses(input);
  });

  test("id06", () => {
    // 3.3.1 — Tests the IDREF (is a Name) VC
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root ANY>\n    <!ATTLIST root\n\tid\tID\t#IMPLIED\n\tidref\tIDREF\t#IMPLIED\n\t>\n]>\n\n<!-- Values of type IDREF must match the name production -->\n\n<root idref="36d">\n</root>\n\n\n';
    expectParses(input);
  });

  test("id07", () => {
    // 3.3.1 — Tests the IDREFS (is a Names) VC
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root ANY>\n    <!ATTLIST root\n\tid\tID\t#IMPLIED\n\tidref\tIDREF\t#IMPLIED\n\tidrefs\tIDREFS\t#IMPLIED\n\t>\n]>\n\n<!-- Values of type IDREFS must match the names production -->\n\n<root idrefs="d36 36d">\n</root>\n\n\n\n';
    expectParses(input);
  });

  test("id08", () => {
    // 3.3.1 — Tests the IDREF (matches an ID) VC
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root ANY>\n    <!ATTLIST root\n\tid\tID\t#IMPLIED\n\tidref\tIDREF\t#IMPLIED\n\t>\n]>\n\n<!-- each name must match the value of an id attribute on some element -->\n\n<root idref="d36d">\n</root>\n\n\n';
    expectParses(input);
  });

  test("id09", () => {
    // 3.3.1 — Tests the IDREF (IDREFS matches an ID) VC
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root ANY>\n    <!ATTLIST root\n\tid\tID\t#IMPLIED\n\tidref\tIDREF\t#IMPLIED\n\tidrefs\tIDREFS\t#IMPLIED\n\t>\n]>\n\n<!-- each name must match the value of an id attribute on some element -->\n\n<root idrefs="d36 ee38">\n    <root id="d36"/>\n</root>\n\n\n\n';
    expectParses(input);
  });

  test("inv-not-sa01", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that optional whitespace causes a
    // validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\n\n<!DOCTYPE root SYSTEM \"../valid/sa.dtd\">\n    \n<root>\n    <child>\n    The whitespace before and after this element keeps\n    this from being standalone.\n    </child>\n</root>\n";
    expectParses(input);
  });

  test("inv-not-sa02", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that attributes needing normalization
    // cause a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!ENTITY internal " number99">\n]>\n\n    <!-- sync with ../valid/not-sa02.xml -->\n\n    <!--\n\tLOTS of normalized/defaulted attributes\n\tkeep this from being standalone\n\n\tXXX not the best of tests!!\n\t... each type of normalization/defaulting\n\tneeds separate testing\n    -->\n\n<attributes\n    notation =\t" nonce "\n    nmtoken =\t" this-gets-normalized "\n    nmtokens =\t" this&#x0d;&#x0a; also\t gets&#x20; normalized "\n    id =\t"\t&internal; "\n    idref =\t" &internal;\n    "\n    idrefs =\t" &internal;  &internal;    &internal;"\n    entity =\t" unparsed-1 "\n    entities =\t"unparsed-1\n    unparsed-2\t\t\n"\n    cdata =\t"nothing happens to this one!"\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa04", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that attributes needing defaulting
    // cause a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\n\n<!DOCTYPE attributes SYSTEM \"../valid/sa.dtd\" [\n    <!--\n\tattribute needs defaulting\n    -->\n]>\n\n<attributes/>\n\n<?pi equals three?>\n";
    expectParses(input);
  });

  test("inv-not-sa05", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that a token attribute that needs
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\n\n<!DOCTYPE attributes SYSTEM \"../valid/sa.dtd\" [\n    <!--\n\tTOKEN needs normalization\n    -->\n]>\n\n<attributes\n    token =\t\" c \"\n    />\n";
    expectParses(input);
  });

  test("inv-not-sa06", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that a NOTATION attribute that needs
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tNOTATION needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    notation =\t" nonce "\n    />\n\n';
    expectParses(input);
  });

  test("inv-not-sa07", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that an NMTOKEN attribute needing
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tNMTOKEN needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    nmtoken =\t" this-gets-normalized "\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa08", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that an NMTOKENS attribute needing
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tNMTOKENS needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    nmtokens =\t" this&#x0d;&#x0a; also\t gets&#x20; normalized "\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa09", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that an ID attribute needing
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tID needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    id =\t"\tcindy "\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa10", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that an IDREF attribute needing
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tIDREF needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    id =\t"id43"\n    idref =\t" id43\n    "\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa11", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that an IDREFS attribute needing
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tIDREFS needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    id =\t"date28"\n    idrefs =\t" date28   date28\n    date28\t"\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa12", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that an ENTITY attribute needing
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tENTITY needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    entity =\t" unparsed-1 "\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa13", () => {
    // 2.9 — Tests the Standalone Document Declaration VC, ensuring that an ENTITIES attribute needing
    // normalization causes a validity error. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tENTITIES needs normalization\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    entities =\t"\n    unparsed-1\n    \n    unparsed-2\n\t\t  "\n    />\n';
    expectParses(input);
  });

  test("inv-not-sa14", () => {
    // 3 — CDATA sections containing only whitespace do not match the nonterminal S, and cannot appear in
    // these positions. (upstream: invalid; external parameter entities are not read)
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\n\n<!DOCTYPE root SYSTEM \"../valid/sa.dtd\">\n    \n<root><![CDATA[\n    ]]><child>\n    The whitespace before and after this element keeps\n    this from being standalone.  (CDATA is just another\n    way to represent text...)\n    </child><![CDATA[\n]]></root>\n";
    expectParses(input);
  });

  test("optional01", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one is required. (upstream: invalid; external parameter entities are not read)
    const input: string = '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once></once>\n</root>\n';
    expectParses(input);
  });

  test("optional02", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // two children where one is required. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once><e/><e/></once>\n</root>\n\n';
    expectParses(input);
  });

  test("optional03", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where two are required. (upstream: invalid; external parameter entities are not read)
    const input: string = '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <twice></twice>\n</root>\n\n';
    expectParses(input);
  });

  test("optional04", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // three children where two are required. (upstream: invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <twice><e/><e/><e/></twice>\n</root>\n\n';
    expectParses(input);
  });

  test("optional05", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or two are required (one construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-a></once-or-twice-a>\n</root>\n\n';
    expectParses(input);
  });

  test("optional06", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or two are required (a second construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-b></once-or-twice-b>\n</root>\n\n\n';
    expectParses(input);
  });

  test("optional07", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or two are required (a third construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-c></once-or-twice-c>\n</root>\n\n\n';
    expectParses(input);
  });

  test("optional08", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or two are required (a fourth construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-d></once-or-twice-d>\n</root>\n\n\n';
    expectParses(input);
  });

  test("optional09", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or two are required (a fifth construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-e></once-or-twice-e>\n</root>\n\n\n';
    expectParses(input);
  });

  test("optional10", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // three children where one or two are required (a basic construction of that model). (upstream:
    // invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-a><e/><e/><e/></once-or-twice-a>\n</root>\n\n\n';
    expectParses(input);
  });

  test("optional11", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // three children where one or two are required (a second construction of that model). (upstream:
    // invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-b><e/><e/><e/></once-or-twice-b>\n</root>\n\n\n\n';
    expectParses(input);
  });

  test("optional12", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // three children where one or two are required (a third construction of that model). (upstream:
    // invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-c><e/><e/><e/></once-or-twice-c>\n</root>\n\n\n\n';
    expectParses(input);
  });

  test("optional13", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // three children where one or two are required (a fourth construction of that model). (upstream:
    // invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-d><e/><e/><e/></once-or-twice-d>\n</root>\n\n\n\n';
    expectParses(input);
  });

  test("optional14", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // three children where one or two are required (a fifth construction of that model). (upstream:
    // invalid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-e><e/><e/><e/></once-or-twice-e>\n</root>\n\n\n\n';
    expectParses(input);
  });

  test("optional20", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or more are required (a sixth construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-a></once-or-twice-a>\n</root>\n';
    expectParses(input);
  });

  test("optional21", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or more are required (a seventh construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-b></once-or-twice-b>\n</root>\n\n';
    expectParses(input);
  });

  test("optional22", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or more are required (an eigth construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-c></once-or-twice-c>\n</root>\n\n';
    expectParses(input);
  });

  test("optional23", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or more are required (a ninth construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-d></once-or-twice-d>\n</root>\n\n';
    expectParses(input);
  });

  test("optional24", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing no
    // children where one or more are required (a tenth construction of that model). (upstream: invalid;
    // external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-e></once-or-twice-e>\n</root>\n\n';
    expectParses(input);
  });

  test("optional25", () => {
    // 3 — Tests the Element Valid VC (clause 2) for one instance of "children" content model, providing
    // text content where one or more elements are required. (upstream: invalid; external parameter
    // entities are not read)
    const input: string =
      '<!DOCTYPE root SYSTEM "../valid/dtdtest.dtd">\n<root>\n    <once-or-twice-e>No text allowed!</once-or-twice-e>\n</root>\n\n';
    expectParses(input);
  });

  test("inv-required00", () => {
    // 3.3.2 — Tests the Required Attribute VC.
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!ATTLIST root\n\treq CDATA #REQUIRED\n\t>\n]>\n\n<root/>\n\n<!-- doesn't include required 'req' attribute -->\n";
    expectParses(input);
  });

  test("inv-required01", () => {
    // 3.1 2.10 — Tests the Attribute Value Type (declared) VC for the xml:space attribute
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n]>\n\n<root xml:space='preserve'/>\n\n    <!-- all attributes must be declared -->\n";
    expectParses(input);
  });

  test("inv-required02", () => {
    // 3.1 2.12 — Tests the Attribute Value Type (declared) VC for the xml:lang attribute
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n]>\n\n<root xml:lang='en'/>\n\n    <!-- all attributes must be declared -->\n\n";
    expectParses(input);
  });

  test("root", () => {
    // 2.8 — Tests the Root Element Type VC (upstream: invalid; external parameter entities are not read)
    const input: string =
      "<?xml version='1.0' standalone='yes'?>\n\n<!DOCTYPE attributes SYSTEM \"../valid/sa.dtd\">\n\n<!-- the name in the dtd must match the element type of the root element -->\n    \n<root/>\n";
    expectParses(input);
  });

  test("attr01", () => {
    // 3.3.1 — Tests the "Entity Name" VC for the ENTITY attribute type.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    affiliated\tENTITY\t#REQUIRED\n    >\n    <!-- tests the "entity name" VC ... the "entity declared" clause,\n\tas applied to attributes of type ENTITY -->\n]>\n<root affiliated="food"/>\n';
    expectParses(input);
  });

  test("attr02", () => {
    // 3.3.1 — Tests the "Entity Name" VC for the ENTITIES attribute type.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    affiliated\tENTITIES\t#REQUIRED\n    >\n    <!-- tests the "entity name" VC ... the "entity declared" clause,\n\tas applied to attributes of type ENTITIES -->\n<!NOTATION fruit\n    PUBLIC "-//International Grocery Consortium//Edible//Healthy//EN">\n<!ENTITY apple SYSTEM "http://www.apple.com" NDATA fruit>\n]>\n<root affiliated="apple apple food"/>\n';
    expectParses(input);
  });

  test("attr03", () => {
    // 3.3.1 — Tests the "Notation Attributes" VC for the NOTATION attribute type, first clause: value must
    // be one of the ones that's declared.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    type\tNOTATION\t(fruit | vegetable)\t#REQUIRED\n    >\n<!NOTATION fruit\n    PUBLIC "-//International Grocery Consortium//Edible//Healthy//EN">\n<!NOTATION vegetable\n    PUBLIC "-//International Grocery Consortium//Edible//Yucky//EN">\n<!NOTATION candy\n    PUBLIC "-//International Grocery Consortium//Edible//Yummy//EN">\n\n    <!-- tests the \'must match one of the names included in the\n\tdeclaration\' part of the "Notation Attributes" VC -->\n]>\n<root type="candy"/>\n\n';
    expectParses(input);
  });

  test("attr04", () => {
    // 3.3.1 — Tests the "Notation Attributes" VC for the NOTATION attribute type, second clause: the names
    // in the declaration must all be declared.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    type\tNOTATION\t(fruit | vegetable)\t#REQUIRED\n    >\n<!NOTATION fruit\n    PUBLIC "-//International Grocery Consortium//Edible//Healthy//EN">\n\n    <!-- tests the \'all notation names in the declaration must\n\tbe declared\' part of the "Notation Attributes" VC -->\n]>\n<root type="fruit"/>\n';
    expectParses(input);
  });

  test("attr05", () => {
    // 3.3.1 — Tests the "Name Token" VC for the NMTOKEN attribute type.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    token\tNMTOKEN\t\t#REQUIRED\n    >\n\n    <!-- tests the "name token\' VC for an NMTOKEN value -->\n]>\n<root token="dev@null"/>\n';
    expectParses(input);
  });

  test("attr06", () => {
    // 3.3.1 — Tests the "Name Token" VC for the NMTOKENS attribute type.
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    token\tNMTOKEN\t\t#REQUIRED\n    >\n\n    <!-- tests the "name token\' VC for an NMTOKENS value -->\n]>\n<root token="now is the time!?"/>\n';
    expectParses(input);
  });

  test("attr07", () => {
    // 3.3.1 — Tests the "Enumeration" VC by providing a value which wasn't one of the choices.
    const input: string =
      '<!DOCTYPE arbor [\n<!ELEMENT arbor EMPTY>\n<!ATTLIST arbor\n    type\t(fruit | vegetable)\t"fruit"\n    >\n    <!-- tests the \'must match one of the nmtokens included in the\n\tdeclaration\' part of the "Enumeration" VC -->\n]>\n<arbor type="money"/>\n\n';
    expectParses(input);
  });

  test("attr08", () => {
    // 3.3.2 — Tests the "Fixed Attribute Default" VC by providing the wrong value.
    const input: string =
      '<!DOCTYPE palimpest [\n<!ELEMENT palimpest EMPTY>\n<!ATTLIST palimpest\n    xmlns CDATA #FIXED "http://java.sun.com/historical"\n    >\n    <!-- tests the "fixed attribute default" vc -->\n]>\n\n<palimpest xmlns="http://over.the.rainbow.com/somewhere"/>\n';
    expectParses(input);
  });

  test("attr09", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal IDREF value.
    const input: string =
      '<!DOCTYPE collection [\n\n<!ELEMENT collection ANY>\n\n<!ELEMENT identifier EMPTY>\n<!ATTLIST identifier\n    value\tIDREF\t"42"\n    >\n    <!-- tests the "attribute default legal" vc -->\n\n<!ELEMENT identified EMPTY>\n<!ATTLIST identified\n    id\t\tID\t#REQUIRED\n    >\n]>\n\n<collection>\n    <identifier name="i-am-not-a-number"/>\n    <identified id="i-am-not-a-number"/>\n</collection>\n';
    expectParses(input);
  });

  test("attr10", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal IDREFS value.
    const input: string =
      '<!DOCTYPE collection [\n\n<!ELEMENT collection ANY>\n\n<!ELEMENT identifier EMPTY>\n<!ATTLIST identifier\n    value\tIDREFS\t"i-am-not-a-number 42"\n    >\n    <!-- tests the "attribute default legal" vc -->\n\n<!ELEMENT identified EMPTY>\n<!ATTLIST identified\n    id\t\tID\t#REQUIRED\n    >\n]>\n\n<collection>\n    <identifier name="i-am-not-a-number"/>\n    <identified id="i-am-not-a-number"/>\n</collection>\n';
    expectParses(input);
  });

  test("attr11", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal ENTITY value.
    const input: string =
      '<!DOCTYPE reference [\r\n\r\n<!ELEMENT reference EMPTY>\r\n<!ATTLIST reference\r\n    value\tENTITY\t"2orldbook"\r\n    >\r\n    <!-- tests the "attribute default legal" vc -->\r\n\r\n<!NOTATION encyclopaedia PUBLIC "-//fooCorp Inc//NOTATION something//EN">\r\n<!ENTITY brittannica SYSTEM "http://www.eb.com/" NDATA encyclopaedia>\r\n<!ENTITY worldbook SYSTEM "http://www.worldbook.com">\r\n\r\n]>\r\n\r\n<reference value="brittannica"/>\r\n';
    expectParses(input);
  });

  test("attr12", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal ENTITIES value.
    const input: string =
      '<!DOCTYPE references [\r\n\r\n<!ELEMENT references EMPTY>\r\n<!ATTLIST references\r\n    value\tENTITIES\t"brittannica 2orldbook"\r\n    >\r\n    <!-- tests the "attribute default legal" vc -->\r\n\r\n<!NOTATION encyclopaedia PUBLIC "-//fooCorp Inc//NOTATION something//EN">\r\n<!ENTITY brittannica SYSTEM "http://www.eb.com/" NDATA encyclopaedia>\r\n<!ENTITY worldbook SYSTEM "http://www.worldbook.com">\r\n\r\n]>\r\n\r\n<references value="brittannica"/>\r\n';
    expectParses(input);
  });

  test("attr13", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal NMTOKEN value.
    const input: string =
      '<!DOCTYPE root [\n\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    value\tNMTOKEN\t"alpha/beta"\n    >\n    <!-- tests the "attribute default legal" vc -->\n]>\n\n<root value="brittannica"/>\n\n';
    expectParses(input);
  });

  test("attr14", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal NMTOKENS value.
    const input: string =
      '<!DOCTYPE root [\n\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    value\tNMTOKENS\t"alpha beta $gamma"\n    >\n    <!-- tests the "attribute default legal" vc -->\n]>\n\n<root value="zeta eta iota"/>\n\n\n';
    expectParses(input);
  });

  test("attr15", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal NOTATIONS value.
    const input: string =
      '<!DOCTYPE reference [\n\n<!ELEMENT reference EMPTY>\n<!ATTLIST reference\n    source\tNOTATION\t(brittannica | worldbook) "encarta"\n    >\n    <!-- tests the "attribute default legal" vc -->\n\n<!NOTATION brittannica SYSTEM "http://www.eb.com/">\n<!NOTATION worldbook SYSTEM "http://www.worldbook.com">\n\n]>\n\n<reference source="brittannica"/>\n';
    expectParses(input);
  });

  test("attr16", () => {
    // 3.3.2 — Tests the "Attribute Default Legal" VC by providing an illegal enumeration value.
    const input: string =
      '<!DOCTYPE root [\n\n<!ELEMENT root EMPTY>\n<!ATTLIST root\n    value\t(brittannica | worldbook) "encarta"\n    >\n    <!-- tests the "attribute default legal" vc -->\n]>\n\n<root value="brittannica"/>\n';
    expectParses(input);
  });

  test("utf16b", () => {
    // 4.3.3 2.8 — Tests reading an invalid "big endian" UTF-16 document
    const input = Buffer.from(
      "/v8APAA/AHgAbQBsACAAdgBlAHIAcwBpAG8AbgA9ACcAMQAuADAAJwAgAGUAbgBjAG8AZABpAG4AZwA9ACcAVQBUAEYALQAxADYAJwA/AD4ACgA8AHIAbwBvAHQALwA+AAo=",
      "base64",
    );
    expectParses(input);
  });

  test("utf16l", () => {
    // 4.3.3 2.8 — Tests reading an invalid "little endian" UTF-16 document
    const input = Buffer.from(
      "//48AD8AeABtAGwAIAB2AGUAcgBzAGkAbwBuAD0AJwAxAC4AMAAnACAAZQBuAGMAbwBkAGkAbgBnAD0AJwBVAFQARgAtADEANgAnAD8APgAKADwAcgBvAG8AdAAvAD4ACgA=",
      "base64",
    );
    expectParses(input);
  });

  test("empty", () => {
    // 2.4 2.7 [18] 3 — CDATA section containing only white space does not match the nonterminal S, and
    // cannot appear in these positions.
    const input: string =
      "<!--\r\n    From: \"Henry S. Thompson\" <ht@cogsci.ed.ac.uk>\r\n\r\n    I'd be interested in reports from validating parsers wrt the\r\n    following:\r\n-->\r\n\r\n<!DOCTYPE foo [\r\n<!ELEMENT foo (a+)>\r\n<!ENTITY empty ''>\r\n<!ENTITY space ' '>\r\n<!ELEMENT a EMPTY>]>\r\n<foo>\r\n&empty;\r\n<a/>\r\n&space;\r\n<a/>\r\n<![CDATA[]]>\r\n<a/>\r\n<![CDATA[ ]]>\r\n<a/>\r\n</foo>\r\n";
    expectParses(input);
  });

  test("not-wf-sa03", () => {
    // 2.9 — Tests the Entity Declared WFC, ensuring that a reference to externally defined entity causes a
    // well-formedness error. (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<?xml version=\'1.0\' standalone=\'yes\'?>\n\n<!DOCTYPE attributes SYSTEM "../valid/sa.dtd" [\n    <!--\n\tExternal entity ref\n    -->\n]>\n\n<attributes\n    token =\t"b"\n    id =\t"external-&number;"\n    />\n';
    expectRejects(input, "XML Parse error: Entity 'number' is not declared");
  });

  test("attlist01", () => {
    // 3.3.1 [56] — SGML's NUTOKEN is not allowed.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute types -->\n\n    <!ATTLIST root\n\tnumber\tNUTOKEN\t"1"\n\t>\n\n]>\n\n<root/>\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NUTOKEN'",
    );
  });

  test("attlist02", () => {
    // 3.3.1 [56] — SGML's NUTOKENS attribute type is not allowed.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute types -->\n\n    <!ATTLIST root\n\tnumber\tNUTOKENS\t"1 2 3"\n\t>\n\n]>\n\n<root/>\n\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NUTOKENS'",
    );
  });

  test("attlist03", () => {
    // 3.3.1 [59] — Comma doesn't separate enumerations, unlike in SGML.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute types -->\n\n    <!ATTLIST root\n\tchoice\t(a,b,c)\t"a"\n\t>\n\n]>\n\n<root/>\n\n';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found ','");
  });

  test("attlist04", () => {
    // 3.3.1 [56] — SGML's NUMBER attribute type is not allowed.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute types -->\n\n    <!ATTLIST root\n\tnumber\tNUMBER\t"1"\n\t>\n\n]>\n\n<root/>\n\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NUMBER'",
    );
  });

  test("attlist05", () => {
    // 3.3.1 [56] — SGML's NUMBERS attribute type is not allowed.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute types -->\n\n    <!ATTLIST root\n\tnumbers\tNUMBERS\t"1 2 3 4"\n\t>\n\n]>\n\n<root/>\n\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NUMBERS'",
    );
  });

  test("attlist06", () => {
    // 3.3.1 [56] — SGML's NAME attribute type is not allowed.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute types -->\n\n    <!ATTLIST root\n\tnumber\tNAME\t"Elvis"\n\t>\n\n]>\n\n<root/>\n\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NAME'",
    );
  });

  test("attlist07", () => {
    // 3.3.1 [56] — SGML's NAMES attribute type is not allowed.
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute types -->\n\n    <!ATTLIST root\n\tnumber\tNAMES\t"The King"\n\t>\n\n]>\n\n<root/>\n\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NAMES'",
    );
  });

  test("attlist08", () => {
    // 3.3.1 [56] — SGML's #CURRENT is not allowed.
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  illegal attribute default -->\n\n    <!ATTLIST root\n\tlanguage\tCDATA\t#CURRENT\n\t>\n\n]>\n\n<root/>\n";
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '#CURRENT'",
    );
  });

  test("attlist09", () => {
    // 3.3.1 [56] — SGML's #CONREF is not allowed.
    const input: string =
      '<!DOCTYPE root [\n    <!-- SGML-ism:  illegal attribute default -->\n\n    <!ATTLIST root\n\tlanguage\tCDATA\t#CONREF\n\t>\n\n]>\n\n<root language="Dutch"/>\n\n';
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '#CONREF'",
    );
  });

  test("attlist10", () => {
    // 3.1 [40] — Whitespace required between attributes
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ATTLIST root att1 CDATA #IMPLIED>\n<!ATTLIST root att2 CDATA #IMPLIED>\n]>\n<root att1="value1"att2="value2">\n    <!-- whitespace required between attributes -->\n</root>\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'att2'");
  });

  test("attlist11", () => {
    // 3.1 [44] — Whitespace required between attributes
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ATTLIST root att1 CDATA #IMPLIED>\n<!ATTLIST root att2 CDATA #IMPLIED>\n]>\n<root att1="value1"att2="value2"/>\n    <!-- whitespace required between attributes -->\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'att2'");
  });

  test("cond01", () => {
    // 3.4 [61] — Only INCLUDE and IGNORE are conditional section keywords (upstream: not-wf; external
    // parameter entities are not read)
    const input: string = '<!DOCTYPE root SYSTEM "cond.dtd" [\n    <!ENTITY % MAYBE "CDATA">\n]>\n\n<root/>\n';
    expectParses(input);
  });

  test("cond02", () => {
    // 3.4 [61] — Must have keyword in conditional sections (upstream: not-wf; external parameter entities
    // are not read)
    const input: string = '<!DOCTYPE root SYSTEM "cond.dtd" [\n    <!ENTITY % MAYBE "">\n]>\n\n<root/>\n\n';
    expectParses(input);
  });

  test("content01", () => {
    // 3.2.1 [48] — No whitespace before "?" in content model
    const input: string =
      "<!DOCTYPE root [\n    <!-- no whitespace before '?', '*', '+' -->\n    <!ELEMENT root ((root) ?)>\n]>\n<root/>\n";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("content02", () => {
    // 3.2.1 [48] — No whitespace before "*" in content model
    const input: string =
      "<!DOCTYPE root [\n    <!-- no whitespace before '?', '*', '+' -->\n    <!ELEMENT root ((root) *)>\n]>\n<root/>\n\n";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("content03", () => {
    // 3.2.1 [48] — No whitespace before "+" in content model
    const input: string =
      "<!DOCTYPE root [\n    <!-- no whitespace before '?', '*', '+' -->\n    <!ELEMENT root (root +)>\n]>\n<root/>\n\n";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("decl01", () => {
    // 4.3.1 [77] — External entities may not have standalone decls. (upstream: not-wf; external parameter
    // entities are not read)
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!ENTITY % ent01 SYSTEM "decl01.ent">\n\n    <!-- the entity is an illegal PE -->\n    %ent01;\n]>\n<root/>\n';
    expectParses(input);
  });

  test("nwf-dtd00", () => {
    // 3.2.1 [55] — Comma mandatory in content model
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root (foo, bar? foo)>\n\t<!-- comma omitted -->\n    <!ELEMENT foo EMPTY>\n    <!ELEMENT bar EMPTY>\n]>\n\n<root> <foo/> <foo/> </root>\n";
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found 'foo'");
  });

  test("nwf-dtd01", () => {
    // 3.2.1 [55] — Can't mix comma and vertical bar in content models
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root (foo, bar? | foo)>\n\t<!-- comma swapped for vertical bar -->\n    <!ELEMENT foo EMPTY>\n    <!ELEMENT bar EMPTY>\n]>\n\n<root> <foo/> <foo/> </root>\n";
    expectRejects(input, "XML Parse error: A content model group cannot mix ',' and '|'");
  });

  test("dtd02", () => {
    // 4.1 [69] — PE name immediately after "%"
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!-- correct PE ref syntax -->\n    <!ENTITY % foo "<!ATTLIST root>">\n    % foo;\n]>\n\n<root/>\n';
    expectRejects(input, "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '%'");
  });

  test("dtd03", () => {
    // 4.1 [69] — PE name immediately followed by ";"
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!-- correct PE ref syntax -->\n    <!ENTITY % foo "<!ATTLIST root>">\n    %foo\n    ;\n]>\n\n<root/>\n';
    expectRejects(input, "XML Parse error: Expected ';' to end the parameter entity reference 'foo'");
  });

  test("dtd04", () => {
    // 4.2.2 [75] — PUBLIC literal must be quoted
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!-- PUBLIC id must be quoted -->\n    <!ENTITY foo PUBLIC -//BadCorp//DTD-foo-1.0//EN "elvis.ent">\n]>\n\n<root/>\n';
    expectRejects(input, "XML Parse error: Expected a quoted public identifier after PUBLIC but found '-'");
  });

  test("dtd05", () => {
    // 4.2.2 [75] — SYSTEM identifier must be quoted
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n    <!-- SYSTEM id must be quoted -->\n    <!ENTITY foo SYSTEM elvis.ent>\n]>\n\n<root/>\n";
    expectRejects(input, "XML Parse error: Expected a quoted system identifier after SYSTEM but found 'elvis.ent'");
  });

  test("dtd07", () => {
    // 4.3.1 [77] — Text declarations (which optionally begin any external entity) are required to have
    // "encoding=...". (upstream: not-wf; external parameter entities are not read)
    const input: string = '<!DOCTYPE root SYSTEM "dtd07.dtd" [\n    <!ELEMENT root EMPTY>\n]>\n<root/>\n';
    expectParses(input);
  });

  test("element00", () => {
    // 3.1 [42] — EOF in middle of incomplete ETAG
    const input: string = "<root>\n    Incomplete end tag.\n</ro";
    expectRejects(input, "XML Parse error: Expected closing tag </root> but found </ro>");
  });

  test("element01", () => {
    // 3.1 [42] — EOF in middle of incomplete ETAG
    const input: string = "<root>\n    Incomplete end tag.\n</root";
    expectRejects(input, "XML Parse error: Expected '>' to end the closing tag but found end of input");
  });

  test("element02", () => {
    // 3.1 [43] — Illegal markup (<%@ ... %>)
    const input: string = '<!DOCTYPE html [ <!ELEMENT html ANY> ]>\n<html>\n    <% @ LANGUAGE="VBSCRIPT" %>\n</html>\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '%'");
  });

  test("element03", () => {
    // 3.1 [43] — Illegal markup (<% ... %>)
    const input: string =
      '<!DOCTYPE html [ <!ELEMENT html ANY> ]>\n<html>\n    <% document.println ("hello, world"); %>\n</html>\n\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '%'");
  });

  test("element04", () => {
    // 3.1 [43] — Illegal markup (<!ELEMENT ... >)
    const input: string = "<!DOCTYPE root [ <!ELEMENT root ANY> ]>\n<root>\n    <!ELEMENT foo EMPTY>\n</root>\n";
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("encoding01", () => {
    // 4.3.3 [81] — Illegal character " " in encoding name
    const input = Buffer.from('<?xml version="1.0" encoding=" utf-8"?>\n<root/>\n');
    expectRejects(input, "XML Parse error: Invalid encoding name ' utf-8' in the XML declaration");
  });

  test("encoding02", () => {
    // 4.3.3 [81] — Illegal character "/" in encoding name
    const input = Buffer.from('<?xml version="1.0" encoding="a/b"?>\n<root/>\n\n');
    expectRejects(input, "XML Parse error: Invalid encoding name 'a/b' in the XML declaration");
  });

  test("encoding03", () => {
    // 4.3.3 [81] — Illegal character reference in encoding name
    const input = Buffer.from('<?xml version="1.0" encoding="just&#41;word"?>\n<root/>\n\n');
    expectRejects(input, "XML Parse error: Invalid encoding name 'just&#41;word' in the XML declaration");
  });

  test("encoding04", () => {
    // 4.3.3 [81] — Illegal character ":" in encoding name
    const input = Buffer.from('<?xml version="1.0" encoding="utf:8"?>\n<root/>\n\n');
    expectRejects(input, "XML Parse error: Invalid encoding name 'utf:8' in the XML declaration");
  });

  test("encoding05", () => {
    // 4.3.3 [81] — Illegal character "@" in encoding name
    const input = Buffer.from('<?xml version="1.0" encoding="@import(sys-encoding)"?>\n<root/>\n\n');
    expectRejects(input, "XML Parse error: Invalid encoding name '@import(sys-encoding)' in the XML declaration");
  });

  test("encoding06", () => {
    // 4.3.3 [81] — Illegal character "+" in encoding name
    const input = Buffer.from(
      '<?xml version="1.0" encoding="XYZ+999"?>\n\n<!-- WF ... but illegal encoding name, also a fatal error --> \n\n<root/>\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name 'XYZ+999' in the XML declaration");
  });

  test("encoding07", () => {
    // 4.3.1 [77] — Text declarations (which optionally begin any external entity) are required to have
    // "encoding=...". (upstream: not-wf; external general entities are not read)
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!--\n\treusing this entity; it\'s got no markup decls,\n\tso it\'s legal except for a missing "encoding=...".\n    -->\n    <!ENTITY empty SYSTEM "dtd07.dtd">\n]>\n<root>&empty;</root>\n';
    expectParses(input);
  });

  test("pi", () => {
    // 2.6 [16] — No space between PI target name and data
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!-- space before PI data and ?> -->\n<?bad-pi+?>\n]>\n<root/>\n";
    expectRejects(
      input,
      "XML Parse error: Expected whitespace or '?>' after the processing instruction target but found '+'",
    );
  });

  test("pubid01", () => {
    // 2.3 [12] — Illegal entity ref in public ID
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- illegal public ID characters -->\n\n    <!ENTITY e PUBLIC "this isn&apos;t allowed" "ignored">\n]>\n\n<root/>\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '&'");
  });

  test("pubid02", () => {
    // 2.3 [12] — Illegal characters in public ID
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- illegal public ID characters -->\n\n    <!ENTITY e PUBLIC "<illegal>" "ignored">\n]>\n\n<root/>\n\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '<'");
  });

  test("pubid03", () => {
    // 2.3 [12] — Illegal characters in public ID
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- illegal public ID characters -->\n\n    <!ENTITY e PUBLIC "[illegal]" "ignored">\n]>\n\n<root/>\n\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '['");
  });

  test("pubid04", () => {
    // 2.3 [12] — Illegal characters in public ID
    const input: string =
      '<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- illegal public ID characters -->\n\n    <!ENTITY e PUBLIC "{ illegal }" "ignored">\n]>\n\n<root/>\n\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '{'");
  });

  test("pubid05", () => {
    // 2.3 [12] — SGML-ism: public ID without system ID
    const input: string =
      '<!DOCTYPE root [\n\n    <!-- SGML-ism: publid ID without system ID -->\n\n    <!ENTITY e PUBLIC "this is not allowed">\n]>\n\n<root/>\n';
    expectRejects(
      input,
      "XML Parse error: Expected a quoted system identifier after the public identifier but found '>'",
    );
  });

  test("sgml01", () => {
    // 3 [39] — SGML-ism: omitted end tag for EMPTY content
    const input: string =
      "<!DOCTYPE root [\n    <!ELEMENT root EMPTY>\n\n    <!-- SGML-ism:  omitted end tag -->\n]>\n\n<root>\n";
    expectRejects(input, "XML Parse error: Missing closing tag for element 'root'");
  });

  test("sgml02", () => {
    // 2.8  — XML declaration must be at the very beginning of a document; it"s not a processing
    // instruction
    const input: string =
      ' <?xml version="1.0"?>\n    <!-- SGML-ism:  XML PI not at beginning -->\n<!DOCTYPE root [ <!ELEMENT root EMPTY> ]>\n<root/>\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("sgml03", () => {
    // 2.5 [15] — Comments may not contain "--"
    const input: string =
      "<!DOCTYPE root [ <!ELEMENT root EMPTY> ]>\n\n    <!-- SGML-ism:  -- inside comment -->\n<root/>\n";
    expectRejects(input, "XML Parse error: '--' is not allowed inside a comment");
  });

  test("sgml04", () => {
    // 3.3 [52] — ATTLIST declarations apply to only one element, unlike SGML
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  multiple attlist types -->\n\n    <!ELEMENT root EMPTY>\n    <!ELEMENT branch EMPTY>\n\n    <!ATTLIST (root|branch)\n\tTreeType CDATA #REQUIRED\n\t>\n]>\n\n<root/>\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ATTLIST' but found '('");
  });

  test("sgml05", () => {
    // 3.2 [45] — ELEMENT declarations apply to only one element, unlike SGML
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  multiple element types -->\n\n    <!ELEMENT root EMPTY>\n    <!ELEMENT leaves EMPTY>\n    <!ELEMENT branch EMPTY>\n\n    <!ELEMENT (bush|tree) (root,leaves,branch)>\n]>\n\n<root/>\n\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '('");
  });

  test("sgml06", () => {
    // 3.3 [52] — ATTLIST declarations are never global, unlike in SGML
    const input: string =
      "<!DOCTYPE root [\n    <!-- Web-SGML-ism:  global attlist types -->\n\n    <!ELEMENT root EMPTY>\n\n    <!ATTLIST #ALL\n\tTreeType CDATA #REQUIRED\n\t>\n]>\n\n<root/>\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ATTLIST' but found '#ALL'");
  });

  test("sgml07", () => {
    // 3.2 [45] — SGML Tag minimization specifications are not allowed
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  omitted tag minimzation spec -->\n    <!ELEMENT root - o EMPTY>\n]>\n\n<root/>\n";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '-'");
  });

  test("sgml08", () => {
    // 3.2 [45] — SGML Tag minimization specifications are not allowed
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  omitted tag minimzation spec -->\n    <!ELEMENT root - - EMPTY>\n]>\n\n<root/>\n\n";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '-'");
  });

  test("sgml09", () => {
    // 3.2 [45] — SGML Content model exception specifications are not allowed
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  exception spec -->\n\n    <!ELEMENT footnote (para*) -footnote>\n]>\n\n<root/>\n\n";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '-footnote'");
  });

  test("sgml10", () => {
    // 3.2 [45] — SGML Content model exception specifications are not allowed
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  exception spec -->\n    <!ELEMENT section (header,(para|section))* +(annotation|todo)>\n]>\n\n<root/>\n\n";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '+'");
  });

  test("sgml11", () => {
    // 3.2 [46] — CDATA is not a valid content model spec
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  CDATA content type -->\n    <!ELEMENT ROOT CDATA>\n]>\n\n<root/>\n\n";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'CDATA'");
  });

  test("sgml12", () => {
    // 3.2 [46] — RCDATA is not a valid content model spec
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  RCDATA content type -->\n    <!ELEMENT ROOT RCDATA>\n]>\n\n<root/>\n\n\n";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'RCDATA'");
  });

  test("sgml13", () => {
    // 3.2.1 [47] — SGML Unordered content models not allowed
    const input: string =
      "<!DOCTYPE root [\n    <!-- SGML-ism:  unordered content type -->\n    <!ELEMENT ROOT (a & b & c)>\n    <!ELEMENT a EMPTY>\n    <!ELEMENT b EMPTY>\n    <!ELEMENT c EMPTY>\n]>\n\n<root><b/><c/><a/></root>\n\n\n";
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found '&'");
  });

  test("uri01", () => {
    // 4.2.2 [75] — SYSTEM ids may not have URI fragments (upstream: optional error)
    const input: string =
      '<!DOCTYPE root [\n<!ELEMENT root EMPTY>\n<!-- URI fragments disallowed -->\n<!ENTITY foo SYSTEM "foo#bar">\n]>\n<root/>\n';
    expectParses(input);
  });
});

describe("oasis", () => {
  test("o-p01pass2", () => {
    // 2.2 [1] — various Misc items where they can occur
    const input: string =
      "<?PI before document element?>\r\n<!-- comment after document element-->\r\n<?PI before document element?>\r\n<!-- comment after document element-->\r\n<?PI before document element?>\r\n<!-- comment after document element-->\r\n<?PI before document element?>\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!ELEMENT c ANY>\r\n]>\r\n<doc>\r\n<a><b><c/></b></a>\r\n</doc>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n";
    expectParses(input);
  });

  test("o-p06pass1", () => {
    // 2.3 [6] — various satisfactions of the Names production in a NAMES attribute
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|refs)*>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT refs EMPTY>\r\n<!ATTLIST refs refs IDREFS #REQUIRED>\r\n<!ATTLIST a id ID #REQUIRED>\r\n]>\r\n<doc>\r\n<a id="A1"/><a id="A2"/><a id="A3"/>\r\n<refs refs="A1 A2 A3"/>\r\n<refs refs="A1\r\nA2\tA3"/>\r\n<refs refs="A1"/>\r\n</doc>';
    expectParses(input);
  });

  test("o-p07pass1", () => {
    // 2.3 [7] — various valid Nmtoken 's in an attribute list declaration.
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att (0|35a|A|-a|:a|a:|.|_a) #IMPLIED>\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p08pass1", () => {
    // 2.3 [8] — various satisfaction of an NMTOKENS attribute value.
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (A*)>\r\n<!ELEMENT A EMPTY>\r\n<!ATTLIST A att NMTOKENS #IMPLIED>\r\n]>\r\n<doc>\r\n<A att="abc"/><A att="abc def . :"/><A att="\r\nabc\r\ndef\r\n"/>\r\n</doc>';
    expectParses(input);
  });

  test("o-p09pass1", () => {
    // 2.3 [9] — valid EntityValue's. Except for entity references, markup is not recognized. (upstream:
    // valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p09pass1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p12pass1", () => {
    // 2.3 [12] — valid public IDs.
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 PUBLIC "a b\r\ncdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ">\r\n<!NOTATION not2 PUBLIC \'0123456789-()+,./:=?;!*#@$_%\'>\r\n<!NOTATION not3 PUBLIC "0123456789-()+,.\'/:=?;!*#@$_%">\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p22pass4", () => {
    // 2.8 [22] — XML decl and doctypedecl
    const input: string =
      '<?xml version="1.0"?>\r\n<!--comment--> <?pi?>\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n\r\n<!--comment--> <?pi?>\r\n\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p22pass5", () => {
    // 2.8 [22] — just doctypedecl
    const input: string =
      "<!--comment--> <?pi?>\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n\r\n<!--comment--> <?pi?>\r\n\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p22pass6", () => {
    // 2.8 [22] — S between decls is not required
    const input: string = '<?xml version="1.0"?><!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n]><doc/>\r\n';
    expectParses(input);
  });

  test("o-p28pass1", () => {
    // 3.1 [43] [44] — Empty-element tag must be used for element which are declared EMPTY.
    const input: string = "<!DOCTYPE \r\n\r\ndoc\r\n\r\n[\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p28pass3", () => {
    // 2.8 4.1 [28] [69] — Valid doctypedecl with Parameter entity reference. The declaration of a
    // parameter entity must precede any reference to it. (upstream: valid; external parameter entities are
    // not read)
    const input: string =
      '<!DOCTYPE doc [\r\n<!ENTITY % eldecl "<!ELEMENT doc EMPTY>">\r\n%eldecl;\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p28pass4", () => {
    // 2.8 4.2.2 [28] [75] — Valid doctypedecl with ExternalID as an External Entity declaration.
    // (upstream: valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p28pass4.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p28pass5", () => {
    // 2.8 4.1 [28] [69] — Valid doctypedecl with ExternalID as an External Entity. A parameter entity
    // reference is also used. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE doc SYSTEM "p28pass5.dtd"[\r\n<!--comment-->\r\n<!ENTITY % rootdecl "<!ELEMENT doc (a)>">\r\n<!ELEMENT a EMPTY>\r\n]>\r\n<doc><a/></doc>\r\n';
    expectParses(input);
  });

  test("o-p29pass1", () => {
    // 2.8 [29] — Valid types of markupdecl.
    const input: string =
      '<!DOCTYPE doc [\r\n<?Pi?><!--comment-->\r\n<!ELEMENT doc EMPTY>\r\n<?Pi?><!--comment-->\r\n<!ATTLIST doc att CDATA #IMPLIED>\r\n<?Pi?><!--comment-->\r\n<!ENTITY % ent "">\r\n<?Pi?><!--comment-->\r\n<!NOTATION not PUBLIC "some notation">\r\n<?Pi?><!--comment-->\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p30pass1", () => {
    // 2.8 4.2.2 [30] [75] — Valid doctypedecl with ExternalID as an External Entity. The external entity
    // has an element declaration. (upstream: valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p30pass1.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p30pass2", () => {
    // 2.8 4.2.2 4.3.1 [30] [75] [77] — Valid doctypedecl with ExternalID as an Enternal Entity. The
    // external entity begins with a Text Declaration. (upstream: valid; external parameter entities are
    // not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p30pass2.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p31pass1", () => {
    // 2.8 [31] — external subset can be empty (upstream: valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p31pass1.dtd" [<!ELEMENT doc EMPTY>]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p31pass2", () => {
    // 2.8 3.4 4.2.2 [31] [62] [63] [75] — Valid doctypedecl with EXternalID as Enternal Entity. The
    // external entity contains a parameter entity reference and condtional sections. (upstream: valid;
    // external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p31pass2.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p43pass1", () => {
    // 2.4 2.5 2.6 2.7 [15] [16] [18] — Valid use of character data, comments, processing instructions and
    // CDATA sections within the start and end tag.
    const input: string =
      '<!DOCTYPE elem\r\n[\r\n<!ELEMENT elem (#PCDATA|elem)*>\r\n<!ENTITY ent "<elem>CharData</elem>">\r\n]>\r\n<elem>\r\nCharData&#32;\r\n<!--comment-->\r\n<![CDATA[\r\n<elem>\r\nCharData&#32;\r\n<!--comment-->\r\n<?pi?>&ent;&quot;\r\nCharData\r\n</elem>\r\n]]>\r\n<![CDATA[\r\n<elem>\r\nCharData&#32;\r\n<!--comment-->\r\n<?pi?>&ent;&quot;\r\nCharData\r\n</elem>\r\n]]>\r\n<?pi?>&ent;&quot;\r\nCharData\r\n</elem>\r\n';
    expectParses(input);
  });

  test("o-p45pass1", () => {
    // 3.2 [45] — valid element declarations
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT\r\na ANY\r\n>\r\n<!ELEMENT c (#PCDATA)>\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p46pass1", () => {
    // 3.2 3.2.1 3.2.2 [45] [46] [47] [51] — Valid use of contentspec, element content models, and mixed
    // content within an element type declaration.
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT b (#PCDATA)*>\r\n<!ELEMENT c (a,b)>\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p47pass1", () => {
    // 3.2 3.2.1 [45] [46] [47]  — Valid use of contentspec, element content models, choices, sequences and
    // content particles within an element type declaration. The optional character following a name or
    // list governs the number of times the element or content particle may appear.
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc,a?)>\r\n<!ELEMENT b (doc|a)>\r\n<!ELEMENT c (a,b)?>\r\n<!ELEMENT d (a|b)? >\r\n<!ELEMENT e (a,b)* >\r\n<!ELEMENT f (a,b)+ >\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p48pass1", () => {
    // 3.2 3.2.1 [45] [46] [47] — Valid use of contentspec, element content models, choices, sequences and
    // content particles within an element type declaration. The optional character following a name or
    // list governs the number of times the element or content particle may appear.
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc)>\r\n<!ELEMENT b ((doc|a?))>\r\n<!ELEMENT c ((a,b))>\r\n<!ELEMENT d (doc*)>\r\n<!ELEMENT e (doc+)>\r\n<!ELEMENT f (doc?)>\r\n<!ELEMENT g ((a,b)*)>\r\n<!ELEMENT h ((a,b)?)>\r\n<!ELEMENT i ((a,b)+)>\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p49pass1", () => {
    // 3.2 3.2.1 [45] [46] [47] — Valid use of contentspec, element content models, choices, and content
    // particles within an element type declaration. The optional character following a name or list
    // governs the number of times the element or content particle may appear. Whitespace is also valid
    // between choices.
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!--NOTE: XML doesn't specify whether this is a choice or a seq-->\r\n<!ELEMENT a (doc?)>\r\n<!ELEMENT b (doc|a)>\r\n<!ELEMENT c (\r\ndoc\r\n|\r\na\r\n|\r\nc?\r\n)>\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p50pass1", () => {
    // 3.2 3.2.1 [45] [46] [47] — Valid use of contentspec, element content models, sequences and content
    // particles within an element type declaration. The optional character following a name or list
    // governs the number of times the element or content particle may appear. Whitespace is also valid
    // between sequences.
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!--NOTE: XML doesn't specify whether this is a choice or a seq-->\r\n<!ELEMENT a (doc?)>\r\n<!ELEMENT b (doc,a)>\r\n<!ELEMENT c (\r\ndoc\r\n,\r\na\r\n,\r\nc?\r\n)>\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p51pass1", () => {
    // 3.2.2 [51] — valid Mixed contentspec's.
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ELEMENT a (#PCDATA|doc)*>\r\n<!ELEMENT b (\r\n#PCDATA\r\n|\r\ndoc\r\n|\r\na\r\n|\r\nb\r\n)*>\r\n<!ELEMENT c (#PCDATA)*>\r\n]>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p52pass1", () => {
    // 3.3 [52] — valid AttlistDecls: No AttDef's are required, and the terminating S is optional, multiple
    // ATTLISTS per element are OK, and multiple declarations of the same attribute are OK.
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA|a|b|c|d)*>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT b EMPTY>\r\n<!ELEMENT c EMPTY>\r\n<!ELEMENT d EMPTY>\r\n<!ATTLIST a>\r\n<!ATTLIST b >\r\n<!ATTLIST c att CDATA #IMPLIED>\r\n<!ATTLIST d att CDATA #IMPLIED>\r\n<!ATTLIST\r\nc att CDATA\r\n #IMPLIED\r\natt2\r\n CDATA\r\n "second declaration is OK"\r\natt2 CDATA\r\n #REQUIRED\r\n >\r\n<!ATTLIST d>\r\n]>\r\n<doc><c/><c att2="test"/></doc>';
    expectParses(input);
  });

  test("o-p53pass1", () => {
    // 3.3 [53] — a valid AttDef
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p54pass1", () => {
    // 3.3.1 [54] — the three kinds of attribute types
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|b|c)*>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT b EMPTY>\r\n<!ELEMENT c EMPTY>\r\n<!ATTLIST a att CDATA #IMPLIED>\r\n<!ATTLIST b att NMTOKENS #IMPLIED>\r\n<!ATTLIST c att (a|b) #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p55pass1", () => {
    // 3.3.1 [55] — StringType = "CDATA"
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p56pass1", () => {
    // 3.3.1 [56] — the 7 tokenized attribute types
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|b|c|d|e|f|g)*>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT b EMPTY>\r\n<!ELEMENT c EMPTY>\r\n<!ELEMENT d EMPTY>\r\n<!ELEMENT e EMPTY>\r\n<!ELEMENT f EMPTY>\r\n<!ELEMENT g EMPTY>\r\n<!ATTLIST a att ID #IMPLIED>\r\n<!ATTLIST b att IDREF #IMPLIED>\r\n<!ATTLIST c att IDREFS #IMPLIED>\r\n<!ATTLIST d att ENTITY #IMPLIED>\r\n<!ATTLIST e att ENTITIES #IMPLIED>\r\n<!ATTLIST f att NMTOKEN #IMPLIED>\r\n<!ATTLIST g att NMTOKENS #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p57pass1", () => {
    // 3.3.1 [57] — enumerated types are NMTOKEN or NOTATION lists
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|b)*>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!NOTATION a SYSTEM "a">\r\n<!ATTLIST a att (a|b) #IMPLIED>\r\n<!ATTLIST b att NOTATION (a|b) #IMPLIED>\r\n<!NOTATION b SYSTEM "b">\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p58pass1", () => {
    // 3.3.1 [58] — NOTATION enumeration has on or more items
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|b)*>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!NOTATION a SYSTEM "a">\r\n<!NOTATION b SYSTEM "b">\r\n<!ATTLIST a att NOTATION (a) #IMPLIED>\r\n<!ATTLIST b att NOTATION ( a | b ) #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p59pass1", () => {
    // 3.3.1 [59] — NMTOKEN enumerations haveon or more items
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|b)*>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT b EMPTY>\r\n<!ATTLIST a att (a) #IMPLIED>\r\n<!ATTLIST b att ( a | b ) #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p60pass1", () => {
    // 3.3.2 [60] — the four types of default values
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|b|c|d)*>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT b EMPTY>\r\n<!ELEMENT c EMPTY>\r\n<!ELEMENT d EMPTY>\r\n<!ATTLIST a att CDATA #REQUIRED>\r\n<!ATTLIST b att CDATA #IMPLIED>\r\n<!ATTLIST c att CDATA #FIXED "value">\r\n<!ATTLIST d att CDATA \'default\'>\r\n]>\r\n<doc><c/><c att="value"/></doc>\r\n';
    expectParses(input);
  });

  test("o-p61pass1", () => {
    // 3.4 [61] — valid conditional sections are INCLUDE and IGNORE (upstream: valid; external parameter
    // entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p61pass1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p62pass1", () => {
    // 3.4 [62] — valid INCLUDE sections -- options S before and after keyword, sections can nest
    // (upstream: valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p62pass1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p63pass1", () => {
    // 3.4 [63] — valid IGNORE sections (upstream: valid; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p63pass1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p64pass1", () => {
    // 3.4 [64] — IGNOREd sections ignore everything except section delimiters (upstream: valid; external
    // parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p64pass1.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p68pass1", () => {
    // 4.1 [68] — Valid entity references. Also ensures that a charref to '&' isn't interpreted as an
    // entity reference open delimiter
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY ent "replacement text">\r\n]>\r\n<doc>\r\n&ent;aaa&ent;\r\n<!--Not a reference:-->\r\n<!--Charref to & doesn\'t make a delimiter-->\r\n&#38;en\r\n</doc>\r\n';
    expectParses(input);
  });

  test("o-p69pass1", () => {
    // 4.1 [69] — Valid PEReferences. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % pe "<!---->">\r\n%pe;<!---->%pe;\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p70pass1", () => {
    // 4.2 [70] — An EntityDecl is either a GEDecl or a PEDecl
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY ge "replacement text">\r\n<!ENTITY % pe "<!-- replacement decl -->">\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p71pass1", () => {
    // 4.2 [71] — Valid GEDecls
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY ge "replacement text">\r\n<!ENTITY\r\n ge2\r\n "replacement text"\r\n >\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p72pass1", () => {
    // 4.2 [72] — Valid PEDecls
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % pe "<!--replacement decl-->">\r\n<!ENTITY\r\n  %\r\n  pe2\r\n  "<!--replacement decl-->"\r\n  >\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p73pass1", () => {
    // 4.2 [73] — EntityDef is either Entity value or an external id, with an optional NDataDecl
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge "replacement text">\r\n<!ENTITY ge2 SYSTEM "nop.ent">\r\n<!ENTITY ge3 SYSTEM "nop.ent" NDATA unknot>\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p76pass1", () => {
    // 4.2.2 [76] — valid NDataDecls
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge SYSTEM "nop.ent" NDATA unknot>\r\n<!ENTITY ge2 SYSTEM "nop.ent"\r\n  NDATA\r\n  unknot\r\n  >\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p01pass1", () => {
    // 2.1 [1] — no prolog
    const input: string = "<doc>\r\n<a><b><c/></b></a>\r\n</doc>";
    expectParses(input);
  });

  test("o-p01pass3", () => {
    // 2.1 [1] — Misc items after the document
    const input: string =
      "<doc>\r\n<a><b><c/></b></a>\r\n</doc>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n";
    expectParses(input);
  });

  test("o-p03pass1", () => {
    // 2.3 [3] — all valid S characters
    const input: string = "\t\r\n <doc/>";
    expectParses(input);
  });

  test("o-p04pass1", () => {
    // 2.3 [4] — names with all valid ASCII characters, and one from each other class in NameChar
    const input: string =
      "<doc>\r\n<abcdefghijklmnopqrstuvwxyz/>\r\n<ABCDEFGHIJKLMNOPQRSTUVWXYZ/>\r\n<A01234567890/>\r\n<A.-:̀·/>\r\n</doc>";
    expectParses(input);
  });

  test("o-p05pass1", () => {
    // 2.3 [5] — various valid Name constructions
    const input: string = "<doc>\r\n<A:._-0/>\r\n<::._-0/>\r\n<_:._-0/>\r\n<A/>\r\n<_/>\r\n<:/>\r\n</doc>";
    expectParses(input);
  });

  test("o-p06fail1", () => {
    // 2.3 [6] — Requires at least one name.
    const input: string =
      '<!--non-validating processors may pass this instance because they don\'t check the IDREFS attribute type-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (a|refs)*>\r\n<!ELEMENT a EMPTY>\r\n<!ELEMENT refs EMPTY>\r\n<!ATTLIST refs refs IDREFS #REQUIRED>\r\n<!ATTLIST a id ID #REQUIRED>\r\n]>\r\n<doc>\r\n<a id="A1"/><a id="A2"/><a id="A3"/>\r\n<refs refs=""/>\r\n</doc>';
    expectParses(input);
  });

  test("o-p08fail1", () => {
    // 2.3 [8] — at least one Nmtoken is required.
    const input: string =
      '<!--note: non-validating parsers may accept this document-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (A*)>\r\n<!ELEMENT A EMPTY>\r\n<!ATTLIST A att NMTOKENS #IMPLIED>\r\n]>\r\n<doc>\r\n<A att=""/>\r\n</doc>';
    expectParses(input);
  });

  test("o-p08fail2", () => {
    // 2.3 [8] — an invalid Nmtoken character.
    const input: string =
      '<!--note: non-validating parsers may accept this document-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (A*)>\r\n<!ELEMENT A EMPTY>\r\n<!ATTLIST A att NMTOKENS #IMPLIED>\r\n]>\r\n<doc>\r\n<A att="abc / def"/>\r\n</doc>';
    expectParses(input);
  });

  test("o-p10pass1", () => {
    // 2.3 [10] — valid attribute values
    const input: string = '<doc>\r\n<A a="asdf>\'&#34;>\r\nasdf\r\n\t?>%"/>\r\n<A a=\'"">&#39;&#34;\'/>\r\n</doc>';
    expectParses(input);
  });

  test("o-p14pass1", () => {
    // 2.4 [14] — valid CharData
    const input: string = "<doc>a%b%&lt;/doc>&#60;/doc>]]&lt;&amp;</doc>\r\n";
    expectParses(input);
  });

  test("o-p15pass1", () => {
    // 2.5 [15] — valid comments
    const input: string = "<!--a\r\n<!DOCTYPE\r\n<?-\r\n]]>-<[ CDATA [\r\n\"- -'-\r\n-<doc>-->\r\n<!---->\r\n<doc/>";
    expectParses(input);
  });

  test("o-p16pass1", () => {
    // 2.6 [16] [17] — Valid form of Processing Instruction. Shows that whitespace character data is valid
    // before end of processing instruction.
    const input: string =
      "<?pitarget?>\r\n<?xmla <!DOCTYPE <[ CDATA [</doc> &a%b&#c?>\r\n<?pitarget ...?>\r\n<?pitarget \r\n\t?>\r\n<?pitarget > ?>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p16pass2", () => {
    // 2.6 [16] — Valid form of Processing Instruction. Shows that whitespace character data is valid
    // before end of processing instruction.
    const input: string = "<?pitarget '?>\r\n<doc/>";
    expectParses(input);
  });

  test("o-p16pass3", () => {
    // 2.6 [16] — Valid form of Processing Instruction. Shows that whitespace character data is valid
    // before end of processing instruction.
    const input: string = '<?pitarget "?>\r\n<doc/>';
    expectParses(input);
  });

  test("o-p18pass1", () => {
    // 2.7 [18] — valid CDSect's. Note that a CDStart in a CDSect is not recognized as such
    const input: string =
      "<doc><![CDATA[<doc<!DOCTYPE&a%b&#c]] >] ]> ]]]><![CDATA[]]>\r\n<![CDATA[\r\n<![CDATA[\r\n]]>\r\n</doc>";
    expectParses(input);
  });

  test("o-p22pass1", () => {
    // 2.8 [22] — prolog can be empty
    const input: string = "<doc/>\r\n";
    expectParses(input);
  });

  test("o-p22pass2", () => {
    // 2.8 [22] — XML declaration only
    const input: string = '<?xml version="1.0"?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p22pass3", () => {
    // 2.8 [22] — XML decl and Misc
    const input: string = '<?xml version="1.0"?>\r\n<!--comment--> <?pi?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p23pass1", () => {
    // 2.8 [23] — Test shows a valid XML declaration along with version info.
    const input: string = '<?xml version="1.0"?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p23pass2", () => {
    // 2.8 [23] — Test shows a valid XML declaration along with encoding declaration.
    const input = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\r\n<doc/>\r\n');
    expectParses(input);
  });

  test("o-p23pass3", () => {
    // 2.8 [23] — Test shows a valid XML declaration along with Standalone Document Declaration.
    const input: string = '<?xml version="1.0" standalone="yes"?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p23pass4", () => {
    // 2.8 [23] — Test shows a valid XML declaration, encoding declarationand Standalone Document
    // Declaration.
    const input = Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<doc/>\r\n');
    expectParses(input);
  });

  test("o-p24pass1", () => {
    // 2.8 [24] — Test shows a prolog that has the VersionInfo delimited by double quotes.
    const input: string = '<?xml version="1.0"?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p24pass2", () => {
    // 2.8 [24] — Test shows a prolog that has the VersionInfo delimited by single quotes.
    const input: string = "<?xml version='1.0'?>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p24pass3", () => {
    // 2.8 [24] — Test shows whitespace is allowed in prolog before version info.
    const input: string = "<?xml\r\n\r\n\r\nversion\r\n=\r\n'1.0'\r\n?>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p24pass4", () => {
    // 2.8 [24] — Test shows whitespace is allowed in prolog on both sides of equal sign.
    const input: string = "<?xml version = '1.0'?>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p25pass1", () => {
    // 2.8 [25] — Test shows whitespace is NOT necessary before or after equal sign of versioninfo.
    const input: string = '<?xml version="1.0"?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p25pass2", () => {
    // 2.8 [25] — Test shows whitespace can be used on both sides of equal sign of versioninfo.
    const input: string = '<?xml version\r\n\r\n\t \r\n=\r\n  \r\n\r\n"1.0"?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p26pass1", () => {
    // 2.8 [26] — The valid version number. We cannot test others because a 1.0 processor is allowed to
    // fail them.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--because we are testing conformace to XML 1.0, there can be no\r\n    exhaustive tests of the VersionNum production.  The only\r\n    VersionNum a 1.0-compliant processor is required to pass\r\n    is "1.0" -->\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p27pass1", () => {
    // 2.8 [27] — Comments are valid as the Misc part of the prolog.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--Non-terminal Misc only appears as Misc*, so we cannot test the fact\r\n    that Misc must match exactly one comment, PI, or S-->\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p27pass2", () => {
    // 2.8 [27] — Processing Instructions are valid as the Misc part of the prolog.
    const input: string = '<?xml version="1.0"?>\r\n<?pi?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p27pass3", () => {
    // 2.8 [27] — Whitespace is valid as the Misc part of the prolog.
    const input: string = '<?xml version="1.0"?>\r\n\r\n \t\r\n\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p27pass4", () => {
    // 2.8 [27] — A combination of comments, whitespaces and processing instructions are valid as the Misc
    // part of the prolog.
    const input: string =
      '<?xml version="1.0"?><?pi?>\r\n\r\n \t\r\n\r\n<!--comment-->\r\n<?pi?>\r\n\r\n \t\r\n\r\n<!--comment-->\r\n<?pi?><doc/>\r\n';
    expectParses(input);
  });

  test("o-p32pass1", () => {
    // 2.9 [32] — Double quotes can be used as delimeters for the value of a Standalone Document
    // Declaration.
    const input: string = '<?xml version="1.0" standalone="yes"?>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p32pass2", () => {
    // 2.9 [32] — Single quotes can be used as delimeters for the value of a Standalone Document
    // Declaration.
    const input: string = "<?xml version=\"1.0\" standalone='no'?>\r\n<doc/>\r\n";
    expectParses(input);
  });

  test("o-p39pass1", () => {
    // 3 3.1 [39] [44] — Empty element tag may be used for any element which has no content.
    const input: string = "<doc/>";
    expectParses(input);
  });

  test("o-p39pass2", () => {
    // 3 3.1 [39] [43] — Character data is valid element content.
    const input: string = "<doc>content</doc>";
    expectParses(input);
  });

  test("o-p40pass1", () => {
    // 3.1 [40] — Elements content can be empty.
    const input: string = "<doc></doc>";
    expectParses(input);
  });

  test("o-p40pass2", () => {
    // 3.1 [40] — Whitespace is valid within a Start-tag.
    const input: string = "<doc\r\n \r\n></doc>";
    expectParses(input);
  });

  test("o-p40pass3", () => {
    // 3.1 [40] [41] — Attributes are valid within a Start-tag.
    const input: string = '<doc att="val"></doc>';
    expectParses(input);
  });

  test("o-p40pass4", () => {
    // 3.1 [40] — Whitespace and Multiple Attributes are valid within a Start-tag.
    const input: string = '<doc att="val" att2="val2"\r\natt3="val3"\r\n></doc>';
    expectParses(input);
  });

  test("o-p41pass1", () => {
    // 3.1 [41] — Attributes are valid within a Start-tag.
    const input: string = '<doc att="val"></doc>';
    expectParses(input);
  });

  test("o-p41pass2", () => {
    // 3.1 [41] — Whitespace is valid within a Start-tags Attribute.
    const input: string = '<doc att\r\n =\r\n  "val"></doc>';
    expectParses(input);
  });

  test("o-p42pass1", () => {
    // 3.1 [42] — Test shows proper syntax for an End-tag.
    const input: string = "<doc></doc>";
    expectParses(input);
  });

  test("o-p42pass2", () => {
    // 3.1 [42] — Whitespace is valid after name in End-tag.
    const input: string = "<doc></doc  \r\n>";
    expectParses(input);
  });

  test("o-p44pass1", () => {
    // 3.1 [44] — Valid display of an Empty Element Tag.
    const input: string = "<doc/>";
    expectParses(input);
  });

  test("o-p44pass2", () => {
    // 3.1 [44] — Empty Element Tags can contain an Attribute.
    const input: string = '<doc att="val"/>';
    expectParses(input);
  });

  test("o-p44pass3", () => {
    // 3.1 [44] — Whitespace is valid in an Empty Element Tag following the end of the attribute value.
    const input: string = '<doc att="val"\r\n\r\n\r\n/>';
    expectParses(input);
  });

  test("o-p44pass4", () => {
    // 3.1 [44] — Whitespace is valid after the name in an Empty Element Tag.
    const input: string = "<doc\r\n  \r\n/>";
    expectParses(input);
  });

  test("o-p44pass5", () => {
    // 3.1 [44] — Whitespace and Multiple Attributes are valid in an Empty Element Tag.
    const input: string = '<doc att="val"\r\natt2="val2" att3="val3"/>';
    expectParses(input);
  });

  test("o-p66pass1", () => {
    // 4.1 [66] — valid character references
    const input: string = "<doc>\r\n&#65;&#9;&#x41;&#x4f;&#x4F;&#0000000000000000009;\r\n&#x10F2ec;&#xa;\r\n</doc>";
    expectParses(input);
  });

  test("o-p74pass1", () => {
    // 4.2 [74] — PEDef is either an entity value or an external id
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ENTITY % pe "<!--replacement decl-->">\r\n<!ENTITY % pe2 SYSTEM "nop.ent">\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p75pass1", () => {
    // 4.2.2 [75] — valid external identifiers
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ENTITY ent SYSTEM "nop.ent">\r\n<!ENTITY ent2 PUBLIC "PublicID" "nop.ent">\r\n<!ENTITY ent3 PUBLIC\r\n              "PublicID"\r\n              "nop.ent"\r\n              >\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-e2", () => {
    // 3.3.1 [58] [59] Errata [E2] — Validity Constraint: No duplicate tokens
    const input: string =
      '<!DOCTYPE el [\r\n<!ELEMENT el EMPTY>\r\n<!ATTLIST el at (one|two|two) #IMPLIED>\r\n]>\r\n<e1 at="two"/>\r\n';
    expectParses(input);
  });

  test("o-p01fail1", () => {
    // 2.1 [1] — S cannot occur before the prolog
    const input: string =
      '\r\n<?xml version="1.0"?>\r\n<doc>\r\n<a><b><c/></b></a>\r\n</doc>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("o-p01fail2", () => {
    // 2.1 [1] — comments cannot occur before the prolog
    const input: string =
      '<!--bad comment--><?xml version="1.0"?>\r\n<doc>\r\n<a><b><c/></b></a>\r\n</doc>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("o-p01fail3", () => {
    // 2.1 [1] — only one document element
    const input: string =
      "<doc/><bad/>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n<!-- comment after document element-->\r\n<?PI after document element?>\r\n";
    expectRejects(input, "XML Parse error: Only one root element is allowed");
  });

  test("o-p01fail4", () => {
    // 2.1 [1] — document element must be complete.
    const input: string = "<doc>";
    expectRejects(input, "XML Parse error: Missing closing tag for element 'doc'");
  });

  test("o-p02fail1", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AAAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x00");
  });

  test("o-p02fail10", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ACwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0B");
  });

  test("o-p02fail11", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ADAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0C");
  });

  test("o-p02fail12", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ADgA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0E");
  });

  test("o-p02fail13", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ADwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0F");
  });

  test("o-p02fail14", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AEAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x10");
  });

  test("o-p02fail15", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AEQA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x11");
  });

  test("o-p02fail16", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AEgA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x12");
  });

  test("o-p02fail17", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AEwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x13");
  });

  test("o-p02fail18", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AFAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x14");
  });

  test("o-p02fail19", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AFQA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x15");
  });

  test("o-p02fail2", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AAQA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x01");
  });

  test("o-p02fail20", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AFgA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x16");
  });

  test("o-p02fail21", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AFwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x17");
  });

  test("o-p02fail22", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AGAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x18");
  });

  test("o-p02fail23", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AGQA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x19");
  });

  test("o-p02fail24", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AGgA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1A");
  });

  test("o-p02fail25", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AGwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1B");
  });

  test("o-p02fail26", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AHAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1C");
  });

  test("o-p02fail27", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AHQA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1D");
  });

  test("o-p02fail28", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AHgA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1E");
  });

  test("o-p02fail29", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AHwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1F");
  });

  test("o-p02fail3", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AAgA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x02");
  });

  test("o-p02fail30", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4A/v88AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: '\ufffe' (U+FFFE)");
  });

  test("o-p02fail31", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4A//88AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("o-p02fail4", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4AAwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x03");
  });

  test("o-p02fail5", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ABAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x04");
  });

  test("o-p02fail6", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ABQA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x05");
  });

  test("o-p02fail7", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ABgA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x06");
  });

  test("o-p02fail8", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ABwA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x07");
  });

  test("o-p02fail9", () => {
    // 2.2 [2] — Use of illegal character within XML document.
    const input = Buffer.from("//48AGQAbwBjAD4ACAA8AC8AZABvAGMAPgA=", "base64");
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x08");
  });

  test("o-p03fail1", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input = Buffer.from("ADxkb2MvPg==", "base64");
    expectRejects(input, "XML Parse error: UTF-16 input has an odd number of bytes");
  });

  test("o-p03fail10", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u000b<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0B");
  });

  test("o-p03fail11", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\f<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0C");
  });

  test("o-p03fail12", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u000e<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0E");
  });

  test("o-p03fail13", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u000f<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0F");
  });

  test("o-p03fail14", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0010<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x10");
  });

  test("o-p03fail15", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0011<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x11");
  });

  test("o-p03fail16", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0012<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x12");
  });

  test("o-p03fail17", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0013<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x13");
  });

  test("o-p03fail18", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0014<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x14");
  });

  test("o-p03fail19", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0015<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x15");
  });

  test("o-p03fail2", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0001<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x01");
  });

  test("o-p03fail20", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0016<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x16");
  });

  test("o-p03fail21", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0017<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x17");
  });

  test("o-p03fail22", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0018<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x18");
  });

  test("o-p03fail23", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0019<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x19");
  });

  test("o-p03fail24", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u001a<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1A");
  });

  test("o-p03fail25", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u001b<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1B");
  });

  test("o-p03fail26", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u001c<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1C");
  });

  test("o-p03fail27", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u001d<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1D");
  });

  test("o-p03fail28", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u001e<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1E");
  });

  test("o-p03fail29", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u001f<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1F");
  });

  test("o-p03fail3", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0002<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x02");
  });

  test("o-p03fail4", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0003<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x03");
  });

  test("o-p03fail5", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0004<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x04");
  });

  test("o-p03fail7", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0006<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x06");
  });

  test("o-p03fail8", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\u0007<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x07");
  });

  test("o-p03fail9", () => {
    // 2.3 [3] — Use of illegal character within XML document.
    const input: string = "\b<doc/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x08");
  });

  test("o-p04fail1", () => {
    // 2.3 [4] — Name contains invalid character.
    const input: string = "<A@/>\r\n";
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '@'");
  });

  test("o-p04fail2", () => {
    // 2.3 [4] — Name contains invalid character.
    const input: string = "<A#/>\r\n";
    expectRejects(input, "XML Parse error: Expected a keyword after '#' but found '/'");
  });

  test("o-p04fail3", () => {
    // 2.3 [4] — Name contains invalid character.
    const input: string = "<A$/>\r\n";
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '$'");
  });

  test("o-p05fail1", () => {
    // 2.3 [5] — a Name cannot start with a digit
    const input: string = "<0A/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '0'");
  });

  test("o-p05fail2", () => {
    // 2.3 [5] — a Name cannot start with a '.'
    const input: string = "<.A/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '.'");
  });

  test("o-p05fail3", () => {
    // 2.3 [5] — a Name cannot start with a "-"
    const input: string = "<-A/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '-'");
  });

  test("o-p05fail4", () => {
    // 2.3 [5] — a Name cannot start with a CombiningChar
    const input: string = "<̀A/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '̀' (U+0300)");
  });

  test("o-p05fail5", () => {
    // 2.3 [5] — a Name cannot start with an Extender
    const input: string = "<·A/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '·' (U+00B7)");
  });

  test("o-p09fail1", () => {
    // 2.3 [9] — EntityValue excludes '%' (upstream: not-wf; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p09fail1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p09fail2", () => {
    // 2.3 [9] — EntityValue excludes '&' (upstream: not-wf; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p09fail2.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p09fail3", () => {
    // 2.3 [9] — incomplete character reference
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ENTITY % ent1 "asdf&#65">\r\n]>\r\n<doc/>';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found '\"'",
    );
  });

  test("o-p09fail4", () => {
    // 2.3 [9] — quote types must match
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ENTITY % ent1 'a\">\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Unterminated entity value");
  });

  test("o-p09fail5", () => {
    // 2.3 [9] — quote types must match
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ENTITY % ent1 \"a'>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Unterminated entity value");
  });

  test("o-p10fail1", () => {
    // 2.3 [10] — attribute values exclude '<'
    const input: string = '<doc a="1 < 2"/>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("o-p10fail2", () => {
    // 2.3 [10] — attribute values exclude '&'
    const input: string = '<doc a="1 &"/>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found '\"'");
  });

  test("o-p10fail3", () => {
    // 2.3 [10] — quote types must match
    const input: string = "<doc a='asd\"/>\r\n";
    expectRejects(input, "XML Parse error: Unterminated attribute value");
  });

  test("o-p11fail1", () => {
    // 2.3 [11] — quote types must match
    const input: string =
      "<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 SYSTEM 'a\">\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Unterminated quoted string");
  });

  test("o-p11fail2", () => {
    // 2.3 [11] — cannot contain delimiting quotes
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 SYSTEM """>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the notation declaration but found '\"'");
  });

  test("o-p12fail1", () => {
    // 2.3 [12] — '"' excluded
    const input: string =
      "<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 PUBLIC '\"'>\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '\"'");
  });

  test("o-p12fail2", () => {
    // 2.3 [12] — '\' excluded
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 PUBLIC "\\\\">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '\\'");
  });

  test("o-p12fail3", () => {
    // 2.3 [12] — entity references excluded
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ENTITY x "x">\r\n<!NOTATION not1 PUBLIC "&x;">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '&'");
  });

  test("o-p12fail4", () => {
    // 2.3 [12] — '>' excluded
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 PUBLIC ">">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '>'");
  });

  test("o-p12fail5", () => {
    // 2.3 [12] — '<' excluded
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 PUBLIC "<">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '<'");
  });

  test("o-p12fail6", () => {
    // 2.3 [12] — built-in entity refs excluded
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 PUBLIC "&amp;">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '&'");
  });

  test("o-p12fail7", () => {
    // 2.3 [13] — The public ID has a tab character, which is disallowed
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 PUBLIC "\t">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: tab");
  });

  test("o-p14fail1", () => {
    // 2.4 [14] — '<' excluded
    const input: string = "<doc>< </doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found space");
  });

  test("o-p14fail2", () => {
    // 2.4 [14] — '&' excluded
    const input: string = "<doc>& </doc>\r\n";
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found space");
  });

  test("o-p14fail3", () => {
    // 2.4 [14] — "]]>" excluded
    const input: string = "<doc>a]]>b</doc>\r\n";
    expectRejects(input, "XML Parse error: ']]>' is only allowed as the end of a CDATA section");
  });

  test("o-p15fail1", () => {
    // 2.5 [15] — comments can't end in '-'
    const input: string = "<!--a--->\r\n<doc/>";
    expectRejects(input, "XML Parse error: '--' is not allowed inside a comment");
  });

  test("o-p15fail2", () => {
    // 2.5 [15] — one comment per comment (contrasted with SGML)
    const input: string = "<!-- -- -- -->\r\n<doc/>";
    expectRejects(input, "XML Parse error: '--' is not allowed inside a comment");
  });

  test("o-p15fail3", () => {
    // 2.5 [15] — can't include 2 or more adjacent '-'s
    const input: string = "<!-- --- -->\r\n<doc/>";
    expectRejects(input, "XML Parse error: '--' is not allowed inside a comment");
  });

  test("o-p16fail1", () => {
    // 2.6 [16] — "xml" is an invalid PITarget
    const input: string = "<?pitarget?>\r\n<?xml?>\r\n<doc/>";
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("o-p16fail2", () => {
    // 2.6 [16] — a PITarget must be present
    const input: string = "<??>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected a processing instruction target after '<?' but found '?'");
  });

  test("o-p16fail3", () => {
    // 2.6 [16] — S after PITarget is required
    const input: string = "<?pitarget+++?>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected whitespace or '?>' after the processing instruction target but found '+'",
    );
  });

  test("o-p18fail1", () => {
    // 2.7 [18] — no space before "CDATA"
    const input: string = "<doc><![ CDATA[a]]></doc>";
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("o-p18fail2", () => {
    // 2.7 [18] — no space after "CDATA"
    const input: string = "<doc><![CDATA [a]]></doc>";
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("o-p18fail3", () => {
    // 2.7 [18] — CDSect's can't nest
    const input: string = "<doc>\r\n<![CDATA[\r\n<![CDATA[XML doesn't allow CDATA sections to nest]]>\r\n]]>\r\n</doc>";
    expectRejects(input, "XML Parse error: ']]>' is only allowed as the end of a CDATA section");
  });

  test("o-p22fail1", () => {
    // 2.8 [22] — prolog must start with XML decl
    const input: string = '\r\n<?xml version="1.0"?>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("o-p22fail2", () => {
    // 2.8 [22] — prolog must start with XML decl
    const input: string = '<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<?xml version="1.0"?>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("o-p23fail1", () => {
    // 2.8 [23] — "xml" must be lower-case
    const input: string = '<?XML version="1.0"?>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("o-p23fail2", () => {
    // 2.8 [23] — VersionInfo must be supplied
    const input = Buffer.from('<?xml encoding="UTF-8"?>\r\n<doc/>\r\n');
    expectRejects(input, 'XML Parse error: The XML declaration must start with version="1.0"');
  });

  test("o-p23fail3", () => {
    // 2.8 [23] — VersionInfo must come first
    const input = Buffer.from('<?xml encoding="UTF-8" version="1.0"?>\r\n<doc/>\r\n');
    expectRejects(input, 'XML Parse error: The XML declaration must start with version="1.0"');
  });

  test("o-p23fail4", () => {
    // 2.8 [23] — SDDecl must come last
    const input = Buffer.from('<?xml version="1.0" standalone="yes" encoding="UTF-8"?>\r\n<doc/>\r\n');
    expectRejects(
      input,
      "XML Parse error: Misplaced 'encoding' in the XML declaration (the order is version, encoding, standalone)",
    );
  });

  test("o-p23fail5", () => {
    // 2.8 [23] — no SGML-type PIs
    const input: string = '<?xml version="1.0">\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '?>' to end the XML declaration but found '>'");
  });

  test("o-p24fail1", () => {
    // 2.8 [24] — quote types must match
    const input: string = "<?xml version = '1.0\"?>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in a quoted string: '>'");
  });

  test("o-p24fail2", () => {
    // 2.8 [24] — quote types must match
    const input: string = "<?xml version = \"1.0'?>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in a quoted string: '>'");
  });

  test("o-p25fail1", () => {
    // 2.8 [25] — Comment is illegal in VersionInfo.
    const input: string = '<?xml version <!--bad comment--> ="1.0"?>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '=' after the name in the XML declaration but found a comment");
  });

  test("o-p26fail1", () => {
    // 2.8 [26] — Illegal character in VersionNum.
    const input: string = '<?xml version="1.0?"?>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Unsupported XML version '1.0?' (this is an XML 1.0 parser)");
  });

  test("o-p26fail2", () => {
    // 2.8 [26] — Illegal character in VersionNum.
    const input: string = '<?xml version="1.0^"?>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Unsupported XML version '1.0^' (this is an XML 1.0 parser)");
  });

  test("o-p27fail1", () => {
    // 2.8 [27] — References aren't allowed in Misc, even if they would resolve to valid Misc.
    const input: string = '<?xml version="1.0"?>\r\n&#32;\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected the root element but found '&'");
  });

  test("o-p28fail1", () => {
    // 2.8 [28] — only declarations in DTD.
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n<doc/>\r\n]>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '<doc'",
    );
  });

  test("o-p29fail1", () => {
    // 2.8 [29] — A processor must not pass unknown declaration types.
    const input: string =
      "<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n<!DUNNO should not pass unknown declaration types>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("o-p30fail1", () => {
    // 2.8 [30] — An XML declaration is not the same as a TextDecl (upstream: not-wf; external parameter
    // entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p30fail1.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p31fail1", () => {
    // 2.8 [31] — external subset excludes doctypedecl (upstream: not-wf; external parameter entities are
    // not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p31fail1.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p32fail1", () => {
    // 2.9 [32] — quote types must match
    const input: string = '<?xml version="1.0" standalone=\'yes"?>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a quoted string: '>'");
  });

  test("o-p32fail2", () => {
    // 2.9 [32] — quote types must match
    const input: string = '<?xml version="1.0" standalone="yes\'?>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a quoted string: '>'");
  });

  test("o-p32fail3", () => {
    // 2.9 [32] — initial S is required
    const input: string = '<?xml version="1.0"standalone="yes"?>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'standalone'");
  });

  test("o-p32fail4", () => {
    // 2.9 [32] — quotes are required
    const input: string = '<?xml version="1.0" standalone=yes?>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted value in the XML declaration but found 'yes'");
  });

  test("o-p32fail5", () => {
    // 2.9 [32] — yes or no must be lower case
    const input: string = '<?xml version="1.0" standalone="YES"?>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid value 'YES' for standalone in the XML declaration (expected yes or no)",
    );
  });

  test("o-p39fail1", () => {
    // 3 [39] — start-tag requires end-tag
    const input: string = "<doc>content";
    expectRejects(input, "XML Parse error: Missing closing tag for element 'doc'");
  });

  test("o-p39fail2", () => {
    // 3 [39] — end-tag requires start-tag
    const input: string = "<doc>content</a></doc>";
    expectRejects(input, "XML Parse error: Expected closing tag </doc> but found </a>");
  });

  test("o-p39fail3", () => {
    // 3 [39] — XML documents contain one or more elements
    const input: string = "";
    expectRejects(input, "XML Parse error: XML document must have a root element");
  });

  test("o-p39fail4", () => {
    // 2.8 [23] — XML declarations must be correctly terminated
    const input: string = '<?xml version="1.0">\r\n';
    expectRejects(input, "XML Parse error: Expected '?>' to end the XML declaration but found '>'");
  });

  test("o-p39fail5", () => {
    // 2.8 [23] — XML declarations must be correctly terminated
    const input: string =
      '<?xml version="1.0">\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n\r\n<!--comment-->\r\n<?pi?>\r\n';
    expectRejects(input, "XML Parse error: Expected '?>' to end the XML declaration but found '>'");
  });

  test("o-p40fail1", () => {
    // 3.1 [40] — S is required between attributes
    const input: string = '<doc att="val"att2="val2"></doc>';
    expectRejects(input, "XML Parse error: Whitespace is required before 'att2'");
  });

  test("o-p40fail2", () => {
    // 3.1 [40] — tags start with names, not nmtokens
    const input: string = "<3notname></3notname>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '3'");
  });

  test("o-p40fail3", () => {
    // 3.1 [40] — tags start with names, not nmtokens
    const input: string = "<3notname></notname>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '3'");
  });

  test("o-p40fail4", () => {
    // 3.1 [40] — no space before name
    const input: string = "< doc></doc>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found space");
  });

  test("o-p41fail1", () => {
    // 3.1 [41] — quotes are required (contrast with SGML)
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc att (val|val2)>\r\n]>\r\n<doc att=val></doc>";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'att'");
  });

  test("o-p41fail2", () => {
    // 3.1 [41] — attribute name is required (contrast with SGML)
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc att (val|val2)>\r\n]>\r\n<doc val></doc>";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'att'");
  });

  test("o-p41fail3", () => {
    // 3.1 [41] — Eq required
    const input: string = '<doc att "val"></doc>';
    expectRejects(input, "XML Parse error: Expected '=' after the attribute name but found '\"'");
  });

  test("o-p42fail1", () => {
    // 3.1 [42] — no space before name
    const input: string = "<doc></ doc>";
    expectRejects(input, "XML Parse error: Expected an element name after '</' but found space");
  });

  test("o-p42fail2", () => {
    // 3.1 [42] — cannot end with "/>"
    const input: string = "<doc></doc/>";
    expectRejects(input, "XML Parse error: Expected '>' to end the closing tag but found '/>'");
  });

  test("o-p42fail3", () => {
    // 3.1 [42] — no NET (contrast with SGML)
    const input: string = "<doc/doc/";
    expectRejects(input, "XML Parse error: Expected '>' after '/' but found 'd'");
  });

  test("o-p43fail1", () => {
    // 3.1 [43] — no non-comment declarations
    const input: string =
      '<!DOCTYPE elem\r\n[\r\n<!ELEMENT elem (#PCDATA|elem)*>\r\n<!ENTITY ent "<elem>CharData</elem>">\r\n]>\r\n<elem>\r\n<!ENTITY badent "bad">\r\n</elem>\r\n';
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("o-p43fail2", () => {
    // 3.1 [43] — no conditional sections
    const input: string =
      '<!DOCTYPE elem\r\n[\r\n<!ELEMENT elem (#PCDATA|elem)*>\r\n<!ENTITY ent "<elem>CharData</elem>">\r\n]>\r\n<elem>\r\n<![IGNORE[This was valid in SGML, but not XML]]>\r\n</elem>\r\n';
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("o-p43fail3", () => {
    // 3.1 [43] — no conditional sections
    const input: string =
      '<!DOCTYPE elem\r\n[\r\n<!ELEMENT elem (#PCDATA|elem)*>\r\n<!ENTITY ent "<elem>CharData</elem>">\r\n]>\r\n<elem>\r\n<![INCLUDE[This was valid in SGML, but not XML]]>\r\n</elem>\r\n';
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("o-p44fail1", () => {
    // 3.1 [44] — Illegal space before Empty element tag.
    const input: string = "< doc/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found space");
  });

  test("o-p44fail2", () => {
    // 3.1 [44] — Illegal space after Empty element tag.
    const input: string = "<doc/ >";
    expectRejects(input, "XML Parse error: Expected '>' after '/' but found space");
  });

  test("o-p44fail3", () => {
    // 3.1 [44] — Illegal comment in Empty element tag.
    const input: string = "<doc --bad comment--/>";
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '--bad'");
  });

  test("o-p44fail4", () => {
    // 3.1 [44] — Whitespace required between attributes.
    const input: string = '<doc att="val"att2="val2"/>';
    expectRejects(input, "XML Parse error: Whitespace is required before 'att2'");
  });

  test("o-p44fail5", () => {
    // 3.1 [44] — Duplicate attribute name is illegal.
    const input: string = '<doc att="val" att="val"/>';
    expectRejects(input, "XML Parse error: Duplicate attribute 'att'");
  });

  test("o-p45fail1", () => {
    // 3.2 [45] — ELEMENT must be upper case.
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!element doc EMPTY>\r\n]>\r\n<doc/>";
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("o-p45fail2", () => {
    // 3.2 [45] — S before contentspec is required.
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc(#PCDATA)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("o-p45fail3", () => {
    // 3.2 [45] — only one content spec
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT (doc|a) (#PCDATA)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '('");
  });

  test("o-p45fail4", () => {
    // 3.2 [45] — no comments in declarations (contrast with SGML)
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA) --bad comment-->\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '--bad'");
  });

  test("o-p46fail1", () => {
    // 3.2 [46] — no parens on declared content
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (#EMPTY)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '#EMPTY'");
  });

  test("o-p46fail2", () => {
    // 3.2 [46] — no inclusions (contrast with SGML)
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (#PCDATA) +(doc)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '+'");
  });

  test("o-p46fail3", () => {
    // 3.2 [46] — no exclusions (contrast with SGML)
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (#PCDATA) -(doc)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '-'");
  });

  test("o-p46fail4", () => {
    // 3.2 [46] — no space before occurrence
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc) +>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("o-p46fail5", () => {
    // 3.2 [46] — single group
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (#PCDATA)(doc)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '('");
  });

  test("o-p46fail6", () => {
    // 3.2 [46] — can't be both declared and modeled
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a EMPTY (doc)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '('");
  });

  test("o-p47fail1", () => {
    // 3.2.1 [47] — Invalid operator '|' must match previous operator ','
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc,a?|a?)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A content model group cannot mix ',' and '|'");
  });

  test("o-p47fail2", () => {
    // 3.2.1 [47] — Illegal character '-' in Element-content model
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc)->\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '-'");
  });

  test("o-p47fail3", () => {
    // 3.2.1 [47] — Optional character must follow a name or list
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a *(doc)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '*'");
  });

  test("o-p47fail4", () => {
    // 3.2.1 [47] — Illegal space before optional character
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc) ?>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("o-p48fail1", () => {
    // 3.2.1 [48] — Illegal space before optional character
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc *)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("o-p48fail2", () => {
    // 3.2.1 [48] — Illegal space before optional character
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a ((doc|a?) +)>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("o-p49fail1", () => {
    // 3.2.1 [49] — connectors must match
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc|a?,a?)>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A content model group cannot mix ',' and '|'");
  });

  test("o-p50fail1", () => {
    // 3.2.1 [50] — connectors must match
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc ANY>\r\n<!ELEMENT a (doc,a?|a?)>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A content model group cannot mix ',' and '|'");
  });

  test("o-p51fail1", () => {
    // 3.2.2 [51] — occurrence on #PCDATA group must be *
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)?>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A mixed content model may only be followed by '*'");
  });

  test("o-p51fail2", () => {
    // 3.2.2 [51] — occurrence on #PCDATA group must be *
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)+>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A mixed content model may only be followed by '*'");
  });

  test("o-p51fail3", () => {
    // 3.2.2 [51] — #PCDATA must come first
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ELEMENT a (doc|#PCDATA)*>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: #PCDATA must come first in a content model, as (#PCDATA|a|b)*");
  });

  test("o-p51fail4", () => {
    // 3.2.2 [51] — occurrence on #PCDATA group must be *
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ELEMENT a (#PCDATA|doc)?>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A mixed content model may only be followed by '*'");
  });

  test("o-p51fail5", () => {
    // 3.2.2 [51] — only '|' connectors
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ELEMENT a (#PCDATA|doc,a?)*>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A mixed content model is separated by '|', not ','");
  });

  test("o-p51fail6", () => {
    // 3.2.2 [51] — Only '|' connectors and occurrence on #PCDATA group must be *
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ELEMENT a (#PCDATA,doc,a?)*>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: A mixed content model is separated by '|', not ','");
  });

  test("o-p51fail7", () => {
    // 3.2.2 [51] — no nested groups
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ELEMENT a (#PCDATA|(doc|a))*>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Only element names may follow #PCDATA in a mixed content model");
  });

  test("o-p52fail1", () => {
    // 3.3 [52] — A name is required
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST  >\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ATTLIST' but found '>'");
  });

  test("o-p52fail2", () => {
    // 3.3 [52] — A name is required
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST>\r\n]>\r\n<doc/>";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ATTLIST' but found '>'");
  });

  test("o-p53fail1", () => {
    // 3.3 [53] — S is required before default
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA#IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Whitespace is required before '#IMPLIED'");
  });

  test("o-p53fail2", () => {
    // 3.3 [53] — S is required before type
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att(a|b) #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("o-p53fail3", () => {
    // 3.3 [53] — type is required
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found '#IMPLIED'",
    );
  });

  test("o-p53fail4", () => {
    // 3.3 [53] — default is required
    const input: string = "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '>'",
    );
  });

  test("o-p53fail5", () => {
    // 3.3 [53] — name is requried
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc (a|b) #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '('");
  });

  test("o-p54fail1", () => {
    // 3.3.1 [54] — don't pass unknown attribute types
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att DUNNO #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'DUNNO'",
    );
  });

  test("o-p55fail1", () => {
    // 3.3.1 [55] — must be upper case
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att cdata #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'cdata'",
    );
  });

  test("o-p56fail1", () => {
    // 3.3.1 [56] — no IDS type
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att IDS #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'IDS'",
    );
  });

  test("o-p56fail2", () => {
    // 3.3.1 [56] — no NUMBER type
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att NUMBER #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NUMBER'",
    );
  });

  test("o-p56fail3", () => {
    // 3.3.1 [56] — no NAME type
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att NAME #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NAME'",
    );
  });

  test("o-p56fail4", () => {
    // 3.3.1 [56] — no ENTITYS type - types must be upper case
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att ENTITYS #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'ENTITYS'",
    );
  });

  test("o-p56fail5", () => {
    // 3.3.1 [56] — types must be upper case
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att id #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'id'",
    );
  });

  test("o-p57fail1", () => {
    // 3.3.1 [57] — no keyword for NMTOKEN enumeration
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att NMTOKEN (a|b) #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '('",
    );
  });

  test("o-p58fail1", () => {
    // 3.3.1 [58] — at least one value required
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!NOTATION b SYSTEM "b">\r\n<!ATTLIST doc att NOTATION () #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a notation name but found ')'");
  });

  test("o-p58fail2", () => {
    // 3.3.1 [58] — separator must be '|'
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!NOTATION b SYSTEM "b">\r\n<!ATTLIST doc att NOTATION (a,b) #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found ','");
  });

  test("o-p58fail3", () => {
    // 3.3.1 [58] — notations are NAMEs, not NMTOKENs -- note: Leaving the invalid notation undeclared
    // would cause a validating parser to fail without checking the name syntax, so the notation is
    // declared with an invalid name. A parser that reports error positions should report an error at the
    // AttlistDecl on line 6, before reaching the notation declaration.
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!--should fail at this AttlistDecl, before NOTATION decl-->\r\n<!ATTLIST doc att NOTATION (a|0b) #IMPLIED>\r\n\r\n\r\n\r\n<!NOTATION 0b SYSTEM "0b">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a notation name but found '0b'");
  });

  test("o-p58fail4", () => {
    // 3.3.1 [58] — NOTATION must be upper case
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!NOTATION b SYSTEM "b">\r\n<!ATTLIST doc att notation (a|b) #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'notation'",
    );
  });

  test("o-p58fail5", () => {
    // 3.3.1 [58] — S after keyword is required
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!NOTATION b SYSTEM "b">\r\n<!ATTLIST doc att NOTATION(a|b) #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("o-p58fail6", () => {
    // 3.3.1 [58] — parentheses are require
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!ATTLIST doc att NOTATION a #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '(' after NOTATION but found 'a'");
  });

  test("o-p58fail7", () => {
    // 3.3.1 [58] — values are unquoted
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!ATTLIST doc att NOTATION "a" #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '(' after NOTATION but found '\"'");
  });

  test("o-p58fail8", () => {
    // 3.3.1 [58] — values are unquoted
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION a SYSTEM "a">\r\n<!ATTLIST doc att NOTATION ("a") #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a notation name but found '\"'");
  });

  test("o-p59fail1", () => {
    // 3.3.1 [59] — at least one required
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att () #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Expected a name token in the enumeration but found ')'");
  });

  test("o-p59fail2", () => {
    // 3.3.1 [59] — separator must be ","
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att (a,b) #IMPLIED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found ','");
  });

  test("o-p59fail3", () => {
    // 3.3.1 [59] — values are unquoted
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att ("a") #IMPLIED>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a name token in the enumeration but found '\"'");
  });

  test("o-p60fail1", () => {
    // 3.3.2 [60] — keywords must be upper case
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA #implied>\r\n]>\r\n<doc/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '#implied'",
    );
  });

  test("o-p60fail2", () => {
    // 3.3.2 [60] — S is required after #FIXED
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA #FIXED"value">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("o-p60fail3", () => {
    // 3.3.2 [60] — only #FIXED has both keyword and value
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA #REQUIRED "value">\r\n]>\r\n<doc att="value"/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '\"'",
    );
  });

  test("o-p60fail4", () => {
    // 3.3.2 [60] — #FIXED required value
    const input: string =
      "<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA #FIXED>\r\n]>\r\n<doc/>\r\n";
    expectRejects(input, "XML Parse error: Expected a quoted default value after #FIXED but found '>'");
  });

  test("o-p60fail5", () => {
    // 3.3.2 [60] — only one default type
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!ATTLIST doc att CDATA #IMPLIED #REQUIRED>\r\n]>\r\n<doc att="value"/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '#REQUIRED'",
    );
  });

  test("o-p61fail1", () => {
    // 3.4 [61] — no other types, including TEMP, which is valid in SGML (upstream: not-wf; external
    // parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p61fail1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p62fail1", () => {
    // 3.4 [62] — INCLUDE must be upper case (upstream: not-wf; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p62fail1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p62fail2", () => {
    // 3.4 [62] — no spaces in terminating delimiter (upstream: not-wf; external parameter entities are not
    // read)
    const input: string = '<!DOCTYPE doc SYSTEM "p62fail2.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p63fail1", () => {
    // 3.4 [63] — IGNORE must be upper case (upstream: not-wf; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p63fail1.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p63fail2", () => {
    // 3.4 [63] — delimiters must be balanced (upstream: not-wf; external parameter entities are not read)
    const input: string = '<!DOCTYPE doc SYSTEM "p63fail2.dtd">\r\n<doc/>';
    expectParses(input);
  });

  test("o-p64fail1", () => {
    // 3.4 [64] — section delimiters must balance (upstream: not-wf; external parameter entities are not
    // read)
    const input: string = '<!DOCTYPE doc SYSTEM "p64fail1.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p64fail2", () => {
    // 3.4 [64] — section delimiters must balance (upstream: not-wf; external parameter entities are not
    // read)
    const input: string = '<!DOCTYPE doc SYSTEM "p64fail2.dtd">\r\n<doc/>\r\n';
    expectParses(input);
  });

  test("o-p66fail1", () => {
    // 4.1 [66] — terminating ';' is required
    const input: string = "<doc>&#65</doc>";
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found '<'",
    );
  });

  test("o-p66fail2", () => {
    // 4.1 [66] — no S after '&#'
    const input: string = "<doc>&# 65;</doc>";
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found space",
    );
  });

  test("o-p66fail3", () => {
    // 4.1 [66] — no hex digits in numeric reference
    const input: string = "<doc>&#A;</doc>";
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found 'A'",
    );
  });

  test("o-p66fail4", () => {
    // 4.1 [66] — only hex digits in hex references
    const input: string = "<doc>&#x4G;</doc>";
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found 'G'",
    );
  });

  test("o-p66fail5", () => {
    // 4.1 [66] — no references to non-characters
    const input: string = "<doc>&#5;</doc>";
    expectRejects(input, "XML Parse error: Character reference '&#5;' is not a valid XML character");
  });

  test("o-p66fail6", () => {
    // 4.1 [66] — no references to non-characters
    const input: string = "<doc>&#xd802;&#xdc02;</doc>";
    expectRejects(input, "XML Parse error: Character reference '&#xd802;' is not a valid XML character");
  });

  test("o-p68fail1", () => {
    // 4.1 [68] — terminating ';' is required
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY ent "replacement text">\r\n]>\r\n<doc>\r\n&ent\r\n</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found newline");
  });

  test("o-p68fail2", () => {
    // 4.1 [68] — no S after '&'
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY ent "replacement text">\r\n]>\r\n<doc>\r\n& ent;\r\n</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found space");
  });

  test("o-p68fail3", () => {
    // 4.1 [68] — no S before ';'
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY ent "replacement text">\r\n]>\r\n<doc>\r\n&ent ;\r\n</doc>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found space");
  });

  test("o-p69fail1", () => {
    // 4.1 [69] — terminating ';' is required
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % pe "<!---->">\r\n%pe<!---->\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' to end the parameter entity reference 'pe'");
  });

  test("o-p69fail2", () => {
    // 4.1 [69] — no S after '%'
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % pe "<!---->">\r\n% pe;\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '%'");
  });

  test("o-p69fail3", () => {
    // 4.1 [69] — no S before ';'
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % pe "<!---->">\r\n%pe ;\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' to end the parameter entity reference 'pe'");
  });

  test("o-p70fail1", () => {
    // 4.2 [70] — This is neither
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY & bad "replacement text">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name or '%' after '<!ENTITY' but found '&'");
  });

  test("o-p71fail1", () => {
    // 4.2 [71] — S is required before EntityDef
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY ge"replacement text">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("o-p71fail2", () => {
    // 4.2 [71] — Entity name is a Name, not an NMToken
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY -ge "replacement text">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name or '%' after '<!ENTITY' but found '-ge'");
  });

  test("o-p71fail3", () => {
    // 4.2 [71] — no S after "<!"
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<! ENTITY ge "replacement text">\r\n]>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("o-p71fail4", () => {
    // 4.2 [71] — S is required after "<!ENTITY"
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITYge "replacement text">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'ge'");
  });

  test("o-p72fail1", () => {
    // 4.2 [72] — S is required after "<!ENTITY"
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY% pe "<!--replacement decl-->">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before '%'");
  });

  test("o-p72fail2", () => {
    // 4.2 [72] — S is required after '%'
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY %pe "<!--replacement decl-->">\r\n]>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Whitespace is required between '%' and the name in a parameter entity declaration",
    );
  });

  test("o-p72fail3", () => {
    // 4.2 [72] — S is required after name
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % pe"<!--replacement decl-->">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("o-p72fail4", () => {
    // 4.2 [72] — Entity name is a name, not an NMToken
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!ENTITY % .pe "<!--replacement decl-->">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected the parameter entity name after '%' but found '.pe'");
  });

  test("o-p73fail1", () => {
    // 4.2 [73] — No typed replacement text
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge CDATA "replacement text">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found 'CDATA'");
  });

  test("o-p73fail2", () => {
    // 4.2 [73] — Only one replacement value
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge "replacement text" "more text">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found '\"'");
  });

  test("o-p73fail3", () => {
    // 4.2 [73] — No NDataDecl on replacement text
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge "replacement text" NDATA unknot>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'NDATA'");
  });

  test("o-p73fail4", () => {
    // 4.2 [73] — Value is required
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge >\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found '>'");
  });

  test("o-p73fail5", () => {
    // 4.2 [73] — No NDataDecl without value
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge NDATA unknot>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found 'NDATA'");
  });

  test("o-p74fail1", () => {
    // 4.2 [74] — no NDataDecls on parameter entities
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY % pe SYSTEM "nop.ent" NDATA unknot>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Parameter entities cannot have NDATA");
  });

  test("o-p74fail2", () => {
    // 4.2 [74] — value is required
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY % pe>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found '>'");
  });

  test("o-p74fail3", () => {
    // 4.2 [74] — only one value
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ENTITY % pe "<!--decl1-->" SYSTEM "nop.ent">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'SYSTEM'");
  });

  test("o-p75fail1", () => {
    // 4.2.2 [75] — S required after "PUBLIC"
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ENTITY ent PUBLIC"PublicID" "nop.ent">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("o-p75fail2", () => {
    // 4.2.2 [75] — S required after "SYSTEM"
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ENTITY ent SYSTEM"nop.ent">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("o-p75fail3", () => {
    // 4.2.2 [75] — S required between literals
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ENTITY ent PUBLIC "PublicID""nop.ent">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("o-p75fail4", () => {
    // 4.2.2 [75] — "SYSTEM" implies only one literal
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ENTITY ent SYSTEM "PublicID" "nop.ent">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found '\"'");
  });

  test("o-p75fail5", () => {
    // 4.2.2 [75] — only one keyword
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ENTITY ent PUBLIC "PublicID" SYSTEM "nop.ent">\r\n]>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a quoted system identifier after the public identifier but found 'SYSTEM'",
    );
  });

  test("o-p75fail6", () => {
    // 4.2.2 [75] — "PUBLIC" requires two literals (contrast with SGML)
    const input: string = '<!DOCTYPE doc\r\n[\r\n<!ENTITY ent PUBLIC "PublicID">\r\n]>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a quoted system identifier after the public identifier but found '>'",
    );
  });

  test("o-p76fail1", () => {
    // 4.2.2 [76] — S is required before "NDATA"
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge SYSTEM "nop.ent"NDATA unknot>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'NDATA'");
  });

  test("o-p76fail2", () => {
    // 4.2.2 [76] — "NDATA" is upper-case
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge SYSTEM "nop.ent" ndata unknot>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'ndata'");
  });

  test("o-p76fail3", () => {
    // 4.2.2 [76] — notation name is required
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!ENTITY ge SYSTEM "nop.ent" NDATA>\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a notation name after NDATA but found '>'");
  });

  test("o-p76fail4", () => {
    // 4.2.2 [76] — notation names are Names
    const input: string =
      '<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc (#PCDATA)>\r\n<!NOTATION unknot PUBLIC "Unknown">\r\n<!--error should be reported here, not at <!Notation-->\r\n<!ENTITY ge SYSTEM "nop.ent" NDATA -unknot>\r\n<!NOTATION -unknot PUBLIC "Unknown">\r\n]>\r\n<doc/>\r\n';
    expectRejects(input, "XML Parse error: Expected a notation name after NDATA but found '-unknot'");
  });

  test("o-p11pass1", () => {
    // 2.3, 4.2.2 [11] — system literals may not contain URI fragments (upstream: optional error)
    const input: string =
      '<!--Inability to resolve a notation should not be reported as an error-->\r\n<!DOCTYPE doc\r\n[\r\n<!ELEMENT doc EMPTY>\r\n<!NOTATION not1 SYSTEM "a%a&b&#0<!ELEMENT<!--<?</>?>/\\\'\'">\r\n<!NOTATION not2 SYSTEM \'a\r\n\tb"""\'>\r\n<!NOTATION not3 SYSTEM "">\r\n<!NOTATION not4 SYSTEM \'\'>\r\n]>\r\n<doc/>\r\n';
    expectParses(input);
  });
});

describe("ibm", () => {
  test("ibm-invalid-P28-ibm28i01.xml", () => {
    // 2.8 — The test violates VC:Root Element Type in P28. The Name in the document type declaration does
    // not match the element type of the root element.
    const input = Buffer.from(
      "<?xml version=\"1.0\" encoding='UTF-8'?>\r\n<!DOCTYPE tiger [\r\n   <!ELEMENT tiger EMPTY>\r\n]>\r\n<!-- This against VC of P28. The Name in the document type declaration\r\n does not match the element type of the root element. --> \r\n<animal/>",
    );
    const canonical = "<animal></animal>";
    const compact: unknown = { animal: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P32-ibm32i01.xml", () => {
    // 2.9 — This test violates VC: Standalone Document Declaration in P32. The standalone document
    // declaration has the value yes, BUT there is an external markup declaration of attributes with
    // default values, and the associated element appears in the document with specified values for those
    // attributes. (upstream: invalid; external parameter entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0" standalone="yes" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32i01.dtd" [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- This is against VC: Standalone Document Declaration in P32\r\n The standalone document declaration has the value "yes", there is an external \r\n markup declaration of attributes with default values, and the associated \r\n element appears in the document with specified values for those attributes.   \r\n-->\r\n<animal/>\r\n';
    expectParses(input);
  });

  test("ibm-invalid-P32-ibm32i03.xml", () => {
    // 2.9 — This test violates VC: Standalone Document Declaration in P32. The standalone document
    // declaration has the value yes, BUT there is an external markup declaration of attributes with values
    // that will change if normalized. (upstream: invalid; external parameter entities are not read; output
    // depends on them)
    const input: string =
      '<?xml version="1.0" standalone="yes" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32i03.dtd" [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- This is against VC: Standalone Document Declaration in P32\r\n The standalone document declaration has the value "yes", there is an external\r\n markup declaration of attributes with values containing character reference.\r\n-->\r\n<animal class="   NMTOKEN_with_leading_and_trailing_space\t "/>\r\n\r\n\r\n\r\n\r\n';
    expectParses(input);
  });

  test("ibm-invalid-P32-ibm32i04.xml", () => {
    // 2.9 — This test violates VC: Standalone Document Declaration in P32. The standalone document
    // declaration has the value yes, BUT there is an external markup declaration of element with element
    // content, and white space occurs directly within the mixed content. (upstream: invalid; external
    // parameter entities are not read)
    const input: string =
      "<?xml version='1.0' standalone='yes' ?>\r\n<!DOCTYPE animal SYSTEM \"ibm32i04.dtd\" [\r\n  <!ATTLIST animal xml:space (default|preserve) 'preserve'>\r\n]>\r\n<!-- This is against VC: Standalone Document Declaration in P32\r\n The standalone document declaration has the value \"yes\", there is an \r\n external markup declaration of element with a element only content type, and \r\n white space occurs directly within the mixed content.\r\n-->\r\n<animal><a>This is a \r\n\r\nyellow tiger</a> <b/>\r\n<c/>\r\n\r\n</animal>\r\n";
    const canonical =
      '<animal xml:space="preserve"><a>This is a &#10;&#10;yellow tiger</a> <b></b>&#10;<c></c>&#10;&#10;</animal>';
    const compact: unknown = {
      animal: { "@xml:space": "preserve", a: "This is a \n\nyellow tiger", b: "", c: "" },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P39-ibm39i01.xml", () => {
    // 3 — This test violates VC: Element Valid in P39. Element a is declared empty in DTD, but has content
    // in the document.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n\r\n]>\r\n<!--* EMPTY element a has content *-->\r\n<root><a>should not have content here</a><b>\r\n   <c></c> \r\n   content of b element\r\n</b></root>\r\n\r\n';
    const canonical =
      "<root><a>should not have content here</a><b>&#10;   <c></c> &#10;   content of b element&#10;</b></root>";
    const compact: unknown = {
      root: {
        a: "should not have content here",
        b: { c: "", "#text": " \n   content of b element\n" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P39-ibm39i02.xml", () => {
    // 3 — This test violates VC: Element Valid in P39. root is declared only having element children in
    // DTD, but have text content in the document.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n\r\n]>\r\n<!--* root element have text content *-->\r\n<root>\r\n root can\'t have text content\r\n<a></a><b>\r\n   <c></c> \r\n   content of b element\r\n</b></root>\r\n\r\n';
    const canonical =
      "<root>&#10; root can't have text content&#10;<a></a><b>&#10;   <c></c> &#10;   content of b element&#10;</b></root>";
    const compact: unknown = {
      root: {
        "#text": "\n root can't have text content\n",
        a: "",
        b: { c: "", "#text": " \n   content of b element\n" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P39-ibm39i03.xml", () => {
    // 3 — This test violates VC: Element Valid in P39. Illegal elements are inserted in b's content of
    // Mixed type.
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n]>\r\n<!--* illgal element in b's Mixed content *-->\r\n<root><a/><b>\r\n   <c></c> \r\n   content of b element\r\n   <a/>\r\n   could not have 'a' as 'b's content\r\n</b></root>\r\n\r\n";
    const canonical =
      "<root><a></a><b>&#10;   <c></c> &#10;   content of b element&#10;   <a></a>&#10;   could not have 'a' as 'b's content&#10;</b></root>";
    const compact: unknown = {
      root: {
        a: "",
        b: {
          c: "",
          "#text": " \n   content of b element\n   \n   could not have 'a' as 'b's content\n",
          a: "",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P39-ibm39i04.xml", () => {
    // 3 — This test violates VC: Element Valid in P39. Element c has undeclared element as its content of
    // ANY type
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n  <!ELEMENT f EMPTY>\r\n]>\r\n<!--* element c has undeclared element as its ANY content *-->\r\n<root><a/><b>\r\n   <c><f/></c> \r\n   content of b element\r\n   <c>\r\n      <d>not declared in dtd</d>\r\n   </c>\r\n</b></root>\r\n\r\n';
    const canonical =
      "<root><a></a><b>&#10;   <c><f></f></c> &#10;   content of b element&#10;   <c>&#10;      <d>not declared in dtd</d>&#10;   </c>&#10;</b></root>";
    const compact: unknown = {
      root: {
        a: "",
        b: {
          c: [{ f: "" }, { d: "not declared in dtd" }],
          "#text": " \n   content of b element\n   ",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P41-ibm41i01.xml", () => {
    // 3.1 — This test violates VC: Attribute Value Type in P41. attr1 for Element b is not declared.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA|b)* >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!ATTLIST b attr2 (abc|def) "abc">\r\n  <!ATTLIST b attr3 CDATA #FIXED "fixed">\r\n]>\r\n<root>\r\n  <b attr1="value1" attr2="def" attr3="fixed">attr1 not declared</b>\r\n</root>\r\n<!--* testing VC:Attribute Value Type  *-->\r\n';
    const canonical = '<root>&#10;  <b attr1="value1" attr2="def" attr3="fixed">attr1 not declared</b>&#10;</root>';
    const compact: unknown = {
      root: {
        b: {
          "@attr1": "value1",
          "@attr2": "def",
          "@attr3": "fixed",
          "#text": "attr1 not declared",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P41-ibm41i02.xml", () => {
    // 3.1 — This test violates VC: Attribute Value Type in P41. attr3 for Element b is given a value that
    // does not match the declaration in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (PCDATA|b)* >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!ATTLIST b attr1 CDATA #REQUIRED>\r\n  <!ATTLIST b attr2 (abc|def) "abc">\r\n  <!ATTLIST b attr3 CDATA #FIXED "fixed">\r\n]>\r\n<root>\r\n  <b attr1="value1" attr2="abc" attr3="shoudbefixed">attr3 value not fixed</b>\r\n</root>\r\n<!--* testing P41 VC: AtributeValueType*-->\r\n';
    const canonical =
      '<root>&#10;  <b attr1="value1" attr2="abc" attr3="shoudbefixed">attr3 value not fixed</b>&#10;</root>';
    const compact: unknown = {
      root: {
        b: {
          "@attr1": "value1",
          "@attr2": "abc",
          "@attr3": "shoudbefixed",
          "#text": "attr3 value not fixed",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P45-ibm45i01.xml", () => {
    // 3.2 — This test violates VC: Unique Element Type Declaration. Element not_unique has been declared 3
    // time in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA|b)* >\r\n  <!ELEMENT b EMPTY>\r\n  <!ELEMENT not_unique ANY>\r\n  <!ELEMENT not_unique EMPTY>\r\n  <!ELEMENT not_unique (b,b) >\r\n  <!ELEMENT unique. ANY>\r\n  <!ATTLIST b attr1 CDATA #IMPLIED>\r\n  <!ATTLIST b attr2 CDATA #IMPLIED>\r\n  <!ATTLIST b attr3 CDATA #IMPLIED>\r\n]>\r\n<root>\r\n  <b/>without white space\r\n  <b /> with a white space\r\n  <b attr1="value1" />\r\n  <b attr1="value1" attr2="value2" attr3 = "value3"/>\r\n</root>\r\n<!--* a invalid test: testing P45 VC unique element type decl  *-->\r\n';
    const canonical =
      '<root>&#10;  <b></b>without white space&#10;  <b></b> with a white space&#10;  <b attr1="value1"></b>&#10;  <b attr1="value1" attr2="value2" attr3="value3"></b>&#10;</root>';
    const compact: unknown = {
      root: {
        b: ["", "", { "@attr1": "value1" }, { "@attr1": "value1", "@attr2": "value2", "@attr3": "value3" }],
        "#text": "without white space\n   with a white space\n  ",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P49-ibm49i01.xml", () => {
    // 3.2.1 — Violates VC:Proper Group/PE Nesting in P49. Open and close parenthesis for a choice content
    // model are in different PE replace Texts. (upstream: invalid; external parameter entities are not
    // read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm49i01.dtd" [\r\n  <!ELEMENT root (a,b)>\r\n]>\r\n<root><a/><b>\r\n   <c></c >\r\n   content of b element\r\n</b></root>\r\n<!--* a invalid test: tests VC:Proper Group/PE Nesting in P49 *-->\r\n';
    const canonical = "<root><a></a><b>&#10;   <c></c>&#10;   content of b element&#10;</b></root>";
    const compact: unknown = { root: { a: "", b: { c: "", "#text": "\n   content of b element\n" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P50-ibm50i01.xml", () => {
    // 3.2.1 — Violates VC:Proper Group/PE Nesting in P50. Open and close parenthesis for a seq content
    // model are in different PE replace Texts. (upstream: invalid; external parameter entities are not
    // read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm50i01.dtd" [\r\n  <!ELEMENT root (a,b)>\r\n]>\r\n<root><a/><b>\r\n   <c></c >\r\n   content of b element\r\n</b></root>\r\n<!--* a invalid test: tests VC:Proper Group/PE Nesting in P50 *-->\r\n';
    const canonical = "<root><a></a><b>&#10;   <c></c>&#10;   content of b element&#10;</b></root>";
    const compact: unknown = { root: { a: "", b: { c: "", "#text": "\n   content of b element\n" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P51-ibm51i01.xml", () => {
    // 3.2.2 — Violates VC:Proper Group/PE Nesting in P51. Open and close parenthesis for a Mixed content
    // model are in different PE replace Texts. (upstream: invalid; external parameter entities are not
    // read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm51i01.dtd" [\r\n  <!ELEMENT root ANY>\r\n]>\r\n<root>\r\n  <a> Element type a </a>\r\n  <b> Element type b </b>\r\n</root>\r\n<!--* a invalid test: tests P51 VC: Proper Group/PE Nesting *-->';
    const canonical = "<root>&#10;  <a> Element type a </a>&#10;  <b> Element type b </b>&#10;</root>";
    const compact: unknown = { root: { a: " Element type a ", b: " Element type b " } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P51-ibm51i03.xml", () => {
    // 3.2.2 — Violates VC:No Duplicate Types in P51. Element a appears twice in the Mixed content model of
    // Element e.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root ANY>\r\n  <!ELEMENT a (#PCDATA)* >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!ELEMENT c ( #PCDATA)*>\r\n  <!ELEMENT d (#PCDATA|c)* >\r\n  <!--* Duplicate element types in Mixed content decl *-->\r\n  <!ELEMENT e (#PCDATA|a|a|b|c)* >\r\n]>\r\n<root>\r\n  <a> Element type a </a>\r\n  <b> Element type b </b>\r\n</root>\r\n<!--* a invalid test: tests P51 VC: No Duplicate Types *-->\r\n';
    const canonical = "<root>&#10;  <a> Element type a </a>&#10;  <b> Element type b </b>&#10;</root>";
    const compact: unknown = { root: { a: " Element type a ", b: " Element type b " } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i01.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: ID. The value of the ID attribute
    // "UniqueName" is "@999" which does not meet the Name production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(negative Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ATTLIST tokenizer UniqueName ID #REQUIRED>\r\n ]>\r\n<tokenizer UniqueName = "@c999">\r\nThis is a negative test for validity constraints\r\nthe value of the attribute with a type ID does not match the Name production\r\n</tokenizer>';
    const canonical =
      '<tokenizer UniqueName="@c999">&#10;This is a negative test for validity constraints&#10;the value of the attribute with a type ID does not match the Name production&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        "@UniqueName": "@c999",
        "#text":
          "\nThis is a negative test for validity constraints\nthe value of the attribute with a type ID does not match the Name production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i02.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: ID. The two ID attributes "attr" and
    // "UniqueName" have the same value "Ac999" for the element "b" and the element "tokenizer".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(negative Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ELEMENT b EMPTY>\r\n <!ATTLIST b attr ID #REQUIRED>\r\n <!ATTLIST tokenizer UniqueName ID #REQUIRED>\r\n  ]>\r\n<tokenizer UniqueName = "Ac999">\r\n<b attr = "Ac999"></b>\r\nThis is a negative test for validity constraints\r\nthe value of the attribute with a type ID appears more than once in the XML document\r\n</tokenizer>\r\n';
    const canonical =
      '<tokenizer UniqueName="Ac999">&#10;<b attr="Ac999"></b>&#10;This is a negative test for validity constraints&#10;the value of the attribute with a type ID appears more than once in the XML document&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        "@UniqueName": "Ac999",
        b: { "@attr": "Ac999" },
        "#text":
          "\nThis is a negative test for validity constraints\nthe value of the attribute with a type ID appears more than once in the XML document\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i03.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: ID Attribute Default. The "#FIXED"
    // occurs in the DefaultDecl for the ID attribute "UniqueName".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ATTLIST tokenizer UniqueName ID #FIXED "AC1999">\r\n ]>\r\n<tokenizer>\r\nThis is a Negative validity test for ID Attribute Default.\r\nGiving the attribute default as #FIXED\r\n</tokenizer>\r\n';
    const canonical =
      '<tokenizer UniqueName="AC1999">&#10;This is a Negative validity test for ID Attribute Default.&#10;Giving the attribute default as #FIXED&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        "@UniqueName": "AC1999",
        "#text":
          "\nThis is a Negative validity test for ID Attribute Default.\nGiving the attribute default as #FIXED\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i05.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: ID Attribute Default. The constant
    // string "BOGUS" occurs in the DefaultDecl for the ID attribute "UniqueName".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ATTLIST tokenizer UniqueName ID "BOGUS">\r\n ]>\r\n<tokenizer UniqueName = "AC1999">\r\nThis is a Negative validity test for ID Attribute Default.\r\nGiving the attibute default as a const string\r\n</tokenizer>\r\n';
    const canonical =
      '<tokenizer UniqueName="AC1999">&#10;This is a Negative validity test for ID Attribute Default.&#10;Giving the attibute default as a const string&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        "@UniqueName": "AC1999",
        "#text":
          "\nThis is a Negative validity test for ID Attribute Default.\nGiving the attibute default as a const string\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i06.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: One ID per Element Type. The element
    // "a" has two ID attributes "first" and "second".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ELEMENT a EMPTY>\r\n <!ATTLIST a first ID #REQUIRED>\r\n <!ATTLIST a second ID #REQUIRED>\r\n ]>\r\n<tokenizer>\r\n<a first = "AC1999" second="BC1999"></a>\r\nThis is a Negative validity test for ID.\r\nThere is more than attribute of type ID for the element a\r\n\r\n</tokenizer>\r\n';
    const canonical =
      '<tokenizer>&#10;<a first="AC1999" second="BC1999"></a>&#10;This is a Negative validity test for ID.&#10;There is more than attribute of type ID for the element a&#10;&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        a: { "@first": "AC1999", "@second": "BC1999" },
        "#text":
          "\nThis is a Negative validity test for ID.\nThere is more than attribute of type ID for the element a\n\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i07.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: IDREF. The value of the IDREF attribute
    // "reference" is "@456" which does not meet the Name production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT id EMPTY>\r\n <!ELEMENT idref EMPTY>\r\n <!ATTLIST id UniqueName ID #REQUIRED>\r\n <!ATTLIST idref reference IDREF #IMPLIED>\r\n ]>\r\n<test>\r\n<id UniqueName = "AC456"></id>\r\n<idref reference = "@456"></idref>\r\nNegative test for validity constraint of IDREF.\r\nIn an attribute decl, values of type IDREF does not match the name production\r\n</test>';
    const canonical =
      '<test>&#10;<id UniqueName="AC456"></id>&#10;<idref reference="@456"></idref>&#10;Negative test for validity constraint of IDREF.&#10;In an attribute decl, values of type IDREF does not match the name production&#10;</test>';
    const compact: unknown = {
      test: {
        id: { "@UniqueName": "AC456" },
        idref: { "@reference": "@456" },
        "#text":
          "\nNegative test for validity constraint of IDREF.\nIn an attribute decl, values of type IDREF does not match the name production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i08.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: IDREF. The value of the IDREF attribute
    // "reference" is "BC456" which does not match the value assigned to any ID attributes.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT id EMPTY>\r\n <!ELEMENT idref EMPTY>\r\n <!ATTLIST id UniqueName ID #REQUIRED>\r\n <!ATTLIST idref reference IDREF #IMPLIED>\r\n ]>\r\n<test>\r\n<id UniqueName = "AC456"></id>\r\n<idref reference = "BC456"></idref>\r\nNegative test for validity constraint of IDREF.\r\nIn an attribute decl, values of type IDREF match the name production and\r\nIDREF value does not match the value assigned to any ID attribute somewhere\r\nin the XML document.\r\n</test>';
    const canonical =
      '<test>&#10;<id UniqueName="AC456"></id>&#10;<idref reference="BC456"></idref>&#10;Negative test for validity constraint of IDREF.&#10;In an attribute decl, values of type IDREF match the name production and&#10;IDREF value does not match the value assigned to any ID attribute somewhere&#10;in the XML document.&#10;</test>';
    const compact: unknown = {
      test: {
        id: { "@UniqueName": "AC456" },
        idref: { "@reference": "BC456" },
        "#text":
          "\nNegative test for validity constraint of IDREF.\nIn an attribute decl, values of type IDREF match the name production and\nIDREF value does not match the value assigned to any ID attribute somewhere\nin the XML document.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i09.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: IDREFS. The value of the IDREFS
    // attribute "reference" is "AC456 #567" which does not meet the Names production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT id1 EMPTY>\r\n <!ELEMENT id2 EMPTY>\r\n <!ELEMENT idrefs EMPTY>\r\n <!ATTLIST id1 UniqueName ID #REQUIRED>\r\n <!ATTLIST id2 UName ID #IMPLIED>\r\n <!ATTLIST idrefs reference IDREFS #IMPLIED>\r\n ]>\r\n<test>\r\n<id1 UniqueName = "AC456"></id1>\r\n<id2 UName = "BC567"></id2>\r\n<idrefs reference = "AC456 #567"></idrefs>\r\nNegative test for validity constraint of IDREFS.\r\nIn an attribute decl, values of type IDREFS does not match the name production\r\n</test>';
    const canonical =
      '<test>&#10;<id1 UniqueName="AC456"></id1>&#10;<id2 UName="BC567"></id2>&#10;<idrefs reference="AC456 #567"></idrefs>&#10;Negative test for validity constraint of IDREFS.&#10;In an attribute decl, values of type IDREFS does not match the name production&#10;</test>';
    const compact: unknown = {
      test: {
        id1: { "@UniqueName": "AC456" },
        id2: { "@UName": "BC567" },
        idrefs: { "@reference": "AC456 #567" },
        "#text":
          "\nNegative test for validity constraint of IDREFS.\nIn an attribute decl, values of type IDREFS does not match the name production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i10.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: IDREFS. The value of the IDREFS
    // attribute "reference" is "EF456 DE355" which does not match the values assigned to two ID
    // attributes.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT id1 EMPTY>\r\n <!ELEMENT id2 EMPTY>\r\n <!ELEMENT idrefs EMPTY>\r\n <!ATTLIST id1 UniqueName ID #REQUIRED>\r\n <!ATTLIST id2 UName ID #IMPLIED>\r\n <!ATTLIST idrefs reference IDREFS #IMPLIED>\r\n ]>\r\n<test>\r\n<id1 UniqueName = "BC456"></id1>\r\n<id2 UName = "AC567"></id2>\r\n<idrefs reference = "EF456 DE355"></idrefs>\r\nNegative test for validity constraint of IDREFS.\r\nIn an attribute decl, values of type IDREFS match the name production\r\nbut IDREFS value do not match the values assigned to one or more ID attributes\r\nsomewhere in the XML document\r\n</test>';
    const canonical =
      '<test>&#10;<id1 UniqueName="BC456"></id1>&#10;<id2 UName="AC567"></id2>&#10;<idrefs reference="EF456 DE355"></idrefs>&#10;Negative test for validity constraint of IDREFS.&#10;In an attribute decl, values of type IDREFS match the name production&#10;but IDREFS value do not match the values assigned to one or more ID attributes&#10;somewhere in the XML document&#10;</test>';
    const compact: unknown = {
      test: {
        id1: { "@UniqueName": "BC456" },
        id2: { "@UName": "AC567" },
        idrefs: { "@reference": "EF456 DE355" },
        "#text":
          "\nNegative test for validity constraint of IDREFS.\nIn an attribute decl, values of type IDREFS match the name production\nbut IDREFS value do not match the values assigned to one or more ID attributes\nsomewhere in the XML document\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i11.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: Entity Name. The value of the ENTITY
    // attribute "sun" is "ima ge" which does not meet the Name production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT landscape EMPTY>\r\n <!ENTITY image SYSTEM "d:\\testspec\\images\\sunset.gif" NDATA gif>\r\n <!ATTLIST landscape sun ENTITY #IMPLIED>\r\n]>\r\n<test>\r\n<landscape sun = "ima ge"></landscape>\r\nIn the attribute decl, values of type ENTITY do not match the Name production\r\n</test>';
    const canonical =
      '<test>&#10;<landscape sun="ima ge"></landscape>&#10;In the attribute decl, values of type ENTITY do not match the Name production&#10;</test>';
    const compact: unknown = {
      test: {
        landscape: { "@sun": "ima ge" },
        "#text": "\nIn the attribute decl, values of type ENTITY do not match the Name production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i12.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: Entity Name. The value of the ENTITY
    // attribute "sun" is "notimage" which does not match the name of any unparsed entity declared.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT landscape EMPTY>\r\n <!ENTITY image SYSTEM "d:\\testspec\\images\\sunset.gif" NDATA gif>\r\n <!ATTLIST landscape sun ENTITY #IMPLIED>\r\n]>\r\n<test>\r\n<landscape sun = "notimage"></landscape>\r\nIn the attribute decl, values of type ENTITY match the Name production\r\nbut does not match the name of any entity declared in the DTD\r\n</test>';
    const canonical =
      '<test>&#10;<landscape sun="notimage"></landscape>&#10;In the attribute decl, values of type ENTITY match the Name production&#10;but does not match the name of any entity declared in the DTD&#10;</test>';
    const compact: unknown = {
      test: {
        landscape: { "@sun": "notimage" },
        "#text":
          "\nIn the attribute decl, values of type ENTITY match the Name production\nbut does not match the name of any entity declared in the DTD\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i13.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: Entity Name. The value of the ENTITY
    // attribute "sun" is "parsedentity" which matches the name of a parsed entity instead of an unparsed
    // entity declared.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT landscape EMPTY>\r\n <!ENTITY parsedentity SYSTEM "ibm56iv01.xml" >\r\n <!ATTLIST landscape sun ENTITY #IMPLIED>\r\n]>\r\n<test>\r\n<landscape sun = "parsedentity"></landscape>\r\nIn an attribute declaration, values of type ENTITY match the Name production and the ENTITY value\r\nmatches the name of a parsed entity declared in the DTD. \r\n</test>';
    const canonical =
      '<test>&#10;<landscape sun="parsedentity"></landscape>&#10;In an attribute declaration, values of type ENTITY match the Name production and the ENTITY value&#10;matches the name of a parsed entity declared in the DTD. &#10;</test>';
    const compact: unknown = {
      test: {
        landscape: { "@sun": "parsedentity" },
        "#text":
          "\nIn an attribute declaration, values of type ENTITY match the Name production and the ENTITY value\nmatches the name of a parsed entity declared in the DTD. \n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i14.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: Entity Name. The value of the ENTITIES
    // attribute "sun" is "#image1 @image" which does not meet the Names production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT landscape EMPTY>\r\n <!ENTITY image1 SYSTEM "d:\\testspec\\images\\sunset.gif" NDATA gif>\r\n <!ENTITY image2 SYSTEM "d:\\testspec\\images\\frontpage.gif" NDATA gif>\r\n <!ATTLIST landscape sun ENTITIES #IMPLIED>\r\n]>\r\n<test>\r\n<landscape sun = "#image1 @image"></landscape>\r\nIn an attribute declaration, values of type ENTITIES do not match the Name production.\r\n</test>';
    const canonical =
      '<test>&#10;<landscape sun="#image1 @image"></landscape>&#10;In an attribute declaration, values of type ENTITIES do not match the Name production.&#10;</test>';
    const compact: unknown = {
      test: {
        landscape: { "@sun": "#image1 @image" },
        "#text": "\nIn an attribute declaration, values of type ENTITIES do not match the Name production.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i15.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: ENTITIES. The value of the ENTITIES
    // attribute "sun" is "image3 image4" which does not match the names of two unparsed entities declared.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT landscape EMPTY>\r\n <!ENTITY image1 SYSTEM "d:\\testspec\\images\\sunset.gif" NDATA gif>\r\n <!ENTITY image2 SYSTEM "d:\\testspec\\images\\frontpag.gif" NDATA gif>\r\n <!ATTLIST landscape sun ENTITIES #IMPLIED>\r\n]>\r\n<test>\r\n<landscape sun = "image3 image4"></landscape>\r\nIn an attribute declaration, values of type ENTITIES match the Name production and the ENTITIES value\r\ndoes not match one or more names of entities declared in the DTD. \r\n</test>';
    const canonical =
      '<test>&#10;<landscape sun="image3 image4"></landscape>&#10;In an attribute declaration, values of type ENTITIES match the Name production and the ENTITIES value&#10;does not match one or more names of entities declared in the DTD. &#10;</test>';
    const compact: unknown = {
      test: {
        landscape: { "@sun": "image3 image4" },
        "#text":
          "\nIn an attribute declaration, values of type ENTITIES match the Name production and the ENTITIES value\ndoes not match one or more names of entities declared in the DTD. \n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i16.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: ENTITIES. The value of the ENTITIES
    // attribute "sun" is "parsedentity1 parsedentity2" which matches the names of two parsed entities
    // instead of two unparsed entities declared.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT landscape EMPTY>\r\n <!ENTITY parsedentity1 SYSTEM "ibm56iv01.xml">\r\n <!ENTITY parsedentity2 SYSTEM "ibm56iv02.xml">\r\n <!ATTLIST landscape sun ENTITIES #IMPLIED>\r\n]>\r\n<test>\r\n<landscape sun = "parsedentity1 parsedentity2"></landscape>\r\nIn an attribute declaration, values of type ENTITIES match the Name production and the ENTITIES value\r\nmatches one or more names of parsed entities declared in the DTD. .\r\n</test>';
    const canonical =
      '<test>&#10;<landscape sun="parsedentity1 parsedentity2"></landscape>&#10;In an attribute declaration, values of type ENTITIES match the Name production and the ENTITIES value&#10;matches one or more names of parsed entities declared in the DTD. .&#10;</test>';
    const compact: unknown = {
      test: {
        landscape: { "@sun": "parsedentity1 parsedentity2" },
        "#text":
          "\nIn an attribute declaration, values of type ENTITIES match the Name production and the ENTITIES value\nmatches one or more names of parsed entities declared in the DTD. .\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i17.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: Name Token. The value of the NMTOKEN
    // attribute "thistoken" is "x : image" which does not meet the Nmtoken production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT nametoken EMPTY>\r\n <!ATTLIST nametoken thistoken NMTOKEN #IMPLIED>\r\n]>\r\n<test>\r\n<nametoken thistoken = "x : image"></nametoken>\r\nIn an attribute declaration, values of type NMTOKEN does not match the Nmtoken production\r\n</test>';
    const canonical =
      '<test>&#10;<nametoken thistoken="x : image"></nametoken>&#10;In an attribute declaration, values of type NMTOKEN does not match the Nmtoken production&#10;</test>';
    const compact: unknown = {
      test: {
        nametoken: { "@thistoken": "x : image" },
        "#text": "\nIn an attribute declaration, values of type NMTOKEN does not match the Nmtoken production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P56-ibm56i18.xml", () => {
    // 3.3.1 — Tests invalid TokenizedType which is against P56 VC: Name Token. The value of the NMTOKENS
    // attribute "thistoken" is "@lang y: #country" which does not meet the Nmtokens production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Negative Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT nametokens EMPTY>\r\n <!ATTLIST nametokens thistoken NMTOKENS #IMPLIED>\r\n]>\r\n<test>\r\n<nametokens thistoken = "@lang y: #country"></nametokens>\r\nIn an attribute declaration, values of type NMTOKENS does not match the Nmtokens production\r\n</test>';
    const canonical =
      '<test>&#10;<nametokens thistoken="@lang y: #country"></nametokens>&#10;In an attribute declaration, values of type NMTOKENS does not match the Nmtokens production&#10;</test>';
    const compact: unknown = {
      test: {
        nametokens: { "@thistoken": "@lang y: #country" },
        "#text": "\nIn an attribute declaration, values of type NMTOKENS does not match the Nmtokens production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P58-ibm58i01.xml", () => {
    // 3.3.1 — Tests invalid NotationType which is against P58 VC: Notation Attributes. The attribute
    // "content-encoding" with value "raw" is not a value from the list "(base64|uuencode)".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 58(Negative Test-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT blob (#PCDATA)>\r\n <!NOTATION base64 SYSTEM "mimecode">\r\n <!NOTATION uuencode SYSTEM "uudecode">\r\n <!NOTATION raw SYSTEM "raw">\r\n <!ATTLIST blob content-encoding NOTATION (base64|uuencode) #REQUIRED>\r\n ]>\r\n <test>\r\n<blob content-encoding = "raw"></blob>\r\nThe attribute values of type NOTATION does not match any of the notation names included in the\r\ndeclaration.All notation names in the declaration have been declared.\r\n</test>';
    const canonical =
      '<test>&#10;<blob content-encoding="raw"></blob>&#10;The attribute values of type NOTATION does not match any of the notation names included in the&#10;declaration.All notation names in the declaration have been declared.&#10;</test>';
    const compact: unknown = {
      test: {
        blob: { "@content-encoding": "raw" },
        "#text":
          "\nThe attribute values of type NOTATION does not match any of the notation names included in the\ndeclaration.All notation names in the declaration have been declared.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P58-ibm58i02.xml", () => {
    // 3.3.1 — Tests invalid NotationType which is against P58 VC: Notation Attributes. The attribute
    // "content-encoding" with value "raw" is a value from the list "(base64|uuencode|raw|ascii)", but
    // "raw" is not a declared notation.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 58(Negative Test-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT blob (#PCDATA)>\r\n <!NOTATION base64 SYSTEM "mimecode">\r\n <!NOTATION uuencode SYSTEM "uudecode">\r\n <!ATTLIST blob content-encoding NOTATION (base64|uuencode|raw|ascii) #REQUIRED>\r\n ]>\r\n <test>\r\n<blob content-encoding = "raw"></blob>\r\nThe attribute values of type NOTATION does match any of the notation names included in the\r\ndeclaration, but some of notation names in the declaration have not been declared\r\n</test>';
    const canonical =
      '<test>&#10;<blob content-encoding="raw"></blob>&#10;The attribute values of type NOTATION does match any of the notation names included in the&#10;declaration, but some of notation names in the declaration have not been declared&#10;</test>';
    const compact: unknown = {
      test: {
        blob: { "@content-encoding": "raw" },
        "#text":
          "\nThe attribute values of type NOTATION does match any of the notation names included in the\ndeclaration, but some of notation names in the declaration have not been declared\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P59-ibm59i01.xml", () => {
    // 3.3.1 — Tests invalid Enumeration which is against P59 VC: Enumeration. The value of the attribute
    // is "ONE" which matches neither "one" nor "two" as declared in the Enumeration in the AttDef in the
    // AttlistDecl.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!ELEMENT num EMPTY>\r\n <!ATTLIST num value (one|two) #IMPLIED>\r\n ]>\r\n <test>\r\n<num value = "ONE"></num>\r\nThis is a Negative test\r\nThe attribute values of type Enumeration does not match any of the Nmtoken tokens in the declaration.\r\n</test>';
    const canonical =
      '<test>&#10;<num value="ONE"></num>&#10;This is a Negative test&#10;The attribute values of type Enumeration does not match any of the Nmtoken tokens in the declaration.&#10;</test>';
    const compact: unknown = {
      test: {
        num: { "@value": "ONE" },
        "#text":
          "\nThis is a Negative test\nThe attribute values of type Enumeration does not match any of the Nmtoken tokens in the declaration.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P60-ibm60i01.xml", () => {
    // 3.3.2 — Tests invalid DefaultDecl which is against P60 VC: Required Attribute. The attribute
    // "chapter" for the element "two" is declared as #REQUIRED in the DefaultDecl in the AttlistDecl, but
    // the value of this attribute is not given.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!ATTLIST one chapter CDATA #REQUIRED>\r\n <!ATTLIST two chapter CDATA #REQUIRED>\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\n<two></two>\r\nNegative test for Required Attribute. Some occurrence of an element with \r\nan attribute of #REQUIRED default declaration does not give the value of \r\nthose attribute\r\n</Java>';
    const canonical =
      '<Java>&#10;<one chapter="Introduction"></one>&#10;<two></two>&#10;Negative test for Required Attribute. Some occurrence of an element with &#10;an attribute of #REQUIRED default declaration does not give the value of &#10;those attribute&#10;</Java>';
    const compact: unknown = {
      Java: {
        one: { "@chapter": "Introduction" },
        two: "",
        "#text":
          "\nNegative test for Required Attribute. Some occurrence of an element with \nan attribute of #REQUIRED default declaration does not give the value of \nthose attribute\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P60-ibm60i02.xml", () => {
    // 3.3.2 — Tests invalid DefaultDecl which is against P60 VC: Fixed Attribute Default.. The attribute
    // "chapter" for the element "one" is declared as #FIXED with the given value "Introduction" in the
    // DefaultDecl in the AttlistDecl, but the value of a instance of this attribute is assigned to
    // "JavaBeans".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA #FIXED "Introduction">\r\n  ]>\r\n<Java>\r\n<one chapter="JavaBeans"></one>\r\nNegative Test\r\nAn attribute has a default value declared with the #FIXED keyword, \r\nand an instances of that attribute is given a value which is not \r\nthe same as the default value in the declaration. \r\n</Java>\r\n';
    const canonical =
      '<Java>&#10;<one chapter="JavaBeans"></one>&#10;Negative Test&#10;An attribute has a default value declared with the #FIXED keyword, &#10;and an instances of that attribute is given a value which is not &#10;the same as the default value in the declaration. &#10;</Java>';
    const compact: unknown = {
      Java: {
        one: { "@chapter": "JavaBeans" },
        "#text":
          "\nNegative Test\nAn attribute has a default value declared with the #FIXED keyword, \nand an instances of that attribute is given a value which is not \nthe same as the default value in the declaration. \n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P60-ibm60i03.xml", () => {
    // 3.3.2 — Tests invalid DefaultDecl which is against P60 VC: Attribute Default Legal. The declared
    // default value "c" is not legal for the type (a|b) in the AttDef in the AttlistDecl.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 60-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT a EMPTY>\r\n <!ELEMENT b EMPTY>\r\n <!ELEMENT attr EMPTY>\r\n <!ATTLIST attr value (a|b) "c"> \r\n  ]>\r\n<test>\r\nThe default value specified for an attribute does not meet the \r\nlexical constraints of the declared attribute type.\r\n</test>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n';
    const canonical =
      "<test>&#10;The default value specified for an attribute does not meet the &#10;lexical constraints of the declared attribute type.&#10;</test>";
    const compact: unknown = {
      test: "\nThe default value specified for an attribute does not meet the \nlexical constraints of the declared attribute type.\n",
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P60-ibm60i04.xml", () => {
    // 3.3.2 — Tests invalid DefaultDecl which is against P60 VC: Attribute Default Legal. The declared
    // default value "@#$" is not legal for the type NMTOKEN the AttDef in the AttlistDecl.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 60-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT a EMPTY>\r\n <!ELEMENT nametoken EMPTY>\r\n <!ATTLIST nametoken namevalue NMTOKEN "@#$"> \r\n  ]>\r\n<test>\r\nThe default value specified for an attribute does not meet the \r\nlexical constraints of the declared attribute type.\r\n</test>\r\n';
    const canonical =
      "<test>&#10;The default value specified for an attribute does not meet the &#10;lexical constraints of the declared attribute type.&#10;</test>";
    const compact: unknown = {
      test: "\nThe default value specified for an attribute does not meet the \nlexical constraints of the declared attribute type.\n",
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P68-ibm68i01.xml", () => {
    // 4.1 — Tests invalid EntityRef which is against P68 VC: Entity Declared. The GE with the name "ge2"
    // is referred in the file ibm68i01.dtd", but not declared. (upstream: optional error)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm68i01.dtd" [\r\n  <!ELEMENT root (#PCDATA|a)* >\r\n]>\r\n<root>\r\n  pcdata content\r\n  <a attr1="xyz"/>\r\n</root>\r\n<!--* a invalid test for P68 VC:Entity Declared *-->\r\n\r\n';
    const canonical = '<root>&#10;  pcdata content&#10;  <a attr1="xyz"></a>&#10;</root>';
    const compact: unknown = { root: { "#text": "\n  pcdata content\n  ", a: { "@attr1": "xyz" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P68-ibm68i02.xml", () => {
    // 4.1 — Tests invalid EntityRef which is against P68 VC: Entity Declared. The GE with the name "ge1"
    // is referred before declared in the file ibm68i01.dtd". (upstream: optional error)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm68i02.dtd" [\r\n  <!ELEMENT root (#PCDATA|a)* >\r\n]>\r\n<root>\r\n  pcdata content\r\n  <a attr1="xyz"/>\r\n</root>\r\n<!--* a invalid test for P68 VC:Entity Declared *-->\r\n\r\n';
    const canonical = '<root>&#10;  pcdata content&#10;  <a attr1="xyz"></a>&#10;</root>';
    const compact: unknown = { root: { "#text": "\n  pcdata content\n  ", a: { "@attr1": "xyz" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P68-ibm68i03.xml", () => {
    // 4.1 — Tests invalid EntityRef which is against P68 VC: Entity Declared. The GE with the name "ge2"
    // is referred in the file ibm68i03.ent", but not declared. (upstream: optional error)
    const input: string =
      '<?xml version="1.0" standalone=\'no\'?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA)* >\r\n  <!ENTITY % pe1 SYSTEM "ibm68i03.ent">\r\n  %pe1;\r\n]>\r\n<root>\r\n  pcdata content\r\n</root>\r\n<!--* a invalid test for P68 VC:Entity Declared *-->\r\n';
    const canonical = "<root>&#10;  pcdata content&#10;</root>";
    const compact: unknown = { root: "\n  pcdata content\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P68-ibm68i04.xml", () => {
    // 4.1 — Tests invalid EntityRef which is against P68 VC: Entity Declared. The GE with the name "ge1"
    // is referred before declared in the file ibm68i04.ent". (upstream: optional error)
    const input: string =
      '<?xml version="1.0" standalone=\'no\'?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA)* >\r\n  <!ENTITY % pe1 SYSTEM "ibm68i04.ent">\r\n  %pe1;\r\n]>\r\n<root>\r\n  pcdata content\r\n</root>\r\n<!--* a invalid test for P68 VC:Entity Declared *-->\r\n';
    const canonical = "<root>&#10;  pcdata content&#10;</root>";
    const compact: unknown = { root: "\n  pcdata content\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P69-ibm69i01.xml", () => {
    // 4.1 — Tests invalid PEReference which is against P69 VC: Entity Declared. The Name "pe2" in the
    // PEReference in the file ibm69i01.dtd does not match the Name of any declared PE. (upstream: optional
    // error)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm69i01.dtd" [\r\n  <!ELEMENT root (#PCDATA|a)* >\r\n]>\r\n<root>\r\n  pcdata content\r\n  <a attr1="xyz"/>\r\n</root>\r\n<!--* a invalid test for P69 VC:Entity Declared *-->\r\n\r\n';
    const canonical = '<root>&#10;  pcdata content&#10;  <a attr1="xyz"></a>&#10;</root>';
    const compact: unknown = { root: { "#text": "\n  pcdata content\n  ", a: { "@attr1": "xyz" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P69-ibm69i02.xml", () => {
    // 4.1 — Tests invalid PEReference which is against P69 VC: Entity Declared. The PE with the name "pe1"
    // is referred before declared in the file ibm69i02.dtd (upstream: optional error)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm69i02.dtd" [\r\n  <!ELEMENT root (#PCDATA|a)* >\r\n]>\r\n<root>\r\n  pcdata content\r\n  <a attr1="xyz"/>\r\n</root>\r\n<!--* a invalid test for P69 VC:Entity Declared *-->\r\n\r\n';
    const canonical = '<root>&#10;  pcdata content&#10;  <a attr1="xyz"></a>&#10;</root>';
    const compact: unknown = { root: { "#text": "\n  pcdata content\n  ", a: { "@attr1": "xyz" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P69-ibm69i03.xml", () => {
    // 4.1 — Tests invalid PEReference which is against P69 VC: Entity Declared. The Name "pe3" in the
    // PEReference in the file ibm69i03.ent does not match the Name of any declared PE. (upstream: optional
    // error)
    const input: string =
      '<?xml version="1.0" standalone=\'no\'?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA)* >\r\n  <!ENTITY % pe1 SYSTEM "ibm69i03.ent">\r\n  %pe1;\r\n]>\r\n<root>\r\n  pcdata content\r\n</root>\r\n<!--* a invalid test for P69 VC:Entity Declared *-->\r\n';
    const canonical = "<root>&#10;  pcdata content&#10;</root>";
    const compact: unknown = { root: "\n  pcdata content\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P69-ibm69i04.xml", () => {
    // 4.1 — Tests invalid PEReference which is against P69 VC: Entity Declared. The PE with the name "pe2"
    // is referred before declared in the file ibm69i04.ent. (upstream: optional error)
    const input: string =
      '<?xml version="1.0" standalone=\'no\'?>\r\n<!DOCTYPE root  [\r\n  <!ELEMENT root (#PCDATA)* >\r\n  <!ENTITY % pe1 SYSTEM "ibm69i04.ent">\r\n  %pe1;\r\n]>\r\n<root>\r\n  pcdata content\r\n</root>\r\n<!--* a invalid test for P69 VC:Entity Declared *-->\r\n';
    const canonical = "<root>&#10;  pcdata content&#10;</root>";
    const compact: unknown = { root: "\n  pcdata content\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-invalid-P76-ibm76i01.xml", () => {
    // 4.2.2 — Tests invalid NDataDecl which is against P76 VC: Notation declared. The Name "JPGformat" in
    // the NDataDecl in the EntityDecl for "ge2" does not match the Name of any declared notation.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n<!ENTITY % pe1 \'<!ATTLIST root att2 CDATA "&ge1;">\'>\r\n<!ENTITY ge1 "attdefaultvalue" >\r\n%pe1;\r\n\r\n<!--* notation JPGformat not declared *-->\r\n<!ENTITY ge2  SYSTEM "image.jpg" NDATA JPGformat>\r\n\r\n]>\r\n<root att2="any" />\r\n<!-- a invalid test case: test P76 VC: Notation Declared -->';
    const canonical = '<root att2="any"></root>';
    const compact: unknown = { root: { "@att2": "any" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-not-wf-P01-ibm01n01.xml", () => {
    // 2.1 — Tests a document with no element. A well-formed document should have at lease one elements.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE book [\r\n   <!ELEMENT book ANY>\r\n]>\r\n<!-- element is missing -->';
    expectRejects(input, "XML Parse error: XML document must have a root element");
  });

  test("ibm-not-wf-P01-ibm01n02.xml", () => {
    // 2.1 — Tests a document with wrong ordering of its prolog and element. The element occurs before the
    // xml declaration and the DTD.
    const input: string =
      '<doc>Wrong ordering between prolog and element!</doc>\r\n<?xml version="1.0"?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc ANY>\r\n]>';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P01-ibm01n03.xml", () => {
    // 2.1 — Tests a document with wrong combination of misc and element. One PI occurs between two
    // elements.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc ANY>\r\n   <!ELEMENT title ANY>\r\n]>\r\n<doc>Wrong combination!</doc>\r\n<?PI after document element?>\r\n<title>Wrong combination!</title>\r\n<?PI after title element?>\r\n';
    expectRejects(input, "XML Parse error: Only one root element is allowed");
  });

  test("ibm-not-wf-P02-ibm02n01.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x00
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x00\r\n in p02: \u0000 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x00");
  });

  test("ibm-not-wf-P02-ibm02n02.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x01
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x01\r\n in p02: \u0001 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x01");
  });

  test("ibm-not-wf-P02-ibm02n03.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x02
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x02\r\n in p02: \u0002 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x02");
  });

  test("ibm-not-wf-P02-ibm02n04.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x03
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x03\r\n in p02: \u0003 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x03");
  });

  test("ibm-not-wf-P02-ibm02n05.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x04
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x04\r\n in p02: \u0004 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x04");
  });

  test("ibm-not-wf-P02-ibm02n06.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x05
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x05\r\n in p02: \u0005 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x05");
  });

  test("ibm-not-wf-P02-ibm02n07.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x06
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x06\r\n in p02: \u0006 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x06");
  });

  test("ibm-not-wf-P02-ibm02n08.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x07
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x07\r\n in p02: \u0007 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x07");
  });

  test("ibm-not-wf-P02-ibm02n09.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x08
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x08\r\n in p02: \b -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x08");
  });

  test("ibm-not-wf-P02-ibm02n10.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x0B
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x0b\r\n in p02: \u000b -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0B");
  });

  test("ibm-not-wf-P02-ibm02n11.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x0C
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x0c\r\n in p02: \f -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0C");
  });

  test("ibm-not-wf-P02-ibm02n12.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x0E
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x0e\r\n in p02: \u000e -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0E");
  });

  test("ibm-not-wf-P02-ibm02n13.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x0F
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x0f\r\n in p02: \u000f -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0F");
  });

  test("ibm-not-wf-P02-ibm02n14.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x10
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x10\r\n in p02: \u0010 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x10");
  });

  test("ibm-not-wf-P02-ibm02n15.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x11
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x11\r\n in p02: \u0011 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x11");
  });

  test("ibm-not-wf-P02-ibm02n16.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x12
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x12\r\n in p02: \u0012 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x12");
  });

  test("ibm-not-wf-P02-ibm02n17.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x13
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x13\r\n in p02: \u0013 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x13");
  });

  test("ibm-not-wf-P02-ibm02n18.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x14
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x14\r\n in p02: \u0014 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x14");
  });

  test("ibm-not-wf-P02-ibm02n19.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x15
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x15\r\n in p02: \u0015 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x15");
  });

  test("ibm-not-wf-P02-ibm02n20.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x16
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x16\r\n in p02: \u0016 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x16");
  });

  test("ibm-not-wf-P02-ibm02n21.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x17
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x17\r\n in p02: \u0017 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x17");
  });

  test("ibm-not-wf-P02-ibm02n22.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x18
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x18\r\n in p02: \u0018 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x18");
  });

  test("ibm-not-wf-P02-ibm02n23.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x19
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x19\r\n in p02: \u0019 -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x19");
  });

  test("ibm-not-wf-P02-ibm02n24.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x1A
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x1a\r\n in p02: \u001a -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1A");
  });

  test("ibm-not-wf-P02-ibm02n25.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x1B
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x1b\r\n in p02: \u001b -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1B");
  });

  test("ibm-not-wf-P02-ibm02n26.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x1C
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x1c\r\n in p02: \u001c -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1C");
  });

  test("ibm-not-wf-P02-ibm02n27.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x1D
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x1d\r\n in p02: \u001d -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1D");
  });

  test("ibm-not-wf-P02-ibm02n28.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x1E
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x1e\r\n in p02: \u001e -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1E");
  });

  test("ibm-not-wf-P02-ibm02n29.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #x1F
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x1f\r\n in p02: \u001f -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x1F");
  });

  test("ibm-not-wf-P02-ibm02n30.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #xD800
    const input = Buffer.from(
      "PCFET0NUWVBFIGJvb2sgWw0KPCFFTEVNRU5UIGJvb2sgQU5ZPg0KXT4NCjwhLS0gSWxsZWdhbENoYXIgI3hkODAwDQogaW4gcDAyOiDtoIAgLS0+DQo8Ym9vay8+DQo=",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("ibm-not-wf-P02-ibm02n31.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #xDFFF
    const input = Buffer.from(
      "PCFET0NUWVBFIGJvb2sgWw0KPCFFTEVNRU5UIGJvb2sgQU5ZPg0KXT4NCjwhLS0gSWxsZWdhbENoYXIgI3hkZmZmDQogaW4gcDAyOiDtv78gLS0+DQo8Ym9vay8+DQo=",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("ibm-not-wf-P02-ibm02n32.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #xFFFE
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #xfffe\r\n in p02: \ufffe -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\ufffe' (U+FFFE)");
  });

  test("ibm-not-wf-P02-ibm02n33.xml", () => {
    // 2.2 — Tests a comment which contains an illegal Char: #xFFFF
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #xffff\r\n in p02: \uffff -->\r\n<book/>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("ibm-not-wf-P03-ibm03n01.xml", () => {
    // 2.3 — Tests an end tag which contains an illegal space character #x3000 which follows the element
    // name "book".
    const input: string =
      "<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n]>\r\n<!-- IllegalChar #x3000\r\n in p03: 　 -->\r\n<book>Illegal space 3000 in the end tag</book 　>\r\n";
    expectRejects(input, "XML Parse error: Expected '>' to end the closing tag but found '　' (U+3000)");
  });

  test("ibm-not-wf-P04-ibm04n01.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x21
    const input: string =
      "<!DOCTYPE IllegalNameChar! [\r\n   <!ELEMENT IllegalNameChar! EMPTY>\r\n]>\r\n<IllegalNameChar!/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '!'",
    );
  });

  test("ibm-not-wf-P04-ibm04n02.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x28
    const input: string =
      "<!DOCTYPE IllegalNameChar( [\r\n   <!ELEMENT IllegalNameChar( EMPTY>\r\n]>\r\n<IllegalNameChar(/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '('",
    );
  });

  test("ibm-not-wf-P04-ibm04n03.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x29
    const input: string =
      "<!DOCTYPE IllegalNameChar) [\r\n   <!ELEMENT IllegalNameChar) EMPTY>\r\n]>\r\n<IllegalNameChar)/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ')'",
    );
  });

  test("ibm-not-wf-P04-ibm04n04.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x2B
    const input: string =
      "<!DOCTYPE IllegalNameChar+ [\r\n   <!ELEMENT IllegalNameChar+ EMPTY>\r\n]>\r\n<IllegalNameChar+/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '+'",
    );
  });

  test("ibm-not-wf-P04-ibm04n05.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x2C
    const input: string =
      "<!DOCTYPE IllegalNameChar, [\r\n   <!ELEMENT IllegalNameChar, EMPTY>\r\n]>\r\n<IllegalNameChar,/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ','",
    );
  });

  test("ibm-not-wf-P04-ibm04n06.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x2F
    const input: string =
      "<!DOCTYPE IllegalNameChar/ [\r\n   <!ELEMENT IllegalNameChar/ EMPTY>\r\n]>\r\n<IllegalNameChar//>\r\n\r\n";
    expectRejects(input, "XML Parse error: Expected '>' after '/' but found space");
  });

  test("ibm-not-wf-P04-ibm04n07.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x3B
    const input: string =
      "<!DOCTYPE IllegalNameChar; [\r\n   <!ELEMENT IllegalNameChar; EMPTY>\r\n]>\r\n<IllegalNameChar;/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ';'",
    );
  });

  test("ibm-not-wf-P04-ibm04n08.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x3C
    const input: string =
      "<!DOCTYPE IllegalNameChar< [\r\n   <!ELEMENT IllegalNameChar< EMPTY>\r\n]>\r\n<IllegalNameChar</>\r\n\r\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found space");
  });

  test("ibm-not-wf-P04-ibm04n09.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x3D
    const input: string =
      "<!DOCTYPE IllegalNameChar= [\r\n   <!ELEMENT IllegalNameChar= EMPTY>\r\n]>\r\n<IllegalNameChar=/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '='",
    );
  });

  test("ibm-not-wf-P04-ibm04n10.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x3F
    const input: string =
      "<!DOCTYPE IllegalNameChar? [\r\n   <!ELEMENT IllegalNameChar? EMPTY>\r\n]>\r\n<IllegalNameChar?/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '?'",
    );
  });

  test("ibm-not-wf-P04-ibm04n11.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x5B
    const input: string =
      "<!DOCTYPE IllegalNameChar[ [\r\n   <!ELEMENT IllegalNameChar[ EMPTY>\r\n]>\r\n<IllegalNameChar[/>\r\n\r\n";
    expectRejects(input, "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '['");
  });

  test("ibm-not-wf-P04-ibm04n12.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x5C
    const input: string =
      "<!DOCTYPE IllegalNameChar\\ [\r\n   <!ELEMENT IllegalNameChar\\ EMPTY>\r\n]>\r\n<IllegalNameChar\\/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '\\'",
    );
  });

  test("ibm-not-wf-P04-ibm04n13.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x5D
    const input: string =
      "<!DOCTYPE IllegalNameChar] [\r\n   <!ELEMENT IllegalNameChar] EMPTY>\r\n]>\r\n<IllegalNameChar]/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ']'",
    );
  });

  test("ibm-not-wf-P04-ibm04n14.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x5E
    const input: string =
      "<!DOCTYPE IllegalNameChar^ [\r\n   <!ELEMENT IllegalNameChar^ EMPTY>\r\n]>\r\n<IllegalNameChar^/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '^'",
    );
  });

  test("ibm-not-wf-P04-ibm04n15.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x60
    const input: string =
      "<!DOCTYPE IllegalNameChar` [\r\n   <!ELEMENT IllegalNameChar` EMPTY>\r\n]>\r\n<IllegalNameChar`/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '`'",
    );
  });

  test("ibm-not-wf-P04-ibm04n16.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x7B
    const input: string =
      "<!DOCTYPE IllegalNameChar{ [\r\n   <!ELEMENT IllegalNameChar{ EMPTY>\r\n]>\r\n<IllegalNameChar{/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '{'",
    );
  });

  test("ibm-not-wf-P04-ibm04n17.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x7C
    const input: string =
      "<!DOCTYPE IllegalNameChar| [\r\n   <!ELEMENT IllegalNameChar| EMPTY>\r\n]>\r\n<IllegalNameChar|/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '|'",
    );
  });

  test("ibm-not-wf-P04-ibm04n18.xml", () => {
    // 2.3 — Tests an element name which contains an illegal ASCII NameChar. "IllegalNameChar" is followed
    // by #x7D
    const input: string =
      "<!DOCTYPE IllegalNameChar} [\r\n   <!ELEMENT IllegalNameChar} EMPTY>\r\n]>\r\n<IllegalNameChar}/>\r\n\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '}'",
    );
  });

  test("ibm-not-wf-P05-ibm05n01.xml", () => {
    // 2.3 — Tests an element name which has an illegal first character. An illegal first character "." is
    // followed by "A_name-starts_with.".
    const input: string =
      "<!DOCTYPE .A_name_starts_with. [\r\n   <!ELEMENT .A_name_starts_with. EMPTY>\r\n]>\r\n<.A_name_starts_with./>  \r\n";
    expectRejects(input, "XML Parse error: Expected the document type name but found '.A_name_starts_with.'");
  });

  test("ibm-not-wf-P05-ibm05n02.xml", () => {
    // 2.3 — Tests an element name which has an illegal first character. An illegal first character "-" is
    // followed by "A_name-starts_with-".
    const input: string =
      "<!DOCTYPE -A_name_starts_With- [\r\n   <!ELEMENT -A_name_starts_With- EMPTY>\r\n]>\r\n<-A_name_starts_With-/>  \r\n";
    expectRejects(input, "XML Parse error: Expected the document type name but found '-A_name_starts_With-'");
  });

  test("ibm-not-wf-P05-ibm05n03.xml", () => {
    // 2.3 — Tests an element name which has an illegal first character. An illegal first character "5" is
    // followed by "A_name-starts_with_digit".
    const input: string =
      "<!DOCTYPE 5A_name_starts_with_digit [\r\n   <!ELEMENT 5A_name_starts_with_digit EMPTY>\r\n]>\r\n<5A_name_starts_with_digit/>  \r\n";
    expectRejects(input, "XML Parse error: Expected the document type name but found '5A_name_starts_with_digit'");
  });

  test("ibm-not-wf-P09-ibm09n01.xml", () => {
    // 2.3 — Tests an internal general entity with an invalid value. The entity "Fullname" contains "%".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n \t<!ENTITY FullName "Snow%Man">\r\n]>\r\n\r\n<!-- testing invalid entity value -->\r\n<student>My Name is &FullName;. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found '\"'");
  });

  test("ibm-not-wf-P09-ibm09n02.xml", () => {
    // 2.3 — Tests an internal general entity with an invalid value. The entity "Fullname" contains the
    // ampersand character.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n \t<!ENTITY FullName "Snow&Man">\r\n]>\r\n\r\n<!-- testing invalid entity value -->\r\n<student>My Name is &FullName;. </student>';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found '\"'");
  });

  test("ibm-not-wf-P09-ibm09n03.xml", () => {
    // 2.3 — Tests an internal general entity with an invalid value. The entity "Fullname" contains the
    // double quote character in the middle.
    const input: string =
      '<?xml version="1.0"?> \r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ENTITY FullName "Snow"Man"> \r\n]>\r\n\r\n<!-- testing invalid entity value -->\r\n<student>My Name is &FullName;. </student>';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'Man'");
  });

  test("ibm-not-wf-P09-ibm09n04.xml", () => {
    // 2.3 — Tests an internal general entity with an invalid value. The closing bracket (double quote) is
    // missing with the value of the entity "FullName".
    const input: string =
      '<?xml version="1.0"?> \r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ENTITY FullName "SnowMan> \r\n]>\r\n\r\n<!-- testing invalid entity value -->\r\n<student>My Name is &FullName;. </student>\r\n';
    expectRejects(input, "XML Parse error: Unterminated entity value");
  });

  test("ibm-not-wf-P10-ibm10n01.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The value of the attribute "first" contains the
    // character "less than".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue -->\r\n<student first="Snow<Man">My Name is SnowMan. </student>\r\n\r\n\r\n\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("ibm-not-wf-P10-ibm10n02.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The value of the attribute "first" contains the
    // character ampersand.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue -->\r\n<student first="Snow&Man">My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found '\"'");
  });

  test("ibm-not-wf-P10-ibm10n03.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The value of the attribute "first" contains the
    // double quote character in the middle.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue -->\r\n<student first="Snow"Man">My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'Man'");
  });

  test("ibm-not-wf-P10-ibm10n04.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The closing bracket (double quote) is missing with
    // The value of the attribute "first".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue with no closing bracket -->\r\n<student first="Snow >My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("ibm-not-wf-P10-ibm10n05.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The value of the attribute "first" contains the
    // character "less than".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "SNow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue -->\r\n<student first=\'Snow<Man\'>My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("ibm-not-wf-P10-ibm10n06.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The value of the attribute "first" contains the
    // character ampersand.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue -->\r\n<student first=\'Snow&Man\'>My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found '''");
  });

  test("ibm-not-wf-P10-ibm10n07.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The value of the attribute "first" contains the
    // double quote character in the middle.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue -->\r\n<student first="Snow"Man">My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'Man'");
  });

  test("ibm-not-wf-P10-ibm10n08.xml", () => {
    // 2.3 — Tests an attribute with an invalid value. The closing bracket (single quote) is missing with
    // the value of the attribute "first".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #IMPLIED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "I">\r\n\t<!ENTITY mylast "Man">\r\n]>\r\n\r\n<!-- testing invalid attvalue with no closing single quote -->\r\n<student first=\'Snow >My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("ibm-not-wf-P11-ibm11n01.xml", () => {
    // 2.3 — Tests SystemLiteral. The systemLiteral for the element "student" has a double quote character
    // in the middle.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student SYSTEM "student".dtd"[\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid system literal  -->\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '.dtd'",
    );
  });

  test("ibm-not-wf-P11-ibm11n02.xml", () => {
    // 2.3 — Tests SystemLiteral. The systemLiteral for the element "student" has a single quote character
    // in the middle.
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student SYSTEM 'student'.dtd'[\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid system literal  -->\r\n<student>My Name is SnowMan. </student>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '.dtd'",
    );
  });

  test("ibm-not-wf-P11-ibm11n03.xml", () => {
    // 2.3 — Tests SystemLiteral. The closing bracket (double quote) is missing with the systemLiteral for
    // the element "student".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student SYSTEM "student.DTD [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid system literal with no closing bracket  -->\r\n<student>My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: Unterminated quoted string");
  });

  test("ibm-not-wf-P11-ibm11n04.xml", () => {
    // 2.3 — Tests SystemLiteral. The closing bracket (single quote) is missing with the systemLiteral for
    // the element "student".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student SYSTEM \'student.DTD [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid system literal with no closing bracket  -->\r\n<student>My Name is SnowMan. </student>\r\n';
    expectRejects(input, "XML Parse error: Unterminated quoted string");
  });

  test("ibm-not-wf-P12-ibm12n01.xml", () => {
    // 2.3 — Tests PubidLiteral. The closing bracket (double quote) is missing with the value of the
    // PubidLiteral for the entity "info".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n\t<!ENTITY info PUBLIC "..\\info.dtd>\r\n]>\r\n\r\n<!-- testing invalid pubid literal with no closing bracket  -->\r\n<student>My Name is &info;. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '\\'");
  });

  test("ibm-not-wf-P12-ibm12n02.xml", () => {
    // 2.3 — Tests PubidLiteral. The value of the PubidLiteral for the entity "info" has a single quote
    // character in the middle..
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n\t<!ENTITY info PUBLIC '..\\info'.dtd'>\r\n]>\r\n\r\n<!-- testing invalid pubid literal -->\r\n<student>My Name is &info;. </student>\r\n";
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '\\'");
  });

  test("ibm-not-wf-P12-ibm12n03.xml", () => {
    // 2.3 — Tests PubidLiteral. The closing bracket (single quote) is missing with the value of the
    // PubidLiteral for the entity "info".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n\t<!ENTITY info PUBLIC \'..\\info.dtd>\r\n]>\r\n\r\n<!-- testing invalid pubid literal with no closing bracket  -->\r\n<student>My Name is &info;. </student>';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '\\'");
  });

  test("ibm-not-wf-P13-ibm13n01.xml", () => {
    // 2.3 — Tests PubidChar. The pubidChar of the PubidLiteral for the entity "info" contains the
    // character "{".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ENTITY info PUBLIC "This is a {test} " "student.dtd">\r\n]>\r\n\r\n<!-- testing invalid pubid char with {  -->\r\n<student>My Name is &info;. </student>\r\n\r\n\r\n\r\n\r\n ';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '{'");
  });

  test("ibm-not-wf-P13-ibm13n02.xml", () => {
    // 2.3 — Tests PubidChar. The pubidChar of the PubidLiteral for the entity "info" contains the
    // character "~".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ENTITY info PUBLIC "This is a test~. " "student.dtd">\r\n]>\r\n\r\n<!-- testing invalid pubid char with ~  -->\r\n<student>My Name is &info;. </student>';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '~'");
  });

  test("ibm-not-wf-P13-ibm13n03.xml", () => {
    // 2.3 — Tests PubidChar. The pubidChar of the PubidLiteral for the entity "info" contains the
    // character double quote in the middle.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE student [\n\t<!ENTITY info PUBLIC "This is a test á " "student.dtd">\n]>\n\n<!-- testing invalid pubid char with á  -->\n<student>My Name is &info;. </student>\n\n',
    );
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: 'á' (U+00E1)");
  });

  test("ibm-not-wf-P14-ibm14n01.xml", () => {
    // 2.4 — Tests CharData. The content of the element "student" contains the sequence close-bracket
    // close-bracket greater-than.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student first CDATA #REQUIRED\r\n\t\t\t  last  CDATA #IMPLIED>\r\n]>\r\n\r\n<!-- testing invalid chardata string  -->\r\n<student first="Snow">My name is Snow ]]> Man</student>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: ']]>' is only allowed as the end of a CDATA section");
  });

  test("ibm-not-wf-P14-ibm14n02.xml", () => {
    // 2.4 — Tests CharData. The content of the element "student" contains the character "less than".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student first CDATA #REQUIRED\r\n\t\t\t  last  CDATA #IMPLIED>\r\n]>\r\n\r\n<!-- testing invalid chardata string  -->\r\n<student first="Snow">My name is Snow <Man </student>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '</student'",
    );
  });

  test("ibm-not-wf-P14-ibm14n03.xml", () => {
    // 2.4 — Tests CharData. The content of the element "student" contains the character ampersand.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student first CDATA #REQUIRED\r\n\t\t\t  last  CDATA #IMPLIED>\r\n]>\r\n\r\n<!-- testing invalid chardata string  -->\r\n<student first="Snow">My name is Snow&Man </student>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found space");
  });

  test("ibm-not-wf-P15-ibm15n01.xml", () => {
    // 2.5 — Tests comment. The text of the second comment contains the character "-".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid comment  -->\r\n<!------>\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    expectRejects(input, "XML Parse error: '--' is not allowed inside a comment");
  });

  test("ibm-not-wf-P15-ibm15n02.xml", () => {
    // 2.5 — Tests comment. The second comment has a wrong closing sequence "-(greater than)".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid comment  -->\r\n<!-- Student\'s name ->\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Unterminated comment");
  });

  test("ibm-not-wf-P15-ibm15n03.xml", () => {
    // 2.5 — Tests comment. The second comment has a wrong beginning sequence "(less than)!-".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid comment  -->\r\n<!- student file-1 -->\r\n<student>My Name is SnowMan. </student>';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P15-ibm15n04.xml", () => {
    // 2.5 — Tests comment. The closing sequence is missing with the second comment.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid comment  -->\r\n<!--student phone number 408-777-8888 \r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Unterminated comment");
  });

  test("ibm-not-wf-P16-ibm16n01.xml", () => {
    // 2.6 — Tests PI. The content of the PI includes the sequence "?(greater than)?".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid PI with illegal sequence  -->\r\n<?MyInstruct This is ?> a test ?>\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected the root element but found 'a'");
  });

  test("ibm-not-wf-P16-ibm16n02.xml", () => {
    // 2.6 — Tests PI. The PITarget is missing in the PI.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n\r\n<!-- testing invalid PI with missing PITarget  -->\r\n<??>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Expected a processing instruction target after '<?' but found '?'");
  });

  test("ibm-not-wf-P16-ibm16n03.xml", () => {
    // 2.6 — Tests PI. The PI has a wrong closing sequence ">".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n\r\n<!-- testing invalid PI with wrong closing sequence  -->\r\n<?MyInstruct >\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Unterminated processing instruction");
  });

  test("ibm-not-wf-P16-ibm16n04.xml", () => {
    // 2.6 — Tests PI. The closing sequence is missing in the PI.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n\r\n<!-- testing invalid PI with missing sequence  -->\r\n<?MyInstruct \r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Unterminated processing instruction");
  });

  test("ibm-not-wf-P17-ibm17n01.xml", () => {
    // 2.6 — Tests PITarget. The PITarget contains the string "XML".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n\r\n<!-- testing invalid PITarget  -->\r\n<?XML This is a test ?>\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P17-ibm17n02.xml", () => {
    // 2.6 — Tests PITarget. The PITarget contains the string "xML".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid PITarget  -->\r\n<?xML This is a test ?>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P17-ibm17n03.xml", () => {
    // 2.6 — Tests PITarget. The PITarget contains the string "xml".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid PITarget  -->\r\n<?xml This is a test ?>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P17-ibm17n04.xml", () => {
    // 2.6 — Tests PITarget. The PITarget contains the string "xmL".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid PITarget  -->\r\n<?xmL This is a test ?>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P18-ibm18n01.xml", () => {
    // 2.7 — Tests CDSect. The CDStart is missing in the CDSect in the content of element "student".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDSect with missing CDStart   -->\r\n<student>My Name is SnowMan. This is <normal> text]]></student>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: ']]>' is only allowed as the end of a CDATA section");
  });

  test("ibm-not-wf-P18-ibm18n02.xml", () => {
    // 2.7 — Tests CDSect. The CDEnd is missing in the CDSect in the content of element "student".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDSect with missing CDEnd  -->\r\n<student>My Name is SnowMan. <![CDATA[This is <normal> text </student>';
    expectRejects(input, "XML Parse error: Unterminated CDATA section");
  });

  test("ibm-not-wf-P19-ibm19n01.xml", () => {
    // 2.7 — Tests CDStart. The CDStart contains a lower case string "cdata".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDStart -->\r\n<![cdata[This is a test]]>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Conditional sections are only allowed in the external DTD subset");
  });

  test("ibm-not-wf-P19-ibm19n02.xml", () => {
    // 2.7 — Tests CDStart. The CDStart contains an extra character "[".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDStart -->\r\n<![[CDATA[This is a test]]>\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Conditional sections are only allowed in the external DTD subset");
  });

  test("ibm-not-wf-P19-ibm19n03.xml", () => {
    // 2.7 — Tests CDStart. The CDStart contains a wrong character "?".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDStart -->\r\n<?[CDATA[This is a test]]>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Expected a processing instruction target after '<?' but found '['");
  });

  test("ibm-not-wf-P20-ibm20n01.xml", () => {
    // 2.7 — Tests CDATA with an illegal sequence. The CDATA contains the sequence close-bracket
    // close-bracket greater-than.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CData with illegal sequence -->\r\n<![CDATA[<testing>This is ]]> a test</testing>]]>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: CDATA sections are only allowed inside elements");
  });

  test("ibm-not-wf-P21-ibm21n01.xml", () => {
    // 2.7 — Tests CDEnd. One "]" is missing in the CDEnd.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDEnd -->\r\n<![[CDATA[This is a test]>\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Conditional sections are only allowed in the external DTD subset");
  });

  test("ibm-not-wf-P21-ibm21n02.xml", () => {
    // 2.7 — Tests CDEnd. An extra "]" is placed in the CDEnd.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDEnd -->\r\n<![cdata[This is a test]]]>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: Conditional sections are only allowed in the external DTD subset");
  });

  test("ibm-not-wf-P21-ibm21n03.xml", () => {
    // 2.7 — Tests CDEnd. A wrong character ")" is placed in the CDEnd.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing invalid CDEnd -->\r\n<![CDATA[This is a test])>\r\n<student>My Name is SnowMan. </student>';
    expectRejects(input, "XML Parse error: CDATA sections are only allowed inside elements");
  });

  test("ibm-not-wf-P22-ibm22n01.xml", () => {
    // 2.8 — Tests prolog with wrong field ordering. The XMLDecl occurs after the DTD.
    const input: string =
      '<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<?xml version="1.0" encoding="ASCII" ?>\r\n<doc/>\r\n<!-- Wrong ordering between DTD and XMLDecl -->';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P22-ibm22n02.xml", () => {
    // 2.8 — Tests prolog with wrong field ordering. The Misc (comment) occurs before the XMLDecl.
    const input: string =
      '<!-- Wrong ordering Misc, DTD and XMLDecl -->\r\n<?xml version="1.0" encoding="ASCII" ?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P22-ibm22n03.xml", () => {
    // 2.8 — Tests prolog with wrong field ordering. The XMLDecl occurs after the DTD and a comment. The
    // other comment occurs before the DTD.
    const input: string =
      '<!-- Wrong ordering patter 4 -->\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<!-- Wrong ordering Misc, DTD, Misc, and XMLDecl -->\r\n<?xml version="1.0" encoding="ASCII" ?>\r\n<doc/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P23-ibm23n01.xml", () => {
    // 2.8 — Tests XMLDecl with a required field missing. The Versioninfo is missing in the XMLDecl.
    const input = Buffer.from(
      '<?xml encoding="ASCII" ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Missing required field VersionInfo in XMLDecl -->',
    );
    expectRejects(input, 'XML Parse error: The XML declaration must start with version="1.0"');
  });

  test("ibm-not-wf-P23-ibm23n02.xml", () => {
    // 2.8 — Tests XMLDecl with wrong field ordering. The VersionInfo occurs after the EncodingDecl.
    const input = Buffer.from(
      "<?xml encoding='ASCII' version='1.0'?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong ordering between VersionInfo and EncodingDecl in XMLDecl -->",
    );
    expectRejects(input, 'XML Parse error: The XML declaration must start with version="1.0"');
  });

  test("ibm-not-wf-P23-ibm23n03.xml", () => {
    // 2.8 — Tests XMLDecl with wrong field ordering. The VersionInfo occurs after the SDDecl and the
    // SDDecl occurs after the VersionInfo.
    const input = Buffer.from(
      "<?xml encoding='ASCII' standalone='yes' version='1.0'?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong ordering EncodingDecl, SDDecl, and VersionInfo in XMLDecl -->",
    );
    expectRejects(input, 'XML Parse error: The XML declaration must start with version="1.0"');
  });

  test("ibm-not-wf-P23-ibm23n04.xml", () => {
    // 2.8 — Tests XMLDecl with wrong key word. An upper case string "XML" is used as the key word in the
    // XMLDecl.
    const input: string =
      "<?XML version='1.0'?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong keyword in XMLDecl -->";
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P23-ibm23n05.xml", () => {
    // 2.8 — Tests XMLDecl with a wrong closing sequence ">".
    const input = Buffer.from(
      "<?xml version='1.0' encoding='ASCII' standalone='yes' >\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong closing sequence in XMLDecl -->",
    );
    expectRejects(input, "XML Parse error: Expected '?>' to end the XML declaration but found '>'");
  });

  test("ibm-not-wf-P23-ibm23n06.xml", () => {
    // 2.8 — Tests XMLDecl with a wrong opening sequence "(less than)!".
    const input: string =
      "<!xml version='1.0' encoding='ASCII' standalone='yes' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong opening sequence in XMLDecl -->";
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P24-ibm24n01.xml", () => {
    // 2.8 — Tests VersionInfo with a required field missing. The VersionNum is missing in the VersionInfo
    // in the XMLDecl.
    const input: string =
      "<?xml version= ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- VersioNum is missing in VersionInfo -->";
    expectRejects(input, "XML Parse error: Expected a quoted value in the XML declaration but found '?'");
  });

  test("ibm-not-wf-P24-ibm24n02.xml", () => {
    // 2.8 — Tests VersionInfo with a required field missing. The white space is missing between the key
    // word "xml" and the VersionInfo in the XMLDecl.
    const input: string =
      "<?xmlversion='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- S is missing in VersionInfo -->";
    expectRejects(
      input,
      "XML Parse error: Expected whitespace or '?>' after the processing instruction target but found '='",
    );
  });

  test("ibm-not-wf-P24-ibm24n03.xml", () => {
    // 2.8 — Tests VersionInfo with a required field missing. The "=" (equal sign) is missing between the
    // key word "version" and the VersionNum.
    const input: string =
      "<?xml version'1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]> \r\n<doc/>\r\n<!-- Eq is missing in VersionInfo -->";
    expectRejects(input, "XML Parse error: Expected '=' after the name in the XML declaration but found '''");
  });

  test("ibm-not-wf-P24-ibm24n04.xml", () => {
    // 2.8 — Tests VersionInfo with wrong field ordering. The VersionNum occurs before "=" and "version".
    const input: string =
      "<?xml '1.0'=version ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong ordering VersionNum Eq 'version' -->";
    expectRejects(input, "XML Parse error: Expected version=\"1.0\" in the XML declaration but found '''");
  });

  test("ibm-not-wf-P24-ibm24n05.xml", () => {
    // 2.8 — Tests VersionInfo with wrong field ordering. The "=" occurs after "version" and the
    // VersionNum.
    const input: string =
      "<?xml version'1.0'= ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong ordering version VersionNum Eq -->";
    expectRejects(input, "XML Parse error: Expected '=' after the name in the XML declaration but found '''");
  });

  test("ibm-not-wf-P24-ibm24n06.xml", () => {
    // 2.8 — Tests VersionInfo with the wrong key word "Version".
    const input: string =
      "<?xml Version='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong key word 'Version' -->";
    expectRejects(input, "XML Parse error: Expected version=\"1.0\" in the XML declaration but found 'Version'");
  });

  test("ibm-not-wf-P24-ibm24n07.xml", () => {
    // 2.8 — Tests VersionInfo with the wrong key word "versioN".
    const input: string =
      "<?xml versioN='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong key word 'versioN' -->";
    expectRejects(input, "XML Parse error: Expected version=\"1.0\" in the XML declaration but found 'versioN'");
  });

  test("ibm-not-wf-P24-ibm24n08.xml", () => {
    // 2.8 — Tests VersionInfo with mismatched quotes around the VersionNum. version = '1.0" is used as the
    // VersionInfo.
    const input: string =
      "<?xml version='1.0\" ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Mismatched qotes in VersionInfo -->";
    expectRejects(input, "XML Parse error: Invalid character in a quoted string: '>'");
  });

  test("ibm-not-wf-P24-ibm24n09.xml", () => {
    // 2.8 — Tests VersionInfo with mismatched quotes around the VersionNum. The closing bracket for the
    // VersionNum is missing.
    const input: string =
      "<?xml version='1.0 ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Mismatched qotes in VersionInfo -->";
    expectRejects(input, "XML Parse error: Invalid character in a quoted string: '>'");
  });

  test("ibm-not-wf-P25-ibm25n01.xml", () => {
    // 2.8 — Tests eq with a wrong key word "==".
    const input: string =
      "<?xml version=='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong key word \"==\" in Eq -->";
    expectRejects(input, "XML Parse error: Expected a quoted value in the XML declaration but found '='");
  });

  test("ibm-not-wf-P25-ibm25n02.xml", () => {
    // 2.8 — Tests eq with a wrong key word "eq".
    const input: string =
      "<?xml version eq '1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- Wrong key word \"eq\" in Eq -->";
    expectRejects(input, "XML Parse error: Expected '=' after the name in the XML declaration but found 'eq'");
  });

  test("ibm-not-wf-P26-ibm26n01.xml", () => {
    // 2.8 — Tests VersionNum with an illegal character "#".
    const input: string =
      "<?xml version='_#1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- illegal character '#' in VersionNum -->";
    expectRejects(input, "XML Parse error: Unsupported XML version '_#1.0' (this is an XML 1.0 parser)");
  });

  test("ibm-not-wf-P27-ibm27n01.xml", () => {
    // 2.8 — Tests type of Misc. An element declaration is used as a type of Misc After the element
    // "animal".
    const input: string =
      '<?xml version="1.0" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal ANY>\r\n]>\r\n<animal>Wrong type of Misc following this element!</animal>\r\n<!ELEMENT cat EMPTY>';
    expectRejects(input, "XML Parse error: Unexpected '<!ELEMENT' after the root element");
  });

  test("ibm-not-wf-P28-ibm28n01.xml", () => {
    // 2.8 — Tests doctypedecl with a required field missing. The Name "animal" is missing in the
    // doctypedecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE SYSTEM "ibm28n01.dtd">\r\n<!-- Name is missing in doctypedecl --> \r\n<animal/>\r\n',
    );
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '\"'",
    );
  });

  test("ibm-not-wf-P28-ibm28n02.xml", () => {
    // 2.8 — Tests doctypedecl with wrong field ordering. The Name "animal" occurs after the markup
    // declarations inside the "[]".
    const input = Buffer.from(
      "<?xml version=\"1.0\" encoding='UTF-8'?>\r\n<!DOCTYPE [\r\n<!ELEMENT animal EMPTY>\r\n] animal>\r\n<!-- Wrong ordering [ ] Name in doctypedecl --> \r\n<animal/>\r\n",
    );
    expectRejects(input, "XML Parse error: Expected the document type name but found '['");
  });

  test("ibm-not-wf-P28-ibm28n03.xml", () => {
    // 2.8 — Tests doctypedecl with wrong field ordering. The Name "animal" occurs after the markup
    // declarations inside the "[]".
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE SYSTEM "ibm28n01.dtd" animal [\r\n   <!ATTLIST animal color CDATA #REQUIRED>\r\n]>\r\n<!-- Wrong ordering ExternalID Name [ ] in doctypedecl --> \r\n<animal color="yellow"/>\r\n',
    );
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '\"'",
    );
  });

  test("ibm-not-wf-P28-ibm28n04.xml", () => {
    // 2.8 — Tests doctypedecl with general entity reference.The "(ampersand)generalE" occurs in the DTD.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE aniaml [\r\n   <!ELEMENT animal ANY>\r\n   <!ENTITY generalE "leopard">\r\n   &generalE;\r\n   <!ENTITY % parameterE "<!ELEMENT leopard EMPTY>">\r\n   %parameterE;\r\n] animal>\r\n<!-- Wrong componet general entity reference occurs inside the DTD -->\r\n<!-- General entity sould be used in the document content --> \r\n<animal>&generalE</animal>\r\n',
    );
    expectRejects(input, "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '&'");
  });

  test("ibm-not-wf-P28-ibm28n05.xml", () => {
    // 2.8 — Tests doctypedecl with wrong key word. A wrong key word "DOCtYPE" occurs on line 2.
    const input = Buffer.from(
      "<?xml version=\"1.0\" encoding='UTF-8'?>\r\n<!DOCtYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Wrong keyword DOCTYPE in doctypedecl --> \r\n<animal/>\r\n",
    );
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P28-ibm28n06.xml", () => {
    // 2.8 — Tests doctypedecl with mismatched brackets. The closing bracket "]" of the DTD is missing.
    const input = Buffer.from(
      "<?xml version=\"1.0\" encoding='UTF-8'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n>\r\n<!-- Bracket mismatch in [ ] in doctypedecl --> \r\n<animal/>\r\n",
    );
    expectRejects(input, "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '>'");
  });

  test("ibm-not-wf-P28-ibm28n07.xml", () => {
    // 2.8 — Tests doctypedecl with wrong bracket. The opening bracket "{" occurs in the DTD.
    const input = Buffer.from(
      "<?xml version=\"1.0\" encoding='UTF-8'?>\r\n<!DOCTYPE animal {\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Wrong bracket in [ ] in doctypedecl --> \r\n<animal/>\r\n",
    );
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '{'",
    );
  });

  test("ibm-not-wf-P28-ibm28n08.xml", () => {
    // 2.8 — Tests doctypedecl with wrong opening sequence. The opening sequence "(less than)?DOCTYPE"
    // occurs in the DTD.
    const input = Buffer.from(
      "<?xml version=\"1.0\" encoding='UTF-8'?>\r\n<?DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Wrong opening sequence in doctypedecl --> \r\n<animal/>\r\n",
    );
    expectRejects(input, "XML Parse error: Unterminated processing instruction");
  });

  test("ibm-not-wf-p28a-ibm28an01.xml", () => {
    // 2.8 — This test violates WFC:PE Between Declarations in Production 28a. The last character of a
    // markup declaration is not contained in the same parameter-entity text replacement. (upstream:
    // not-wf; external parameter entities are not read)
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!DOCTYPE animal SYSTEM "ibm28an01.dtd" [\r\n   <!ELEMENT animal (cat|tiger|leopard)+>\r\n   <!NOTATION animal_class SYSTEM "ibm29v01.txt">\r\n   <!ELEMENT cat ANY>\r\n   <!ENTITY forcat "This is a small cat">\r\n   <!ELEMENT tiger (#PCDATA)>\r\n   <!ELEMENT small EMPTY>\r\n   <!ELEMENT big EMPTY>\r\n   <!ATTLIST tiger color CDATA #REQUIRED>\r\n   <?sound "This is a PI" ?>\r\n   <!-- This is a comment -->\r\n]>\r\n<animal>\r\n   <cat>&forcat;</cat>\r\n   <tiger color="white">This is a white tiger in Mirage!!</tiger>\r\n   <cat/>\r\n   <leopard>\r\n      <small/>\r\n      <big/>\r\n   </leopard>\r\n</animal>\r\n',
    );
    expectParses(input);
  });

  test("ibm-not-wf-P29-ibm29n01.xml", () => {
    // 2.8 — Tests markupdecl with an illegal markup declaration. A XMLDecl occurs inside the DTD.
    const input: string =
      '<!DOCTYPE animal [\r\n   <?xml version="1.0" encoding="ASCII" ?>\r\n   <!-- Illegal markupdecl in DTD --> \r\n   <!ELEMENT animal (cat|tiger|leopard)+>\r\n   <!ELEMENT cat EMPTY>\r\n   <!ELEMENT tiger (#PCDATA)>\r\n   <!ELEMENT leopard ANY>\r\n   <!ELEMENT small EMPTY>\r\n   <!ELEMENT big EMPTY>\r\n   <!ATTLIST tiger color CDATA #REQUIRED>\r\n]>\r\n<animal>\r\n   <cat/>\r\n   <tiger color="white">This is a white tiger in Mirage!!</tiger>\r\n   <cat/>\r\n   <leopard>\r\n      <small/>\r\n      <big/>\r\n   </leopard>\r\n</animal>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
    );
  });

  test("ibm-not-wf-P29-ibm29n02.xml", () => {
    // 2.8 — Tests WFC "PEs in Internal Subset". A PE reference occurs inside an elementdecl in the DTD.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal ANY>\r\n   <!ENTITY % parameterE "leopard EMPTY>">\r\n   <!ELEMENT %parameterE;\r\n]>\r\n<!-- Parameter reference appears inside elementdecl in DTD -->\r\n<animal>Any content</animal>\r\n',
    );
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("ibm-not-wf-P29-ibm29n03.xml", () => {
    // 2.8 — Tests WFC "PEs in Internal Subset". A PE reference occurs inside an ATTlistDecl in the DTD.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal ANY>\r\n   <!ENTITY % parameterE "color">\r\n   <!ATTLIST animal %parameterE; CDATA #IMPLIED>\r\n]>\r\n<!-- Parameter reference appears inside AttlistDecl in DTD -->\r\n<animal>Any content</animal>\r\n',
    );
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("ibm-not-wf-P29-ibm29n04.xml", () => {
    // 2.8 — Tests WFC "PEs in Internal Subset". A PE reference occurs inside an EntityDecl in the DTD.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal ANY>\r\n   <!ENTITY % parameterE "A leopard">\r\n   <!ENTITY content "%parameterE;">\r\n]>\r\n<!-- Parameter reference appears inside an entity declaration in DTD -->\r\n<animal>&content;</animal>\r\n',
    );
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("ibm-not-wf-P29-ibm29n05.xml", () => {
    // 2.8 — Tests WFC "PEs in Internal Subset". A PE reference occurs inside a PI in the DTD.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal ANY>\r\n   <!ENTITY % parameterE "A music file ?>">\r\n   <?music %parameterE;\r\n]>\r\n<!-- Parameter reference appears inside a PI in DTD -->\r\n<animal>Any content</animal>\r\n',
    );
    expectRejects(input, "XML Parse error: Unterminated processing instruction");
  });

  test("ibm-not-wf-P29-ibm29n06.xml", () => {
    // 2.8 — Tests WFC "PEs in Internal Subset". A PE reference occurs inside a comment in the DTD.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal ANY>\r\n   <!ENTITY % parameterE "A music file -->">\r\n<!-- Parameter reference appears inside a comment in DTD -->\r\n   <!-- This is %parameterE;\r\n]>\r\n<animal>Any content</animal>\r\n',
    );
    expectRejects(input, "XML Parse error: Unterminated comment");
  });

  test("ibm-not-wf-P29-ibm29n07.xml", () => {
    // 2.8 — Tests WFC "PEs in Internal Subset". A PE reference occurs inside a NotationDecl in the DTD.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=\'UTF-8\'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal ANY>\r\n   <!ENTITY % parameterE "cat SYSTEM">\r\n   <!NOTATION %parameterE; "cat.txt">\r\n]>\r\n<!-- Parameter reference appears inside a NotationDecl in DTD -->\r\n<animal>Any content</animal>\r\n',
    );
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("ibm-not-wf-P30-ibm30n01.xml", () => {
    // 2.8 — Tests extSubset with wrong field ordering. In the file "ibm30n01.dtd", the TextDecl occurs
    // after the extSubsetDecl (the element declaration). (upstream: not-wf; external parameter entities
    // are not read)
    const input: string =
      '<!DOCTYPE animal SYSTEM "ibm30n01.dtd">\r\n<animal/>\r\n<!-- Wrong ordering extSubsetDecl TextDecl in the external DTD -->';
    expectParses(input);
  });

  test("ibm-not-wf-P31-ibm31n01.xml", () => {
    // 2.8 — Tests extSubsetDecl with an illegal field. A general entity reference occurs in file
    // "ibm31n01.dtd". (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE animal SYSTEM "ibm31n01.dtd">\r\n<animal/>\r\n<!-- Illegal extSubsetDecl in the external DTD -->';
    expectParses(input);
  });

  test("ibm-not-wf-P32-ibm32n01.xml", () => {
    // 2.9 — Tests SDDecl with a required field missing. The leading white space is missing with the SDDecl
    // in the XMLDecl.
    const input: string =
      '<?xml version="1.0"standalone="yes" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Missing a S in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'standalone'");
  });

  test("ibm-not-wf-P32-ibm32n02.xml", () => {
    // 2.9 — Tests SDDecl with a required field missing. The "=" sign is missing in the SDDecl in the
    // XMLDecl.
    const input: string =
      '<?xml version="1.0" standalone"yes" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Missing Eq in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(input, "XML Parse error: Expected '=' after the name in the XML declaration but found '\"'");
  });

  test("ibm-not-wf-P32-ibm32n03.xml", () => {
    // 2.9 — Tests SDDecl with wrong key word. The word "Standalone" occurs in the SDDecl in the XMLDecl.
    const input: string =
      '<?xml version="1.0" Standalone="yes" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Wrong keyword in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Unexpected 'Standalone' in the XML declaration (expected version, encoding or standalone)",
    );
  });

  test("ibm-not-wf-P32-ibm32n04.xml", () => {
    // 2.9 — Tests SDDecl with wrong key word. The word "Yes" occurs in the SDDecl in the XMLDecl.
    const input: string =
      '<?xml version="1.0" standalone="Yes" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Wrong keyword in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid value 'Yes' for standalone in the XML declaration (expected yes or no)",
    );
  });

  test("ibm-not-wf-P32-ibm32n05.xml", () => {
    // 2.9 — Tests SDDecl with wrong key word. The word "YES" occurs in the SDDecl in the XMLDecl.
    const input: string =
      '<?xml version="1.0" standalone="YES" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Wrong keyword in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid value 'YES' for standalone in the XML declaration (expected yes or no)",
    );
  });

  test("ibm-not-wf-P32-ibm32n06.xml", () => {
    // 2.9 — Tests SDDecl with wrong key word. The word "No" occurs in the SDDecl in the XMLDecl.
    const input: string =
      '<?xml version="1.0" standalone="No" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32n06.dtd">\r\n<!-- Wrong keyword in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid value 'No' for standalone in the XML declaration (expected yes or no)",
    );
  });

  test("ibm-not-wf-P32-ibm32n07.xml", () => {
    // 2.9 — Tests SDDecl with wrong key word. The word "NO" occurs in the SDDecl in the XMLDecl.
    const input: string =
      '<?xml version="1.0" standalone="NO" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32n06.dtd">\r\n<!-- Wrong keyword in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid value 'NO' for standalone in the XML declaration (expected yes or no)",
    );
  });

  test("ibm-not-wf-P32-ibm32n08.xml", () => {
    // 2.9 — Tests SDDecl with wrong field ordering. The "=" sign occurs after the key word "yes" in the
    // SDDecl in the XMLDecl.
    const input: string =
      '<?xml version="1.0" standalone"Yes"= ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- Wrong ordering in SDDecl -->\r\n<animal/>\r\n';
    expectRejects(input, "XML Parse error: Expected '=' after the name in the XML declaration but found '\"'");
  });

  test("ibm-not-wf-P32-ibm32n09.xml", () => {
    // 2.9 — This is test violates WFC: Entity Declared in P68. The standalone document declaration has the
    // value yes, BUT there is an external markup declaration of an entity (other than amp, lt, gt, apos,
    // quot), and references to this entity appear in the document. (upstream: not-wf; external parameter
    // entities are not read)
    const input: string =
      '<?xml version="1.0" standalone="yes" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32n09.dtd" [\r\n   <!ELEMENT animal (#PCDATA)>\r\n]>\r\n<!-- This is test violates WFC: Entity Declared in P68\r\n The standalone document declaration has the value "yes", there is an \r\n external markup declaration of an entity (other than amp, lt, gt, apos, quot), and references to this entity appear in the document. \r\n-->\r\n<animal>&animal_content;</animal>\r\n';
    expectRejects(input, "XML Parse error: Entity 'animal_content' is not declared");
  });

  test("ibm-not-wf-P39-ibm39n01.xml", () => {
    // 3 — Tests element with a required field missing. The ETag is missing for the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n]>\r\n<root>missing end tag\r\n\r\n';
    expectRejects(input, "XML Parse error: Missing closing tag for element 'root'");
  });

  test("ibm-not-wf-P39-ibm39n02.xml", () => {
    // 3 — Tests element with a required field missing. The STag is missing for the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n]>\r\nmissing start tag</root>\r\n';
    expectRejects(input, "XML Parse error: Expected the root element but found 'missing'");
  });

  test("ibm-not-wf-P39-ibm39n03.xml", () => {
    // 3 — Tests element with required fields missing. Both the content and the ETag are missing in the
    // element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n]>\r\n<root>\r\n<!--* Missing end tag and no content -->\r\n';
    expectRejects(input, "XML Parse error: Missing closing tag for element 'root'");
  });

  test("ibm-not-wf-P39-ibm39n04.xml", () => {
    // 3 — Tests element with required fields missing. Both the content and the STag are missing in the
    // element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n]>\r\n</root>\r\n<!--* Missing start tag and no content -->\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected the root element but found '</root'");
  });

  test("ibm-not-wf-P39-ibm39n05.xml", () => {
    // 3 — Tests element with wrong field ordering. The STag and the ETag are swapped in the element
    // "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n]>\r\n</root>switched start and end tags<root>\r\n';
    expectRejects(input, "XML Parse error: Expected the root element but found '</root'");
  });

  test("ibm-not-wf-P39-ibm39n06.xml", () => {
    // 3 — Tests element with wrong field ordering. The content occurs after the ETag of the element
    // "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n]>\r\n<root></root>content after end tag\r\n';
    expectRejects(input, "XML Parse error: Unexpected 'content' after the root element");
  });

  test("ibm-not-wf-P40-ibm40n01.xml", () => {
    // 3.1 — Tests STag with a required field missing. The Name "root" is in the STag of the element
    // "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<attr1="any">missing name in start tag</root>\r\n\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '='");
  });

  test("ibm-not-wf-P40-ibm40n02.xml", () => {
    // 3.1 — Tests STag with a required field missing. The white space between the Name "root" and the
    // attribute "attr1" is missing in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<rootattr1="any">missing white space in start tag</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '='");
  });

  test("ibm-not-wf-P40-ibm40n03.xml", () => {
    // 3.1 — Tests STag with wrong field ordering. The Name "root" occurs after the attribute "attr1" in
    // the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<attr1="any" root>Wrong ordering in start tag</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '='");
  });

  test("ibm-not-wf-P40-ibm40n04.xml", () => {
    // 3.1 — Tests STag with a wrong opening sequence. The string "(less than)!" is used as the opening
    // sequence for the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<!root attr1="any">wrong begining sequence in start tag</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P40-ibm40n05.xml", () => {
    // 3.1 — Tests STag with duplicate attribute names. The attribute name "attr1" occurs twice in the STag
    // of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root attr1="any1" attr1="any2">duplicate attr names in start tag</root>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Duplicate attribute 'attr1'");
  });

  test("ibm-not-wf-P41-ibm41n01.xml", () => {
    // 3.1 — Tests Attribute with a required field missing. The attribute name is missing in the Attribute
    // in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root ="any">missing name in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '='");
  });

  test("ibm-not-wf-P41-ibm41n02.xml", () => {
    // 3.1 — Tests Attribute with a required field missing. The "=" is missing between the attribute name
    // and the attribute value in the Attribute in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root attr1"any">missing Eq in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected '=' after the attribute name but found '\"'");
  });

  test("ibm-not-wf-P41-ibm41n03.xml", () => {
    // 3.1 — Tests Attribute with a required field missing. The AttValue is missing in the Attribute in the
    // STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root attr1= >missing AttValue in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted attribute value but found '>'");
  });

  test("ibm-not-wf-P41-ibm41n04.xml", () => {
    // 3.1 — Tests Attribute with a required field missing. The Name and the "=" are missing in the
    // Attribute in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root "any">missing name and Eq in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '\"'");
  });

  test("ibm-not-wf-P41-ibm41n05.xml", () => {
    // 3.1 — Tests Attribute with a required field missing. The "=" and the AttValue are missing in the
    // Attribute in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root attr1>missing Eq and AttValue in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected '=' after the attribute name but found '>'");
  });

  test("ibm-not-wf-P41-ibm41n06.xml", () => {
    // 3.1 — Tests Attribute with a required field missing. The Name and the AttValue are missing in the
    // Attribute in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root = >missing Name and AttValue in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '='");
  });

  test("ibm-not-wf-P41-ibm41n07.xml", () => {
    // 3.1 — Tests Attribute with wrong field ordering. The "=" occurs after the Name and the AttValue in
    // the Attribute in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root attr1"any"=>wrong ordering in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected '=' after the attribute name but found '\"'");
  });

  test("ibm-not-wf-P41-ibm41n08.xml", () => {
    // 3.1 — Tests Attribute with wrong field ordering. The Name and the AttValue are swapped in the
    // Attribute in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root "any"=attr1>wrong ordering in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '\"'");
  });

  test("ibm-not-wf-P41-ibm41n09.xml", () => {
    // 3.1 — Tests Attribute with wrong field ordering. The "=" occurs before the Name and the AttValue in
    // the Attribute in the STag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root =attr1"any">wrong ordering in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '='");
  });

  test("ibm-not-wf-P41-ibm41n10.xml", () => {
    // 3.1 — Tests Attribute against WFC "no external entity references". A direct reference to the
    // external entity "aExternal" is contained in the value of the attribute "attr1".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n<!ENTITY aExternal SYSTEM "ibm41n10.ent">\r\n]>\r\n<root attr1="&aExternal;">direct reference to external entinity in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Attribute values cannot reference external entity 'aExternal'");
  });

  test("ibm-not-wf-P41-ibm41n11.xml", () => {
    // 3.1 — Tests Attribute against WFC "no external entity references". A indirect reference to the
    // external entity "aExternal" is contained in the value of the attribute "attr1".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n<!ENTITY aExternal SYSTEM "ibm41n11.ent">\r\n<!ENTITY aIndirect "&aExternal;">\r\n]>\r\n<root attr1="&aIndirect;">indirect reference to external entinity in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: Attribute values cannot reference external entity 'aExternal'");
  });

  test("ibm-not-wf-P41-ibm41n12.xml", () => {
    // 3.1 — Tests Attribute against WFC "no external entity references". A direct reference to the
    // external unparsed entity "aImage" is contained in the value of the attribute "attr1".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root attr1="&aImage;">direct reference to external unparsed entinity in Attribute</root>\r\n\r\n';
    expectRejects(input, "XML Parse error: Unparsed entity 'aImage' cannot be referenced");
  });

  test("ibm-not-wf-P41-ibm41n13.xml", () => {
    // 3.1 — Tests Attribute against WFC "No (less than) character in Attribute Values". The character
    // "less than" is contained in the value of the attribute "attr1".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n<!ENTITY withlt "have <lessthan> inside">\r\n]>\r\n<root attr1="&withlt;">Direct reference to an entity with &lt; as part of its replacement text in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("ibm-not-wf-P41-ibm41n14.xml", () => {
    // 3.1 — Tests Attribute against WFC "No (less than) in Attribute Values". The character "less than" is
    // contained in the value of the attribute "attr1" through indirect internal entity reference.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n<!ENTITY withlt "have <lessthan> inside">\r\n<!ENTITY aIndirect "&withlt;">\r\n]>\r\n<root attr1="&aIndirect;">indirect reference to an entity with &lt; as part of its replacement text in Attribute</root>\r\n';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("ibm-not-wf-P42-ibm42n01.xml", () => {
    // 3.1 — Tests ETag with a required field missing. The Name is missing in the ETag of the element
    // "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n]>\r\n<root attr1="any">missing Name in ETag</>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '</' but found '>'");
  });

  test("ibm-not-wf-P42-ibm42n02.xml", () => {
    // 3.1 — Tests ETag with a wrong beginning sequence. The string "(less than)\" is used as a beginning
    // sequence of the ETag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n]>\r\n<root attr1="any">Wrong begining sequence in ETag <\\root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found '\\'");
  });

  test("ibm-not-wf-P42-ibm42n03.xml", () => {
    // 3.1 — Tests ETag with a wrong beginning sequence. The string "less than" is used as a beginning
    // sequence of the ETag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n]>\r\n<root attr1="any">Wrong begining sequence in ETag <root>\r\n';
    expectRejects(input, "XML Parse error: Missing closing tag for element 'root'");
  });

  test("ibm-not-wf-P42-ibm42n04.xml", () => {
    // 3.1 — Tests ETag with a wrong structure. An white space occurs between The beginning sequence and
    // the Name of the ETag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n]>\r\n<root attr1="any">Extra white space before Name in ETag </ root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '</' but found space");
  });

  test("ibm-not-wf-P42-ibm42n05.xml", () => {
    // 3.1 — Tests ETag with a wrong structure. The ETag of the element "root" contains an Attribute
    // (attr1="any").
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root ANY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n]>\r\n<root> Attribute in ETag </root attr1="any">\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the closing tag but found 'attr1'");
  });

  test("ibm-not-wf-P43-ibm43n01.xml", () => {
    // 3.1 — Tests element content with a wrong option. A NotationDecl is used as the content of the
    // element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY % paaa "a string">\r\n]>\r\n<root>\r\n<!NOTATION nota1 SYSTEM "bogus.not">\r\n</root>\r\n<!--* NotationDecl in content -->';
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("ibm-not-wf-P43-ibm43n02.xml", () => {
    // 3.1 — Tests element content with a wrong option. An elementdecl is used as the content of the
    // element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY % paaa "a string">\r\n]>\r\n<root>\r\n<!ELEMENT ele1 ANY>\r\n</root>\r\n<!--* ElementDecl in content -->\r\n';
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("ibm-not-wf-P43-ibm43n04.xml", () => {
    // 3.1 — Tests element content with a wrong option. An entitydecl is used as the content of the element
    // "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY % paaa "a string">\r\n]>\r\n<root>\r\n<!ENTITY GE1 "This is an entity declaration">\r\n</root>\r\n<!--* EntityDecl in content -->\r\n';
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("ibm-not-wf-P43-ibm43n05.xml", () => {
    // 3.1 — Tests element content with a wrong option. An AttlistDecl is used as the content of the
    // element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY % paaa "a string">\r\n]>\r\n<root>\r\n<!ATTLIST root attr1 ID #IMPLIED>\r\n</root>\r\n<!--* AttlistDecl in content -->\r\n';
    expectRejects(input, "XML Parse error: Expected a comment or CDATA section after '<!'");
  });

  test("ibm-not-wf-P44-ibm44n01.xml", () => {
    // 3.1 — Tests EmptyElemTag with a required field missing. The Name "root" is missing in the
    // EmptyElemTag.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n< />\r\n<!--* Missing Name and Attribute EmptyElemTag *-->\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<' but found space");
  });

  test("ibm-not-wf-P44-ibm44n02.xml", () => {
    // 3.1 — Tests EmptyElemTag with wrong field ordering. The Attribute (attri1 = "any") occurs before the
    // name of the element "root" in the EmptyElemTag.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<attr1="any" root/>\r\n<!--* Swithech positions of Name and Attribute EmptyElemTag *-->\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '='");
  });

  test("ibm-not-wf-P44-ibm44n03.xml", () => {
    // 3.1 — Tests EmptyElemTag with wrong closing sequence. The string "\>" is used as the closing
    // sequence in the EmptyElemtag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root attr1="any"\\>\r\n<!--* Wrong closing sequence in EmptyElemTag *-->\r\n\r\n\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag but found '\\'");
  });

  test("ibm-not-wf-P44-ibm44n04.xml", () => {
    // 3.1 — Tests EmptyElemTag which against the WFC "Unique Att Spec". The attribute name "attr1" occurs
    // twice in the EmptyElemTag of the element "root".
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root attr1 CDATA #IMPLIED>\r\n<!ATTLIST root attr2 CDATA #IMPLIED>\r\n]>\r\n<root attr1="any1" attr1="any2"/>\r\n<!--* Duplicate Attribute Name in EmptyElemTag *-->\r\n';
    expectRejects(input, "XML Parse error: Duplicate attribute 'attr1'");
  });

  test("ibm-not-wf-P45-ibm45n01.xml", () => {
    // 3.2 — Tests elementdecl with a required field missing. The Name is missing in the second elementdecl
    // in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Mising Name in elementdecl *-->\r\n<!ELEMENT (#PCDATA)>\r\n]>\r\n<root>Any content</root>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '('");
  });

  test("ibm-not-wf-P45-ibm45n02.xml", () => {
    // 3.2 — Tests elementdecl with a required field missing. The white space is missing between "aEle" and
    // "(#PCDATA)" in the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Mising white space in elementdecl *-->\r\n<!ELEMENT aEle(#PCDATA)>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("ibm-not-wf-P45-ibm45n03.xml", () => {
    // 3.2 — Tests elementdecl with a required field missing. The contentspec is missing in the second
    // elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Mising contentspec in elementdecl *-->\r\n<!ELEMENT root >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '>'");
  });

  test("ibm-not-wf-P45-ibm45n04.xml", () => {
    // 3.2 — Tests elementdecl with a required field missing. The contentspec and the white space is
    // missing in the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Mising contentspec and white space in elementdecl *-->\r\n<!ELEMENT root>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '>'");
  });

  test("ibm-not-wf-P45-ibm45n05.xml", () => {
    // 3.2 — Tests elementdecl with a required field missing. The Name, the white space, and the
    // contentspec are missing in the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Mising Name S contentspec in elementdecl *-->\r\n<!ELEMENT >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '>'");
  });

  test("ibm-not-wf-P45-ibm45n06.xml", () => {
    // 3.2 — Tests elementdecl with wrong field ordering. The Name occurs after the contentspec in the
    // second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong ordering in elementdecl *-->\r\n<!ELEMENT (#PCDATA) aElement >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '('");
  });

  test("ibm-not-wf-P45-ibm45n07.xml", () => {
    // 3.2 — Tests elementdecl with wrong beginning sequence. The string "(less than)ELEMENT" is used as
    // the beginning sequence in the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong begining sequence in elementdecl *-->\r\n<ELEMENT aElement (#PCDATA)>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '<ELEMENT'",
    );
  });

  test("ibm-not-wf-P45-ibm45n08.xml", () => {
    // 3.2 — Tests elementdecl with wrong key word. The string "Element" is used as the key word in the
    // second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong Keyword: Element in elementdecl *-->\r\n<!Element aElement (#PCDATA)>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P45-ibm45n09.xml", () => {
    // 3.2 — Tests elementdecl with wrong key word. The string "element" is used as the key word in the
    // second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong keyword: element in elementdecl *-->\r\n<!element aElement (#PCDATA)>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P46-ibm46n01.xml", () => {
    // 3.2 — Tests contentspec with wrong key word. the string "empty" is used as the key word in the
    // contentspec of the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong keyword: empty in contentspec *-->\r\n<!ELEMENT aElement empty>\r\n]>\r\n<root>Any content</root>\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'empty'");
  });

  test("ibm-not-wf-P46-ibm46n02.xml", () => {
    // 3.2 — Tests contentspec with wrong key word. the string "Empty" is used as the key word in the
    // contentspec of the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong keyword: Empty in contentspec *-->\r\n<!ELEMENT aElement Empty >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'Empty'");
  });

  test("ibm-not-wf-P46-ibm46n03.xml", () => {
    // 3.2 — Tests contentspec with wrong key word. the string "Any" is used as the key word in the
    // contentspec of the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong keyword: Any in contentspec *-->\r\n<!ELEMENT aElement Any>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'Any'");
  });

  test("ibm-not-wf-P46-ibm46n04.xml", () => {
    // 3.2 — Tests contentspec with wrong key word. the string "any" is used as the key word in the
    // contentspec of the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Wrong keyword: any in contentspec *-->\r\n<!ELEMENT aElement any >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found 'any'");
  });

  test("ibm-not-wf-P46-ibm46n05.xml", () => {
    // 3.2 — Tests contentspec with a wrong option. The string "#CDATA" is used as the contentspec in the
    // second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Bogus content type: #CDATA in contentspec *-->\r\n<!ELEMENT aElement #CDATA>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '#CDATA'");
  });

  test("ibm-not-wf-P47-ibm47n01.xml", () => {
    // 3.2.1 — Tests children with a required field missing. The "+" is used as the choice or seq field in
    // the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Missing choice|seq in children *-->\r\n<!ELEMENT aElement + >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '+'");
  });

  test("ibm-not-wf-P47-ibm47n02.xml", () => {
    // 3.2.1 — Tests children with a required field missing. The "*" is used as the choice or seq field in
    // the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Missing choice|seq in children *-->\r\n<!ELEMENT aElement * >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '*'");
  });

  test("ibm-not-wf-P47-ibm47n03.xml", () => {
    // 3.2.1 — Tests children with a required field missing. The "?" is used as the choice or seq field in
    // the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* Missing choice|seq in children *-->\r\n<!ELEMENT aElement ? >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '?'");
  });

  test("ibm-not-wf-P47-ibm47n04.xml", () => {
    // 3.2.1 — Tests children with wrong field ordering. The "*" occurs before the seq field (a,a) in the
    // second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Wrong ordering in children *-->\r\n<!ELEMENT aElement *(a,a) >\r\n]>\r\n<root>Any content</root>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '*'");
  });

  test("ibm-not-wf-P47-ibm47n05.xml", () => {
    // 3.2.1 — Tests children with wrong field ordering. The "+" occurs before the choice field (a|a) in
    // the second elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* Wrong ordering in children *-->\r\n<!ELEMENT aElement +(a|a) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected EMPTY, ANY or '(' in the element declaration but found '+'");
  });

  test("ibm-not-wf-P47-ibm47n06.xml", () => {
    // 3.2.1 — Tests children with wrong key word. The "^" occurs after the seq field in the second
    // elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Wrong keyword: ^  in children *-->\r\n<!ELEMENT aElement (a,a)^ >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the element declaration but found '^'");
  });

  test("ibm-not-wf-P48-ibm48n01.xml", () => {
    // 3.2.1 — Tests cp with a required fields missing. The field Name|choice|seq is missing in the second
    // cp in the choice field in the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing seq|choice|Name in cp *-->\r\n<!ELEMENT aElement ((a,a)|+) >\r\n]>\r\n<root>Any content</root>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '+'");
  });

  test("ibm-not-wf-P48-ibm48n02.xml", () => {
    // 3.2.1 — Tests cp with a required fields missing. The field Name|choice|seq is missing in the cp in
    // the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing seq|choice|Name in cp *-->\r\n<!ELEMENT aElement (*) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '*'");
  });

  test("ibm-not-wf-P48-ibm48n03.xml", () => {
    // 3.2.1 — Tests cp with a required fields missing. The field Name|choice|seq is missing in the first
    // cp in the choice field in the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing seq|choice|Name in cp *-->\r\n<!ELEMENT aElement (?|(a,a)|a) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '?'");
  });

  test("ibm-not-wf-P48-ibm48n04.xml", () => {
    // 3.2.1 — Tests cp with wrong field ordering. The "+" occurs before the seq (a,a) in the first cp in
    // the choice field in the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* wrong ordering in cp *-->\r\n<!ELEMENT aElement (+(a,a)|a) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '+'");
  });

  test("ibm-not-wf-P48-ibm48n05.xml", () => {
    // 3.2.1 — Tests cp with wrong field ordering. The "*" occurs before the choice (a|b) in the first cp
    // in the seq field in the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* wrong ordering in cp *-->\r\n<!ELEMENT aElement (*(a|b),a) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '*'");
  });

  test("ibm-not-wf-P48-ibm48n06.xml", () => {
    // 3.2.1 — Tests cp with wrong field ordering. The "?" occurs before the Name "a" in the second cp in
    // the seq field in the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* wrong ordering in cp *-->\r\n<!ELEMENT aElement (a, ?a) >\r\n]>\r\n<root>Any content</root>\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '?'");
  });

  test("ibm-not-wf-P48-ibm48n07.xml", () => {
    // 3.2.1 — Tests cp with wrong key word. The "^" occurs after the Name "a" in the first cp in the
    // choice field in the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* wrong keyword: ^ in cp *-->\r\n<!ELEMENT aElement ( a^ | a ) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found '^'");
  });

  test("ibm-not-wf-P49-ibm49n01.xml", () => {
    // 3.2.1 — Tests choice with a required field missing. The two cps are missing in the choice field in
    // the third elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* missing cp in choice *-->\r\n<!ELEMENT aElement (|)* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '|'");
  });

  test("ibm-not-wf-P49-ibm49n02.xml", () => {
    // 3.2.1 — Tests choice with a required field missing. The third cp is missing in the choice field in
    // the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* missing cp in choice *-->\r\n<!ELEMENT aElement (a |b|)* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found ')'");
  });

  test("ibm-not-wf-P49-ibm49n03.xml", () => {
    // 3.2.1 — Tests choice with a wrong separator. The "!" is used as the separator in the choice field in
    // the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* wrong separator: !  in choice *-->\r\n<!ELEMENT aElement (a!b)+ >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found '!'");
  });

  test("ibm-not-wf-P49-ibm49n04.xml", () => {
    // 3.2.1 — Tests choice with a required field missing. The separator "|" is missing in the choice field
    // (a b)+ in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* missing separator in choice *-->\r\n<!ELEMENT aElement (a b) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found 'b'");
  });

  test("ibm-not-wf-P49-ibm49n05.xml", () => {
    // 3.2.1 — Tests choice with an extra separator. An extra "|" occurs between a and b in the choice
    // field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* extra separator in choice *-->\r\n<!ELEMENT aElement (a ||b)* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '|'");
  });

  test("ibm-not-wf-P49-ibm49n06.xml", () => {
    // 3.2.1 — Tests choice with a required field missing. The closing bracket ")" is missing in the choice
    // field (a |b * in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* missing closing bracket in choice *-->\r\n<!ELEMENT aElement (a |b * >\r\n]>\r\n<root>Any content</root>\r\n\r\n';
    expectRejects(input, "XML Parse error: An occurrence indicator must directly follow the name or ')' it applies to");
  });

  test("ibm-not-wf-P50-ibm50n01.xml", () => {
    // 3.2.1 — Tests seq with a required field missing. The two cps are missing in the seq field in the
    // fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* missing cp in seq *-->\r\n<!ELEMENT aElement (,) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found ','");
  });

  test("ibm-not-wf-P50-ibm50n02.xml", () => {
    // 3.2.1 — Tests seq with a required field missing. The third cp is missing in the seq field in the
    // fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* missing cp in seq *-->\r\n<!ELEMENT aElement (a,a,)+ >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found ')'");
  });

  test("ibm-not-wf-P50-ibm50n03.xml", () => {
    // 3.2.1 — Tests seq with a wrong separator. The "|" is used as the separator between a and b in the
    // seq field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* wrong separators in seq *-->\r\n<!ELEMENT aElement (a,a|b) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: A content model group cannot mix ',' and '|'");
  });

  test("ibm-not-wf-P50-ibm50n04.xml", () => {
    // 3.2.1 — Tests seq with a wrong separator. The "." is used as the separator between a and b in the
    // seq field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* wrong separator in seq *-->\r\n<!ELEMENT aElement (a . b)* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found '.'");
  });

  test("ibm-not-wf-P50-ibm50n05.xml", () => {
    // 3.2.1 — Tests seq with an extra separator. An extra "," occurs between (a|b) and a in the seq field
    // in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* extra separator in seq *-->\r\n<!ELEMENT aElement ((a|b),,a)? >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found ','");
  });

  test("ibm-not-wf-P50-ibm50n06.xml", () => {
    // 3.2.1 — Tests seq with a required field missing. The separator between (a|b) and (b|a) is missing in
    // the seq field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* missing separator in seq *-->\r\n<!ELEMENT aElement ((a|b) (b|a)) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found '('");
  });

  test("ibm-not-wf-P50-ibm50n07.xml", () => {
    // 3.2.1 — Tests seq with wrong closing bracket. The "]" is used as the closing bracket in the seq
    // field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* wrong closing bracket in seq *-->\r\n<!ELEMENT aElement (a, b]* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected ')', '|' or ',' in the content model but found ']'");
  });

  test("ibm-not-wf-P51-ibm51n01.xml", () => {
    // 3.2.2 — Tests Mixed with a wrong key word. The string "#pcdata" is used as the key word in the Mixed
    // field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* wrong keyword : #pcdata in Mixed  *-->\r\n<!ELEMENT aElement (#pcdata)* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '#pcdata'");
  });

  test("ibm-not-wf-P51-ibm51n02.xml", () => {
    // 3.2.2 — Tests Mixed with wrong field ordering. The field #PCDATA does not occur as the first
    // component in the Mixed field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* #PCDATA must be the first in Mixed  *-->\r\n<!ELEMENT aElement ( a | b|#PCDATA)* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: #PCDATA must come first in a content model, as (#PCDATA|a|b)*");
  });

  test("ibm-not-wf-P51-ibm51n03.xml", () => {
    // 3.2.2 — Tests Mixed with a separator missing. The separator "|" is missing in between #PCDATA and a
    // in the Mixed field in the fourth elementdecl in the DTD.
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* Missing '|' in Mixed  *-->\r\n<!ELEMENT aElement ( #PCDATA a )* >\r\n]>\r\n<root>Any content</root>\r\n";
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the mixed content model but found 'a'");
  });

  test("ibm-not-wf-P51-ibm51n04.xml", () => {
    // 3.2.2 — Tests Mixed with a wrong key word. The string "#CDATA" is used as the key word in the Mixed
    // field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* wrong keyword: #CDATA in Mixed  *-->\r\n<!ELEMENT aElement (#CDATA) >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an element name or '(' in the content model but found '#CDATA'");
  });

  test("ibm-not-wf-P51-ibm51n05.xml", () => {
    // 3.2.2 — Tests Mixed with a required field missing. The "*" is missing after the ")" in the Mixed
    // field in the fourth elementdecl in the DTD.
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* Missing '* after ')' in Mixed  *-->\r\n<!ELEMENT aElement ( #PCDATA | a ) >\r\n]>\r\n<root>Any content</root>";
    expectRejects(input, "XML Parse error: A mixed content model with element names must end with ')*'");
  });

  test("ibm-not-wf-P51-ibm51n06.xml", () => {
    // 3.2.2 — Tests Mixed with wrong closing bracket. The "]" is used as the closing bracket in the Mixed
    // field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* Wrong closing bracket in Mixed  *-->\r\n<!ELEMENT aElement ( #PCDATA | a ]* >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the mixed content model but found ']'");
  });

  test("ibm-not-wf-P51-ibm51n07.xml", () => {
    // 3.2.2 — Tests Mixed with a required field missing. The closing bracket ")" is missing after (#PCDATA
    // in the Mixed field in the fourth elementdecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!ELEMENT b ANY>\r\n<!--* Missing closing bracket in Mixed  *-->\r\n<!ELEMENT aElement ( #PCDATA *>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the mixed content model but found '*'");
  });

  test("ibm-not-wf-P52-ibm52n01.xml", () => {
    // 3.3 — Tests AttlistDecl with a required field missing. The Name is missing in the AttlistDecl in the
    // DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing Name in AttlistDecl *-->\r\n<!ATTLIST attr1 CDATA #IMPLIED>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found '#IMPLIED'",
    );
  });

  test("ibm-not-wf-P52-ibm52n02.xml", () => {
    // 3.3 — Tests AttlistDecl with a required field missing. The white space is missing between the
    // beginning sequence and the name in the AttlistDecl in the DTD.
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing white space after 'ATTLIST' *-->\r\n<!ATTLISTa attr1 ID #REQUIRED >\r\n]>\r\n<root>Any content</root>\r\n";
    expectRejects(input, "XML Parse error: Whitespace is required before 'a'");
  });

  test("ibm-not-wf-P52-ibm52n03.xml", () => {
    // 3.3 — Tests AttlistDecl with wrong field ordering. The Name "a" occurs after the first AttDef in the
    // AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Wrong ordering in AttlistDecl *-->\r\n<!ATTLIST attr1 CDATA "defaultAttValue" a attr2 CDATA #IMPLIED>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found '\"'",
    );
  });

  test("ibm-not-wf-P52-ibm52n04.xml", () => {
    // 3.3 — Tests AttlistDecl with wrong key word. The string "Attlist" is used as the key word in the
    // beginning sequence in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Wrong keyword: Attlist in AttlistDecl *-->\r\n<!Attlist a attr1 CDATA #REQUIRED >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P52-ibm52n05.xml", () => {
    // 3.3 — Tests AttlistDecl with a required field missing. The closing bracket "greater than" is missing
    // in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing closing bracket in AttlistDecl *-->\r\n<!ATTLIST a \r\n<!--* random *-->\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found a comment",
    );
  });

  test("ibm-not-wf-P52-ibm52n06.xml", () => {
    // 3.3 — Tests AttlistDecl with wrong beginning sequence. The string "(less than)ATTLIST" is used as
    // the beginning sequence in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Wrong begining sequence in AttlistDecl *-->\r\n<ATTLIST a attr1 CDATA "default">\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '<ATTLIST'",
    );
  });

  test("ibm-not-wf-P53-ibm53n01.xml", () => {
    // 3.3 — Tests AttDef with a required field missing. The DefaultDecl is missing in the AttDef for the
    // name "attr1" in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing DefaultDecl in AttDef *-->\r\n<!ATTLIST a attr1 CDATA >\r\n]>\r\n<root>Any content</root>\r\n\r\n\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '>'",
    );
  });

  test("ibm-not-wf-P53-ibm53n02.xml", () => {
    // 3.3 — Tests AttDef with a required field missing. The white space is missing between (abc|def) and
    // "def" in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing white space between AttType and DefaultDecl in AttDef *-->\r\n<!ATTLIST a attr1 (abc|def)"def">\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P53-ibm53n03.xml", () => {
    // 3.3 — Tests AttDef with a required field missing. The AttType is missing for "attr1" in the AttDef
    // in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing AttType in AttDef *-->\r\n<!ATTLIST a attr1 #IMPLIED>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found '#IMPLIED'",
    );
  });

  test("ibm-not-wf-P53-ibm53n04.xml", () => {
    // 3.3 — Tests AttDef with a required field missing. The white space is missing between "attr1" and
    // (abc|def) in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing white space between Name and AttType in AttDef *-->\r\n<!ATTLIST a attr1(abc|def) "abc" >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("ibm-not-wf-P53-ibm53n05.xml", () => {
    // 3.3 — Tests AttDef with a required field missing. The Name is missing in the AttDef in the
    // AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing Name in AttDef *-->\r\n<!ATTLIST a (abc|def) "def" >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '('");
  });

  test("ibm-not-wf-P53-ibm53n06.xml", () => {
    // 3.3 — Tests AttDef with a required field missing. The white space before the name "attr2" is missing
    // in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Missing white space before Name in AttDef *-->\r\n<!ATTLIST a attr1 CDATA "default"attr2 ID #required>\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'attr2'");
  });

  test("ibm-not-wf-P53-ibm53n07.xml", () => {
    // 3.3 — Tests AttDef with wrong field ordering. The Name "attr1" occurs after the AttType in the
    // AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* Wrong ordering in AttDef *-->\r\n<!ATTLIST a (abc|def) attr1 "abc">\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '('");
  });

  test("ibm-not-wf-P53-ibm53n08.xml", () => {
    // 3.3 — Tests AttDef with wrong field ordering. The Name "attr1" occurs after the AttType and
    // "default" occurs before the AttType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n<!ELEMENT root (#PCDATA)>\r\n<!ELEMENT a ANY>\r\n<!--* wrong ordering in AttDef *-->\r\n<!ATTLIST a "default" CDATA attr1 >\r\n]>\r\n<root>Any content</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '\"'",
    );
  });

  test("ibm-not-wf-P54-ibm54n01.xml", () => {
    // 3.3.1 — Tests AttType with a wrong option. The string "BOGUSATTR" is used as the AttType in the
    // AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 54-->\r\n<!DOCTYPE AttrType\r\n[\r\n<!ELEMENT AttrType ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a att BOGUSATTR #IMPLIED> \r\n]>\r\n<AttrType>\r\nGiving a Bogus attribute. \r\n</AttrType>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'BOGUSATTR'",
    );
  });

  test("ibm-not-wf-P54-ibm54n02.xml", () => {
    // 3.3.1 — Tests AttType with a wrong option. The string "PCDATA" is used as the AttType in the
    // AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 54-->\r\n<!DOCTYPE AttrType\r\n[\r\n<!ELEMENT AttrType ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a att PCDATA #IMPLIED> \r\n]>\r\n<AttrType>\r\nGiving a wrong AttType for the attribute. \r\n<a att="23" ></a>\r\n</AttrType>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'PCDATA'",
    );
  });

  test("ibm-not-wf-P55-ibm55n01.xml", () => {
    // 3.3.1 — Tests StringType with a wrong key word. The lower case string "cdata" is used as the
    // StringType in the AttType in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test syntax invalid for Production 55-->\r\n<!DOCTYPE AttrType\r\n[\r\n<!ELEMENT AttrType (#PCDATA)>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a att cdata #IMPLIED>  \r\n]>\r\n<AttrType>\r\nGiving a lowercase for CDATA attribute.\r\n</AttrType>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'cdata'",
    );
  });

  test("ibm-not-wf-P55-ibm55n02.xml", () => {
    // 3.3.1 — Tests StringType with a wrong key word. The string "#CDATA" is used as the StringType in the
    // AttType in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test invalid syntax for Production 55-->\r\n<!DOCTYPE AttrType\r\n[\r\n<!ELEMENT AttrType (#PCDATA)>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a att #CDATA #IMPLIED> \r\n]>\r\n<AttrType>\r\nGiving a wrong character. \r\n</AttrType>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found '#CDATA'",
    );
  });

  test("ibm-not-wf-P55-ibm55n03.xml", () => {
    // 3.3.1 — Tests StringType with a wrong key word. The string "CData" is used as the StringType in the
    // AttType in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test invalid syntax for Production 55-->\r\n<!DOCTYPE AttrType\r\n[\r\n<!ELEMENT AttrType (#PCDATA)>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a att CData #IMPLIED> \r\n]>\r\n<AttrType>\r\n Giving a wrong key word of the StringType.\r\n</AttrType>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'CData'",
    );
  });

  test("ibm-not-wf-P56-ibm56n01.xml", () => {
    // 3.3.1 — Tests TokenizedType with wrong key word. The type "id" is used in the TokenizedType in the
    // AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 56-->\r\n<!DOCTYPE root\r\n[\r\n<!ELEMENT root ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a attr id #REQUIRED>\r\n]>\r\n<root>\r\nInvalid TokenizedType id(lowercase)\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'id'",
    );
  });

  test("ibm-not-wf-P56-ibm56n02.xml", () => {
    // 3.3.1 — Tests TokenizedType with wrong key word. The type "Idref" is used in the TokenizedType in
    // the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 56-->\r\n<!DOCTYPE root\r\n[\r\n<!ELEMENT root ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a attr Idref #REQUIRED>\r\n]>\r\n<root>\r\nInvalid TokenizedType Idref(case sensitive)\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'Idref'",
    );
  });

  test("ibm-not-wf-P56-ibm56n03.xml", () => {
    // 3.3.1 — Tests TokenizedType with wrong key word. The type"Idrefs" is used in the TokenizedType in
    // the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 56-->\r\n<!DOCTYPE root\r\n[\r\n<!ELEMENT root ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a attr IdRefs #REQUIRED>\r\n]>\r\n<root>\r\nInvalid TokenizedType IdRefs(case sensitive)\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'IdRefs'",
    );
  });

  test("ibm-not-wf-P56-ibm56n04.xml", () => {
    // 3.3.1 — Tests TokenizedType with wrong key word. The type "EntitY" is used in the TokenizedType in
    // the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 56-->\r\n<!DOCTYPE root\r\n[\r\n<!ELEMENT root ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a attr EntitY #REQUIRED>\r\n]>\r\n<root>\r\nInvalid TokenizedType EntitY(case sensitive)\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'EntitY'",
    );
  });

  test("ibm-not-wf-P56-ibm56n05.xml", () => {
    // 3.3.1 — Tests TokenizedType with wrong key word. The type "nmTOKEN" is used in the TokenizedType in
    // the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 56-->\r\n<!DOCTYPE root\r\n[\r\n<!ELEMENT root ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a attr nmTOKEN #REQUIRED>\r\n]>\r\n<root>\r\nInvalid TokenizedType nmTOKEN(case sensitive)\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'nmTOKEN'",
    );
  });

  test("ibm-not-wf-P56-ibm56n06.xml", () => {
    // 3.3.1 — Tests TokenizedType with wrong key word. The type "NMtokens" is used in the TokenizedType in
    // the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 56-->\r\n<!DOCTYPE root\r\n[\r\n<!ELEMENT root ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a attr NMtokens #REQUIRED>\r\n]>\r\n<root>\r\nInvalid TokenizedType NMtokens(case sensitive)\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'NMtokens'",
    );
  });

  test("ibm-not-wf-P56-ibm56n07.xml", () => {
    // 3.3.1 — Tests TokenizedType with wrong key word. The type "#ID" is used in the TokenizedType in the
    // AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- test for Production 56-->\r\n<!DOCTYPE root\r\n[\r\n<!ELEMENT root ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a attr #ID #REQUIRED>\r\n]>\r\n<root>\r\nInvalid TokenizedType #ID(Wrong Character)\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found '#ID'",
    );
  });

  test("ibm-not-wf-P57-ibm57n01.xml", () => {
    // 3.3.1 — Tests EnumeratedType with an illegal option. The string "NMTOKEN (a|b)" is used in the
    // EnumeratedType in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 57-->\r\n<!DOCTYPE root\r\n [\r\n <!ELEMENT root EMPTY>\r\n <!ATTLIST root att NMTOKEN (a|b) #IMPLIED>\r\n ]>\r\n <root>\r\nThis test case tests the illegal enumerated types\r\n</root>';
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '('",
    );
  });

  test("ibm-not-wf-P58-ibm58n01.xml", () => {
    // 3.3.1 — Tests NotationType with wrong key word. The lower case "notation" is used as the key word in
    // the NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!ATTLIST one attr notation (this) #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test with notation (name) \r\nIt is case sensitive.\r\n</test>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'notation'",
    );
  });

  test("ibm-not-wf-P58-ibm58n02.xml", () => {
    // 3.3.1 — Tests NotationType with a required field missing. The beginning bracket "(" is missing in
    // the NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!ATTLIST one attr NOTATION this) #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test with  (name) \r\nMissing the open parenthesis\r\n</test>';
    expectRejects(input, "XML Parse error: Expected '(' after NOTATION but found 'this'");
  });

  test("ibm-not-wf-P58-ibm58n03.xml", () => {
    // 3.3.1 — Tests NotationType with a required field missing. The Name is missing in the "()" in the
    // NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!ATTLIST one attr NOTATION () #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test with  NOTATION () \r\nMissing the required field\r\n</test>';
    expectRejects(input, "XML Parse error: Expected a notation name but found ')'");
  });

  test("ibm-not-wf-P58-ibm58n04.xml", () => {
    // 3.3.1 — Tests NotationType with a required field missing. The closing bracket is missing in the
    // NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!ATTLIST one attr NOTATION (this #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test with  NOTATION (Name \r\nMissing the closing brackets\r\n</test>';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found '#IMPLIED'");
  });

  test("ibm-not-wf-P58-ibm58n05.xml", () => {
    // 3.3.1 — Tests NotationType with wrong field ordering. The key word "NOTATION" occurs after "(this)"
    // in the NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!ATTLIST one attr (this) NOTATION #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test with (Name) NOTATION  \r\nWrong Ordering\r\n</test>';
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found 'NOTATION'",
    );
  });

  test("ibm-not-wf-P58-ibm58n06.xml", () => {
    // 3.3.1 — Tests NotationType with wrong separator. The "," is used as a separator between "this" and
    // "that" in the NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- Syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!NOTATION that SYSTEM "beta">\r\n <!ATTLIST three attr NOTATION (this,that) #IMPLIED>\r\n ]>\r\n<test>\r\nNegative Test.\r\nThis test tests the presence of a correct seperator. There is a wrong seperator(,)\r\n</test>';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found ','");
  });

  test("ibm-not-wf-P58-ibm58n07.xml", () => {
    // 3.3.1 — Tests NotationType with a required field missing. The white space is missing between
    // "NOTATION" and "(this)" in the NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- Syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!ATTLIST three attr NOTATION(this) #IMPLIED>\r\n ]>\r\n<test>\r\nNegative Test.\r\nMissing space after NOTATION\r\n</test>';
    expectRejects(input, "XML Parse error: Whitespace is required before '('");
  });

  test("ibm-not-wf-P58-ibm58n08.xml", () => {
    // 3.3.1 — Tests NotationType with extra wrong characters. The double quote character occurs after "("
    // and before ")" in the NotationType in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- Syntax test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!ATTLIST three attr NOTATION ("this") #IMPLIED>\r\n ]>\r\n<test>\r\nNegative Test.\r\nPresence of quotes around the value\r\n</test>';
    expectRejects(input, "XML Parse error: Expected a notation name but found '\"'");
  });

  test("ibm-not-wf-P59-ibm59n01.xml", () => {
    // 3.3.1 — Tests Enumeration with required fields missing. The Nmtokens and "|"s are missing in the
    // AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT enum (#PCDATA)>\r\n <!ATTLIST one attr () #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test\r\nMissing the required field\r\n</test>';
    expectRejects(input, "XML Parse error: Expected a name token in the enumeration but found ')'");
  });

  test("ibm-not-wf-P59-ibm59n02.xml", () => {
    // 3.3.1 — Tests Enumeration with a required field missing. The closing bracket ")" is missing in the
    // AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT enum (#PCDATA)>\r\n <!ATTLIST one attr (enum #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test\r\nMissing the closing brackets\r\n</test>';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found '#IMPLIED'");
  });

  test("ibm-not-wf-P59-ibm59n03.xml", () => {
    // 3.3.1 — Tests Enumeration with wrong separator. The "," is used as the separator in the AttDef in
    // the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!ELEMENT enum (#PCDATA)>\r\n <!ATTLIST one attr (enum,two) #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test\r\nWrong Separator(, instead of |)\r\n</test>';
    expectRejects(input, "XML Parse error: Expected '|' or ')' in the enumeration but found ','");
  });

  test("ibm-not-wf-P59-ibm59n04.xml", () => {
    // 3.3.1 — Tests Enumeration with illegal presence. The double quotes occur around the Enumeration
    // value in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT enum (#PCDATA)>\r\n <!ATTLIST one attr ("enum") #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test\r\nIllegal presence of quotes around the value\r\n</test>';
    expectRejects(input, "XML Parse error: Expected a name token in the enumeration but found '\"'");
  });

  test("ibm-not-wf-P59-ibm59n05.xml", () => {
    // 3.3.1 — Tests Enumeration with a required field missing. The white space is missing between in the
    // AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT enum (#PCDATA)>\r\n <!ATTLIST one attr enum) #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test\r\nMissing the begining bracket  \r\n</test>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'enum'",
    );
  });

  test("ibm-not-wf-P59-ibm59n06.xml", () => {
    // 3.3.1 — Tests Enumeration with a required field missing. The beginning bracket "(" is missing in the
    // AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT enum (#PCDATA)>\r\n <!ATTLIST one attr enum) #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Negative test\r\nMissing the Opening brackets\r\n</test>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found 'enum'",
    );
  });

  test("ibm-not-wf-P60-ibm60n01.xml", () => {
    // 3.3.2 — Tests DefaultDecl with wrong key word. The string "#required" is used as the key word in the
    // DefaultDecl in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA #required>\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nNegative Test. Case sensitive.\r\n</Java>';
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '#required'",
    );
  });

  test("ibm-not-wf-P60-ibm60n02.xml", () => {
    // 3.3.2 — Tests DefaultDecl with wrong key word. The string "Implied" is used as the key word in the
    // DefaultDecl in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA #Implied>\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nNegative test. Case Sensitive\r\n</Java>';
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '#Implied'",
    );
  });

  test("ibm-not-wf-P60-ibm60n03.xml", () => {
    // 3.3.2 — Tests DefaultDecl with wrong key word. The string "!IMPLIED" is used as the key word in the
    // DefaultDecl in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA !IMPLIED>\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nNegative Test. Wrong Character.\r\n</Java>';
    expectRejects(
      input,
      "XML Parse error: Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found '!'",
    );
  });

  test("ibm-not-wf-P60-ibm60n04.xml", () => {
    // 3.3.2 — Tests DefaultDecl with a required field missing. There is no attribute value specified after
    // the key word "#FIXED" in the DefaultDecl in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA #FIXED >\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nNegative test. Missing required field(#FIXED should have a value)\r\n</Java>';
    expectRejects(input, "XML Parse error: Expected a quoted default value after #FIXED but found '>'");
  });

  test("ibm-not-wf-P60-ibm60n05.xml", () => {
    // 3.3.2 — Tests DefaultDecl with a required field missing. The white space is missing between the key
    // word "#FIXED" and the attribute value in the DefaultDecl in the AttDef in the AttlistDecl in the
    // DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA #FIXED"Introduction">\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nNegative test. Missing required field(#FIXED should have a space before value)\r\n</Java>';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P60-ibm60n06.xml", () => {
    // 3.3.2 — Tests DefaultDecl with wrong field ordering. The key word "#FIXED" occurs after the
    // attribute value "introduction" in the DefaultDecl in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA "Introduction" #FIXED>\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nNegative test. Wrong Ordering\r\n</Java>';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '#FIXED'",
    );
  });

  test("ibm-not-wf-P60-ibm60n07.xml", () => {
    // 3.3.2 — Tests DefaultDecl against WFC of P60. The text replacement of the entity "avalue" contains
    // the "less than" character in the DefaultDecl in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- WFC test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ENTITY avalue "<Introduction">\r\n <!ATTLIST one chapter CDATA #REQUIRED>\r\n ]>\r\n<Java>\r\n<one chapter="&avalue;"></one>\r\nNegative test. \r\nThe replacement text of any entity referred to directly or indirectly \r\nin an attribute value contains a less than character\r\n</Java>';
    expectRejects(input, "XML Parse error: '<' is not allowed in attribute values");
  });

  test("ibm-not-wf-P60-ibm60n08.xml", () => {
    // 3.3.2 — Tests DefaultDecl with more than one key word. The "#REQUIRED" and the "#IMPLIED" are used
    // as the key words in the DefaultDecl in the AttDef in the AttlistDecl in the DTD.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA #REQUIRED #IMPLIED>\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nNegative Test. More than one Default type declarations.\r\n</Java>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected an attribute name or '>' in the ATTLIST declaration but found '#IMPLIED'",
    );
  });

  test("ibm-not-wf-P61-ibm61n01.xml", () => {
    // 3.4 — Tests conditionalSect with a wrong option. The word "NOTINCLUDE" is used as part of an option
    // which is wrong in the coditionalSect. (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 61-->\r\n<!DOCTYPE animal SYSTEM "ibm61n01.dtd">\r\n<animal>\r\n <tiger/>\r\n</animal>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n01.xml", () => {
    // 3.4 — Tests includeSect with wrong key word. The string "include" is used as a key word in the
    // beginning sequence in the includeSect in the file ibm62n01.dtd. (upstream: not-wf; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n01.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test. Test includeSect with include(Case sensitive)\r\n</animal>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n02.xml", () => {
    // 3.4 — Tests includeSect with wrong beginning sequence. An extra "[" occurs in the beginning sequence
    // in the includeSect in the file ibm62n02.dtd. (upstream: not-wf; external parameter entities are not
    // read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n02.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test.  An extra \'[\' is used.\r\n</animal>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n03.xml", () => {
    // 3.4 — Tests includeSect with wrong beginning sequence. A wrong character "?" occurs in the beginning
    // sequence in the includeSect in the file ibm62n03.dtd. (upstream: not-wf; external parameter entities
    // are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n03.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test.  Wrong character is used is used.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n04.xml", () => {
    // 3.4 — Tests includeSect with a required field missing. The key word "INCLUDE" is missing in the
    // includeSect in the file ibm62n04.dtd. (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n04.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test.  Missing the required field INCLUDE.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n05.xml", () => {
    // 3.4 — Tests includeSect with a required field missing. The "[" is missing after the key word
    // "INCLUDE" in the includeSect in the file ibm62n05.dtd. (upstream: not-wf; external parameter
    // entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n05.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test.  Missing the required field \'[\' after INCLUDE.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n06.xml", () => {
    // 3.4 — Tests includeSect with wrong field ordering. The two external subset declarations occur before
    // the key word "INCLUDE" in the includeSect in the file ibm62n06.dtd. (upstream: not-wf; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n06.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test.  Wrong Ordering. External subset declaration prior to the keyword INCLUDE\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n07.xml", () => {
    // 3.4 — Tests includeSect with a required field missing. The closing sequence "]](greater than)" is
    // missing in the includeSect in the file ibm62n07.dtd. (upstream: not-wf; external parameter entities
    // are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n07.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test. Missing closing sequence.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P62-ibm62n08.xml", () => {
    // 3.4 — Tests includeSect with a required field missing. One "]" is missing in the closing sequence in
    // the includeSect in the file ibm62n08.dtd. (upstream: not-wf; external parameter entities are not
    // read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62n08.dtd">\r\n<animal>\r\n <tiger/>\r\nNegative test. Missing external subset declaration.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P63-ibm63n01.xml", () => {
    // 3.4 — Tests ignoreSect with wrong key word. The string "ignore" is used as a key word in the
    // beginning sequence in the ignoreSect in the file ibm63n01.dtd. (upstream: not-wf; external parameter
    // entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63n01.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "TIGER1">\r\nNegative test. Case sensitive(ignore is used instead of IGNORE).\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P63-ibm63n02.xml", () => {
    // 3.4 — Tests ignoreSect with wrong beginning sequence. An extra "[" occurs in the beginning sequence
    // in the ignoreSect in the file ibm63n02.dtd. (upstream: not-wf; external parameter entities are not
    // read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63n02.dtd"\r\n[\r\n<!ATTLIST attr a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "TIGER1">\r\nNegative test. Extra \'[\' is used before IGNORE.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P63-ibm63n03.xml", () => {
    // 3.4 — Tests ignoreSect with wrong beginning sequence. A wrong character "?" occurs in the beginning
    // sequence in the ignoreSect in the file ibm63n03.dtd. (upstream: not-wf; external parameter entities
    // are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63n03.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "TIGER1">\r\nNegative test.  Wrong character.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P63-ibm63n04.xml", () => {
    // 3.4 — Tests ignoreSect with a required field missing. The key word "IGNORE" is missing in the
    // ignoreSect in the file ibm63n04.dtd. (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63n04.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "TIGER1">\r\nNegative test.  Missing required field(The keyword IGNORE is missing).\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P63-ibm63n05.xml", () => {
    // 3.4 — Tests ignoreSect with a required field missing. The "[" is missing after the key word "IGNORE"
    // in the ignoreSect in the file ibm63n05.dtd. (upstream: not-wf; external parameter entities are not
    // read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63n05.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "TIGER1">\r\nNegative test.  Missing required field( \'[\' is missing after IGNORE ).\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P63-ibm63n06.xml", () => {
    // 3.4 — Tests includeSect with wrong field ordering. The two external subset declarations occur before
    // the key word "IGNORE" in the ignoreSect in the file ibm63n06.dtd. (upstream: not-wf; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63n06.dtd"\r\n[\r\n<!ATTLIST attr a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "TIGER1">\r\nNegative test.  Wrong Ordering. Ignore sect contents preceding IGNORE.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P63-ibm63n07.xml", () => {
    // 3.4 — Tests ignoreSect with a required field missing. The closing sequence "]](greater than)" is
    // missing in the ignoreSect in the file ibm63n07.dtd. (upstream: not-wf; external parameter entities
    // are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63n07.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "TIGER1">\r\nNegative test.  Missing closing sequence.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P64-ibm64n01.xml", () => {
    // 3.4 — Tests ignoreSectContents with wrong beginning sequence. The "?" occurs in beginning sequence
    // the ignoreSectContents in the file ibm64n01.dtd. (upstream: not-wf; external parameter entities are
    // not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 64-->\r\n<!DOCTYPE animal SYSTEM "ibm64n01.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nNegative Test. Pattern2. Wrong character.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P64-ibm64n02.xml", () => {
    // 3.4 — Tests ignoreSectContents with a required field missing.The closing sequence is missing in the
    // ignoreSectContents in the file ibm64n02.dtd. (upstream: not-wf; external parameter entities are not
    // read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 64-->\r\n<!DOCTYPE animal SYSTEM "ibm64n02.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nNegative Test. Pattern3. Missing closing sequence.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P64-ibm64n03.xml", () => {
    // 3.4 — Tests ignoreSectContents with a required field missing.The beginning sequence is missing in
    // the ignoreSectContents in the file ibm64n03.dtd. (upstream: not-wf; external parameter entities are
    // not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 64-->\r\n<!DOCTYPE animal SYSTEM "ibm64n03.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nNegative Test. Pattern4. Missing opening sequence.\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P65-ibm65n01.xml", () => {
    // 3.4 — Tests Ignore with illegal string included. The string "]](greater than)" is contained before
    // "this" in the Ignore in the ignoreSectContents in the file ibm65n01.dtd (upstream: not-wf; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 65-->\r\n<!DOCTYPE animal SYSTEM "ibm65n01.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nNegative Test. Pattern1.Illegal sequence of \']]\'\r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P65-ibm65n02.xml", () => {
    // 3.4 — Tests Ignore with illegal string included. The string "(less than)![" is contained before
    // "this" in the Ignore in the ignoreSectContents in the file ibm65n02.dtd (upstream: not-wf; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 65-->\r\n<!DOCTYPE animal SYSTEM "ibm65n02.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nNegative Test. Pattern2. \r\n</animal>';
    expectParses(input);
  });

  test("ibm-not-wf-P66-ibm66n01.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#002f" is used as the referred
    // character in the CharRef in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "wrong charater reference: &#002f;">\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found 'f'",
    );
  });

  test("ibm-not-wf-P66-ibm66n02.xml", () => {
    // 4.1 — Tests CharRef with the semicolon character missing. The semicolon character is missing at the
    // end of the CharRef in the attribute value in the STag of element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong character reference: &#x003a"/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found '\"'",
    );
  });

  test("ibm-not-wf-P66-ibm66n03.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "49" is used as the referred
    // character in the CharRef in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "wrong charater reference: &49;">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found '4'");
  });

  test("ibm-not-wf-P66-ibm66n04.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#5~0" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong charater reference:&#5~0;"/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found '~'",
    );
  });

  test("ibm-not-wf-P66-ibm66n05.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#x002g" is used as the referred
    // character in the CharRef in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "wrong charater reference: &#x002g;">\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found 'g'",
    );
  });

  test("ibm-not-wf-P66-ibm66n06.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#x006G" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong charater reference:&#x006G;"/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found 'G'",
    );
  });

  test("ibm-not-wf-P66-ibm66n07.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#0=2f" is used as the referred
    // character in the CharRef in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "wrong charater reference: &#x0=2f;">\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found '='",
    );
  });

  test("ibm-not-wf-P66-ibm66n08.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#56.0" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong charater reference:&#56.0;"/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found '.'",
    );
  });

  test("ibm-not-wf-P66-ibm66n09.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#x00/2f" is used as the referred
    // character in the CharRef in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "wrong charater reference: &#x00/2f;">\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found '/'",
    );
  });

  test("ibm-not-wf-P66-ibm66n10.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#51)" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong charater reference: &#51);"/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found ')'",
    );
  });

  test("ibm-not-wf-P66-ibm66n11.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#00 2f" is used as the referred
    // character in the CharRef in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "wrong charater reference: &#x00 2f;">\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Invalid character reference: expected a number followed by ';' but found space",
    );
  });

  test("ibm-not-wf-P66-ibm66n12.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#x0000" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong replacement charater reference: &#x0000;" />\r\n';
    expectRejects(input, "XML Parse error: Character reference '&#x0000;' is not a valid XML character");
  });

  test("ibm-not-wf-P66-ibm66n13.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#x001f" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong replacement charater: &#x001f;" />\r\n';
    expectRejects(input, "XML Parse error: Character reference '&#x001f;' is not a valid XML character");
  });

  test("ibm-not-wf-P66-ibm66n14.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#xfffe" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong replacement charater : &#xfffe;" />\r\n';
    expectRejects(input, "XML Parse error: Character reference '&#xfffe;' is not a valid XML character");
  });

  test("ibm-not-wf-P66-ibm66n15.xml", () => {
    // 4.1 — Tests CharRef with an illegal character referred to. The "#xffff" is used as the referred
    // character in the attribute value in the EmptyElemTag of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root EMPTY>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="wrong replacement charater: &#xffff;" />\r\n';
    expectRejects(input, "XML Parse error: Character reference '&#xffff;' is not a valid XML character");
  });

  test("ibm-not-wf-P68-ibm68n01.xml", () => {
    // 4.1 — Tests EntityRef with a required field missing. The Name is missing in the EntityRef in the
    // content of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root>missing entity name &;</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found ';'");
  });

  test("ibm-not-wf-P68-ibm68n02.xml", () => {
    // 4.1 — Tests EntityRef with a required field missing. The semicolon is missing in the EntityRef in
    // the attribute value in the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root att="&aaa">missing semi-colon</root>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' after the entity name but found '\"'");
  });

  test("ibm-not-wf-P68-ibm68n03.xml", () => {
    // 4.1 — Tests EntityRef with an extra white space. A white space occurs after the ampersand in the
    // EntityRef in the content of the element "root".
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root>extra space after ampsand & aaa;</root>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name after '&' but found space");
  });

  test("ibm-not-wf-P68-ibm68n04.xml", () => {
    // 4.1 — Tests EntityRef which is against P68 WFC: Entity Declared. The name "aAa" in the EntityRef in
    // the AttValue in the STage of the element "root" does not match the Name of any declared entity in
    // the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root att="&aAa;">reference doesn\'t match delaration</root>\r\n';
    expectRejects(input, "XML Parse error: Entity 'aAa' is not declared");
  });

  test("ibm-not-wf-P68-ibm68n05.xml", () => {
    // 4.1 — Tests EntityRef which is against P68 WFC: Entity Declared. The entity with the name "aaa" in
    // the EntityRef in the AttValue in the STag of the element "root" is not declared.
    const input: string =
      "<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root>undefined entitiy &aaa; </root>\r\n";
    expectRejects(input, "XML Parse error: Entity 'aaa' is not declared");
  });

  test("ibm-not-wf-P68-ibm68n06.xml", () => {
    // 4.1 — Tests EntityRef which is against P68 WFC: Entity Declared. The entity with the name "aaa" in
    // the EntityRef in the AttValue in the STag of the element "root" is externally declared, but
    // standalone is "yes". (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0" standalone="yes"?>\r\n<!DOCTYPE root SYSTEM "ibm68n06.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n]>\r\n<root att="&aaa;">entity declared externally but standalone is yes</root>\r\n';
    expectRejects(input, "XML Parse error: Entity 'aaa' is not declared");
  });

  test("ibm-not-wf-P68-ibm68n07.xml", () => {
    // 4.1 — Tests EntityRef which is against P68 WFC: Entity Declared. The entity with the name "aaa" in
    // the EntityRef in the AttValue in the STag of the element "root" is referred before declared.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Entity referenced before declared *-->\r\n<!ATTLIST root att1 CDATA "&aaa;">\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Entity 'aaa' is not declared");
  });

  test("ibm-not-wf-P68-ibm68n08.xml", () => {
    // 4.1 — Tests EntityRef which is against P68 WFC: Parsed Entity. The EntityRef in the AttValue in the
    // STag of the element "root" contains the name "aImage" of an unparsed entity.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "aString">\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root>unparsed entity reference in the wrong place &aImage;</root>\r\n';
    expectRejects(input, "XML Parse error: Unparsed entity 'aImage' cannot be referenced");
  });

  test("ibm-not-wf-P68-ibm68n09.xml", () => {
    // 4.1 — Tests EntityRef which is against P68 WFC: No Recursion. The recursive entity reference occurs
    // with the entity declarations for "aaa" and "bbb" in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* recursive entity reference *-->\r\n<!ENTITY aaa "&bbb;">\r\n<!ENTITY bbb "&aaa;">\r\n]>\r\n<root>&aaa;</root>\r\n\r\n';
    expectRejects(input, "XML Parse error: Entity 'aaa' refers to itself");
  });

  test("ibm-not-wf-P68-ibm68n10.xml", () => {
    // 4.1 — Tests EntityRef which is against P68 WFC: No Recursion. The indirect recursive entity
    // reference occurs with the entity declarations for "aaa", "bbb", "ccc", "ddd", and "eee" in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* indirect recursive entity reference *-->\r\n<!ENTITY aaa "&bbb;">\r\n<!ENTITY bbb "&ccc;">\r\n<!ENTITY ccc "&ddd;">\r\n<!ENTITY ddd "&eee;">\r\n<!ENTITY eee "&aaa;">\r\n]>\r\n<root>&aaa;</root>\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Entity 'aaa' refers to itself");
  });

  test("ibm-not-wf-P69-ibm69n01.xml", () => {
    // 4.1 — Tests PEReference with a required field missing. The Name "paaa" is missing in the PEReference
    // in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ENTITY % paaa "<!ATTLIST root att CDATA #IMPLIED>">\r\n<!--* incorrect PE reference *-->\r\n%;\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '%'");
  });

  test("ibm-not-wf-P69-ibm69n02.xml", () => {
    // 4.1 — Tests PEReference with a required field missing. The semicolon is missing in the PEReference
    // "%paaa" in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ENTITY % paaa "<!ATTLIST root att CDATA #IMPLIED>">\r\n<!--* incorrect PE reference without semicolon *-->\r\n%paaa\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected ';' to end the parameter entity reference 'paaa'");
  });

  test("ibm-not-wf-P69-ibm69n03.xml", () => {
    // 4.1 — Tests PEReference with an extra white space. There is an extra white space occurs before ";"
    // in the PEReference in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ENTITY % paaa "<!ATTLIST root att CDATA #IMPLIED>">\r\n<!--* incorrect PE reference with a extra white space charater *-->\r\n%paaa ;\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root/>\r\n\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected ';' to end the parameter entity reference 'paaa'");
  });

  test("ibm-not-wf-P69-ibm69n04.xml", () => {
    // 4.1 — Tests PEReference with an extra white space. There is an extra white space occurs after "%" in
    // the PEReference in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ENTITY % paaa "<!ATTLIST root att CDATA #IMPLIED>">\r\n<!--* incorrect PE reference with a extra white space char *-->\r\n% paaa;\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '%'");
  });

  test("ibm-not-wf-P69-ibm69n05.xml", () => {
    // 4.1 — Based on E29 substantial source: minutes XML-Syntax 1999-02-24 E38 in XML 1.0 Errata, this WFC
    // does not apply to P69, but the VC Entity declared still apply. Tests PEReference which is against
    // P69 WFC: Entity Declared. The PE with the name "paaa" is referred before declared in the DTD.
    // (upstream: optional error)
    const input: string =
      '<?xml version="1.0" standalone="yes"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* PE referenced before declared, against WFC: entity declared -->\r\n%paaa;\r\n<!ENTITY % paaa "<!ATTLIST root att CDATA #IMPLIED>">\r\n<!ENTITY aaa "aString">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Parameter entity 'paaa' is not declared");
  });

  test("ibm-not-wf-P69-ibm69n06.xml", () => {
    // 4.1 — Tests PEReference which is against P69 WFC: No Recursion. The recursive PE reference occurs
    // with the entity declarations for "paaa" and "bbb" in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* recursive PE reference -->\r\n<!ENTITY % paaa "&bbb;">\r\n<!ENTITY bbb "%paaa;">\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("ibm-not-wf-P69-ibm69n07.xml", () => {
    // 4.1 — Tests PEReference which is against P69 WFC: No Recursion. The indirect recursive PE reference
    // occurs with the entity declarations for "paaa", "bbb", "ccc", "ddd", and "eee" in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!--* indirect recursive PE reference -->\r\n<!ENTITY % paaa "&bbb;">\r\n<!ENTITY bbb "&ccc;">\r\n<!ENTITY ccc "&ddd;">\r\n<!ENTITY ddd "&eee;">\r\n<!ENTITY eee "%paaa;">\r\n]>\r\n<root/>\r\n\r\n';
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("ibm-not-wf-P71-ibm70n01.xml", () => {
    // 4.2 — Tests
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ENTITY aaa "aString">\r\n<!--* mess up Entity Declaration *-->\r\n<root/>\r\n<!ENTITY % paaa "aString">\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '<root'",
    );
  });

  test("ibm-not-wf-P71-ibm71n01.xml", () => {
    // 4.2 — Tests EntityDecl with a required field missing. The white space is missing between the
    // beginning sequence and the Name "aaa" in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing space  *-->\r\n<!ENTITYaaa "aString">\r\n\r\n]>\r\n<root>&aaa;</root>\r\n\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'aaa'");
  });

  test("ibm-not-wf-P71-ibm71n02.xml", () => {
    // 4.2 — Tests EntityDecl with a required field missing. The white space is missing between the Name
    // "aaa" and the EntityDef "aString" in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing space  *-->\r\n<!ENTITY aaa"aString">\r\n\r\n]>\r\n<root>&aaa;</root>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P71-ibm71n03.xml", () => {
    // 4.2 — Tests EntityDecl with a required field missing. The EntityDef is missing in the EntityDecl
    // with the Name "aaa" in the DTD.
    const input: string =
      "<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing EntityDef  *-->\r\n<!ENTITY aaa>\r\n\r\n]>\r\n<root>&aaa;</root>\r\n";
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found '>'");
  });

  test("ibm-not-wf-P71-ibm71n04.xml", () => {
    // 4.2 — Tests EntityDecl with a required field missing. The Name is missing in the EntityDecl with the
    // EntityDef "aString" in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing name  *-->\r\n<!ENTITY "aString">\r\n\r\n]>\r\n<root>&aaa;</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name or '%' after '<!ENTITY' but found '\"'");
  });

  test("ibm-not-wf-P71-ibm71n05.xml", () => {
    // 4.2 — Tests EntityDecl with wrong ordering. The Name "aaa" occurs after the EntityDef in the
    // EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* wrong ordering  *-->\r\n<!ENTITY "aString" aaa>\r\n]>\r\n<root>&aaa;</root>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name or '%' after '<!ENTITY' but found '\"'");
  });

  test("ibm-not-wf-P71-ibm71n06.xml", () => {
    // 4.2 — Tests EntityDecl with wrong key word. The string "entity" is used as the key word in the
    // beginning sequence in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* ENTITY in lower case  *-->\r\n<!entity aaa "aString">\r\n]>\r\n<root>&aaa;</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P71-ibm71n07.xml", () => {
    // 4.2 — Tests EntityDecl with a required field missing. The closing bracket (greater than) is missing
    // in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing closing bracket  *-->\r\n<!ENTITY aaa "aString"\r\n\r\n]>\r\n<root>&aaa;</root>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found ']'");
  });

  test("ibm-not-wf-P71-ibm71n08.xml", () => {
    // 4.2 — Tests EntityDecl with a required field missing. The exclamation mark is missing in the
    // beginning sequence in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* exclamation mark missing  *-->\r\n<ENTITY aaa "aString">\r\n\r\n]>\r\n<root>&aaa;</root>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '<ENTITY'",
    );
  });

  test("ibm-not-wf-P72-ibm72n01.xml", () => {
    // 4.2 — Tests PEdecl with a required field missing. The white space is missing between the beginning
    // sequence and the "%" in the PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing space  *-->\r\n<!ENTITY% paaa "<!-- comments -->">\r\n%paaa;\r\n]>\r\n<root/>\r\n\r\n\r\n\r\n\r\n\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before '%'");
  });

  test("ibm-not-wf-P72-ibm72n02.xml", () => {
    // 4.2 — Tests PEdecl with a required field missing. The Name is missing in the PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing name  *-->\r\n<!ENTITY % "<!-- comments -->">\r\n%paaa;\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected the parameter entity name after '%' but found '\"'");
  });

  test("ibm-not-wf-P72-ibm72n03.xml", () => {
    // 4.2 — Tests PEdecl with a required field missing. The white space is missing between the Name and
    // the PEDef in the PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing space  *-->\r\n<!ENTITY % paaa"<!-- comments -->">\r\n%paaa;\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P72-ibm72n04.xml", () => {
    // 4.2 — Tests PEdecl with a required field missing. The PEDef is missing after the Name "paaa" in the
    // PEDecl in the DTD.
    const input: string =
      "<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing PEDef  *-->\r\n<!ENTITY % paaa>\r\n%paaa;\r\n]>\r\n<root/>\r\n";
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found '>'");
  });

  test("ibm-not-wf-P72-ibm72n05.xml", () => {
    // 4.2 — Tests PEdecl with wrong field ordering. The Name "paaa" occurs after the PEDef in the PEDecl
    // in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* wrong order  *-->\r\n<!ENTITY % "<!-- comments -->" paaa>\r\n%paaa;\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected the parameter entity name after '%' but found '\"'");
  });

  test("ibm-not-wf-P72-ibm72n06.xml", () => {
    // 4.2 — Tests PEdecl with wrong field ordering. The "%" and the Name "paaa" occurs after the PEDef in
    // the PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* wrong order  *-->\r\n<!ENTITY "<!-- comments -->" % paaa >\r\n%paaa;\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected an entity name or '%' after '<!ENTITY' but found '\"'");
  });

  test("ibm-not-wf-P72-ibm72n07.xml", () => {
    // 4.2 — Tests PEdecl with wrong key word. The string "entity" is used as the key word in the beginning
    // sequence in the PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* wrong keyword  *-->\r\n<!entity % paaa "<!-- comments -->">\r\n%paaa;\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P72-ibm72n08.xml", () => {
    // 4.2 — Tests PEdecl with a required field missing. The closing bracket (greater than) is missing in
    // the PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing closing bracket  *-->\r\n<!ENTITY % paaa "<!-- comments -->"\r\n%paaa;\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Parameter entity references are not allowed inside markup declarations in the internal subset",
    );
  });

  test("ibm-not-wf-P72-ibm72n09.xml", () => {
    // 4.2 — Tests PEdecl with wrong closing sequence. The string "!(greater than)" is used as the closing
    // sequence in the PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* wrong closing sequence: extra exclamation mark *-->\r\n<!ENTITY% paaa "<!-- comments -->" !>\r\n%paaa;\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before '%'");
  });

  test("ibm-not-wf-P73-ibm73n01.xml", () => {
    // 4.2 — Tests EntityDef with wrong field ordering. The NDataDecl "NDATA JPGformat" occurs before the
    // ExternalID in the EntityDef in the EntityDecl.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* wrong order: NDataDecl ExternalID  *-->\r\n<!ENTITY aImage NDATA JPGformat SYSTEM "image.jpg" >\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found 'NDATA'");
  });

  test("ibm-not-wf-P73-ibm73n03.xml", () => {
    // 4.2 — Tests EntityDef with a required field missing. The ExternalID is missing before the NDataDecl
    // in the EntityDef in the EntityDecl.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* missing ExternalID  *-->\r\n<!ENTITY aImage NDATA JPGformat >\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found 'NDATA'");
  });

  test("ibm-not-wf-P74-ibm74n01.xml", () => {
    // 4.2 — Tests PEDef with extra fields. The NDataDecl occurs after the ExternalID in the PEDef in the
    // PEDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* wrong PEDef: NDataDecl ExternalID  *-->\r\n<!ENTITY % pImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Parameter entities cannot have NDATA");
  });

  test("ibm-not-wf-P75-ibm75n01.xml", () => {
    // 4.2.2 — Tests ExternalID with wrong key word. The string "system" is used as the key word in the
    // ExternalID in the EntityDef in the EntityDecl.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* wrong keyword: system  *-->\r\n<!ENTITY pImage system "image.jpg">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted entity value, SYSTEM or PUBLIC but found 'system'");
  });

  test("ibm-not-wf-P75-ibm75n02.xml", () => {
    // 4.2.2 — Tests ExternalID with wrong key word. The string "public" is used as the key word in the
    // ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* wrong keyword: public  *-->\r\n<!DOCTYPE root \r\n    public "-//W3C//DTD//EN" "empty.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found 'public'",
    );
  });

  test("ibm-not-wf-P75-ibm75n03.xml", () => {
    // 4.2.2 — Tests ExternalID with wrong key word. The string "Public" is used as the key word in the
    // ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* wrong keyword: Public  *-->\r\n<!DOCTYPE root \r\n    Public "-//W3C//DTD//EN" "empty.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found 'Public'",
    );
  });

  test("ibm-not-wf-P75-ibm75n04.xml", () => {
    // 4.2.2 — Tests ExternalID with wrong field ordering. The key word "PUBLIC" occurs after the
    // PublicLiteral and the SystemLiteral in the ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* wrong order *-->\r\n<!DOCTYPE root \r\n    "-//W3C//DTD//EN" "empty.dtd" PUBLIC\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '\"'",
    );
  });

  test("ibm-not-wf-P75-ibm75n05.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The white space between "SYSTEM" and the
    // Systemliteral is missing in the ExternalID in the EntityDef in the EntityDecl in the DTD.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing space *-->\r\n<!ENTITY pImage SYSTEM"image.jpg">\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P75-ibm75n06.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The Systemliteral is missing after "SYSTEM"
    // in the ExternalID in the EntityDef in the EntityDecl in the DTD.
    const input: string =
      "<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* missing SystemLiterral *-->\r\n<!ENTITY pImage SYSTEM >\r\n]>\r\n<root/>\r\n";
    expectRejects(input, "XML Parse error: Expected a quoted system identifier after SYSTEM but found '>'");
  });

  test("ibm-not-wf-P75-ibm75n07.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The white space between the PublicLiteral
    // and the Systemliteral is missing in the ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* missing space  *-->\r\n<!DOCTYPE root \r\n    PUBLIC "-//W3C//DTD//EN""empty.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P75-ibm75n08.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The key word "PUBLIC" is missing in the
    // ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* missing keyword: PUBLIC  *-->\r\n<!DOCTYPE root \r\n    "-//W3C//DTD//EN" "empty.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '\"'",
    );
  });

  test("ibm-not-wf-P75-ibm75n09.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The white space between "PUBLIC" and the
    // PublicLiteral is missing in the ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* missing space  *-->\r\n<!DOCTYPE root \r\n    PUBLIC"-//W3C//DTD//EN" "empty.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P75-ibm75n10.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The PublicLiteral is missing in the
    // ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* missing PubidLiteral  *-->\r\n<!DOCTYPE root \r\n    PUBLIC ".\\empty.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Invalid character in a public identifier: '\\'");
  });

  test("ibm-not-wf-P75-ibm75n11.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The PublicLiteral is missing in the
    // ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* missing System Literal *-->\r\n<!DOCTYPE root \r\n    public "-//W3C//DTD//EN"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found 'public'",
    );
  });

  test("ibm-not-wf-P75-ibm75n12.xml", () => {
    // 4.2.2 — Tests ExternalID with a required field missing. The SystemLiteral is missing in the
    // ExternalID in the doctypedecl.
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* wrong order *-->\r\n<!ENTITY pImage "image.jpg" SYSTEM>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'SYSTEM'");
  });

  test("ibm-not-wf-P75-ibm75n13.xml", () => {
    // 4.2.2 — Tests ExternalID with wrong field ordering. The key word "PUBLIC" occurs after the
    // PublicLiteral in the ExternalID in the doctypedecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!--* wrong order *-->\r\n<!DOCTYPE root \r\n    "-//W3C//DTD//EN" PUBLIC "empty.dtd"\r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '\"'",
    );
  });

  test("ibm-not-wf-P76-ibm76n01.xml", () => {
    // 4.2.2 — Tests NDataDecl with wrong key word. The string "ndata" is used as the key word in the
    // NDataDecl in the EntityDef in the GEDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* wrong keyword in NdataDecl: ndata *-->\r\n<!ENTITY aImage SYSTEM "image.jpg" ndata JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'ndata'");
  });

  test("ibm-not-wf-P76-ibm76n02.xml", () => {
    // 4.2.2 — Tests NDataDecl with wrong key word. The string "NData" is used as the key word in the
    // NDataDecl in the EntityDef in the GEDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* wrong keyword in NdataDecl: NData *-->\r\n<!ENTITY aImage SYSTEM "image.jpg" NData JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'NData'");
  });

  test("ibm-not-wf-P76-ibm76n03.xml", () => {
    // 4.2.2 — Tests NDataDecl with a required field missing. The leading white space is missing in the
    // NDataDecl in the EntityDef in the GEDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* missing space in NdataDecl *-->\r\n<!ENTITY aImage SYSTEM "image.jpg"NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'NDATA'");
  });

  test("ibm-not-wf-P76-ibm76n04.xml", () => {
    // 4.2.2 — Tests NDataDecl with a required field missing. The key word "NDATA" is missing in the
    // NDataDecl in the EntityDef in the GEDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* missing keyword in NdataDecl : NDATA *-->\r\n<!ENTITY aImage SYSTEM "image.jpg" JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'JPGformat'");
  });

  test("ibm-not-wf-P76-ibm76n05.xml", () => {
    // 4.2.2 — Tests NDataDecl with a required field missing. The Name after the key word "NDATA" is
    // missing in the NDataDecl in the EntityDef in the GEDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* Missing Name field in NdataDecl *-->\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected a notation name after NDATA but found '>'");
  });

  test("ibm-not-wf-P76-ibm76n06.xml", () => {
    // 4.2.2 — Tests NDataDecl with a required field missing. The white space between "NDATA" and the Name
    // is missing in the NDataDecl in the EntityDef in the GEDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* missing space in NdataDecl *-->\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATAJPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'NDATAJPGformat'");
  });

  test("ibm-not-wf-P76-ibm76n07.xml", () => {
    // 4.2.2 — Tests NDataDecl with wrong field ordering. The key word "NDATA" occurs after the Name in the
    // NDataDecl in the EntityDef in the GEDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!--* wrong order in NdataDecl *-->\r\n<!ENTITY aImage SYSTEM "image.jpg" JPGformat NDATA>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the entity declaration but found 'JPGformat'");
  });

  test("ibm-not-wf-P77-ibm77n01.xml", () => {
    // 4.3.1 — Tests TextDecl with wrong field ordering. The VersionInfo occurs after the EncodingDecl in
    // the TextDecl in the file "ibm77n01.ent". (upstream: not-wf; external general entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY aExternal SYSTEM "ibm77n01.ent">\r\n]>\r\n<root>&aExternal;</root>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P77-ibm77n02.xml", () => {
    // 4.3.1 — Tests TextDecl with wrong key word. The string "XML" is used in the beginning sequence in
    // the TextDecl in the file "ibm77n02.ent". (upstream: not-wf; external general entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY aExternal SYSTEM "ibm77n02.ent">\r\n]>\r\n<root>&aExternal;</root>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P77-ibm77n03.xml", () => {
    // 4.3.1 — Tests TextDecl with wrong closing sequence. The character "greater than" is used as the
    // closing sequence in the TextDecl in the file "ibm77n03.ent". (upstream: not-wf; external parameter
    // entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY % pExternal SYSTEM "ibm77n03.ent">\r\n%pExternal;\r\n]>\r\n<root/>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P77-ibm77n04.xml", () => {
    // 4.3.1 — Tests TextDecl with a required field missing. The closing sequence is missing in the
    // TextDecl in the file "ibm77n04.ent". (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY % pExternal SYSTEM "ibm77n04.ent">\r\n%pExternal;\r\n]>\r\n<root/>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P78-ibm78n01.xml", () => {
    // 4.3.2 — Tests extParsedEnt with wrong field ordering. The TextDecl occurs after the content in the
    // file ibm78n01.ent. (upstream: not-wf; external general entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY aExternal SYSTEM "ibm78n01.ent">\r\n]>\r\n<root>&aExternal;</root>\r\n\r\n\r\n\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P78-ibm78n02.xml", () => {
    // 4.3.2 — Tests extParsedEnt with extra field. A blank line occurs before the TextDecl in the file
    // ibm78n02.ent. (upstream: not-wf; external general entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY aExternal SYSTEM "ibm78n02.ent">\r\n]>\r\n<root>&aExternal;</root>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P79-ibm79n01.xml", () => {
    // 4.3.2 — Tests extPE with wrong field ordering. The TextDecl occurs after the extSubsetDecl (the
    // white space and the comment) in the file ibm79n01.ent. (upstream: not-wf; external parameter
    // entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY % pExternal SYSTEM "ibm79n01.ent">\r\n%pExternal;\r\n]>\r\n<root/>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P79-ibm79n02.xml", () => {
    // 4.3.2 — Tests extPE with extra field. A blank line occurs before the TextDecl in the file
    // ibm78n02.ent. (upstream: not-wf; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* error in external entity  *-->\r\n<!ENTITY % pExternal SYSTEM "ibm79n02.ent">\r\n%pExternal;\r\n]>\r\n<root/>\r\n';
    expectParses(input);
  });

  test("ibm-not-wf-P80-ibm80n01.xml", () => {
    // 4.3.3 — Tests EncodingDecl with a required field missing. The leading white space is missing in the
    // EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0"encoding="UTF-8"?>\r\n<!--* missing white space in above EncodingDecl *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Whitespace is required before 'encoding'");
  });

  test("ibm-not-wf-P80-ibm80n02.xml", () => {
    // 4.3.3 — Tests EncodingDecl with a required field missing. The "=" sign is missing in the
    // EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding "UTF-8"?>\r\n<!--* missing Eq in above EncodingDecl *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Expected '=' after the name in the XML declaration but found '\"'");
  });

  test("ibm-not-wf-P80-ibm80n03.xml", () => {
    // 4.3.3 — Tests EncodingDecl with a required field missing. The double quoted EncName are missing in
    // the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding= ?>\r\n<!--* missing EncName in above EncodingDecl *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Expected a quoted value in the XML declaration but found '?'");
  });

  test("ibm-not-wf-P80-ibm80n04.xml", () => {
    // 4.3.3 — Tests EncodingDecl with wrong field ordering. The string "encoding=" occurs after the double
    // quoted EncName in the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" "UTF-8"encoding=?>\r\n<!--* wrong ordering in above EncodingDecl *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Expected '?>' to end the XML declaration but found '\"'");
  });

  test("ibm-not-wf-P80-ibm80n05.xml", () => {
    // 4.3.3 — Tests EncodingDecl with wrong field ordering. The "encoding" occurs after the double quoted
    // EncName in the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" "UTF-8"=encoding?>\r\n<!--* wrong ordering in above EncodingDecl *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Expected '?>' to end the XML declaration but found '\"'");
  });

  test("ibm-not-wf-P80-ibm80n06.xml", () => {
    // 4.3.3 — Tests EncodingDecl with wrong key word. The string "Encoding" is used as the key word in the
    // EncodingDecl in the XMLDecl.
    const input: string =
      '<?xml version="1.0" Encoding="UTF-8"?>\r\n<!--* Wrong keyword Encoding in above EncodingDecl *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: Unexpected 'Encoding' in the XML declaration (expected version, encoding or standalone)",
    );
  });

  test("ibm-not-wf-P81-ibm81n01.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The "_" is used as the first character in the
    // EncName in the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="_UTF-8"?>\r\n<!--* Illegal inital Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name '_UTF-8' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n02.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The "-" is used as the first character in the
    // EncName in the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="-UTF-8"?>\r\n<!--* Illegal inital Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name '-UTF-8' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n03.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The "." is used as the first character in the
    // EncName in the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding=".UTF-8"?>\r\n<!--* Illegal inital Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name '.UTF-8' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n04.xml", () => {
    // 4.3.3 — Tests EncName with illegal characters. The "8-" is used as the initial characters in the
    // EncName in the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="8-UTF"?>\r\n<!--* Illegal initial Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name '8-UTF' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n05.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The "~" is used as one character in the EncName in
    // the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF~8"?>\r\n<!--* Illegal Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name 'UTF~8' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n06.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The "#" is used as one character in the EncName in
    // the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF#8"?>\r\n<!--* Illegal Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name 'UTF#8' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n07.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The ":" is used as one character in the EncName in
    // the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF:8"?>\r\n<!--* IllegalCharater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name 'UTF:8' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n08.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The "/" is used as one character in the EncName in
    // the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF/8"?>\r\n<!--* Illegal Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name 'UTF/8' in the XML declaration");
  });

  test("ibm-not-wf-P81-ibm81n09.xml", () => {
    // 4.3.3 — Tests EncName with an illegal character. The ";" is used as one character in the EncName in
    // the EncodingDecl in the XMLDecl.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF;8"?>\r\n<!--* Illegal Charater in above EncName *-->\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n]>\r\n<root/>\r\n',
    );
    expectRejects(input, "XML Parse error: Invalid encoding name 'UTF;8' in the XML declaration");
  });

  test("ibm-not-wf-P82-ibm82n01.xml", () => {
    // 4.7 — Tests NotationDecl with a required field missing. The white space after the beginning sequence
    // of the NotationDecl is missing in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Missing whitespace in NotationDecl *-->\r\n<!NOTATIONJPGformat SYSTEM "JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before 'JPGformat'");
  });

  test("ibm-not-wf-P82-ibm82n02.xml", () => {
    // 4.7 — Tests NotationDecl with a required field missing. The Name in the NotationDecl is missing in
    // the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Missing Name in NotationDecl *-->\r\n<!NOTATION PUBLIC "-//JPG//DTD//JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected SYSTEM or PUBLIC in the notation declaration but found '\"'");
  });

  test("ibm-not-wf-P82-ibm82n03.xml", () => {
    // 4.7 — Tests NotationDecl with a required field missing. The externalID or the PublicID is missing in
    // the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Missing ExternalID or PublicID in NotationDecl *-->\r\n<!NOTATION JPGformat >\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected SYSTEM or PUBLIC in the notation declaration but found '>'");
  });

  test("ibm-not-wf-P82-ibm82n04.xml", () => {
    // 4.7 — Tests NotationDecl with wrong field ordering. The Name occurs after the "SYSTEM" and the
    // externalID in the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Wrong ordering in NotationDecl *-->\r\n<!NOTATION SYSTEM "JPGFormat" JPGformat >\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected SYSTEM or PUBLIC in the notation declaration but found '\"'");
  });

  test("ibm-not-wf-P82-ibm82n05.xml", () => {
    // 4.7 — Tests NotationDecl with wrong key word. The string "notation" is used as a key word in the
    // NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Wrong keyword: notation in NotationDecl *-->\r\n<!notation JPGformat SYSTEM "JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(
      input,
      "XML Parse error: '<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration",
    );
  });

  test("ibm-not-wf-P82-ibm82n06.xml", () => {
    // 4.7 — Tests NotationDecl with a required field missing. The closing bracket (the greater than
    // character) is missing in the NotationDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Missing closing bracket in NotationDecl *-->\r\n<!NOTATION JPGformat PUBLIC "-//JPG//DTD//JPGFormat"\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the notation declaration but found '<!ENTITY'");
  });

  test("ibm-not-wf-P82-ibm82n07.xml", () => {
    // 4.7 — Tests NotationDecl with wrong beginning sequence. The "!" is missing in the beginning sequence
    // in the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Wrong beginning sequence in NotationDecl *-->\r\n<NOTATION JPGformat PUBLIC "-//JPG//DTD//JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n';
    expectRejects(
      input,
      "XML Parse error: Expected a markup declaration or ']' in the internal subset but found '<NOTATION'",
    );
  });

  test("ibm-not-wf-P82-ibm82n08.xml", () => {
    // 4.7 — Tests NotationDecl with wrong closing sequence. The extra "!" occurs in the closing sequence
    // in the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Wrong Closing sequence in NotationDecl *-->\r\n<!NOTATION JPGformat SYSTEM "JPGFormat"!>\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected '>' to end the notation declaration but found '!'");
  });

  test("ibm-not-wf-P83-ibm83n01.xml", () => {
    // 4.7 — Tests PublicID with wrong key word. The string "public" is used as the key word in the
    // PublicID in the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Wrong keyword in PublicID *-->\r\n<!NOTATION JPGformat public "-//JPG//DTD//JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n\r\n';
    expectRejects(input, "XML Parse error: Expected SYSTEM or PUBLIC in the notation declaration but found 'public'");
  });

  test("ibm-not-wf-P83-ibm83n02.xml", () => {
    // 4.7 — Tests PublicID with wrong key word. The string "Public" is used as the key word in the
    // PublicID in the NotationDecl in the DTD.
    const input: string =
      'r<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Wrong keyword : Public in PublicID *-->\r\n<!NOTATION JPGformat Public "-//JPG//DTD//JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected the root element but found 'r'");
  });

  test("ibm-not-wf-P83-ibm83n03.xml", () => {
    // 4.7 — Tests PublicID with a required field missing. The key word "PUBLIC" is missing in the PublicID
    // in the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Missing keyword in PublicID *-->\r\n<!NOTATION JPGformat "-//JPG//DTD//JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected SYSTEM or PUBLIC in the notation declaration but found '\"'");
  });

  test("ibm-not-wf-P83-ibm83n04.xml", () => {
    // 4.7 — Tests PublicID with a required field missing. The white space between the "PUBLIC" and the
    // PubidLiteral is missing in the PublicID in the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Missing White space in PublicID *-->\r\n<!NOTATION JPGformat PUBLIC"-//JPG//DTD//JPGFormat">\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Whitespace is required before a quoted string");
  });

  test("ibm-not-wf-P83-ibm83n05.xml", () => {
    // 4.7 — Tests PublicID with a required field missing. The PubidLiteral is missing in the PublicID in
    // the NotationDecl in the DTD.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Missing PubidLiteral in PublicID *-->\r\n<!NOTATION JPGformat PUBLIC >\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected a quoted public identifier after PUBLIC but found '>'");
  });

  test("ibm-not-wf-P83-ibm83n06.xml", () => {
    // 4.7 — Tests PublicID with wrong field ordering. The key word "PUBLIC" occurs after the PubidLiteral
    // in the PublicID in the NotationDecl.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!--* Wrong ordering in PublicID *-->\r\n<!NOTATION JPGformat "-//JPG//DTD//JPGFormat" PUBLIC>\r\n<!ENTITY aImage SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root/>\r\n';
    expectRejects(input, "XML Parse error: Expected SYSTEM or PUBLIC in the notation declaration but found '\"'");
  });

  test("ibm-not-wf-P85-ibm85n01.xml", () => {
    // B. — Tests BaseChar with an illegal character. The character #x00D7 occurs as the first character of
    // the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?× an illegal char #x0d7\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectRejects(input, "XML Parse error: Expected a processing instruction target after '<?' but found '×' (U+00D7)");
  });

  test("ibm-not-wf-P85-ibm85n02.xml", () => {
    // B. — Tests BaseChar with an illegal character. The character #x00F7 occurs as the first character of
    // the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?÷ an illegal char #x0f7\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectRejects(input, "XML Parse error: Expected a processing instruction target after '<?' but found '÷' (U+00F7)");
  });

  test("ibm-not-wf-P88-ibm88n01.xml", () => {
    // B. — Tests Digit with an illegal character. The character #x0029 occurs as the second character in
    // the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_) an illegal char #x29 in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected whitespace or '?>' after the processing instruction target but found ')'",
    );
  });

  test("ibm-not-wf-P88-ibm88n02.xml", () => {
    // B. — Tests Digit with an illegal character. The character #x003B occurs as the second character in
    // the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_; an illegal char #x3b in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected whitespace or '?>' after the processing instruction target but found ';'",
    );
  });

  test("ibm-not-wf-P89-ibm89n01.xml", () => {
    // B. — Tests Extender with an illegal character. The character #x00B6 occurs as the second character
    // in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_¶ an illegal extender #x0b6 in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected whitespace or '?>' after the processing instruction target but found '¶' (U+00B6)",
    );
  });

  test("ibm-not-wf-P89-ibm89n02.xml", () => {
    // B. — Tests Extender with an illegal character. The character #x00B8 occurs as the second character
    // in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_¸ an illegal extender #x0b8 in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectRejects(
      input,
      "XML Parse error: Expected whitespace or '?>' after the processing instruction target but found '¸' (U+00B8)",
    );
  });

  test("ibm-valid-P01-ibm01v01.xml", () => {
    // 2.1 — Tests with a xml document consisting of prolog followed by element then Misc
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\r\n<!-- Above is XMLDecl -->\r\n<!DOCTYPE animal [\r\n<!ELEMENT animal (cat|tiger|leopard)+>\r\n<!ELEMENT cat EMPTY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ELEMENT leopard ANY>\r\n<!ELEMENT small EMPTY>\r\n<!ELEMENT big EMPTY>\r\n<!ATTLIST tiger color CDATA #REQUIRED>\r\n]>\r\n<!-- Above is DTD -->\r\n<?music "Here is a PI" ?> \r\n<animal>\r\n   <cat/>\r\n   <tiger color="white">This is a white tiger in Mirage!!</tiger>\r\n   <cat/>\r\n   <leopard>\r\n      <small/>\r\n      <big/>\r\n   </leopard>\r\n</animal>\r\n<!-- Above is element animal -->\r\n\r\n',
    );
    const canonical =
      '<animal>&#10;   <cat></cat>&#10;   <tiger color="white">This is a white tiger in Mirage!!</tiger>&#10;   <cat></cat>&#10;   <leopard>&#10;      <small></small>&#10;      <big></big>&#10;   </leopard>&#10;</animal>';
    const compact: unknown = {
      animal: {
        cat: ["", ""],
        tiger: { "@color": "white", "#text": "This is a white tiger in Mirage!!" },
        leopard: { small: "", big: "" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P02-ibm02v01.xml", () => {
    // 2.2 — This test case covers legal character ranges plus discrete legal characters for production 02.
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n<!-- This test case covers     legal character ranges plus\r\n        discrete legal characters for production 02. -->\r\n<?NAME_09-\t_0A-\r\n_0D-\r\n_20- _D7FF-퟿_6c0f-氏_E000-_FFFD-�_effe-_010000-𐀀_10FFFF-􏿿_08ffff-򏿿 This is a PI target ?>\r\n]>\r\n<book/>\r\n',
    );
    expectParses(input);
  });

  test("ibm-valid-P03-ibm03v01.xml", () => {
    // 2.3 — Tests all 4 legal white space characters - #x20 #x9 #xD #xA
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" ?>\r\r\n<!DOCTYPE book [\r\r\n<!ELEMENT book ANY>\r\r\n<!-- This test case covers 0 legal character ranges plus\r\r\n     4 discrete legal characters for production 03. -->\r\r\n<?NAME_20- _09-\t_0D-\r_0A-\r\r\n This is a PI target ?>\r\r\n]>\r\r\n<book/>\r\r\n',
    );
    expectParses(input);
  });

  test("ibm-valid-P09-ibm09v01.xml", () => {
    // 2.3 — Empty EntityValue is legal
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n \t<!ENTITY FullName "">\r\n]>\r\n\r\n<student>My Name is &FullName;. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    const canonical = "<student>My Name is . </student>";
    const compact: unknown = { student: "My Name is . " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P09-ibm09v02.xml", () => {
    // 2.3 — Tests a normal EnitityValue
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n \t<!ENTITY FullName "SnowMan">\r\n]>\r\n\r\n<student>My Name is &FullName;. </student>';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P09-ibm09v03.xml", () => {
    // 2.3 — Tests EnitityValue referencing a Parameter Entity (upstream: valid; external parameter
    // entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student  SYSTEM "ibm09v03.dtd">\r\n<student>I am a new student with &Name;</student>\r\n';
    expectParses(input);
  });

  test("ibm-valid-P09-ibm09v04.xml", () => {
    // 2.3 — Tests EnitityValue referencing a General Entity
    const input: string =
      '<?xml version="1.0"?> \r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n<!-- testing entity value with Reference -->\r\n\t<!ENTITY RealName "SnowMan"> \r\n \t<!ENTITY FullName "&RealName;">\r\n]>\r\n\r\n<student>My Name is &FullName;. </student>';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P09-ibm09v05.xml", () => {
    // 2.3 — Tests EnitityValue with combination of GE, PE and text, the GE used is declared in the
    // student.dtd (upstream: valid; external parameter entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student SYSTEM "student.dtd"[\r\n\t<!ELEMENT student (#PCDATA)> \r\n\t<!ENTITY Age "21">\r\n\t<!ENTITY Status "freshman">\r\n \t<!ENTITY % FullName "first , last , middle">\r\n]>\r\n\r\n<!-- testing entity value with combination reference -->\r\n<student>This is a test of &combine;</student>\r\n\r\n\r\n\r\n';
    expectParses(input);
  });

  test("ibm-valid-P10-ibm10v01.xml", () => {
    // 2.3 — Tests empty AttValue with double quotes as the delimiters
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "Y">\r\n\t<!ENTITY mylast "">\r\n]>\r\n<!-- testing AttValue with empty char inside double quote -->\r\n<student first="" last="">My Name is Snow &mylast; Man. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n';
    const canonical = '<student first="" last="">My Name is Snow  Man. </student>';
    const compact: unknown = { student: { "@first": "", "@last": "", "#text": "My Name is Snow  Man. " } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P10-ibm10v02.xml", () => {
    // 2.3 — Tests empty AttValue with single quotes as the delimiters
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst \"Snow\">\r\n\t<!ENTITY mymiddle \"Y\">\r\n\t<!ENTITY mylast ''>\r\n]>\r\n<!-- testing AttValue with empty char inside single quote -->\r\n<student first='' last=''>My Name is Snow &mylast; Man. </student>\r\n\r\n";
    const canonical = '<student first="" last="">My Name is Snow  Man. </student>';
    const compact: unknown = { student: { "@first": "", "@last": "", "#text": "My Name is Snow  Man. " } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P10-ibm10v03.xml", () => {
    // 2.3 — Test AttValue with double quotes as the delimiters and single quote inside
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst \'Snow\'>\r\n\t<!ENTITY mymiddle \'I\'>\r\n\t<!ENTITY mylast "Man\'">\r\n]>\r\n<!-- testing AttValue string with a single quote inside -->\r\n<student first="Snow\'" last="Man">My Name is &myfirst; &mylast;. </student>';
    const canonical = '<student first="Snow\'" last="Man">My Name is Snow Man\'. </student>';
    const compact: unknown = {
      student: { "@first": "Snow'", "@last": "Man", "#text": "My Name is Snow Man'. " },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P10-ibm10v04.xml", () => {
    // 2.3 — Test AttValue with single quotes as the delimiters and double quote inside
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst 'Snow'>\r\n\t<!ENTITY mymiddle 'I'>\r\n\t<!ENTITY mylast 'Man\"'>\r\n]>\r\n<!-- testing AttValue string with a double quote inside -->\r\n<student first='Snow\"' last='Man'>My Name is &myfirst; &mylast;. </student>\r\n\r\n";
    const canonical = '<student first="Snow&quot;" last="Man">My Name is Snow Man&quot;. </student>';
    const compact: unknown = {
      student: { "@first": 'Snow"', "@last": "Man", "#text": 'My Name is Snow Man". ' },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P10-ibm10v05.xml", () => {
    // 2.3 — Test AttValue with a GE reference and double quotes as the delimiters
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "Y">\r\n\t<!ENTITY mylast "&myfirst; Man">\r\n]>\r\n<!-- testing AttValue with a reference in double quote -->\r\n<student first="&myfirst;" last="mylast;">My Name is &mylast;. </student>\r\n\r\n';
    const canonical = '<student first="Snow" last="mylast;">My Name is Snow Man. </student>';
    const compact: unknown = {
      student: { "@first": "Snow", "@last": "mylast;", "#text": "My Name is Snow Man. " },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P10-ibm10v06.xml", () => {
    // 2.3 — Test AttValue with a GE reference and single quotes as the delimiters
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst \"Snow\">\r\n\t<!ENTITY mymiddle \"Y\">\r\n\t<!ENTITY mylast '&myfirst; Man'>\r\n]>\r\n<!-- testing AttValue with a reference in single quote -->\r\n<student first='&myfirst;' last='&mylast;'>My Name is &mylast;. </student>\r\n\r\n";
    const canonical = '<student first="Snow" last="Snow Man">My Name is Snow Man. </student>';
    const compact: unknown = {
      student: { "@first": "Snow", "@last": "Snow Man", "#text": "My Name is Snow Man. " },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P10-ibm10v07.xml", () => {
    // 2.3 — testing AttValue with mixed references and text content in double quotes
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst "Snow">\r\n\t<!ENTITY mymiddle "Y">\r\n\t<!ENTITY mylast "Man &myfirst; and &myfirst; mymiddle;.">\r\n]>\r\n<!-- testing AttValue with references combination in double quotes -->\r\n<student first="Full Name &myfirst; &#x31; and &mylast; &mylast; &#x63;" last="&mylast;" >My first Name is &myfirst; and my last name is &mylast;. </student>\r\n';
    const canonical =
      '<student first="Full Name Snow 1 and Man Snow and Snow mymiddle;. Man Snow and Snow mymiddle;. c" last="Man Snow and Snow mymiddle;.">My first Name is Snow and my last name is Man Snow and Snow mymiddle;.. </student>';
    const compact: unknown = {
      student: {
        "@first": "Full Name Snow 1 and Man Snow and Snow mymiddle;. Man Snow and Snow mymiddle;. c",
        "@last": "Man Snow and Snow mymiddle;.",
        "#text": "My first Name is Snow and my last name is Man Snow and Snow mymiddle;.. ",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P10-ibm10v08.xml", () => {
    // 2.3 — testing AttValue with mixed references and text content in single quotes
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student\r\n\t\tfirst CDATA #REQUIRED\r\n\t\tmiddle CDATA #IMPLIED\r\n\t\tlast CDATA #REQUIRED > \r\n\t<!ENTITY myfirst \"Snow\">\r\n\t<!ENTITY mymiddle \"I\">\r\n\t<!ENTITY mylast 'Man &myfirst; and &myfirst; mymiddle;.'>\r\n]>\r\n<!-- testing AttValue with references combination in single quote -->\r\n<student first='Full Name &myfirst; and &#x22;&mylast;&#x22; &mylast;' last='&mylast;'>My first Name is &myfirst; and my last name is &mylast;. </student>\r\n\r\n";
    const canonical =
      '<student first="Full Name Snow and &quot;Man Snow and Snow mymiddle;.&quot; Man Snow and Snow mymiddle;." last="Man Snow and Snow mymiddle;.">My first Name is Snow and my last name is Man Snow and Snow mymiddle;.. </student>';
    const compact: unknown = {
      student: {
        "@first": 'Full Name Snow and "Man Snow and Snow mymiddle;." Man Snow and Snow mymiddle;.',
        "@last": "Man Snow and Snow mymiddle;.",
        "#text": "My first Name is Snow and my last name is Man Snow and Snow mymiddle;.. ",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P11-ibm11v01.xml", () => {
    // 2.3 — Tests empty systemliteral using the double quotes
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n   <!ELEMENT student (#PCDATA)>\r\n   <!ENTITY unref SYSTEM "">\r\n]>\r\n\r\n<!-- testing systemliteral with nothing between the double quotes -->\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P11-ibm11v02.xml", () => {
    // 2.3 — Tests empty systemliteral using the single quotes
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student [\r\n   <!ELEMENT student (#PCDATA)>\r\n   <!ENTITY unref SYSTEM ''>\r\n]>\r\n\r\n<!-- testing systemliteral with nothing between the single quotes -->\r\n<student>My Name is SnowMan. </student>\r\n";
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P11-ibm11v03.xml", () => {
    // 2.3 — Tests regular systemliteral using the single quotes (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student SYSTEM \'student.dtd\'[\r\n]>\r\n<!-- testing systemliteral with a string with "\'" -->\r\n<student>My Name is SnowMan. </student>\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P11-ibm11v04.xml", () => {
    // 2.3 — Tests regular systemliteral using the double quotes (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student SYSTEM "student.dtd" [\r\n]>\r\n\r\n<!-- testing systemliteral with a string with \'"\' -->\r\n<student>My Name is SnowMan. </student>\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P12-ibm12v01.xml", () => {
    // 2.3 — Tests empty systemliteral using the double quotes (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student PUBLIC "" "student.dtd"[\r\n]>\r\n\r\n<!-- testing Pubid Literal with nothing between the double quote -->\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P12-ibm12v02.xml", () => {
    // 2.3 — Tests empty systemliteral using the single quotes (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student PUBLIC '' 'student.dtd'[\r\n]>\r\n\r\n<!-- testing Pubid Literal with nothing between the single quotes -->\r\n<student>My Name is SnowMan. </student>\r\n";
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P12-ibm12v03.xml", () => {
    // 2.3 — Tests regular systemliteral using the double quotes (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student PUBLIC "The big \' in it" "student.dtd"[\r\n]>\r\n\r\n<!-- testing Pubid Literal with a string with "\'" inside -->\r\n<student>My Name is SnowMan. </student>\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P12-ibm12v04.xml", () => {
    // 2.3 — Tests regular systemliteral using the single quotes (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      "<?xml version=\"1.0\"?>\r\n<!DOCTYPE student PUBLIC 'The latest version' 'student.dtd'[\r\n]>\r\n\r\n<!-- testing Pubid Literal with a string without  \"'\" inside -->\r\n<student>My Name is SnowMan. </student>\r\n";
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P13-ibm13v01.xml", () => {
    // 2.3 — Testing PubidChar with all legal PubidChar in a PubidLiteral (upstream: valid; external
    // parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student PUBLIC "#x20 #xD #xA abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ -\'()+,./:=?;!*#@$_% " "student.dtd"[\r\n]>\r\n\r\n<!-- testing Pubid char with all legal pubidchar in a string -->\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n ';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P14-ibm14v01.xml", () => {
    // 2.4 — Testing CharData with empty string
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student first CDATA #REQUIRED\r\n\t\t\t  last  CDATA #IMPLIED>\r\n]>\r\n\r\n<!-- testing chardata with empty string -->\r\n<student first="Snow"></student>\r\n\r\n\r\n';
    const canonical = '<student first="Snow"></student>';
    const compact: unknown = { student: { "@first": "Snow" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P14-ibm14v02.xml", () => {
    // 2.4 — Testing CharData with white space character
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student first CDATA #REQUIRED\r\n\t\t\t  last  CDATA #IMPLIED>\r\n]>\r\n\r\n<!-- testing chardata with white space -->\r\n<student first="Eric"> &#x0A; &#x09; &#x0D;&#x20;</student>\r\n\r\n\r\n';
    const canonical = '<student first="Eric"> &#10; &#9; &#13; </student>';
    const compact: unknown = { student: { "@first": "Eric", "#text": " \n \t \r " } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P14-ibm14v03.xml", () => {
    // 2.4 — Testing CharData with a general text string
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)>\r\n\t<!ATTLIST student first CDATA #REQUIRED\r\n\t\t\t  last  CDATA #IMPLIED>\r\n]>\r\n\r\n<!-- testing chardata with a string of sample legal char except \'<\' and \'&\' nor does it contain sequence "]]>" -->\r\n<student first="Snow" last="Man">This is a test</student>';
    const canonical = '<student first="Snow" last="Man">This is a test</student>';
    const compact: unknown = { student: { "@first": "Snow", "@last": "Man", "#text": "This is a test" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P15-ibm15v01.xml", () => {
    // 2.5 — Tests empty comment
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n<!--* Tests empty comment *-->\r\n<!---->\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P15-ibm15v02.xml", () => {
    // 2.5 — Tests comment with regular text
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- Student\'s name -->\r\n<student>My Name is SnowMan. </student>';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P15-ibm15v03.xml", () => {
    // 2.5 — Tests comment with one dash inside
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- student file-1 -->\r\n<student>My Name is SnowMan. </student>';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P15-ibm15v04.xml", () => {
    // 2.5 — Tests comment with more comprehensive content
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!--student phone number 408-398 (387)-4758 -->\r\n<student>My Name is SnowMan. </student>\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P16-ibm16v01.xml", () => {
    // 2.6 — Tests PI definition with only PItarget name and nothing else
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<?MyInstruct?>\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P16-ibm16v02.xml", () => {
    // 2.6 — Tests PI definition with only PItarget name and a white space
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<?MyInstruct ?>\r\n<student>My Name is SnowMan. </student>';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P16-ibm16v03.xml", () => {
    // 2.6 — Tests PI definition with PItarget name and text that contains question mark and right angle
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<?MyInstruct AVOID ? BEFORE > IN PI ?>\r\n<student>My Name is SnowMan. </student>';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P17-ibm17v01.xml", () => {
    // 2.6 — Tests PITarget name
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<?MyInstruct This is a test ?>\r\n<student>My Name is SnowMan. </student>\r\n\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P18-ibm18v01.xml", () => {
    // 2.7 — Tests CDSect with CDStart CData CDEnd
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing CDSect with CDStart CData CDEnd -->\r\n\r\n<student>My Name is SnowMan. <![CDATA[This is <normal> text]]> </student>\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. This is &lt;normal&gt; text </student>";
    const compact: unknown = { student: "My Name is SnowMan. This is <normal> text " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P19-ibm19v01.xml", () => {
    // 2.7 — Tests CDStart
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing CDStart -->\r\n<student>My Name is SnowMan. <![CDATA[This is a test]]> </student>\r\n\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. This is a test </student>";
    const compact: unknown = { student: "My Name is SnowMan. This is a test " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P20-ibm20v01.xml", () => {
    // 2.7 — Tests CDATA with empty string
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing CData with empty string -->\r\n\r\n<student>My Name is SnowMan. <![CDATA[]]></student>\r\n\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. </student>";
    const compact: unknown = { student: "My Name is SnowMan. " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P20-ibm20v02.xml", () => {
    // 2.7 — Tests CDATA with regular content
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing CData with legal chars -->\r\n\r\n<student>My Name is SnowMan. <![CDATA[<testing>This is a test</testing>]]></student>';
    const canonical = "<student>My Name is SnowMan. &lt;testing&gt;This is a test&lt;/testing&gt;</student>";
    const compact: unknown = { student: "My Name is SnowMan. <testing>This is a test</testing>" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P21-ibm21v01.xml", () => {
    // 2.7 — Tests CDEnd
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE student [\r\n\t<!ELEMENT student (#PCDATA)> \r\n]>\r\n\r\n<!-- testing CDEnd --> \r\n\r\n<student>My Name is SnowMan. <![CDATA[This is a test]]> </student>\r\n\r\n\r\n';
    const canonical = "<student>My Name is SnowMan. This is a test </student>";
    const compact: unknown = { student: "My Name is SnowMan. This is a test " };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P22-ibm22v01.xml", () => {
    // 2.8 — Tests prolog with XMLDecl and doctypedecl
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n',
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P22-ibm22v02.xml", () => {
    // 2.8 — Tests prolog with doctypedecl
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P22-ibm22v03.xml", () => {
    // 2.8 — Tests prolog with Misc doctypedecl
    const input: string = "<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<!-- This is a Misc -->\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P22-ibm22v04.xml", () => {
    // 2.8 — Tests prolog with doctypedecl Misc
    const input: string = "<!-- This is a Misc -->\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P22-ibm22v05.xml", () => {
    // 2.8 — Tests prolog with XMLDecl Misc doctypedecl
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!-- This is a Misc -->\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n',
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P22-ibm22v06.xml", () => {
    // 2.8 — Tests prolog with XMLDecl doctypedecl Misc
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<!-- This is a Misc -->\r\n<doc/>\r\n',
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P22-ibm22v07.xml", () => {
    // 2.8 — Tests prolog with XMLDecl Misc doctypedecl Misc
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!-- This is a Misc -->\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<!-- This is a Misc -->\r\n<doc/>\r\n',
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P23-ibm23v01.xml", () => {
    // 2.8 — Tests XMLDecl with VersionInfo only
    const input: string = "<?xml version='1.0'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P23-ibm23v02.xml", () => {
    // 2.8 — Tests XMLDecl with VersionInfo EncodingDecl
    const input = Buffer.from(
      "<?xml version='1.0' encoding='UTF-8' ?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n",
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P23-ibm23v03.xml", () => {
    // 2.8 — Tests XMLDecl with VersionInfo SDDecl
    const input: string =
      "<?xml version='1.0' standalone='yes' ?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P23-ibm23v04.xml", () => {
    // 2.8 — Tests XMLDecl with VerstionInfo and a trailing whitespace char
    const input: string = "<?xml version='1.0' ?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P23-ibm23v05.xml", () => {
    // 2.8 — Tests XMLDecl with VersionInfo EncodingDecl SDDecl
    const input = Buffer.from(
      "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n",
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P23-ibm23v06.xml", () => {
    // 2.8 — Tests XMLDecl with VersionInfo EncodingDecl SDDecl and a trailing whitespace
    const input = Buffer.from(
      "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n",
    );
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P24-ibm24v01.xml", () => {
    // 2.8 — Tests VersionInfo with single quote
    const input: string = "<?xml version='1.0'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P24-ibm24v02.xml", () => {
    // 2.8 — Tests VersionInfo with double quote
    const input: string = '<?xml version="1.0"?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n';
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P25-ibm25v01.xml", () => {
    // 2.8 — Tests EQ with =
    const input: string = "<?xml version='1.0'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P25-ibm25v02.xml", () => {
    // 2.8 — Tests EQ with = and spaces on both sides
    const input: string = "<?xml version ='1.0'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P25-ibm25v03.xml", () => {
    // 2.8 — Tests EQ with = and space in front of it
    const input: string = "<?xml version= '1.0'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P25-ibm25v04.xml", () => {
    // 2.8 — Tests EQ with = and space after it
    const input: string = "<?xml version = '1.0'?>\r\n<!DOCTYPE doc [\r\n<!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P26-ibm26v01.xml", () => {
    // 2.8 — Tests VersionNum 1.0
    const input: string = "<?xml version='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P27-ibm27v01.xml", () => {
    // 2.8 — Tests Misc with comment
    const input: string =
      "<?xml version='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<!-- This is a comment in Misc -->";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P27-ibm27v02.xml", () => {
    // 2.8 — Tests Misc with PI
    const input: string =
      "<?xml version='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc EMPTY>\r\n]>\r\n<doc/>\r\n<?sound \"This is a PI in Misc ?>";
    const canonical = "<doc></doc>";
    const compact: unknown = { doc: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P27-ibm27v03.xml", () => {
    // 2.8 — Tests Misc with white spaces
    const input: string =
      "<?xml version='1.0' ?>\r\n<!DOCTYPE doc [\r\n   <!ELEMENT doc ANY>\r\n]>\r\n<doc>S is in the following Misc</doc>\r\n";
    const canonical = "<doc>S is in the following Misc</doc>";
    const compact: unknown = { doc: "S is in the following Misc" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P28-ibm28v01.xml", () => {
    // 2.8 — Tests doctypedecl with internal DTD only
    const input = Buffer.from(
      "<?xml version=\"1.0\" encoding='UTF-8'?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal EMPTY>\r\n]>\r\n<!-- This a valid test file for production [28] --> \r\n<animal/>\r\n",
    );
    const canonical = "<animal></animal>";
    const compact: unknown = { animal: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P28-ibm28v02.xml", () => {
    // 2.8 — Tests doctypedecl with external subset and combinations of different markup declarations and
    // PEReferences (upstream: valid; external parameter entities are not read)
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!DOCTYPE animal SYSTEM "ibm28v02.dtd" [\r\n   <!NOTATION animal_class SYSTEM "ibm28v02.txt">\r\n   <!ENTITY forcat "This is a small cat">\r\n   <!ELEMENT tiger (#PCDATA)>\r\n   <!ENTITY % make_small "<!ELEMENT small EMPTY>">\r\n   <!ENTITY % make_leopard_element "<!ELEMENT leopard ANY>">\r\n   <!ENTITY % make_attlist "<!ATTLIST tiger color CDATA #REQUIRED>">\r\n   %make_leopard_element; \r\n   <!ELEMENT cat ANY>\r\n   %make_small;\r\n   <!ENTITY % make_big "<!ELEMENT big EMPTY>">\r\n   %make_big;\r\n   %make_attlist;\r\n   <?sound "This is a PI" ?>\r\n   <!-- This is a valid test file for p28 -->\r\n]>\r\n<animal>\r\n   <cat>&forcat;</cat>\r\n   <tiger color="white">This is a white tiger in Mirage!!</tiger>\r\n   <cat/>\r\n   <leopard>\r\n      <small/>\r\n      <big/>\r\n   </leopard>\r\n</animal>\r\n',
    );
    const canonical =
      '<animal>&#10;   <cat>This is a small cat</cat>&#10;   <tiger color="white">This is a white tiger in Mirage!!</tiger>&#10;   <cat></cat>&#10;   <leopard>&#10;      <small></small>&#10;      <big></big>&#10;   </leopard>&#10;</animal>';
    const compact: unknown = {
      animal: {
        cat: ["This is a small cat", ""],
        tiger: { "@color": "white", "#text": "This is a white tiger in Mirage!!" },
        leopard: { small: "", big: "" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P29-ibm29v01.xml", () => {
    // 2.8 — Tests markupdecl with combinations of elementdecl, AttlistDecl,EntityDecl, NotationDecl, PI
    // and comment
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal (cat|tiger|leopard)+>\r\n   <!NOTATION animal_class SYSTEM "ibm29v01.txt">\r\n   <!ELEMENT cat ANY>\r\n   <!ENTITY forcat "This is a small cat">\r\n   <!ELEMENT tiger (#PCDATA)>\r\n   <!ELEMENT leopard ANY>\r\n   <!ELEMENT small EMPTY>\r\n   <!ELEMENT big EMPTY>\r\n   <!ATTLIST tiger color CDATA #REQUIRED>\r\n   <?sound "This is a PI" ?>\r\n   <!-- This is a comment -->\r\n    \r\n]>\r\n<animal>\r\n   <cat>&forcat;</cat>\r\n   <tiger color="white">This is a white tiger in Mirage!!</tiger>\r\n   <cat/>\r\n   <leopard>\r\n      <small/>\r\n      <big/>\r\n   </leopard>\r\n</animal>\r\n',
    );
    const canonical =
      '<animal>&#10;   <cat>This is a small cat</cat>&#10;   <tiger color="white">This is a white tiger in Mirage!!</tiger>&#10;   <cat></cat>&#10;   <leopard>&#10;      <small></small>&#10;      <big></big>&#10;   </leopard>&#10;</animal>';
    const compact: unknown = {
      animal: {
        cat: ["This is a small cat", ""],
        tiger: { "@color": "white", "#text": "This is a white tiger in Mirage!!" },
        leopard: { small: "", big: "" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P29-ibm29v02.xml", () => {
    // 2.8 — Tests WFC: PE in internal subset as a positive test (upstream: valid; external parameter
    // entities are not read)
    const input = Buffer.from(
      '<?xml version="1.0" encoding="utf-8" ?>\r\n<!DOCTYPE animal [\r\n   <!ELEMENT animal (cat|tiger|leopard)+>\r\n   <!NOTATION animal_class SYSTEM "ibm29v01.txt">\r\n   <!ELEMENT cat ANY>\r\n   <!ENTITY forcat "This is a small cat">\r\n   <!ELEMENT tiger (#PCDATA)>\r\n   <!ENTITY % make_leopard_element "<!ELEMENT leopard ANY>">\r\n   %make_leopard_element; \r\n   <!ELEMENT small EMPTY>\r\n   <!ELEMENT big EMPTY>\r\n   <!ATTLIST tiger color CDATA #REQUIRED>\r\n   <?sound "This is a PI" ?>\r\n   <!-- This is a comment -->\r\n    \r\n]>\r\n<animal>\r\n   <cat>&forcat;</cat>\r\n   <tiger color="white">This is a white tiger in Mirage!!</tiger>\r\n   <cat/>\r\n   <leopard>\r\n      <small/>\r\n      <big/>\r\n   </leopard>\r\n</animal>\r\n',
    );
    const canonical =
      '<animal>&#10;   <cat>This is a small cat</cat>&#10;   <tiger color="white">This is a white tiger in Mirage!!</tiger>&#10;   <cat></cat>&#10;   <leopard>&#10;      <small></small>&#10;      <big></big>&#10;   </leopard>&#10;</animal>';
    const compact: unknown = {
      animal: {
        cat: ["This is a small cat", ""],
        tiger: { "@color": "white", "#text": "This is a white tiger in Mirage!!" },
        leopard: { small: "", big: "" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P30-ibm30v01.xml", () => {
    // 2.8 — Tests extSubset with extSubsetDecl only in the dtd file (upstream: valid; external parameter
    // entities are not read)
    const input: string =
      '<!DOCTYPE animal SYSTEM "ibm30v01.dtd">\r\n<animal/>\r\n<!-- tests extSubset with extSubsetDecl only in the dtd file -->\r\n';
    const canonical = "<animal></animal>";
    const compact: unknown = { animal: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P30-ibm30v02.xml", () => {
    // 2.8 — Tests extSubset with TextDecl and extSubsetDecl in the dtd file (upstream: valid; external
    // parameter entities are not read)
    const input: string =
      '<!DOCTYPE animal SYSTEM "ibm30v02.dtd">\r\n<animal/>\r\n<!-- tests extSubset with TextDecl and extSubsetDecl in the dtd file -->\r\n';
    const canonical = "<animal></animal>";
    const compact: unknown = { animal: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P31-ibm31v01.xml", () => {
    // 2.8 — Tests extSubsetDecl with combinations of markupdecls, conditionalSects, PEReferences and white
    // spaces (upstream: valid; external parameter entities are not read)
    const input: string =
      '<!DOCTYPE animal SYSTEM "ibm31v01.dtd">\r\n<animal>\r\n   <tiger/>\r\n</animal>\r\n<!-- tests extSubsetDecl with combinations of markupdecls, conditionalSects, PEReferences and white spaces -->\r\n';
    const canonical = "<animal>&#10;   <tiger></tiger>&#10;</animal>";
    const compact: unknown = { animal: { tiger: "" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P32-ibm32v01.xml", () => {
    // 2.9 — Tests VC: Standalone Document Declaration with absent attribute that has default value and
    // standalone is no (upstream: valid; external parameter entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0" standalone="no" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32v01.dtd">\r\n<animal/>\r\n<!-- Tests VC: Standalone Document Declaration with absent attribute that has default value and standalone is no -->\r\n';
    expectParses(input);
  });

  test("ibm-valid-P32-ibm32v02.xml", () => {
    // 2.9 — Tests VC: Standalone Document Declaration with external entity reference and standalone is no
    // (upstream: valid; external parameter entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0" standalone="no" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32v02.dtd">\r\n<animal>&animal_content;</animal>\r\n<!-- Tests VC: Standalone Document Declaration with external enitity reference and standalone is no -->\r\n';
    expectParses(input);
  });

  test("ibm-valid-P32-ibm32v03.xml", () => {
    // 2.9 — Tests VC: Standalone Document Declaration with attribute values that need to be normalized and
    // standalone is no (upstream: valid; external parameter entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0" standalone="no" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32v03.dtd">\r\n<animal/>\r\n<!-- Tests VC: Standalone Document Declaration with attribute values that need to be normalized and standalone is no -->\r\n';
    expectParses(input);
  });

  test("ibm-valid-P32-ibm32v04.xml", () => {
    // 2.9 — Tests VC: Standalone Document Declaration with whitespace in mixed content and standalone is
    // no (upstream: valid; external parameter entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0" standalone="no" ?>\r\n<!DOCTYPE animal SYSTEM "ibm32v04.dtd">\r\n<animal>This is a \r\n      <a/>  \r\n\r\nyellow tiger</animal>\r\n<!-- Tests VC: Standalone Document Declaration with whitespace in mixed content -->\r\n';
    expectParses(input);
  });

  test("ibm-valid-P33-ibm33v01.xml", () => {
    // 2.12 — Tests LanguageID with Langcode - Subcode
    const input: string =
      '<!DOCTYPE book [\r\n   <!ELEMENT book ANY>\r\n   <!ATTLIST book xml:lang CDATA #REQUIRED>\r\n]>\r\n<book xml:lang="en-US">It is written in English</book>\r\n<!-- Tests LanguageID with Langcode - Subcode -->';
    const canonical = '<book xml:lang="en-US">It is written in English</book>';
    const compact: unknown = { book: { "@xml:lang": "en-US", "#text": "It is written in English" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P34-ibm34v01.xml", () => {
    // 2.12 — Duplicate Test as ibm33v01.xml
    const input: string =
      '<!DOCTYPE book [\r\n   <!ELEMENT book ANY>\r\n   <!ATTLIST book xml:lang CDATA #REQUIRED>\r\n]>\r\n<book xml:lang="en-US">It is written in English</book>\r\n';
    const canonical = '<book xml:lang="en-US">It is written in English</book>';
    const compact: unknown = { book: { "@xml:lang": "en-US", "#text": "It is written in English" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P35-ibm35v01.xml", () => {
    // 2.12 — Tests ISO639Code
    const input: string =
      '<!DOCTYPE book [\r\n   <!ELEMENT book ANY>\r\n   <!ATTLIST book xml:lang CDATA #REQUIRED>\r\n]>\r\n<book xml:lang="en">It is written in English</book>\r\n';
    const canonical = '<book xml:lang="en">It is written in English</book>';
    const compact: unknown = { book: { "@xml:lang": "en", "#text": "It is written in English" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P36-ibm36v01.xml", () => {
    // 2.12 — Tests IanaCode
    const input: string =
      '<!DOCTYPE book [\r\n   <!ELEMENT book ANY>\r\n   <!ATTLIST book xml:lang CDATA #REQUIRED>\r\n]>\r\n<book xml:lang="i-BS-ABCD">It is written in English</book>\r\n';
    const canonical = '<book xml:lang="i-BS-ABCD">It is written in English</book>';
    const compact: unknown = { book: { "@xml:lang": "i-BS-ABCD", "#text": "It is written in English" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P37-ibm37v01.xml", () => {
    // 2.12 — Tests UserCode
    const input: string =
      '<!DOCTYPE book [\r\n   <!ELEMENT book ANY>\r\n   <!ATTLIST book xml:lang CDATA #REQUIRED>\r\n]>\r\n<book xml:lang="x-uk-eng">It is written in English</book>\r\n';
    const canonical = '<book xml:lang="x-uk-eng">It is written in English</book>';
    const compact: unknown = { book: { "@xml:lang": "x-uk-eng", "#text": "It is written in English" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P38-ibm38v01.xml", () => {
    // 2.12 — Tests SubCode
    const input: string =
      '<!DOCTYPE book [\r\n   <!ELEMENT book ANY>\r\n   <!ATTLIST book xml:lang CDATA #REQUIRED>\r\n]>\r\n<book xml:lang="en-USa">It is written in English</book>\r\n';
    const canonical = '<book xml:lang="en-USa">It is written in English</book>';
    const compact: unknown = { book: { "@xml:lang": "en-USa", "#text": "It is written in English" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P39-ibm39v01.xml", () => {
    // 3 — Tests element with EmptyElemTag and STag content Etag, also tests the VC: Element Valid with
    // elements that have children, Mixed and ANY contents
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n  <!ELEMENT d ((e,e)|f)+ >\r\n  <!ELEMENT e ANY>\r\n  <!ELEMENT f EMPTY>\r\n]>\r\n<root><a/><b>\r\n   <c></c> \r\n   content of b element\r\n   <c>\r\n      <d><e>no more children</e><e><f/></e><f/></d>\r\n   </c>\r\n</b></root>\r\n<!--* test P39\'s syntax and Element Valid VC *-->\r\n';
    const canonical =
      "<root><a></a><b>&#10;   <c></c> &#10;   content of b element&#10;   <c>&#10;      <d><e>no more children</e><e><f></f></e><f></f></d>&#10;   </c>&#10;</b></root>";
    const compact: unknown = {
      root: {
        a: "",
        b: {
          c: ["", { d: { e: ["no more children", { f: "" }], f: "" } }],
          "#text": " \n   content of b element\n   ",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P40-ibm40v01.xml", () => {
    // 3.1 — Tests STag with possible combinations of its fields, also tests WFC: Unique Att Spec.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA|b)* >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!ATTLIST b attr1 CDATA #IMPLIED>\r\n  <!ATTLIST b attr2 CDATA #IMPLIED>\r\n  <!ATTLIST b attr3 CDATA #IMPLIED>\r\n]>\r\n<root>\r\n  <b>without white space</b>\r\n  <b > with a white space</b>\r\n  <b attr1="value1">one attribute</b>\r\n  <b attr1="value1" attr2="value2" attr3 = "value3">one attribute</b>\r\n</root>\r\n<!--* testing P40 *-->\r\n';
    const canonical =
      '<root>&#10;  <b>without white space</b>&#10;  <b> with a white space</b>&#10;  <b attr1="value1">one attribute</b>&#10;  <b attr1="value1" attr2="value2" attr3="value3">one attribute</b>&#10;</root>';
    const compact: unknown = {
      root: {
        b: [
          "without white space",
          " with a white space",
          { "@attr1": "value1", "#text": "one attribute" },
          {
            "@attr1": "value1",
            "@attr2": "value2",
            "@attr3": "value3",
            "#text": "one attribute",
          },
        ],
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P41-ibm41v01.xml", () => {
    // 3.1 — Tests Attribute with Name Eq AttValue and VC: Attribute Value Type
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA|b)* >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!ATTLIST b attr1 CDATA #REQUIRED>\r\n  <!ATTLIST b attr2 (abc|def) "abc">\r\n  <!ATTLIST b attr3 CDATA #FIXED "fixed">\r\n]>\r\n<root>\r\n  <b attr1="value1" attr2="def" attr3="fixed">Name eq AttValue</b>\r\n</root>\r\n<!--* testing P41 *-->\r\n';
    const canonical = '<root>&#10;  <b attr1="value1" attr2="def" attr3="fixed">Name eq AttValue</b>&#10;</root>';
    const compact: unknown = {
      root: {
        b: {
          "@attr1": "value1",
          "@attr2": "def",
          "@attr3": "fixed",
          "#text": "Name eq AttValue",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P42-ibm42v01.xml", () => {
    // 3.1 — Tests ETag with possible combinations of its fields
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n]>\r\n<root><a/><b>\r\n   <c></c > : End tag with a space inside\r\n   content of b element\r\n</b></root>\r\n<!--* test P42 *-->\r\n\r\n';
    const canonical =
      "<root><a></a><b>&#10;   <c></c> : End tag with a space inside&#10;   content of b element&#10;</b></root>";
    const compact: unknown = {
      root: {
        a: "",
        b: { c: "", "#text": " : End tag with a space inside\n   content of b element\n" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P43-ibm43v01.xml", () => {
    // 3.1 — Tests content with all possible constructs: element, CharData, Reference, CDSect, Comment
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n  <!ENTITY inContent "<b>General entity reference in element content</b>">\r\n]>\r\n<!--* content: element|CharData|Reference|CDSect|PI|CDSect|PI|Comment *-->\r\n<root><a/><b>\r\n<!-- there is an empty element in the above line -->\r\n   <c></c> \r\n   CharData: content of b element\r\n   %paaa; : PE reference should not be recognized in element content \r\n   <c>\r\n<?PIcontent anyProcessingInstruction?>\r\n<!-- Comment content -->\r\n    &inContent;\r\n    Charater reference: &#x41;\r\n    CDSect in content: <![CDATA[ <html>markups<head>HEAD</head><body>nothing</body></html> ]]>\r\n   </c>\r\n</b>\r\n</root>\r\n<!--* test P43 *-->\r\n';
    const canonical =
      "<root><a></a><b>&#10;&#10;   <c></c> &#10;   CharData: content of b element&#10;   %paaa; : PE reference should not be recognized in element content &#10;   <c>&#10;<?PIcontent anyProcessingInstruction?>&#10;&#10;    <b>General entity reference in element content</b>&#10;    Charater reference: A&#10;    CDSect in content:  &lt;html&gt;markups&lt;head&gt;HEAD&lt;/head&gt;&lt;body&gt;nothing&lt;/body&gt;&lt;/html&gt; &#10;   </c>&#10;</b>&#10;</root>";
    const compact: unknown = {
      root: {
        a: "",
        b: {
          c: [
            "",
            {
              b: "General entity reference in element content",
              "#text":
                "\n    Charater reference: A\n    CDSect in content:  <html>markups<head>HEAD</head><body>nothing</body></html> \n   ",
            },
          ],
          "#text":
            " \n   CharData: content of b element\n   %paaa; : PE reference should not be recognized in element content \n   ",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P44-ibm44v01.xml", () => {
    // 3.1 — Tests EmptyElemTag with possible combinations of its fields
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA|b)* >\r\n  <!ELEMENT b EMPTY >\r\n  <!ATTLIST b attr1 CDATA #IMPLIED>\r\n  <!ATTLIST b attr2 CDATA #IMPLIED>\r\n  <!ATTLIST b attr3 CDATA #IMPLIED>\r\n]>\r\n<root>\r\n  <b/>without white space\r\n  <b /> with a white space\r\n  <b attr1="value1" />\r\n  <b attr1="value1" attr2="value2" attr3 = "value3"/>\r\n</root>\r\n<!--* testing P44 *-->\r\n\r\n\r\n\r\n';
    const canonical =
      '<root>&#10;  <b></b>without white space&#10;  <b></b> with a white space&#10;  <b attr1="value1"></b>&#10;  <b attr1="value1" attr2="value2" attr3="value3"></b>&#10;</root>';
    const compact: unknown = {
      root: {
        b: ["", "", { "@attr1": "value1" }, { "@attr1": "value1", "@attr2": "value2", "@attr3": "value3" }],
        "#text": "without white space\n   with a white space\n  ",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P45-ibm45v01.xml", () => {
    // 3.2 — Tests both P45 elementDecl and P46 contentspec with possible combinations of their constructs
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA|b)* >\r\n  <!--* P45 no space before the end bracket *-->\r\n  <!ELEMENT b EMPTY>\r\n  <!ELEMENT unique ANY>\r\n  <!ELEMENT unique- ANY>\r\n  <!ELEMENT unique_ ANY>\r\n  <!ELEMENT unique. ANY>\r\n  <!ATTLIST b attr1 CDATA #IMPLIED>\r\n  <!ATTLIST b attr2 CDATA #IMPLIED>\r\n  <!ATTLIST b attr3 CDATA #IMPLIED>\r\n]>\r\n<root>\r\n  <b/>without white space\r\n  <b /> with a white space\r\n  <b attr1="value1" />\r\n  <b attr1="value1" attr2="value2" attr3 = "value3"/>\r\n</root>\r\n<!--* !!! testing both P45 and p46 *-->\r\n\r\n';
    const canonical =
      '<root>&#10;  <b></b>without white space&#10;  <b></b> with a white space&#10;  <b attr1="value1"></b>&#10;  <b attr1="value1" attr2="value2" attr3="value3"></b>&#10;</root>';
    const compact: unknown = {
      root: {
        b: ["", "", { "@attr1": "value1" }, { "@attr1": "value1", "@attr2": "value2", "@attr3": "value3" }],
        "#text": "without white space\n   with a white space\n  ",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P47-ibm47v01.xml", () => {
    // 3.2.1 — Tests all possible children,cp,choice,seq patterns in P47,P48,P49,P50
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (a,b)>\r\n  <!ELEMENT a EMPTY>\r\n  <!ELEMENT b (#PCDATA|c)* >\r\n  <!ELEMENT c ANY>\r\n  <!ELEMENT d ANY>\r\n  <!ELEMENT e ANY>\r\n  <!ELEMENT f ANY>\r\n  <!--* test all possible children,cp,choice,seq patterns in P47,P48,P49,P50 *-->\r\n  <!ELEMENT child0 (a)>\r\n  <!ELEMENT child1 (a|b|c)>\r\n  <!ELEMENT child2 (a ,b,b?,a*,c,c,a,a,b+,c ) >\r\n  <!ELEMENT child3 (a+|b)? >\r\n  <!ELEMENT child4 (a, (b|c)+, (a|d)?, (e|f)* )?>\r\n  <!ELEMENT child5 ( (a,b) | c? | ((d|e),b,c) )* >\r\n  <!ELEMENT child5_1 ( (a,b)* | (c,b)? | (d,a)+ | ((e|f),b,c) )* >\r\n  <!ELEMENT child6 (a,b,c)*>\r\n  <!ELEMENT child7 ((a,b)|c*|((d|e),b,c) )+ >\r\n  <!ELEMENT child8 ( a, (b|c), (a|b), b)+>  \r\n]>\r\n<root><a/><b>\r\n   <c></c >\r\n   content of b element\r\n</b></root>\r\n<!--* a valid test: tests P47,P48,P49,P50*-->\r\n\r\n';
    const canonical = "<root><a></a><b>&#10;   <c></c>&#10;   content of b element&#10;</b></root>";
    const compact: unknown = { root: { a: "", b: { c: "", "#text": "\n   content of b element\n" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P49-ibm49v01.xml", () => {
    // 3.2.1 — Tests VC:Proper Group/PE Nesting with PEs of choices that are properly nested with
    // parenthesized groups in external subsets (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm49v01.dtd"[\r\n  <!ELEMENT root (a,b)>\r\n]>\r\n<root><a/><b>\r\n   <c></c>\r\n   content of b element\r\n</b></root>\r\n<!--* a valid test: tests VC:Proper Group/PE Nesting in P49 *-->\r\n\r\n\r\n\r\n';
    const canonical = "<root><a></a><b>&#10;   <c></c>&#10;   content of b element&#10;</b></root>";
    const compact: unknown = { root: { a: "", b: { c: "", "#text": "\n   content of b element\n" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P50-ibm50v01.xml", () => {
    // 3.2.1 — Tests VC:Proper Group/PE Nesting with PEs of seq that are properly nested with parenthesized
    // groups in external subsets (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm50v01.dtd" [\r\n  <!ELEMENT root (a,b)>\r\n]>\r\n<root><a/><b>\r\n   <c><child1><a/><b></b><c></c></child1></c >\r\n   <c><child2><a/><b></b><c></c></child2></c >\r\n   content of b element\r\n</b></root>\r\n<!--* a valid test: tests VC:Proper Group/PE Nesting in P50 *-->\r\n';
    const canonical =
      "<root><a></a><b>&#10;   <c><child1><a></a><b></b><c></c></child1></c>&#10;   <c><child2><a></a><b></b><c></c></child2></c>&#10;   content of b element&#10;</b></root>";
    const compact: unknown = {
      root: {
        a: "",
        b: {
          c: [{ child1: { a: "", b: "", c: "" } }, { child2: { a: "", b: "", c: "" } }],
          "#text": "\n   content of b element\n",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P51-ibm51v01.xml", () => {
    // 3.2.2 — Tests Mixed with possible combinations of its fields amd VC: No Duplicate Types
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root ANY>\r\n  <!--* test all possible Mixed content type decl *-->\r\n  <!ELEMENT a (#PCDATA)* >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!ELEMENT c ( #PCDATA)*>\r\n  <!ELEMENT d (#PCDATA|c)*>\r\n  <!ELEMENT e (#PCDATA|c| b|a)* >\r\n  <!ELEMENT f (#PCDATA| c)* >\r\n  <!ELEMENT g ( #PCDATA) >\r\n  <!ELEMENT h (#PCDATA )>\r\n  <!ELEMENT i ( #PCDATA ) >\r\n]>\r\n<root>\r\n  <a> Element type a </a>\r\n  <b> Element type b </b>\r\n  <c> Element type c </c>\r\n  <d> Element type d <c></c> </d>\r\n  <e> Element type e <a></a> <b></b> <c></c> </e>\r\n</root>\r\n<!--* a valid test: tests P51 *-->';
    const canonical =
      "<root>&#10;  <a> Element type a </a>&#10;  <b> Element type b </b>&#10;  <c> Element type c </c>&#10;  <d> Element type d <c></c> </d>&#10;  <e> Element type e <a></a> <b></b> <c></c> </e>&#10;</root>";
    const compact: unknown = {
      root: {
        a: " Element type a ",
        b: " Element type b ",
        c: " Element type c ",
        d: { "#text": " Element type d ", c: "" },
        e: { "#text": " Element type e ", a: "", b: "", c: "" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P51-ibm51v02.xml", () => {
    // 3.2.2 — Tests VC:Proper Group/PE Nesting with PEs of Mixed that are properly nested with
    // parenthesized groups in external subsets (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm51v02.dtd" [\r\n  <!ELEMENT root ANY>\r\n]>\r\n<root>\r\n  <a> Element type a </a>\r\n  <b> Element type b </b>\r\n  <c> Element type c </c>\r\n  <d> Element type d <c></c> </d>\r\n  <e> Element type e <a></a> <b></b> <c></c> </e>\r\n</root>\r\n<!--* a valid test: tests P51 VC: Proper Group/PE Nesting *-->';
    const canonical =
      "<root>&#10;  <a> Element type a </a>&#10;  <b> Element type b </b>&#10;  <c> Element type c </c>&#10;  <d> Element type d <c></c> </d>&#10;  <e> Element type e <a></a> <b></b> <c></c> </e>&#10;</root>";
    const compact: unknown = {
      root: {
        a: " Element type a ",
        b: " Element type b ",
        c: " Element type c ",
        d: { "#text": " Element type d ", c: "" },
        e: { "#text": " Element type e ", a: "", b: "", c: "" },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P52-ibm52v01.xml", () => {
    // 3.3 — Tests all AttlistDecl and AttDef Patterns in P52 and P53
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root ANY>\r\n  <!ELEMENT a (#PCDATA)* >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!--* All AttlistDecl Patterns in P52 and P53 *-->\r\n  <!ATTLIST a>\r\n  <!ATTLIST a >\r\n  <!ATTLIST b battr1 CDATA #REQUIRED >\r\n  <!ATTLIST b battr2 CDATA #IMPLIED \r\n              battr3 CDATA #FIXED "fixedvalue" battr4 (abc|def) "abc" >\r\n]>\r\n<root>\r\n  <a> Element type a </a>\r\n  <b battr1 = "anyvalue" battr3="fixedvalue" battr4 ="def"> test P52 and P53 </b>\r\n</root>\r\n<!--* a valid test: tests P52 and P53 *-->\r\n';
    const canonical =
      '<root>&#10;  <a> Element type a </a>&#10;  <b battr1="anyvalue" battr3="fixedvalue" battr4="def"> test P52 and P53 </b>&#10;</root>';
    const compact: unknown = {
      root: {
        a: " Element type a ",
        b: {
          "@battr1": "anyvalue",
          "@battr3": "fixedvalue",
          "@battr4": "def",
          "#text": " test P52 and P53 ",
        },
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P54-ibm54v01.xml", () => {
    // 3.3.1 — Tests all AttTypes : StringType, TokenizedTypes, EnumeratedTypes in P55,P56,P57,P58,P59.
    // Also tests all DefaultDecls in P60.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root ANY>\r\n  <!ELEMENT a (#PCDATA) >\r\n  <!ELEMENT b (#PCDATA) >\r\n  <!ELEMENT c (#PCDATA) >\r\n  <!ELEMENT d (#PCDATA) >\r\n  <!ELEMENT e (#PCDATA) >\r\n  <!ELEMENT f (#PCDATA) >\r\n  <!ELEMENT g (#PCDATA) >\r\n  <!ELEMENT h (#PCDATA) >\r\n  <!ELEMENT i (#PCDATA) >\r\n  <!ELEMENT j (#PCDATA) >\r\n  <!ELEMENT k (#PCDATA) >\r\n  <!--* Tests all Attbuite types in P55,P56,P57,P58,P59 *-->\r\n  <!ATTLIST a aattr1 ID #REQUIRED>\r\n  <!ATTLIST b battr1 CDATA #REQUIRED \r\n              battr2 (good|bad) #REQUIRED \r\n              battr3 ID #REQUIRED>\r\n  <!ATTLIST c c_reference IDREF #REQUIRED>\r\n  <!ATTLIST d d_reference IDREFS #REQUIRED>\r\n  <!ENTITY xmltech SYSTEM "xmltech.gif" NDATA gif>\r\n  <!NOTATION gif SYSTEM "gif">\r\n  <!ATTLIST e eattr1 ENTITY #REQUIRED>\r\n  <!ENTITY IBMlogo SYSTEM "IBMlogo.gif" NDATA gif>\r\n  <!ATTLIST f fattr1 ENTITIES #REQUIRED>\r\n  <!ATTLIST g gattr1 NMTOKEN #REQUIRED>\r\n  <!ATTLIST h hattr1 NMTOKENS #REQUIRED>\r\n  <!NOTATION UTF-8 SYSTEM "UTF-8">\r\n  <!ATTLIST i iattr1 NOTATION (UTF-8) #REQUIRED>\r\n  <!--* Tests all DefaultDecl in P60 -->\r\n  <!ATTLIST j jattr1 CDATA #REQUIRED \r\n              jattr2 CDATA "good" \r\n              jattr3 CDATA #FIXED "fixed"\r\n\t      jattr4 CDATA #IMPLIED >\r\n\r\n]>\r\n<root>\r\n  <a aattr1 = "a1"> Element type a </a>\r\n  <b battr1 = "anyvalue" battr2="good" battr3 ="b1"> Element type b </b>\r\n  <c c_reference = "b1"> Element type c </c>\r\n  <d d_reference = "a1 b1"> Element type d </d>\r\n  <e eattr1 = "xmltech"> Element type e </e>\r\n  <f fattr1 = "xmltech IBMlogo"> Element type f </f>\r\n  <g gattr1 = "xml4j3_0_0_EA3"> Element type g </g>\r\n  <h hattr1 = "xml4j3_0_0_EA3 Xerces-J_1_0_1"> Element type h </h>\r\n  <i iattr1 = "UTF-8"> Element type i </i>\r\n  <j jattr1 = "anyvalue" jattr2="good" jattr3 ="fixed"> Element type j </j>\r\n</root>\r\n<!--* a valid test: tests P54 *-->\r\n';
    expectParses(input);
  });

  test("ibm-valid-P54-ibm54v02.xml", () => {
    // 3.3.1 — Tests all AttTypes : StringType, TokenizedType, EnumeratedTypes in P55,P56,P57.
    const input: string =
      "<?xml  version=\"1.0\"?>\r\n<!-- test for Production 54-->\r\n<!DOCTYPE root\r\n [\r\n <!ELEMENT root (x|y|z)*>\r\n <!ELEMENT x (#PCDATA)>\r\n <!ELEMENT y ANY>\r\n <!ELEMENT z EMPTY>\r\n <!ATTLIST x attr CDATA #IMPLIED>\r\n <!ATTLIST y attr NMTOKENS #IMPLIED>\r\n <!ATTLIST z attr (x|y) #IMPLIED>\r\n ]>\r\n<root>\r\n<x attr= 'Madhu'></x>\r\n<y attr= '1.a.name.token.but.not.a.name'></y>\r\n</root>\r\n";
    const canonical = '<root>&#10;<x attr="Madhu"></x>&#10;<y attr="1.a.name.token.but.not.a.name"></y>&#10;</root>';
    const compact: unknown = {
      root: { x: { "@attr": "Madhu" }, y: { "@attr": "1.a.name.token.but.not.a.name" } },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P54-ibm54v03.xml", () => {
    // 3.3.1 — Tests AttTypes with StringType in P55.
    const input: string =
      "<?xml  version=\"1.0\"?>\r\n<!-- test for Production 54-->\r\n<!DOCTYPE AttrType\r\n[\r\n<!ELEMENT AttrType ANY>\r\n<!ELEMENT a (#PCDATA)>\r\n<!ATTLIST a att CDATA #IMPLIED>\r\n]>\r\n<AttrType>\r\n<a att= 'hello world'>\r\n</a>\r\n</AttrType>\r\n";
    const canonical = '<AttrType>&#10;<a att="hello world">&#10;</a>&#10;</AttrType>';
    const compact: unknown = { AttrType: { a: { "@att": "hello world", "#text": "\n" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P55-ibm55v01.xml", () => {
    // 3.3.1 — Tests StringType for P55. The "CDATA" occurs in the StringType for the attribute "att" for
    // the element "a".
    const input: string =
      "<?xml  version=\"1.0\"?>\r\n<!-- test valid syntax for Production 55-->\r\n<!DOCTYPE StType\r\n[\r\n<!ELEMENT StType ANY>\r\n<!ELEMENT a EMPTY>\r\n<!ATTLIST a att CDATA #IMPLIED> \r\n]>\r\n<StType>\r\n<a att='Hello'/>\r\nTesting with a valid stringType attribute \r\n</StType>\r\n";
    const canonical = '<StType>&#10;<a att="Hello"></a>&#10;Testing with a valid stringType attribute &#10;</StType>';
    const compact: unknown = {
      StType: {
        a: { "@att": "Hello" },
        "#text": "\nTesting with a valid stringType attribute \n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v01.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56. The "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN",
    // and "NMTOKENS" occur in the TokenizedType for the attribute "attr".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- valid test for Production 56-->\r\n<!DOCTYPE root\r\n [\r\n <!ELEMENT root (a|b|c|d|e|f|g)*>\r\n <!ELEMENT a EMPTY>\r\n <!ELEMENT b EMPTY>\r\n <!ELEMENT c EMPTY>\r\n <!ELEMENT d EMPTY>\r\n <!ELEMENT e EMPTY>\r\n <!ELEMENT f EMPTY>\r\n <!ELEMENT g EMPTY>\r\n <!ATTLIST a attr ID #IMPLIED>\r\n <!ATTLIST b attr IDREF #IMPLIED>\r\n <!ATTLIST c attr IDREFS #IMPLIED>\r\n <!ATTLIST d attr ENTITY #IMPLIED>\r\n <!ATTLIST e attr ENTITIES #IMPLIED>\r\n <!ATTLIST f attr NMTOKEN #IMPLIED>\r\n <!ATTLIST g attr NMTOKENS #IMPLIED>\r\n ]>\r\n<root/>\r\n';
    const canonical = "<root></root>";
    const compact: unknown = { root: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v02.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: ID Attribute Default. The value "AC1999" is assigned to the
    // ID attribute "attr" with "#REQUIRED" in the DeaultDecl.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Positive Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ATTLIST tokenizer UniqueName ID #REQUIRED>\r\n ]>\r\n<tokenizer UniqueName = "AC1999">\r\nThis is a positive test for validity constraints\r\nGiving a unique name to the attribute ID an ID Attribute default as #required\r\n</tokenizer>\r\n';
    const canonical =
      '<tokenizer UniqueName="AC1999">&#10;This is a positive test for validity constraints&#10;Giving a unique name to the attribute ID an ID Attribute default as #required&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        "@UniqueName": "AC1999",
        "#text":
          "\nThis is a positive test for validity constraints\nGiving a unique name to the attribute ID an ID Attribute default as #required\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v03.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: ID Attribute Default. The value "AC1999" is assigned to the
    // ID attribute "attr" with "#IMPLIED" in the DeaultDecl.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Positive Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ATTLIST tokenizer UniqueName ID #IMPLIED>\r\n ]>\r\n<tokenizer UniqueName = "AC1999">\r\nThis is a positive test for validity constraints\r\nGiving ID attribute default as #IMPLIED\r\n</tokenizer>';
    const canonical =
      '<tokenizer UniqueName="AC1999">&#10;This is a positive test for validity constraints&#10;Giving ID attribute default as #IMPLIED&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        "@UniqueName": "AC1999",
        "#text": "\nThis is a positive test for validity constraints\nGiving ID attribute default as #IMPLIED\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v04.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: ID. The ID attribute "UniqueName" appears only once in the
    // document.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(positive Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ELEMENT b EMPTY>\r\n <!ATTLIST b attr ID #REQUIRED>\r\n <!ATTLIST tokenizer UniqueName ID #REQUIRED>\r\n  ]>\r\n<tokenizer UniqueName = "Ac999">\r\n<b attr = "BC999"></b>\r\nThis is a positive test for validity constraints\r\nthe value of the attribute with a type ID does not appear more than once in the XML document\r\n</tokenizer>\r\n';
    const canonical =
      '<tokenizer UniqueName="Ac999">&#10;<b attr="BC999"></b>&#10;This is a positive test for validity constraints&#10;the value of the attribute with a type ID does not appear more than once in the XML document&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        "@UniqueName": "Ac999",
        b: { "@attr": "BC999" },
        "#text":
          "\nThis is a positive test for validity constraints\nthe value of the attribute with a type ID does not appear more than once in the XML document\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v05.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: One ID per element type. The element "a" or "b" has only one
    // ID attribute.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(positive Test)-->\r\n<!DOCTYPE tokenizer\r\n [\r\n <!ELEMENT tokenizer ANY>\r\n <!ELEMENT a EMPTY>\r\n <!ELEMENT b EMPTY>\r\n <!ATTLIST a first ID #REQUIRED>\r\n <!ATTLIST b second ID #REQUIRED>\r\n ]>\r\n<tokenizer>\r\n<a first = "AC1999"></a>\r\n<b second = "CD345"></b>\r\nThis is a positive validity test for ID.\r\nany element type has no more than one attribute of type ID specified\r\n</tokenizer>';
    const canonical =
      '<tokenizer>&#10;<a first="AC1999"></a>&#10;<b second="CD345"></b>&#10;This is a positive validity test for ID.&#10;any element type has no more than one attribute of type ID specified&#10;</tokenizer>';
    const compact: unknown = {
      tokenizer: {
        a: { "@first": "AC1999" },
        b: { "@second": "CD345" },
        "#text":
          "\nThis is a positive validity test for ID.\nany element type has no more than one attribute of type ID specified\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v06.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: IDREF. The IDREF value "AC456" matches the value assigned to
    // an ID attribute "UniqueName".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Positive Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT id EMPTY>\r\n <!ELEMENT idref EMPTY>\r\n <!ATTLIST id UniqueName ID #REQUIRED>\r\n <!ATTLIST idref reference IDREF #IMPLIED>\r\n ]>\r\n<test>\r\n<id UniqueName = "AC456"></id>\r\n<idref reference = "AC456"></idref>\r\nPositive test for validity constraint of IDREF.\r\nIn an attribute decl, values of type IDREF match tha name production\r\nand the IDREF value matches the value assigned to an ID attribute somewhere\r\nin the XML document.\r\n</test>';
    const canonical =
      '<test>&#10;<id UniqueName="AC456"></id>&#10;<idref reference="AC456"></idref>&#10;Positive test for validity constraint of IDREF.&#10;In an attribute decl, values of type IDREF match tha name production&#10;and the IDREF value matches the value assigned to an ID attribute somewhere&#10;in the XML document.&#10;</test>';
    const compact: unknown = {
      test: {
        id: { "@UniqueName": "AC456" },
        idref: { "@reference": "AC456" },
        "#text":
          "\nPositive test for validity constraint of IDREF.\nIn an attribute decl, values of type IDREF match tha name production\nand the IDREF value matches the value assigned to an ID attribute somewhere\nin the XML document.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v07.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: IDREF. The IDREFS value "AC456 Q123" matches the values
    // assigned to the ID attribute "UniqueName" and "Uname".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Positive Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT id1 EMPTY>\r\n <!ELEMENT id2 EMPTY>\r\n <!ELEMENT idref EMPTY>\r\n <!ATTLIST id1 UniqueName ID #REQUIRED>\r\n <!ATTLIST id2 UName ID #IMPLIED>\r\n <!ATTLIST idref reference IDREFS #IMPLIED>\r\n ]>\r\n<test>\r\n<id1 UniqueName = "AC456"></id1>\r\n<id2 UName = "Q123"></id2>\r\n<idref reference = "AC456 Q123"></idref>\r\nPositive test for validity constraint of IDREFS.\r\nIn an attribute decl, values of type IDREFS match tha name production\r\nand the IDREFS value matches the values assigned to an ID attributes somewhere\r\nin the XML document.\r\n</test>';
    const canonical =
      '<test>&#10;<id1 UniqueName="AC456"></id1>&#10;<id2 UName="Q123"></id2>&#10;<idref reference="AC456 Q123"></idref>&#10;Positive test for validity constraint of IDREFS.&#10;In an attribute decl, values of type IDREFS match tha name production&#10;and the IDREFS value matches the values assigned to an ID attributes somewhere&#10;in the XML document.&#10;</test>';
    const compact: unknown = {
      test: {
        id1: { "@UniqueName": "AC456" },
        id2: { "@UName": "Q123" },
        idref: { "@reference": "AC456 Q123" },
        "#text":
          "\nPositive test for validity constraint of IDREFS.\nIn an attribute decl, values of type IDREFS match tha name production\nand the IDREFS value matches the values assigned to an ID attributes somewhere\nin the XML document.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v08.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: Entity Name. The value "image" of the ENTITY attribute "sun"
    // matches the name of an unparsed entity declared.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Positive Test)it is a DTD-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT landscape EMPTY>\r\n <!NOTATION gif PUBLIC "gif">\r\n <!ENTITY image SYSTEM "testspec/images/sunset.gif" NDATA gif>\r\n <!ATTLIST landscape sun ENTITY #IMPLIED>\r\n]>\r\n<test>\r\n<landscape sun = "image"></landscape>\r\nvalues of type ENTITY match the Name production and the ENTITY value\r\nmatches the name of an unparsed entity declared in the DTD.\r\n</test>\r\n';
    const canonical =
      '<test>&#10;<landscape sun="image"></landscape>&#10;values of type ENTITY match the Name production and the ENTITY value&#10;matches the name of an unparsed entity declared in the DTD.&#10;</test>';
    const compact: unknown = {
      test: {
        landscape: { "@sun": "image" },
        "#text":
          "\nvalues of type ENTITY match the Name production and the ENTITY value\nmatches the name of an unparsed entity declared in the DTD.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v09.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: Name Token. The value of the NMTOKEN attribute "thistoken"
    // matches the Nmtoken production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Positive Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT nametoken EMPTY>\r\n <!ATTLIST nametoken thistoken NMTOKEN #IMPLIED>\r\n]>\r\n<test>\r\n<nametoken thistoken = "x:image"></nametoken>\r\nIn an attribute declaration, values of type NMTOKEN match the Nmtoken production\r\n</test>';
    const canonical =
      '<test>&#10;<nametoken thistoken="x:image"></nametoken>&#10;In an attribute declaration, values of type NMTOKEN match the Nmtoken production&#10;</test>';
    const compact: unknown = {
      test: {
        nametoken: { "@thistoken": "x:image" },
        "#text": "\nIn an attribute declaration, values of type NMTOKEN match the Nmtoken production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P56-ibm56v10.xml", () => {
    // 3.3.1 — Tests TokenizedType for P56 VC: Name Token. The value of the NMTOKENS attribute "thistoken"
    // matches the Nmtoken production.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity constraint check for Production 56(Positive Test)-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT nametokens EMPTY>\r\n <!ATTLIST nametokens thistoken NMTOKENS #IMPLIED>\r\n]>\r\n<test>\r\n<nametokens thistoken = "x:lang y:country"></nametokens>\r\nIn an attribute declaration, values of type NMTOKENS match the Nmtokens production\r\n</test>';
    const canonical =
      '<test>&#10;<nametokens thistoken="x:lang y:country"></nametokens>&#10;In an attribute declaration, values of type NMTOKENS match the Nmtokens production&#10;</test>';
    const compact: unknown = {
      test: {
        nametokens: { "@thistoken": "x:lang y:country" },
        "#text": "\nIn an attribute declaration, values of type NMTOKENS match the Nmtokens production\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P57-ibm57v01.xml", () => {
    // 3.3.1 — Tests EnumeratedType in the AttType. The attribute "att" has a type (a|b) with the element
    // "a". the
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- valid test for Production 57-->\r\n<!DOCTYPE root\r\n [\r\n <!ELEMENT root (#PCDATA|a|b)*>\r\n <!ELEMENT a ANY>\r\n <!ELEMENT b ANY>\r\n <!NOTATION a SYSTEM "a">\r\n <!NOTATION b SYSTEM "b"> \r\n <!ATTLIST a att (a|b) #IMPLIED>\r\n <!ATTLIST b att NOTATION (a|b) #IMPLIED>\r\n ]>\r\n <root>\r\nThis test case tests the kinds of enumerated types\r\n<a/><b/>\r\n</root>\r\n';
    const canonical = "<root>&#10;This test case tests the kinds of enumerated types&#10;<a></a><b></b>&#10;</root>";
    const compact: unknown = {
      root: {
        "#text": "\nThis test case tests the kinds of enumerated types\n",
        a: "",
        b: "",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P58-ibm58v01.xml", () => {
    // 3.3.1 — Tests NotationType for P58. It shows different patterns fro the NOTATION attribute "attr".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- valid test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one ANY>\r\n <!ELEMENT two ANY>\r\n <!ELEMENT three ANY>\r\n <!ELEMENT four ANY>\r\n <!ELEMENT five ANY>\r\n <!NOTATION this SYSTEM "alpha">\r\n <!NOTATION that SYSTEM "beta">\r\n <!ATTLIST one attr NOTATION (this) #IMPLIED>\r\n <!ATTLIST two attr NOTATION ( this) #IMPLIED>\r\n <!ATTLIST three attr NOTATION (this|that) #IMPLIED>\r\n <!ATTLIST four attr NOTATION (that |this) #IMPLIED>\r\n <!ATTLIST five attr NOTATION ( that ) #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a positive test with different patterns for NOTATION\r\n</test>\r\n';
    const canonical = "<test>&#10;This is a positive test with different patterns for NOTATION&#10;</test>";
    const compact: unknown = { test: "\nThis is a positive test with different patterns for NOTATION\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P58-ibm58v02.xml", () => {
    // 3.3.1 — Tests NotationType for P58: Notation Attributes. The value "base64" of the NOTATION
    // attribute "attr" matches one of the notation names declared.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 58-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT blob (#PCDATA)>\r\n <!NOTATION base64 SYSTEM "mimecode">\r\n <!NOTATION uuencode SYSTEM "uudecode">\r\n <!NOTATION raw SYSTEM "bin/cat">\r\n <!ATTLIST blob content-encoding NOTATION (base64|uuencode|raw) #REQUIRED>\r\n ]>\r\n <test>\r\n<blob content-encoding="base64"></blob>\r\nThe attribute values of type NOTATION matches one of the notation names included in the declaration;\r\nall notation names in the declaration have been declared\r\n</test>';
    const canonical =
      '<test>&#10;<blob content-encoding="base64"></blob>&#10;The attribute values of type NOTATION matches one of the notation names included in the declaration;&#10;all notation names in the declaration have been declared&#10;</test>';
    const compact: unknown = {
      test: {
        blob: { "@content-encoding": "base64" },
        "#text":
          "\nThe attribute values of type NOTATION matches one of the notation names included in the declaration;\nall notation names in the declaration have been declared\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P59-ibm59v01.xml", () => {
    // 3.3.1 — Tests Enumeration in the EnumeratedType for P59. It shows different patterns for the
    // Enumeration attribute "attr".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!ELEMENT enum (#PCDATA)>\r\n <!ATTLIST one attr (one) #IMPLIED>\r\n <!ATTLIST two attr ( enum) #IMPLIED>\r\n <!ATTLIST two attr (one|two) #IMPLIED>\r\n <!ATTLIST two attr (one| two) #IMPLIED>\r\n <!ATTLIST two attr (enum ) #IMPLIED>\r\n <!ATTLIST two attr ( one | two | enum) #IMPLIED>\r\n ]>\r\n <test>\r\nThis is a Positive test\r\n</test>\r\n';
    const canonical = "<test>&#10;This is a Positive test&#10;</test>";
    const compact: unknown = { test: "\nThis is a Positive test\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P59-ibm59v02.xml", () => {
    // 3.3.1 — Tests Enumeration for P59 VC: Enumeration. The value "one" of the Enumeration attribute
    // "attr" matches one of the element names declared.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 59-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!ELEMENT num EMPTY>\r\n <!ATTLIST num value (one|two) #IMPLIED>\r\n ]>\r\n <test>\r\n<num value = "one"></num>\r\nThis is a Positive test\r\nThe attribute values of type Enumeration match one of the Nmtoken tokens in the declaration.\r\n</test>';
    const canonical =
      '<test>&#10;<num value="one"></num>&#10;This is a Positive test&#10;The attribute values of type Enumeration match one of the Nmtoken tokens in the declaration.&#10;</test>';
    const compact: unknown = {
      test: {
        num: { "@value": "one" },
        "#text":
          "\nThis is a Positive test\nThe attribute values of type Enumeration match one of the Nmtoken tokens in the declaration.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P60-ibm60v01.xml", () => {
    // 3.3.2 — Tests DefaultDecl for P60. It shows different options "#REQUIRED", "#FIXED", "#IMPLIED", and
    // default for the attribute "chapter".
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java (#PCDATA|one|two|three|four)*>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!ELEMENT three EMPTY>\r\n <!ELEMENT four EMPTY>\r\n <!ATTLIST one chapter CDATA #IMPLIED>\r\n <!ATTLIST two chapter CDATA #REQUIRED>\r\n <!ATTLIST three chapter CDATA #FIXED "JavaBeans">\r\n <!ATTLIST four chapter CDATA \'defualt\'>\r\n ]>\r\n<Java><one chapter="Introduction"/>\r\n <three chapter="JavaBeans"/>\r\n Positive test\r\n DefaultDecl attributes values IMPLIED, REQUIRED, FIXED and default\r\n</Java>';
    const canonical =
      '<Java><one chapter="Introduction"></one>&#10; <three chapter="JavaBeans"></three>&#10; Positive test&#10; DefaultDecl attributes values IMPLIED, REQUIRED, FIXED and default&#10;</Java>';
    const compact: unknown = {
      Java: {
        one: { "@chapter": "Introduction" },
        three: { "@chapter": "JavaBeans" },
        "#text": "\n Positive test\n DefaultDecl attributes values IMPLIED, REQUIRED, FIXED and default\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P60-ibm60v02.xml", () => {
    // 3.3.2 — Tests DefaultDecl for P60 VC: Required Attribute. In the element "one" and "two" the value
    // of the #REQUIRED attribute "chapter" is given.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ELEMENT two EMPTY>\r\n <!ATTLIST one chapter CDATA #REQUIRED>\r\n <!ATTLIST two chapter CDATA #REQUIRED>\r\n ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\n<two chapter="JavaApplets"></two>\r\nPositive test. Required attribute. Every occurrence of an element with a \r\n#REQUIRED attribute default declaration gives the value of that attribute\r\n</Java>';
    const canonical =
      '<Java>&#10;<one chapter="Introduction"></one>&#10;<two chapter="JavaApplets"></two>&#10;Positive test. Required attribute. Every occurrence of an element with a &#10;#REQUIRED attribute default declaration gives the value of that attribute&#10;</Java>';
    const compact: unknown = {
      Java: {
        one: { "@chapter": "Introduction" },
        two: { "@chapter": "JavaApplets" },
        "#text":
          "\nPositive test. Required attribute. Every occurrence of an element with a \n#REQUIRED attribute default declaration gives the value of that attribute\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P60-ibm60v03.xml", () => {
    // 3.3.2 — Tests DefaultDecl for P60 VC: Fixed Attribute Default. The value of the #FIXED attribute
    // "chapter" is exactly the same as the default value.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 60-->\r\n<!DOCTYPE Java \r\n [\r\n <!ELEMENT Java ANY>\r\n <!ELEMENT one EMPTY>\r\n <!ATTLIST one chapter CDATA #FIXED "Introduction">\r\n  ]>\r\n<Java>\r\n<one chapter="Introduction"></one>\r\nAn attribute has a default value declared with the #FIXED keyword, \r\nand an instances of that attribute is given a value which is exactly \r\nthe same as the default value in the declaration. \r\n</Java>\r\n';
    const canonical =
      '<Java>&#10;<one chapter="Introduction"></one>&#10;An attribute has a default value declared with the #FIXED keyword, &#10;and an instances of that attribute is given a value which is exactly &#10;the same as the default value in the declaration. &#10;</Java>';
    const compact: unknown = {
      Java: {
        one: { "@chapter": "Introduction" },
        "#text":
          "\nAn attribute has a default value declared with the #FIXED keyword, \nand an instances of that attribute is given a value which is exactly \nthe same as the default value in the declaration. \n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P60-ibm60v04.xml", () => {
    // 3.3.2 — Tests DefaultDecl for P60 VC: Attribute Default Legal. The default value specified for the
    // attribute "attr" meets the lexical constraints of the declared attribute type.
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- validity test for Production 60-->\r\n<!DOCTYPE test\r\n [\r\n <!ELEMENT test ANY>\r\n <!ELEMENT a EMPTY>\r\n <!ELEMENT b EMPTY>\r\n <!ELEMENT attr EMPTY>\r\n <!ELEMENT nametoken EMPTY>\r\n <!ATTLIST attr value (a|b) "a"> \r\n <!ATTLIST nametoken namevalue NMTOKEN "hello">\r\n  ]>\r\n<test>\r\nThe default value specified for an attribute meets the \r\nlexical constraints of the declared attribute type.\r\n</test>\r\n\r\n';
    const canonical =
      "<test>&#10;The default value specified for an attribute meets the &#10;lexical constraints of the declared attribute type.&#10;</test>";
    const compact: unknown = {
      test: "\nThe default value specified for an attribute meets the \nlexical constraints of the declared attribute type.\n",
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P61-ibm61v01.xml", () => {
    // 3.4 — Tests conditionalSect for P61. It takes the option "invludeSect" in the file ibm61v01.dtd.
    // (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 61-->\r\n<!DOCTYPE animal SYSTEM "ibm61v01.dtd">\r\n<animal>\r\n <tiger/>\r\n</animal>\r\n ';
    const canonical = "<animal>&#10; <tiger></tiger>&#10;</animal>";
    const compact: unknown = { animal: { tiger: "" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P61-ibm61v02.xml", () => {
    // 3.4 — Tests conditionalSect for P61. It takes the option "ignoreSect" in the file ibm61v02.dtd.
    // (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 61-->\r\n<!DOCTYPE animal SYSTEM "ibm61v02.dtd"\r\n[\r\n<!ELEMENT animal EMPTY>\r\n]>\r\n<animal/>\r\n\r\n \r\n';
    const canonical = "<animal></animal>";
    const compact: unknown = { animal: "" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P62-ibm62v01.xml", () => {
    // 3.4 — Tests includeSect for P62. The white space is not included before the key word "INCLUDE" in
    // the beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62v01.dtd">\r\n<animal>\r\n <tiger/>\r\nPositive test. Test includeSect with pattern1 of p62.\r\nNormal Pattern\r\n</animal>';
    const canonical =
      "<animal>&#10; <tiger></tiger>&#10;Positive test. Test includeSect with pattern1 of p62.&#10;Normal Pattern&#10;</animal>";
    const compact: unknown = {
      animal: {
        tiger: "",
        "#text": "\nPositive test. Test includeSect with pattern1 of p62.\nNormal Pattern\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P62-ibm62v02.xml", () => {
    // 3.4 — Tests includeSect for P62. The white space is not included after the key word "INCLUDE" in the
    // beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62v02.dtd">\r\n<animal>\r\n <tiger/>\r\nPositive test. Test includeSect with pattern2 of p62.\r\nspace included before INCLUDE\r\n</animal>\r\n';
    const canonical =
      "<animal>&#10; <tiger></tiger>&#10;Positive test. Test includeSect with pattern2 of p62.&#10;space included before INCLUDE&#10;</animal>";
    const compact: unknown = {
      animal: {
        tiger: "",
        "#text": "\nPositive test. Test includeSect with pattern2 of p62.\nspace included before INCLUDE\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P62-ibm62v03.xml", () => {
    // 3.4 — Tests includeSect for P62. The white space is included after the key word "INCLUDE" in the
    // beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62v03.dtd">\r\n<animal>\r\n <tiger/>\r\nPositive test. Test includeSect with pattern3 of p62.\r\nspace included after INCLUDE\r\n</animal>\r\n';
    const canonical =
      "<animal>&#10; <tiger></tiger>&#10;Positive test. Test includeSect with pattern3 of p62.&#10;space included after INCLUDE&#10;</animal>";
    const compact: unknown = {
      animal: {
        tiger: "",
        "#text": "\nPositive test. Test includeSect with pattern3 of p62.\nspace included after INCLUDE\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P62-ibm62v04.xml", () => {
    // 3.4 — Tests includeSect for P62. The white space is included before the key word "INCLUDE" in the
    // beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62v04.dtd">\r\n<animal>\r\n <tiger/>\r\nPositive test. Test includeSect with pattern4 of p62.\r\nspace included before and after INCLUDE\r\n</animal>\r\n';
    const canonical =
      "<animal>&#10; <tiger></tiger>&#10;Positive test. Test includeSect with pattern4 of p62.&#10;space included before and after INCLUDE&#10;</animal>";
    const compact: unknown = {
      animal: {
        tiger: "",
        "#text": "\nPositive test. Test includeSect with pattern4 of p62.\nspace included before and after INCLUDE\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P62-ibm62v05.xml", () => {
    // 3.4 — Tests includeSect for P62. The extSubsetDecl is not included. (upstream: valid; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 62-->\r\n<!DOCTYPE animal SYSTEM "ibm62v05.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger EMPTY>\r\n]>\r\n\r\n<animal>\r\n <tiger/>\r\nPositive test. Missing external subset declaration.\r\n</animal>';
    const canonical =
      "<animal>&#10; <tiger></tiger>&#10;Positive test. Missing external subset declaration.&#10;</animal>";
    const compact: unknown = {
      animal: {
        tiger: "",
        "#text": "\nPositive test. Missing external subset declaration.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P63-ibm63v01.xml", () => {
    // 3.4 — Tests ignoreSect for P63. The white space is not included before the key word "IGNORE" in the
    // beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63v01.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "tiger">\r\nPositive test. Test for IGNORE with pattern 1.\r\n</animal>';
    const canonical = '<animal a="tiger">&#10;Positive test. Test for IGNORE with pattern 1.&#10;</animal>';
    const compact: unknown = {
      animal: {
        "@a": "tiger",
        "#text": "\nPositive test. Test for IGNORE with pattern 1.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P63-ibm63v02.xml", () => {
    // 3.4 — Tests ignoreSect for P63. The white space is not included after the key word "IGNORE" in the
    // beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63v02.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "tiger">\r\nPositive test. Test for IGNORE with pattern 2.\r\n</animal>';
    const canonical = '<animal a="tiger">&#10;Positive test. Test for IGNORE with pattern 2.&#10;</animal>';
    const compact: unknown = {
      animal: {
        "@a": "tiger",
        "#text": "\nPositive test. Test for IGNORE with pattern 2.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P63-ibm63v03.xml", () => {
    // 3.4 — Tests ignoreSect for P63. The white space is included after the key word "IGNORE" in the
    // beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63v03.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "tiger">\r\nPositive test. Test for IGNORE with pattern 3.\r\n</animal>';
    const canonical = '<animal a="tiger">&#10;Positive test. Test for IGNORE with pattern 3.&#10;</animal>';
    const compact: unknown = {
      animal: {
        "@a": "tiger",
        "#text": "\nPositive test. Test for IGNORE with pattern 3.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P63-ibm63v04.xml", () => {
    // 3.4 — Tests ignoreSect for P63. The ignireSectContents is included. (upstream: valid; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63v04.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "tiger">\r\nPositive test. Test for IGNORE with pattern 4.\r\n</animal>';
    const canonical = '<animal a="tiger">&#10;Positive test. Test for IGNORE with pattern 4.&#10;</animal>';
    const compact: unknown = {
      animal: {
        "@a": "tiger",
        "#text": "\nPositive test. Test for IGNORE with pattern 4.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P63-ibm63v05.xml", () => {
    // 3.4 — Tests ignoreSect for P63. The white space is included before and after the key word "IGNORE"
    // in the beginning sequence. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 63-->\r\n<!DOCTYPE animal SYSTEM "ibm63v05.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n<!ELEMENT tiger (#PCDATA)>\r\n<!ATTLIST animal a (tiger) #REQUIRED> \r\n]>\r\n<animal a = "tiger">\r\nPositive test. Test for IGNORE with pattern 5.\r\n</animal>';
    const canonical = '<animal a="tiger">&#10;Positive test. Test for IGNORE with pattern 5.&#10;</animal>';
    const compact: unknown = {
      animal: {
        "@a": "tiger",
        "#text": "\nPositive test. Test for IGNORE with pattern 5.\n",
      },
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P64-ibm64v01.xml", () => {
    // 3.4 — Tests ignoreSectContents for P64. One "ignore" field is included. (upstream: valid; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 64-->\r\n<!DOCTYPE animal SYSTEM "ibm64v01.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nPositive Test. Pattern1\r\n</animal>';
    const canonical = "<animal>&#10;Positive Test. Pattern1&#10;</animal>";
    const compact: unknown = { animal: "\nPositive Test. Pattern1\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P64-ibm64v02.xml", () => {
    // 3.4 — Tests ignoreSectContents for P64. Two "ignore" and one "ignoreSectContents" fields are
    // included. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 64-->\r\n<!DOCTYPE animal SYSTEM "ibm64v02.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nPositive Test. Pattern2\r\n</animal>';
    const canonical = "<animal>&#10;Positive Test. Pattern2&#10;</animal>";
    const compact: unknown = { animal: "\nPositive Test. Pattern2\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P64-ibm64v03.xml", () => {
    // 3.4 — Tests ignoreSectContents for P64. Four "ignore" and three "ignoreSectContents" fields are
    // included. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 64-->\r\n<!DOCTYPE animal SYSTEM "ibm64v03.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nPositive Test. Pattern3\r\n</animal>';
    const canonical = "<animal>&#10;Positive Test. Pattern3&#10;</animal>";
    const compact: unknown = { animal: "\nPositive Test. Pattern3\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P65-ibm65v01.xml", () => {
    // 3.4 — Tests Ignore for P65. An empty string occurs in the Ignore filed. (upstream: valid; external
    // parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 65-->\r\n<!DOCTYPE animal SYSTEM "ibm65v01.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nPositive Test. Pattern1. Empty string.\r\n</animal>';
    const canonical = "<animal>&#10;Positive Test. Pattern1. Empty string.&#10;</animal>";
    const compact: unknown = { animal: "\nPositive Test. Pattern1. Empty string.\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P65-ibm65v02.xml", () => {
    // 3.4 — Tests Ignore for P65. An string not including the brackets occurs in each of the Ignore filed.
    // (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml  version="1.0"?>\r\n<!-- syntax test for Production 65-->\r\n<!DOCTYPE animal SYSTEM "ibm65v02.dtd"\r\n[\r\n<!ELEMENT animal ANY>\r\n]>\r\n<animal>\r\nPositive Test. Pattern2.\r\n</animal>';
    const canonical = "<animal>&#10;Positive Test. Pattern2.&#10;</animal>";
    const compact: unknown = { animal: "\nPositive Test. Pattern2.\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P66-ibm66v01.xml", () => {
    // 4.1 — Tests all legal CharRef's.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA)>\r\n]>\r\n<root>\r\nTest all valid Charater references for P66:\r\n&#9;&#09;&#0000000009;\r\n&#xA;&#xa;&#x0A;&#x00000000A;\r\n&#x0d;\r\n&#xAB; &#xab; &#xCD; &#xcD; &#xEf; &#xef;\r\n&#67; &#x43; &#x5f;\r\n&#x20; &#xD7A3; &#xAC00;\r\n&#xF900; &#xFFFD;\r\n&#x10000; &#x10FFFF;\r\n</root>\r\n<!--* a valid test for P66 *-->\r\n';
    const canonical =
      "<root>&#10;Test all valid Charater references for P66:&#10;&#9;&#9;&#9;&#10;&#10;&#10;&#10;&#10;&#10;&#13;&#10;« « Í Í ï ï&#10;C C _&#10;  힣 가&#10;豈 �&#10;𐀀 􏿿&#10;</root>";
    const compact: unknown = {
      root: "\nTest all valid Charater references for P66:\n\t\t\t\n\n\n\n\n\n\r\n« « Í Í ï ï\nC C _\n  힣 가\n豈 �\n𐀀 􏿿\n",
    };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P67-ibm67v01.xml", () => {
    // 4.1 — Tests Reference could be EntityRef or CharRef.
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA)>\r\n  <!ATTLIST root attr CDATA #REQUIRED>\r\n  <!ENTITY ge1 "xyz">\r\n]>\r\n<root attr="&ge1;&#65;">\r\n&ge1; &#66;\r\n</root>\r\n<!--* a valid test for P67 *-->\r\n';
    const canonical = '<root attr="xyzA">&#10;xyz B&#10;</root>';
    const compact: unknown = { root: { "@attr": "xyzA", "#text": "\nxyz B\n" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P68-ibm68v01.xml", () => {
    // 4.1 — Tests P68 VC:Entity Declared with Entities in External Subset , standalone is no (upstream:
    // valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root SYSTEM "ibm68v01.dtd" [\r\n  <!ELEMENT root (#PCDATA|a)* >\r\n]>\r\n<root>\r\n  pcdata content\r\n  <a attr1="xyz"/>\r\n</root>\r\n<!--* a valid test for P68 VC:Entity Declared *-->\r\n';
    const canonical = '<root>&#10;  pcdata content&#10;  <a attr1="xyz"></a>&#10;</root>';
    const compact: unknown = { root: { "#text": "\n  pcdata content\n  ", a: { "@attr1": "xyz" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P68-ibm68v02.xml", () => {
    // 4.1 — Tests P68 VC:Entity Declared with Entities in External Parameter Entities , standalone is no
    // (upstream: valid; external general and parameter entities are not read)
    const input: string =
      '<?xml version="1.0" standalone=\'no\'?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA)* >\r\n  <!ENTITY % pe1 SYSTEM "ibm68v02.ent">\r\n  %pe1;\r\n]>\r\n<root>\r\n  pcdata content\r\n</root>\r\n<!--* a valid test for P68 VC:Entity Declared *-->\r\n';
    const canonical = "<root>&#10;  pcdata content&#10;</root>";
    const compact: unknown = { root: "\n  pcdata content\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P69-ibm69v01.xml", () => {
    // 4.1 — Tests P68 VC:Entity Declared with Parameter Entities in External Subset , standalone is no
    // (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0" standalone="no" ?>\r\n<!DOCTYPE root SYSTEM "ibm69v01.dtd" [\r\n  <!ELEMENT root (#PCDATA|a)* >\r\n  <!ENTITY % pe1 "<!-- comment in PE -->">\r\n  %pe1;\r\n]>\r\n<root>\r\n  pcdata content\r\n  <a attr1="xyz"/>\r\n</root>\r\n<!--* a valid test for P69 VC:Entity Declared *-->\r\n';
    const canonical = '<root>&#10;  pcdata content&#10;  <a attr1="xyz"></a>&#10;</root>';
    const compact: unknown = { root: { "#text": "\n  pcdata content\n  ", a: { "@attr1": "xyz" } } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P69-ibm69v02.xml", () => {
    // 4.1 — Tests P68 VC:Entity Declared with Parameter Entities in External Parameter Entities,
    // standalone is no (upstream: valid; external general and parameter entities are not read)
    const input: string =
      '<?xml version="1.0" standalone=\'no\'?>\r\n<!DOCTYPE root [\r\n  <!ELEMENT root (#PCDATA)* >\r\n  <!ENTITY % pe1 SYSTEM "ibm69v02.ent">\r\n  %pe1;\r\n]>\r\n<root>\r\n  pcdata content\r\n</root>\r\n<!--* a valid test for P69 VC:Entity Declared *-->\r\n';
    const canonical = "<root>&#10;  pcdata content&#10;</root>";
    const compact: unknown = { root: "\n  pcdata content\n" };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P70-ibm70v01.xml", () => {
    // 4.2 — Tests all legal GEDecls and PEDecls constructs derived from P70-76 (upstream: valid; external
    // parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n<!--* Test all legal patterns derived from P70-76 *-->\r\n<!ENTITY % pe1 \'<!ATTLIST root att2 CDATA "&ge1;">\'>\r\n<!ENTITY ge1 "attdefaultvalue" >\r\n%pe1;\r\n<!NOTATION JPGformat SYSTEM "JPGFormat">\r\n<!ENTITY ge2  SYSTEM "image.jpg" NDATA JPGformat>\r\n<!ENTITY % pe2 PUBLIC "-//w3c//any" "ibm70v01.ent" >\r\n%pe2;\r\n]>\r\n<root att2="any" />\r\n<!-- a valid test case: test P70-P76 -->';
    const canonical = '<root att2="any"></root>';
    const compact: unknown = { root: { "@att2": "any" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P78-ibm78v01.xml", () => {
    // 4.3.2 — Tests ExtParsedEnt, also TextDecl in P77 and EncodingDecl in P80 (upstream: valid; external
    // general entities are not read; output depends on them)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n\r\n<!--* Test all legal patterns derived from P78 *-->\r\n<!ENTITY epe1 SYSTEM "ibm78v01.ent" >\r\n<!ENTITY epe2 SYSTEM "ibm78v02.ent" >\r\n<!ENTITY epe3 SYSTEM "ibm78v03.ent" >\r\n\r\n]>\r\n<root>&epe1;&epe2;&epe3;</root>\r\n<!-- a valid test case: test P78, P77, P80 -->\r\n';
    expectParses(input);
  });

  test("ibm-valid-P79-ibm79v01.xml", () => {
    // 4.3.2 — Tests extPE (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE book \r\n[\r\n<!ELEMENT book ANY>\r\n<!ATTLIST notebook att CDATA #IMPLIED>\r\n<!ENTITY % epe SYSTEM "ibm79v01.ent" >\r\n%epe;\r\n]>\r\n<book><name>XML Handbook</name> This is a book</book>\r\n\r\n<!-- a valid test case: test P79 -->\r\n';
    expectParses(input);
  });

  test("ibm-valid-P82-ibm82v01.xml", () => {
    // 4.7 — Tests NotationDecl in P82 and PublicID in P83
    const input: string =
      '<?xml version="1.0"?>\r\n<!DOCTYPE root \r\n[\r\n<!ELEMENT root (#PCDATA)>\r\n<!ATTLIST root att CDATA #IMPLIED>\r\n<!ATTLIST root entatt1 ENTITY #REQUIRED >\r\n\r\n<!--* Test PublicID in P82 *-->\r\n<!NOTATION JPGformat PUBLIC "-//image//notreal" >\r\n<!ENTITY unparsed1  SYSTEM "image.jpg" NDATA JPGformat>\r\n]>\r\n<root entatt1="unparsed1">test PublicID in P82</root>\r\n<!-- a valid test case: test P82 and P83 -->\r\n';
    const canonical = '<root entatt1="unparsed1">test PublicID in P82</root>';
    const compact: unknown = { root: { "@entatt1": "unparsed1", "#text": "test PublicID in P82" } };
    expectParses(input, canonical, compact);
  });

  test("ibm-valid-P85-ibm85v01.xml", () => {
    // B. — This test case covers 149 legal character ranges plus 51 single legal characters for BaseChar
    // in P85 using a PI target Name
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n<!-- This test case covers 149 legal character ranges plus\r\n     51 discrete legal characters for production 85. -->\r\n<?NAME_41-A_5A-Z_4d-M_61-a_7A-z_6d-m_0C0-À_0D6-Ö_0cb-Ë_0D8-Ø_0F6-ö_0e7-ç_0F8-ø_0FF-ÿ_0fb-û_100-Ā_131-ı_118-Ę_134-Ĵ_13E-ľ_139-Ĺ_141-Ł_148-ň_144-ń_14A-Ŋ_17E-ž_164-Ť_180-ƀ_1C3-ǃ_1a1-ơ_1CD-Ǎ_1F0-ǰ_1de-Ǟ_1F4-Ǵ_1F5-ǵ_1f4-Ǵ_1FA-Ǻ_217-ȗ_208-Ȉ_250-ɐ_2A8-ʨ_27c-ɼ_2BB-ʻ_2C1-ˁ_2be-ʾ_386-Ά_388-Έ_38A-Ί_389-Ή_38C-Ό_38E-Ύ_3A1-Ρ_397-Η_3A3-Σ_3CE-ώ_3b8-θ_3D0-ϐ_3D6-ϖ_3d3-ϓ_3DA-Ϛ_3DC-Ϝ_3DE-Ϟ_3E0-Ϡ_3E2-Ϣ_3F3-ϳ_3ea-Ϫ_401-Ё_40C-Ќ_406-І_40E-Ў_44F-я_42e-Ю_451-ё_45C-ќ_456-і_45E-ў_481-ҁ_46f-ѯ_490-Ґ_4C4-ӄ_4aa-Ҫ_4C7-Ӈ_4C8-ӈ_4c7-Ӈ_4CB-Ӌ_4CC-ӌ_4cb-Ӌ_4D0-Ӑ_4EB-ӫ_4dd-ӝ_4EE-Ӯ_4F5-ӵ_4f1-ӱ_4F8-Ӹ_4F9-ӹ_4f8-Ӹ_531-Ա_556-Ֆ_543-Ճ_559-ՙ_561-ա_586-ֆ_573-ճ_5D0-א_5EA-ת_5dd-ם_5F0-װ_5F2-ײ_5f1-ױ_621-ء_63A-غ_62d-ح_641-ف_64A-ي_645-م_671-ٱ_6B7-ڷ_694-ڔ_6BA-ں_6BE-ھ_6bc-ڼ_6C0-ۀ_6CE-ێ_6c7-ۇ_6D0-ې_6D3-ۓ_6d1-ۑ_6D5-ە_6E5-ۥ_6E6-ۦ_6e5-ۥ_0905-अ_0939-ह_091f-ट_093D-ऽ_0958-क़_0961-ॡ_095c-ड़_0985-অ_098C-ঌ_0988-ঈ_098F-এ_0990-ঐ_098f-এ_0993-ও_09A8-ন_099d-ঝ_09AA-প_09B0-র_09ad-ভ_09B2-ল_09B6-শ_09B9-হ_09b7-ষ_09DC-ড়_09DD-ঢ়_09dc-ড়_09DF-য়_09E1-ৡ_09e0-ৠ_09F0-ৰ_09F1-ৱ_09f0-ৰ_0A05-ਅ_0A0A-ਊ_0a07-ਇ_0A0F-ਏ_0A10-ਐ_0a0f-ਏ_0A13-ਓ_0A28-ਨ_0a1d-ਝ_0A2A-ਪ_0A30-ਰ_0a2d-ਭ_0A32-ਲ_0A33-ਲ਼_0a32-ਲ_0A35-ਵ_0A36-ਸ਼_0a35-ਵ_0A38-ਸ_0A39-ਹ_0a38-ਸ_0A59-ਖ਼_0A5C-ੜ_0a5a-ਗ਼_0A5E-ਫ਼_0A72-ੲ_0A74-ੴ_0a73-ੳ_0A85-અ_0A8B-ઋ_0a88-ઈ_0A8D-ઍ_0A8F-એ_0A91-ઑ_0a90-ઐ_0A93-ઓ_0AA8-ન_0a9d-ઝ_0AAA-પ_0AB0-ર_0aad-ભ_0AB2-લ_0AB3-ળ_0ab2-લ_0AB5-વ_0AB9-હ_0ab7-ષ_0ABD-ઽ_0AE0-ૠ_0B05-ଅ_0B0C-ଌ_0b08-ଈ_0B0F-ଏ_0B10-ଐ_0b0f-ଏ_0B13-ଓ_0B28-ନ_0b1d-ଝ_0B2A-ପ_0B30-ର_0b2d-ଭ_0B32-ଲ_0B33-ଳ_0b32-ଲ_0B36-ଶ_0B39-ହ_0b37-ଷ_0B3D-ଽ_0B5C-ଡ଼_0B5D-ଢ଼_0b5c-ଡ଼_0B5F-ୟ_0B61-ୡ_0b60-ୠ_0B85-அ_0B8A-ஊ_0b87-இ_0B8E-எ_0B90-ஐ_0b8f-ஏ_0B92-ஒ_0B95-க_0b93-ஓ_0B99-ங_0B9A-ச_0b99-ங_0B9C-ஜ_0B9E-ஞ_0B9F-ட_0b9e-ஞ_0BA3-ண_0BA4-த_0ba3-ண_0BA8-ந_0BAA-ப_0ba9-ன_0BAE-ம_0BB5-வ_0bb1-ற_0BB7-ஷ_0BB9-ஹ_0bb8-ஸ_0C05-అ_0C0C-ఌ_0c08-ఈ_0C0E-ఎ_0C10-ఐ_0c0f-ఏ_0C12-ఒ_0C28-న_0c1d-ఝ_0C2A-ప_0C33-ళ_0c2e-మ_0C35-వ_0C39-హ_0c37-ష_0C60-ౠ_0C61-ౡ_0c60-ౠ_0C85-ಅ_0C8C-ಌ_0c88-ಈ_0C8E-ಎ_0C90-ಐ_0c8f-ಏ_0C92-ಒ_0CA8-ನ_0c9d-ಝ_0CAA-ಪ_0CB3-ಳ_0cae-ಮ_0CB5-ವ_0CB9-ಹ_0cb7-ಷ_0CDE-ೞ_0CE0-ೠ_0CE1-ೡ_0ce0-ೠ_0D05-അ_0D0C-ഌ_0d08-ഈ_0D0E-എ_0D10-ഐ_0d0f-ഏ_0D12-ഒ_0D28-ന_0d1d-ഝ_0D2A-പ_0D39-ഹ_0d31-റ_0D60-ൠ_0D61-ൡ_0d60-ൠ_0E01-ก_0E2E-ฮ_0e17-ท_0E30-ะ_0E32-า_0E33-ำ_0e32-า_0E40-เ_0E45-ๅ_0e42-โ_0E81-ກ_0E82-ຂ_0e81-ກ_0E84-ຄ_0E87-ງ_0E88-ຈ_0e87-ງ_0E8A-ຊ_0E8D-ຍ_0E94-ດ_0E97-ທ_0e95-ຕ_0E99-ນ_0E9F-ຟ_0e9c-ຜ_0EA1-ມ_0EA3-ຣ_0ea2-ຢ_0EA5-ລ_0EA7-ວ_0EAA-ສ_0EAB-ຫ_0eaa-ສ_0EAD-ອ_0EAE-ຮ_0ead-ອ_0EB0-ະ_0EB2-າ_0EB3-ຳ_0eb2-າ_0EBD-ຽ_0EC0-ເ_0EC4-ໄ_0ec2-ໂ_0F40-ཀ_0F47-ཇ_0f43-གྷ_0F49-ཉ_0F69-ཀྵ_0f59-ཙ_10A0-Ⴀ_10C5-Ⴥ_10b2-Ⴒ_10D0-ა_10F6-ჶ_10e3-უ_1100-ᄀ_1102-ᄂ_1103-ᄃ_1102-ᄂ_1105-ᄅ_1107-ᄇ_1106-ᄆ_1109-ᄉ_110B-ᄋ_110C-ᄌ_110b-ᄋ_110E-ᄎ_1112-ᄒ_1110-ᄐ_113C-ᄼ_113E-ᄾ_1140-ᅀ_114C-ᅌ_114E-ᅎ_1150-ᅐ_1154-ᅔ_1155-ᅕ_1154-ᅔ_1159-ᅙ_115F-ᅟ_1161-ᅡ_1160-ᅠ_1163-ᅣ_1165-ᅥ_1167-ᅧ_1169-ᅩ_116D-ᅭ_116E-ᅮ_116d-ᅭ_1172-ᅲ_1173-ᅳ_1172-ᅲ_1175-ᅵ_119E-ᆞ_11A8-ᆨ_11AB-ᆫ_11AE-ᆮ_11AF-ᆯ_11ae-ᆮ_11B7-ᆷ_11B8-ᆸ_11b7-ᆷ_11BA-ᆺ_11BC-ᆼ_11C2-ᇂ_11bf-ᆿ_11EB-ᇫ_11F0-ᇰ_11F9-ᇹ_1E00-Ḁ_1E9B-ẛ_1e4d-ṍ_1EA0-Ạ_1EF9-ỹ_1ecc-Ọ_1F00-ἀ_1F15-ἕ_1f0a-Ἂ_1F18-Ἐ_1F1D-Ἕ_1f1a-Ἒ_1F20-ἠ_1F45-ὅ_1f32-ἲ_1F48-Ὀ_1F4D-Ὅ_1f4a-Ὂ_1F50-ὐ_1F57-ὗ_1f53-ὓ_1F59-Ὑ_1F5B-Ὓ_1F5D-Ὕ_1F5F-Ὗ_1F7D-ώ_1f6e-Ὦ_1F80-ᾀ_1FB4-ᾴ_1f9a-ᾚ_1FB6-ᾶ_1FBC-ᾼ_1fb9-Ᾱ_1FBE-ι_1FC2-ῂ_1FC4-ῄ_1fc3-ῃ_1FC6-ῆ_1FCC-ῌ_1fc9-Έ_1FD0-ῐ_1FD3-ΐ_1fd1-ῑ_1FD6-ῖ_1FDB-Ί_1fd8-Ῐ_1FE0-ῠ_1FEC-Ῥ_1fe6-ῦ_1FF2-ῲ_1FF4-ῴ_1ff3-ῳ_1FF6-ῶ_1FFC-ῼ_1ff9-Ό_2126-Ω_212A-K_212B-Å_212a-K_212E-℮_2180-ↀ_2182-ↂ_2181-ↁ_3041-ぁ_3094-ゔ_306a-な_30A1-ァ_30FA-ヺ_30cd-ネ_3105-ㄅ_312C-ㄬ_3118-ㄘ_AC00-가_D7A3-힣_c1d1-쇑 This is a PI target ?>\r\n]>\r\n<book/>\r\n',
    );
    expectParses(input);
  });

  test("ibm-valid-P86-ibm86v01.xml", () => {
    // B. — This test case covers 2 legal character ranges plus 1 single legal characters for IdeoGraphic
    // in P86 using a PI target Name
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n<!-- This test case covers 2 legal character ranges plus\r\n     1 discrete legal characters for production 86. -->\r\n<?NAME_4E00-一_9FA5-龥_76d2-盒_3007-〇_3021-〡_3029-〩_3025-〥 This is a PI target ?>\r\n]>\r\n<book/>\r\n',
    );
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87v01.xml", () => {
    // B. — This test case covers 65 legal character ranges plus 30 single legal characters for
    // CombiningChar in P87 using a PI target Name
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n<!-- This test case covers 65 legal character ranges plus\r\n     30 discrete legal characters for production 87. -->\r\n<?NAME_300-̀_345-ͅ_322-̢_360-͠_361-͡_360-͠_483-҃_486-҆_484-҄_591-֑_5A1-֡_599-֙_5A3-֣_5B9-ֹ_5ae-֮_5BB-ֻ_5BD-ֽ_5bc-ּ_5BF-ֿ_5C1-ׁ_5C2-ׂ_5c1-ׁ_5C4-ׄ_64B-ً_652-ْ_64e-َ_670-ٰ_6D6-ۖ_6DC-ۜ_6d9-ۙ_6DD-۝_6DF-۟_6de-۞_6E0-۠_6E4-ۤ_6e2-ۢ_6E7-ۧ_6E8-ۨ_6e7-ۧ_6EA-۪_6ED-ۭ_6eb-۫_0901-ँ_0903-ः_0902-ं_093C-़_093E-ा_094C-ौ_0945-ॅ_094D-्_0951-॑_0954-॔_0952-॒_0962-ॢ_0963-ॣ_0962-ॢ_0981-ঁ_0983-ঃ_0982-ং_09BC-়_09BE-া_09BF-ি_09C0-ী_09C4-ৄ_09c2-ূ_09C7-ে_09C8-ৈ_09c7-ে_09CB-ো_09CD-্_09cc-ৌ_09D7-ৗ_09E2-ৢ_09E3-ৣ_09e2-ৢ_0A02-ਂ_0A3C-਼_0A3E-ਾ_0A3F-ਿ_0A40-ੀ_0A42-ੂ_0a41-ੁ_0A47-ੇ_0A48-ੈ_0a47-ੇ_0A4B-ੋ_0A4D-੍_0a4c-ੌ_0A70-ੰ_0A71-ੱ_0a70-ੰ_0A81-ઁ_0A83-ઃ_0a82-ં_0ABC-઼_0ABE-ા_0AC5-ૅ_0ac1-ુ_0AC7-ે_0AC9-ૉ_0ac8-ૈ_0ACB-ો_0ACD-્_0acc-ૌ_0B01-ଁ_0B03-ଃ_0b02-ଂ_0B3C-଼_0B3E-ା_0B43-ୃ_0b40-ୀ_0B47-େ_0B48-ୈ_0b47-େ_0B4B-ୋ_0B4D-୍_0b4c-ୌ_0B56-ୖ_0B57-ୗ_0b56-ୖ_0B82-ஂ_0B83-ஃ_0b82-ஂ_0BBE-ா_0BC2-ூ_0bc0-ீ_0BC6-ெ_0BC8-ை_0bc7-ே_0BCA-ொ_0BCD-்_0bcb-ோ_0BD7-ௗ_0C01-ఁ_0C03-ః_0c02-ం_0C3E-ా_0C44-ౄ_0c41-ు_0C46-ె_0C48-ై_0c47-ే_0C4A-ొ_0C4D-్_0c4b-ో_0C55-ౕ_0C56-ౖ_0c55-ౕ_0C82-ಂ_0C83-ಃ_0c82-ಂ_0CBE-ಾ_0CC4-ೄ_0cc1-ು_0CC6-ೆ_0CC8-ೈ_0cc7-ೇ_0CCA-ೊ_0CCD-್_0ccb-ೋ_0CD5-ೕ_0CD6-ೖ_0cd5-ೕ_0D02-ം_0D03-ഃ_0d02-ം_0D3E-ാ_0D43-ൃ_0d40-ീ_0D46-െ_0D48-ൈ_0d47-േ_0D4A-ൊ_0D4D-്_0d4b-ോ_0D57-ൗ_0E31-ั_0E34-ิ_0E3A-ฺ_0e37-ื_0E47-็_0E4E-๎_0e4a-๊_0EB1-ັ_0EB4-ິ_0EB9-ູ_0eb6-ຶ_0EBB-ົ_0EBC-ຼ_0ebb-ົ_0EC8-່_0ECD-ໍ_0eca-໊_0F18-༘_0F19-༙_0f18-༘_0F35-༵_0F37-༷_0F39-༹_0F3E-༾_0F3F-༿_0F71-ཱ_0F84-྄_0f7a-ེ_0F86-྆_0F8B-ྋ_0f88-ྈ_0F90-ྐ_0F95-ྕ_0f92-ྒ_0F97-ྗ_0F99-ྙ_0FAD-ྭ_0fa3-ྣ_0FB1-ྱ_0FB7-ྷ_0fb4-ྴ_0FB9-ྐྵ_20D0-⃐_20DC-⃜_20d6-⃖_20E1-⃡_302A-〪_302F-〯_302c-〬_3099-゙_309A-゚ This is a PI target ?>\r\n]>\r\n<book/>\r\n',
    );
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88v01.xml", () => {
    // B. — This test case covers 15 legal character ranges for Digit in P88 using a PI target Name
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n<!-- This test case covers 15 legal character ranges plus\r\n     0 discrete legal characters for production 88. -->\r\n<?NAME_30-0_39-9_34-4_660-٠_669-٩_664-٤_6F0-۰_6F9-۹_6f4-۴_0966-०_096F-९_096a-४_09E6-০_09EF-৯_09ea-৪_0A66-੦_0A6F-੯_0a6a-੪_0AE6-૦_0AEF-૯_0aea-૪_0B66-୦_0B6F-୯_0b6a-୪_0BE7-௧_0BEF-௯_0beb-௫_0C66-౦_0C6F-౯_0c6a-౪_0CE6-೦_0CEF-೯_0cea-೪_0D66-൦_0D6F-൯_0d6a-൪_0E50-๐_0E59-๙_0e54-๔_0ED0-໐_0ED9-໙_0ed4-໔_0F20-༠_0F29-༩_0f24-༤ This is a PI target ?>\r\n]>\r\n<book/>\r\n',
    );
    expectParses(input);
  });

  test("ibm-valid-P89-ibm89v01.xml", () => {
    // B. — This test case covers 3 legal character ranges plus 8 single legal characters for Extender in
    // P89 using a PI target Name
    const input = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<!DOCTYPE book [\r\n<!ELEMENT book ANY>\r\n<!-- This test case covers 3 legal character ranges plus\r\n     8 discrete legal characters for production 89. -->\r\n<?NAME_0B7-·_2D0-ː_2D1-ˑ_387-·_640-ـ_0E46-ๆ_0EC6-ໆ_3005-々_3031-〱_3035-〵_3033-〳_309D-ゝ_309E-ゞ_309d-ゝ_30FC-ー_30FE-ヾ_30fd-ヽ This is a PI target ?>\r\n]>\r\n<book/>\r\n',
    );
    expectParses(input);
  });
});

describe("eduni/errata-2e", () => {
  test("rmt-e2e-2a", () => {
    // E2 — Duplicate token in enumerated attribute declaration
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo bar (one|one) #IMPLIED>\n]>\n<foo/>\n\n";
    expectParses(input);
  });

  test("rmt-e2e-2b", () => {
    // E2 — Duplicate token in NOTATION attribute declaration
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!NOTATION one SYSTEM "file:///usr/bin/awk">\n<!ATTLIST foo bar NOTATION (one|one) #IMPLIED>\n]>\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-e2e-9a", () => {
    // E9 — An unused attribute default need only be syntactically correct
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!NOTATION gif SYSTEM "file:///usr/X11R6/bin/xv">\n<!ENTITY declared SYSTEM "xyzzy" NDATA gif>\n<!ATTLIST foo bar ENTITY "undeclared">\n]>\n<foo bar="declared"/>\n';
    expectParses(input);
  });

  test("rmt-e2e-9b", () => {
    // E9 — An attribute default must be syntactically correct even if unused
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!NOTATION gif SYSTEM "file:///usr/X11R6/bin/xv">\n<!ENTITY declared SYSTEM "xyzzy" NDATA gif>\n<!ATTLIST foo bar ENTITY "7">\n]>\n<foo bar="declared"/>\n';
    expectParses(input);
  });

  test("rmt-e2e-14", () => {
    // E14 — Declarations mis-nested wrt parameter entities are just validity errors (but note that some
    // parsers treat some such errors as fatal) (upstream: invalid; external parameter entities are not
    // read)
    const input: string = '<!DOCTYPE foo SYSTEM "E14.dtd">\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-e2e-15a", () => {
    // E15 — Empty content can't contain an entity reference
    const input: string = '<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ENTITY empty "">\n]>\n<foo>&empty;</foo>\n\n';
    expectParses(input);
  });

  test("rmt-e2e-15b", () => {
    // E15 — Empty content can't contain a comment
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n]>\n<foo><!-- comment --></foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-15c", () => {
    // E15 — Empty content can't contain a PI
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n]>\n<foo><?pi xxx?></foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-15d", () => {
    // E15 — Empty content can't contain whitespace
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n]>\n<foo> </foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-15e", () => {
    // E15 — Element content can contain entity reference if replacement text is whitespace
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo (foo*)>\n<!ENTITY space " ">\n]>\n<foo><foo/>&space;<foo/></foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-15f", () => {
    // E15 — Element content can contain entity reference if replacement text is whitespace, even if it
    // came from a character reference in the literal entity value
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo (foo*)>\n<!ENTITY space "&#32;">\n]>\n<foo><foo/>&space;<foo/></foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-15g", () => {
    // E15 — Element content can't contain character reference to whitespace
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo (foo*)>\n]>\n<foo><foo/>&#32;<foo/></foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-15h", () => {
    // E15 — Element content can't contain entity reference if replacement text is character reference to
    // whitespace
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo (foo*)>\n<!ENTITY space "&#38;#32;">\n]>\n<foo><foo/>&space;<foo/></foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-15i", () => {
    // E15 — Element content can contain a comment
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo (foo*)>\n]>\n<foo><foo/><!-- comment --><foo/></foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-15j", () => {
    // E15 — Element content can contain a PI
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo (foo*)>\n]>\n<foo><foo/><?pi xxx?><foo/></foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-15k", () => {
    // E15 — Mixed content can contain a comment
    const input: string =
      "<!DOCTYPE foo [\n<!ELEMENT foo (PCDATA|foo)*>\n]>\n<foo><foo/><!-- comment --><foo/></foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-15l", () => {
    // E15 — Mixed content can contain a PI
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo (PCDATA|foo)*>\n]>\n<foo><foo/><?pi xxx?><foo/></foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-18", () => {
    // E18 — External entity containing start of entity declaration is base URI for system identifier
    // (upstream: valid; external general and parameter entities are not read; output depends on them)
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ENTITY % pe SYSTEM "subdir1/E18-pe">\n%pe;\n%intpe;\n]>\n<foo>&ent;</foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-19", () => {
    // E19 — Parameter entities and character references are included-in-literal, but general entities are
    // bypassed. (upstream: valid; external parameter entities are not read; output depends on them)
    const input: string = '<!DOCTYPE foo SYSTEM "E19.dtd">\n<foo>&ent;</foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-20", () => {
    // E20 — Tokens, after normalization, must be separated by space, not other whitespace characters
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo bar NMTOKENS #IMPLIED>\n]>\n<foo bar="abc&#9;xyz"/>\n';
    expectParses(input);
  });

  test("rmt-e2e-22", () => {
    // E22 — UTF-8 entities may start with a BOM
    const input: string = '\ufeff<?xml version="1.0"?>\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n]>\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-e2e-24", () => {
    // E24 — Either the built-in entity or a character reference can be used to represent greater-than
    // after two close-square-brackets
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ENTITY gt ">">\n]>\n<foo>You can use ]]&gt; or ]]&#62;</foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-27", () => {
    // E27 — Contains an irregular UTF-8 sequence (i.e. a surrogate pair)
    const input = Buffer.from("PCFET0NUWVBFIGZvbyBbCjwhRUxFTUVOVCBmb28gQU5ZPgpdPgo8Zm9vPu2ggO2wgDwvZm9vPgo=", "base64");
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("rmt-e2e-29", () => {
    // E29 — Three-letter language codes are allowed
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xml:lang NMTOKEN #IMPLIED>\n]>\n<foo xml:lang="nds">\n <foo xml:lang="art-lojban"/>\n</foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-34", () => {
    // E34 — A non-deterministic content model is an error even if the element type is not used. (upstream:
    // optional error)
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ELEMENT bar (foo|foo)>\n]>\n<foo/>\n";
    expectParses(input);
  });

  test("rmt-e2e-36", () => {
    // E36 — An external ATTLIST declaration does not make a document non-standalone if the normalization
    // would have been the same without the declaration (upstream: valid; external parameter entities are
    // not read)
    const input: string =
      '<?xml version="1.0" standalone="yes"?>\n<!DOCTYPE foo SYSTEM "E36.dtd">\n<foo bar="123\n456"/>\n';
    expectParses(input);
  });

  test("rmt-e2e-38", () => {
    // E38 — XML 1.0 document refers to 1.1 entity (upstream: not-wf; external general entities are not
    // read)
    const input: string = '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ENTITY e SYSTEM "E38.ent">\n]>\n<foo>&e;</foo>\n';
    expectParses(input);
  });

  test("rmt-e2e-41", () => {
    // E41 — An xml:lang attribute may be empty
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xml:lang CDATA #IMPLIED>\n]>\n<foo xml:lang=""/>\n';
    expectParses(input);
  });

  test("rmt-e2e-48", () => {
    // E48 — ANY content allows character data
    const input: string = "<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n]>\n<foo>hello</foo>\n";
    expectParses(input);
  });

  test("rmt-e2e-55", () => {
    // E55 — A reference to an unparsed entity in an entity value is an error rather than forbidden (unless
    // the entity is referenced, of course) (upstream: optional error)
    const input: string =
      '<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ENTITY e "an &unparsed; entity">\n<!NOTATION gif SYSTEM "file:///usr/X11R6/bin/xv">\n<!ENTITY unparsed SYSTEM "xyzzy" NDATA gif>\n]>\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-e2e-57", () => {
    // E57 — A value other than preserve or default for xml:space is an error (upstream: optional error)
    const input: string = '<foo xml:space="discard-all-but-the-first-three-spaces"/>\n';
    expectParses(input);
  });

  test("rmt-e2e-60", () => {
    // E60 — Conditional sections are allowed in external parameter entities referred to from the internal
    // subset. (upstream: valid; external parameter entities are not read)
    const input: string =
      '<?xml version="1.0"?>\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ENTITY % e SYSTEM "E60.ent">\n%e;\n]>\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-e2e-61", () => {
    // E61 — (From John Cowan) An encoding declaration in ASCII specifying an encoding that is not
    // compatible with ASCII (so the document is not in its declared encoding). It should generate a fatal
    // error.
    const input = Buffer.from('<?xml version="1.0" encoding="UTF-16"?>\n<root/>\n');
    expectRejects(input, "XML Parse error: Document is not UTF-16 but declares encoding 'UTF-16'");
  });
});

describe("eduni/errata-3e", () => {
  test("rmt-e3e-05a", () => {
    // E05 — CDATA sections may occur in Mixed content.
    const input: string =
      "<!-- CDATA sections may occur in Mixed content. -->\n<!DOCTYPE foo [\n<!ELEMENT foo (#PCDATA|foo)*>\n]>\n<foo>a <![CDATA[cdata section]]> in mixed content</foo>\n";
    expectParses(input);
  });

  test("rmt-e3e-05b", () => {
    // E05 — CDATA sections, comments and PIs may occur in ANY content.
    const input: string =
      "<!-- CDATA sections, comments and PIs may occur in ANY content. -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n]>\n<foo>\na <![CDATA[cdata section]]> in mixed content.\na <!-- comment --> in mixed content.\na <?processing instruction?> in mixed content.\n</foo>\n";
    expectParses(input);
  });

  test("rmt-e3e-06a", () => {
    // E06 — Default values for IDREF attributes must match Name.
    const input: string =
      '<!-- Default values for IDREF attributes must match Name. -->\n<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ATTLIST foo id ID #IMPLIED>\n<!ATTLIST foo a IDREF "34">\n]>\n<foo id="g0034" a="g0034"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-06b", () => {
    // E06 — Default values for ENTITY attributes must match Name.
    const input: string =
      '<!-- Default values for ENTITY attributes must match Name. -->\n<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ATTLIST foo a ENTITY "34">\n<!ENTITY ent SYSTEM "foo" NDATA not>\n<!NOTATION not SYSTEM "not">\n]>\n<foo a="ent"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-06c", () => {
    // E06 — Default values for IDREFS attributes must match Names.
    const input: string =
      '<!-- Default values for IDREFS attributes must match Names. -->\n<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ATTLIST foo id ID #IMPLIED>\n<!ATTLIST foo a IDREFS "34">\n]>\n<foo id="g0034" a="g0034"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-06d", () => {
    // E06 — Default values for ENTITIES attributes must match Names.
    const input: string =
      '<!-- Default values for ENTITIES attributes must match Names. -->\n<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ATTLIST foo a ENTITIES "34">\n<!ENTITY ent SYSTEM "foo" NDATA not>\n<!NOTATION not SYSTEM "not">\n]>\n<foo a="ent"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-06e", () => {
    // E06 — Default values for NMTOKEN attributes must match Nmtoken.
    const input: string =
      '<!-- Default values for NMTOKEN attributes must match Nmtoken. -->\n<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ATTLIST foo a NMTOKEN "34+">\n]>\n<foo a="34"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-06f", () => {
    // E06 — Default values for NMTOKENS attributes must match Nmtokens.
    const input: string =
      '<!-- Default values for NMTOKENS attributes must match Nmtokens. -->\n<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ATTLIST foo a NMTOKENS "34+">\n]>\n<foo a="34"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-06g", () => {
    // E06 — Default values for NOTATION attributes must match one of the enumerated values.
    const input: string =
      '<!-- Default values for NOTATION attributes must match one of the enumerated values. -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo a NOTATION (not) "not2">\n<!NOTATION not SYSTEM "not">\n<!NOTATION not2 SYSTEM "not2">\n]>\n<foo a="not">junk</foo>\n';
    expectParses(input);
  });

  test("rmt-e3e-06h", () => {
    // E06 — Default values for enumerated attributes must match one of the enumerated values.
    const input: string =
      '<!-- Default values for enumerated attributes must match one of the enumerated values. -->\n<!DOCTYPE foo [\n<!ELEMENT foo EMPTY>\n<!ATTLIST foo a (one|two|three) "four">\n]>\n<foo a="one"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-06i", () => {
    // E06 — Non-syntactic validity errors in default attributes only happen if the attribute is in fact
    // defaulted.
    const input: string =
      '<!-- Non-syntactic validity errors in default attributes only happen if the attribute is in fact defaulted. -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo id ID #IMPLIED>\n<!ATTLIST foo ref IDREF "undef">\n<!ATTLIST foo ent ENTITY "undef">\n<!-- can\'t test NOTATION attribute, because if it\'s undeclared then we\'ll\n     get an error for one of the enumerated values being undeclared. -->\n<!ENTITY ent SYSTEM "foo" NDATA not>\n<!NOTATION not SYSTEM "not">\n]>\n<foo id="g0034" ref="g0034" ent="ent"/>\n';
    expectParses(input);
  });

  test("rmt-e3e-12", () => {
    // E12 — Default values for attributes may not contain references to external entities.
    const input: string =
      '<!-- Default values for attributes may not contain references to external entities. -->\n<!DOCTYPE foo [\n<!ENTITY ent SYSTEM "ent">\n<!ELEMENT foo ANY>\n<!ATTLIST foo a CDATA "contains &ent; reference">\n]>\n<foo a="not defaulted"/>\n';
    expectRejects(input, "XML Parse error: Attribute values cannot reference external entity 'ent'");
  });

  test("rmt-e3e-13", () => {
    // E13 — Even internal parameter entity references are enough to make undeclared entities into mere
    // validity errors rather than well-formedness errors.
    const input: string =
      "<!-- Even internal parameter entity references are enough to make undeclared entities into mere validity errors rather than well-formedness errors. -->\n<!DOCTYPE foo [\n<!ENTITY % pe \"<!ENTITY ent1 'text'>\">\n%pe;\n<!ELEMENT foo ANY>\n]>\n<foo>&ent2;</foo>\n";
    expectParses(input);
  });
});

describe("eduni/errata-4e", () => {
  test("invalid-bo-1", () => {
    // 4.3.3 — Byte order mark in general entity should go away (big-endian) (upstream: invalid; external
    // general entities are not read; output depends on them)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bom SYSTEM "bom_be.xml">\n]>\n<root>&bom;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-2", () => {
    // 4.3.3 — Byte order mark in general entity should go away (little-endian) (upstream: invalid;
    // external general entities are not read; output depends on them)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bom SYSTEM "bom_le.xml">\n]>\n<root>&bom;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-3", () => {
    // 4.3.3 — Byte order mark in general entity should go away (utf-8) (upstream: invalid; external
    // general entities are not read; output depends on them)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bom8 SYSTEM "8bom.xml">\n]>\n<root>&bom8;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-4", () => {
    // 4.3.3 — Two byte order marks in general entity produce only one (big-endian) (upstream: invalid;
    // external general entities are not read; output depends on them)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bombom SYSTEM "bombom_be.xml">\n]>\n<root>&bombom;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-5", () => {
    // 4.3.3 — Two byte order marks in general entity produce only one (little-endian) (upstream: invalid;
    // external general entities are not read; output depends on them)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bombom SYSTEM "bombom_le.xml">\n]>\n<root>&bombom;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-6", () => {
    // 4.3.3 — Two byte order marks in general entity produce only one (utf-8) (upstream: invalid; external
    // general entities are not read; output depends on them)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bombom8 SYSTEM "8bombom.xml">\n]>\n<root>&bombom8;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-7", () => {
    // 4.3.3 — A byte order mark and a backwards one in general entity cause an illegal char. error
    // (big-endian) (upstream: optional error)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bomboom SYSTEM "bomboom_be.xml">\n]>\n<root>&bomboom;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-8", () => {
    // 4.3.3 — A byte order mark and a backwards one in general entity cause an illegal char. error
    // (little-endian) (upstream: optional error)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bomboom SYSTEM "bomboom_le.xml">\n]>\n<root>&bomboom;</root>\n';
    expectParses(input);
  });

  test("invalid-bo-9", () => {
    // 4.3.3 — A byte order mark and a backwards one in general entity cause an illegal char. error (utf-8)
    // (upstream: optional error)
    const input: string = '<!DOCTYPE root [\n<!ENTITY bomboom8 SYSTEM "8bomboom.xml">\n]>\n<root>&bomboom8;</root>\n';
    expectParses(input);
  });

  test("invalid-sa-140", () => {
    // 2.3 [4] — Character '&#x309a;' is a CombiningChar, not a Letter, but as of 5th edition, may begin a
    // name (c.f. xmltest/not-wf/sa/140.xml).
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "<&#x309a;></&#x309a;>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("invalid-sa-141", () => {
    // 2.3 [5] — As of 5th edition, character #x0E5C is legal in XML names (c.f.
    // xmltest/not-wf/sa/141.xml).
    const input: string = '<!DOCTYPE doc [\r\n<!ENTITY e "<X&#xe5c;></X&#xe5c;>">\r\n]>\r\n<doc>&e;</doc>\r\n';
    expectParses(input);
  });

  test("x-rmt-008b", () => {
    // 2.8 4.3.4 — a document with version=1.7, legal in XML 1.0 from 5th edition
    const input: string =
      '<?xml version="1.7"?>\n<!-- an implausibly-versioned document -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n]>\n<foo/>\n';
    expectParses(input);
  });

  test("x-rmt5-014", () => {
    // 2.3 — Has a "long s" in a name, legal in XML 1.1, legal in XML 1.0 5th edition
    const input: string = '<!-- Has a "long s" in a name, legal in XML 1.1, illegal in XML 1.0 -->\n<eggſ/>\n\n';
    expectParses(input);
  });

  test("x-rmt5-014a", () => {
    // 2.3 — Has a "long s" in a name, legal in XML 1.1, legal in XML 1.0 5th edition
    const input: string =
      '<!-- Has a "long s" in an ID, legal in XML 1.1, illegal in XML 1.0 -->\n<!DOCTYPE egg [\n<!ELEMENT egg EMPTY>\n<!ATTLIST egg id ID #REQUIRED>\n]>\n<egg id="eggſ"/>\n\n';
    expectParses(input);
  });

  test("x-rmt5-016", () => {
    // 2.3 — Has a Byzantine Musical Symbol Kratimata in a name, legal in XML 1.1, legal in XML 1.0 5th
    // edition
    const input: string =
      "<!-- Has a Byzantine Musical Symbol Kratimata in a name,\n     legal in XML 1.1, illegal in XML 1.0 -->\n<𝀲/>\n";
    expectParses(input);
  });

  test("x-rmt5-019", () => {
    // 2.3 — Has the last legal namechar in XML 1.1, legal in XML 1.0 5th edition
    const input: string = "<!-- Has the last legal namechar in XML 1.1, illegal in XML 1.0 -->\n<󯿿/>\n";
    expectParses(input);
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n02.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x333
    const input: string =
      "<!DOCTYPE ̳IllegalNameStartChar [\n<!ELEMENT ̳IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar P4: #0x333 -->\n<̳IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '̳IllegalNameStartChar'");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n03.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x369
    const input: string =
      "<!DOCTYPE ͩIllegalNameStartChar [\n<!ELEMENT ͩIllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x369  -->\n<ͩIllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found 'ͩIllegalNameStartChar'");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n04.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x37E
    const input: string =
      "<!DOCTYPE ;IllegalNameStartChar [\n<!ELEMENT ;IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar  #0x37E  -->\n<;IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found ';' (U+037E)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n05.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2000
    const input: string =
      "<!DOCTYPE  IllegalNameStartChar [\n<!ELEMENT  IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #x2000  -->\n< IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found ' ' (U+2000)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n06.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2001
    const input: string =
      "<!DOCTYPE  IllegalNameStartChar [\n<!ELEMENT  IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #x2001 -->\n< IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found ' ' (U+2001)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n07.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2002
    const input: string =
      "<!DOCTYPE  IllegalNameStartChar [\n<!ELEMENT  IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #x2002 -->\n< IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found ' ' (U+2002)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n08.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2005
    const input: string =
      "<!DOCTYPE  IllegalNameStartChar [\n<!ELEMENT  IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #x2005 -->\n< IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found ' ' (U+2005)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n09.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x200B
    const input: string =
      "<!DOCTYPE ​IllegalNameStartChar [\n<!ELEMENT ​IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x200B -->\n<​IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '​' (U+200B)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n10.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x200E
    const input: string =
      "<!DOCTYPE ‎IllegalNameStartChar [\n<!ELEMENT ‎IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x200E -->\n<‎IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '‎' (U+200E)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n11.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x200F
    const input: string =
      "<!DOCTYPE ‏IllegalNameStartChar [\n<!ELEMENT ‏IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x200F  -->\n<‏IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '‏' (U+200F)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n12.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2069
    const input: string =
      "<!DOCTYPE ⁩IllegalNameStartChar [\n<!ELEMENT ⁩IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x2069 -->\n<⁩IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '⁩' (U+2069)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n13.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2190
    const input: string =
      "<!DOCTYPE ←IllegalNameStartChar [\n<!ELEMENT ←IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x2190 -->\n<←IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '←' (U+2190)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n14.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x23FF
    const input: string =
      "<!DOCTYPE ⏿IllegalNameStartChar [\n<!ELEMENT ⏿IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #x23FF -->\n<⏿IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '⏿' (U+23FF)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n15.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x280F
    const input: string =
      "<!DOCTYPE ⠏IllegalNameStartChar [\n<!ELEMENT ⠏IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x280F  -->\n<⠏IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '⠏' (U+280F)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n16.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2A00
    const input: string =
      "<!DOCTYPE ⨀IllegalNameStartChar [\n<!ELEMENT ⨀IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x2A00 -->\n<⨀IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '⨀' (U+2A00)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n17.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2EDC
    const input: string =
      "<!DOCTYPE ⬀IllegalNameStartChar [\r\n<!ELEMENT ⬀IllegalNameStartChar ANY>\r\n]>\r\n<!-- IllegalNameStartChar #0x2B00  -->\r\n<⬀IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '⬀' (U+2B00)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n18.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2B00
    const input: string =
      "<!DOCTYPE ⯿IllegalNameStartChar [\r\n<!ELEMENT ⯿IllegalNameStartChar ANY>\r\n]>\r\n<!-- IllegalNameStartChar x2BFF \r\nin p02:   -->\r\n<⯿IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '⯿' (U+2BFF)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n19.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x2BFF
    const input: string =
      "<!DOCTYPE ⿿IllegalNameStartChar [\n<!ELEMENT ⿿IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x2FFF -->\n<⿿IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '⿿' (U+2FFF)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n20.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0x3000
    const input: string =
      "<!DOCTYPE 　IllegalNameStartChar [\n<!ELEMENT 　IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0x3000 -->\n<　IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '　' (U+3000)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n21.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xD800
    const input = Buffer.from(
      "PCFET0NUWVBFIO2ggElsbGVnYWxOYW1lU3RhcnRDaGFyIFsKPCFFTEVNRU5UIO2ggElsbGVnYWxOYW1lU3RhcnRDaGFyIEFOWT4KXT4KPCEtLSBJbGxlZ2FsTmFtZVN0YXJ0Q2hhciAjMHhEODAwIC0tPgo87aCASWxsZWdhbE5hbWVTdGFydENoYXIvPgo=",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n22.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xD801
    const input = Buffer.from(
      "PCFET0NUWVBFIO2ggUlsbGVnYWxOYW1lU3RhcnRDaGFyIFsKPCFFTEVNRU5UIO2ggUlsbGVnYWxOYW1lU3RhcnRDaGFyIEFOWT4KXT4KPCEtLSBJbGxlZ2FsTmFtZVN0YXJ0Q2hhciAjMHhEODAxIC0tPgo87aCBSWxsZWdhbE5hbWVTdGFydENoYXIvPgo=",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n23.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xDAFF
    const input = Buffer.from(
      "PCFET0NUWVBFIO2rv0lsbGVnYWxOYW1lU3RhcnRDaGFyIFsKPCFFTEVNRU5UIO2rv0lsbGVnYWxOYW1lU3RhcnRDaGFyIEFOWT4KXT4KPCEtLSBJbGxlZ2FsTmFtZVN0YXJ0Q2hhciAjMHhEQUZGIC0tPgo87au/SWxsZWdhbE5hbWVTdGFydENoYXIvPgo=",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n24.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xDFFF
    const input = Buffer.from(
      "PCFET0NUWVBFIO2/v0lsbGVnYWxOYW1lU3RhcnRDaGFyIFsKPCFFTEVNRU5UIO2/v0lsbGVnYWxOYW1lU3RhcnRDaGFyIEFOWT4KXT4KPCEtLSBJbGxlZ2FsTmFtZVN0YXJ0Q2hhciAjMHhERkZGIC0tPgo87b+/SWxsZWdhbE5hbWVTdGFydENoYXIvPgo=",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n25.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xEFFF
    const input: string =
      "<!DOCTYPE IllegalNameStartChar [\n<!ELEMENT IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0xEFFF -->\n<IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '' (U+EFFF)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n26.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xF1FF
    const input: string =
      "<!DOCTYPE IllegalNameStartChar [\n<!ELEMENT IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0xF1FF -->\n<IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '' (U+F1FF)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n27.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xF8FF
    const input: string =
      "<!DOCTYPE IllegalNameStartChar [\n<!ELEMENT IllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0xF8FF -->\n<IllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Expected the document type name but found '' (U+F8FF)");
  });

  test("x-ibm-1-0.5-not-wf-P04-ibm04n28.xml", () => {
    // 2.3 — Tests an element with an illegal NameStartChar: #0xFFFFF
    const input: string =
      "<!DOCTYPE \uffffIllegalNameStartChar [\n<!ELEMENT \uffffIllegalNameStartChar ANY>\n]>\n<!-- IllegalNameStartChar #0xFFFFF -->\n<\uffffIllegalNameStartChar/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an01.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #xB8
    const input: string =
      "<!DOCTYPE IllegalNameChar¸ [\n<!ELEMENT IllegalNameChar¸ ANY>\n]>\n<!-- IllegalNameChar #xB8 -->\n<IllegalNameChar¸/>\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '¸' (U+00B8)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an02.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xA1
    const input: string =
      "<!DOCTYPE IllegalNameChar¡ [\n<!ELEMENT IllegalNameChar¡ ANY>\n]>\n<!-- IllegalNameChar #0xA1 -->\n<IllegalNameChar¡/>\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '¡' (U+00A1)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an03.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xAF
    const input: string =
      "<!DOCTYPE IllegalNameChar¯ [\n<!ELEMENT IllegalNameChar¯ ANY>\n]>\n<!-- IllegalNameChar #0xAF   -->\n<IllegalNameChar¯/>\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '¯' (U+00AF)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an04.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x37E
    const input: string =
      "<!DOCTYPE IllegalNameChar; [\n<!ELEMENT IllegalNameChar; ANY>\n]>\n<!-- IllegalNameChar #0x37E -->\n<IllegalNameChar;/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ';' (U+037E)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an05.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2000
    const input: string =
      "<!DOCTYPE IllegalNameChar  [\n<!ELEMENT IllegalNameChar  ANY>\n]>\n<!-- IllegalNameChar #0x2000 -->\n<IllegalNameChar />";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ' ' (U+2000)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an06.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2001
    const input: string =
      "<!DOCTYPE IllegalNameChar  [\n<!ELEMENT IllegalNameChar  ANY>\n]>\n<!-- IllegalNameChar #0x2001 -->\n<IllegalNameChar />";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ' ' (U+2001)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an07.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2002
    const input: string =
      "<!DOCTYPE IllegalNameChar  [\n<!ELEMENT IllegalNameChar  ANY>\n]>\n<!-- IllegalNameChar #0x2002 -->\n<IllegalNameChar />";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ' ' (U+2002)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an08.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2005
    const input: string =
      "<!DOCTYPE IllegalNameChar  [\n<!ELEMENT IllegalNameChar  ANY>\n]>\n<!-- IllegalNameChar #0x2005 -->\n<IllegalNameChar />";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found ' ' (U+2005)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an09.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x200B
    const input: string =
      "<!DOCTYPE IllegalNameChar​ [\n<!ELEMENT IllegalNameChar​ ANY>\n]>\n<!-- IllegalNameChar #0x200B -->\n<IllegalNameChar​/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '​' (U+200B)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an10.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x200E
    const input: string =
      "<!DOCTYPE IllegalNameChar‎ [\n<!ELEMENT IllegalNameChar‎ ANY>\n]>\n<!-- IllegalNameChar #0x200E -->\n<IllegalNameChar‎/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '‎' (U+200E)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an11.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2038
    const input: string =
      "<!DOCTYPE IllegalNameChar‽ [\r\n<!ELEMENT IllegalNameChar‽ ANY>\r\n]>\r\n<!-- IllegalNameChar #0x2038 -->\r\n<IllegalNameChar‽/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '‽' (U+203D)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an12.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2041
    const input: string =
      "<!DOCTYPE IllegalNameChar⁁ [\r\n<!ELEMENT IllegalNameChar⁁ ANY>\r\n]>\r\n<!-- IllegalNameChar #0x2041 -->\r\n<IllegalNameChar⁁/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '⁁' (U+2041)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an13.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2190
    const input: string =
      "<!DOCTYPE IllegalNameChar← [\n<!ELEMENT IllegalNameChar← ANY>\n]>\n<!-- IllegalNameChar #0x2190 -->\n<IllegalNameChar←/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '←' (U+2190)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an14.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x23FF
    const input: string =
      "<!DOCTYPE IllegalNameChar⏿ [\n<!ELEMENT IllegalNameChar⏿ ANY>\n]>\n<!-- IllegalNameChar #0x23FF -->\n<IllegalNameChar⏿/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '⏿' (U+23FF)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an15.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x280F
    const input: string =
      "<!DOCTYPE IllegalNameChar⠏ [\n<!ELEMENT IllegalNameChar⠏ ANY>\n]>\n<!-- IllegalNameChar #0x280F -->\n<IllegalNameChar⠏/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '⠏' (U+280F)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an16.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2A00
    const input: string =
      "<!DOCTYPE IllegalNameChar⨀ [\n<!ELEMENT IllegalNameChar⨀ ANY>\n]>\n<!-- IllegalNameChar #0x2A00 -->\n<IllegalNameChar⨀/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '⨀' (U+2A00)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an17.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xFDD0
    const input: string =
      "<!DOCTYPE IllegalNameChar﷐ [\n<!ELEMENT IllegalNameChar﷐ ANY>\n]>\n<!-- IllegalNameChar #0xFDD0 -->\n<IllegalNameChar﷐/>\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '﷐' (U+FDD0)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an18.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xFDEF
    const input: string =
      "<!DOCTYPE IllegalNameChar﷯ [\n<!ELEMENT IllegalNameChar﷯ ANY>\n]>\n<!-- IllegalNameChar #0xFDEF -->\n<IllegalNameChar﷯/>\n";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '﷯' (U+FDEF)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an19.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x2FFF
    const input: string =
      "<!DOCTYPE IllegalNameChar⿿ [\n<!ELEMENT IllegalNameChar⿿ ANY>\n]>\n<!-- IllegalNameChar #0x2FFF -->\n<IllegalNameChar⿿/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '⿿' (U+2FFF)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an20.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0x3000
    const input: string =
      "<!DOCTYPE IllegalNameChar　 [\n<!ELEMENT IllegalNameChar　 ANY>\n]>\n<!-- IllegalNameChar  #0x3000 -->\n<IllegalNameChar　/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '　' (U+3000)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an21.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xD800
    const input = Buffer.from(
      "PCFET0NUWVBFIElsbGVnYWxOYW1lQ2hhcu2ggCBbCjwhRUxFTUVOVCBJbGxlZ2FsTmFtZUNoYXLtoIAgQU5ZPgpdPgo8IS0tIElsbGVnYWxOYW1lQ2hhciAjMHhEODAwIC0tPgo8SWxsZWdhbE5hbWVDaGFy7aCALz4K",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an22.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xD801
    const input = Buffer.from(
      "PCFET0NUWVBFIElsbGVnYWxOYW1lQ2hhcu2ggSBbCjwhRUxFTUVOVCBJbGxlZ2FsTmFtZUNoYXLtoIEgQU5ZPgpdPgo8IS0tIElsbGVnYWxOYW1lQ2hhciAjMHhEODAxIC0tPgo8SWxsZWdhbE5hbWVDaGFy7aCBLz4K",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an23.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xDAFF
    const input = Buffer.from(
      "PCFET0NUWVBFIElsbGVnYWxOYW1lQ2hhcu2rvyBbCjwhRUxFTUVOVCBJbGxlZ2FsTmFtZUNoYXLtq78gQU5ZPgpdPgo8IS0tIElsbGVnYWxOYW1lQ2hhciAjMHhEQUZGIC0tPgo8SWxsZWdhbE5hbWVDaGFy7au/Lz4K",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an24.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xDFFF
    const input = Buffer.from(
      "PCFET0NUWVBFIElsbGVnYWxOYW1lQ2hhcu2/vyBbCjwhRUxFTUVOVCBJbGxlZ2FsTmFtZUNoYXLtv78gQU5ZPgpdPgo8IS0tIElsbGVnYWxOYW1lQ2hhciAjMHhERkZGIC0tPgo8SWxsZWdhbE5hbWVDaGFy7b+/Lz4K",
      "base64",
    );
    expectRejects(input, "XML Parse error: Invalid UTF-8");
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an25.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xEFFF
    const input: string =
      "<!DOCTYPE IllegalNameChar [\n<!ELEMENT IllegalNameChar ANY>\n]>\n<!-- IllegalNameChar #0xEFFF -->\n<IllegalNameChar/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '' (U+EFFF)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an26.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xF1FF
    const input: string =
      "<!DOCTYPE IllegalNameChar [\n<!ELEMENT IllegalNameChar ANY>\n]>\n<!-- IllegalNameChar #0xF1FF -->\n<IllegalNameChar/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '' (U+F1FF)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an27.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xF8FF
    const input: string =
      "<!DOCTYPE IllegalNameChar [\n<!ELEMENT IllegalNameChar ANY>\n]>\n<!-- IllegalNameChar #0xF8FF -->\n<IllegalNameChar/>";
    expectRejects(
      input,
      "XML Parse error: Expected SYSTEM, PUBLIC, '[' or '>' in the document type declaration but found '' (U+F8FF)",
    );
  });

  test("x-ibm-1-0.5-not-wf-P04a-ibm04an28.xml", () => {
    // 2.3 — Tests an element with an illegal NameChar: #0xFFFFF
    const input: string =
      "<!DOCTYPE IllegalNameChar\uffff [\n<!ELEMENT IllegalNameChar\uffff ANY>\n]>\n<!-- IllegalNameChar #0xFFFFF -->\n<IllegalNameChar\uffff/>";
    expectRejects(input, "XML Parse error: Invalid character in XML: '\uffff' (U+FFFF)");
  });

  test("x-ibm-1-0.5-not-wf-P05-ibm05n01.xml", () => {
    // 2.3 — Tests an element with an illegal Name containing #0x0B
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT BadName\u000b EMPTY>\n]>\n<!-- BadName containing char 0x0B; -->\n<root>\n\t<BadName\u000b/>\t\n</root>";
    expectRejects(input, "XML Parse error: Invalid character in XML: control character 0x0B");
  });

  test("x-ibm-1-0.5-not-wf-P05-ibm05n02.xml", () => {
    // 2.3 — Tests an element with an illegal Name containing #0x300
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT ̀BadName EMPTY>\n]>\n<!-- BadName containing char 0x300; -->\n<root>\n\t<̀BadName/>\t\n</root>\n";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '̀BadName'");
  });

  test("x-ibm-1-0.5-not-wf-P05-ibm05n03.xml", () => {
    // 2.3 — Tests an element with an illegal Name containing #0x36F
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT ͯBadName EMPTY>\n]>\n<!-- BadName containing char 0x36F; -->\n<root>\n\t<ͯBadName/>\t\n</root>";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found 'ͯBadName'");
  });

  test("x-ibm-1-0.5-not-wf-P05-ibm05n04.xml", () => {
    // 2.3 — Tests an element with an illegal Name containing #0x203F
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT ‿BadName EMPTY>\n]>\n<!-- BadName containing char 0x203F; -->\n<root>\n\t<‿BadName/>\t\n</root>";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '‿BadName'");
  });

  test("x-ibm-1-0.5-not-wf-P05-ibm05n05.xml", () => {
    // 2.3 — Tests an element with an illegal Name containing #x2040
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT ⁀BadName EMPTY>\n]>\n<!-- BadName containing char #x2040; -->\n<root>\n\t<⁀BadName/>\t\n</root>";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '⁀BadName'");
  });

  test("x-ibm-1-0.5-not-wf-P05-ibm05n06.xml", () => {
    // 2.3 — Tests an element with an illegal Name containing #0xB7
    const input: string =
      "<!DOCTYPE root [\n<!ELEMENT root ANY>\n<!ELEMENT ·BadName EMPTY>\n]>\n<!-- BadName containing char 0xB7; -->\n<root>\n\t<·BadName/>\t\n</root>";
    expectRejects(input, "XML Parse error: Expected an element name after '<!ELEMENT' but found '·BadName'");
  });

  test("x-ibm-1-0.5-valid-P04-ibm04v01.xml", () => {
    // 2.3 — This test case covers legal NameStartChars character ranges plus discrete legal characters for
    // production 04.
    const input: string =
      "<!DOCTYPE LegalNameStartChar [\r\n<!ELEMENT LegalNameStartChar ANY>\r\n<!ELEMENT :LegalNameStartChar ANY>\r\n<!ELEMENT ÀLegalNameStartChar ANY>\r\n<!ELEMENT ÁLegalNameStartChar ANY>\r\n<!ELEMENT ˾LegalNameStartChar ANY>\r\n<!ELEMENT ˿LegalNameStartChar ANY>\r\n<!ELEMENT ͰLegalNameStartChar ANY>\r\n<!ELEMENT ͱLegalNameStartChar ANY>\r\n<!ELEMENT ͼLegalNameStartChar ANY>\r\n<!ELEMENT ͽLegalNameStartChar ANY>\r\n<!ELEMENT ͿLegalNameStartChar ANY>\r\n<!ELEMENT ΀LegalNameStartChar ANY>\r\n<!ELEMENT ῾LegalNameStartChar ANY>\r\n<!ELEMENT ῿LegalNameStartChar ANY>\r\n<!ELEMENT ‌LegalNameStartChar ANY>\r\n<!ELEMENT ‍LegalNameStartChar ANY>\r\n<!ELEMENT ⁰LegalNameStartChar ANY>\r\n<!ELEMENT ⁱLegalNameStartChar ANY>\r\n<!ELEMENT ↎LegalNameStartChar ANY>\r\n<!ELEMENT ↏LegalNameStartChar ANY>\r\n<!ELEMENT ⰀLegalNameStartChar ANY>\r\n<!ELEMENT ⰁLegalNameStartChar ANY>\r\n<!ELEMENT ⿮LegalNameStartChar ANY>\r\n<!ELEMENT ⿯LegalNameStartChar ANY>\r\n<!ELEMENT 、LegalNameStartChar ANY>\r\n<!ELEMENT 。LegalNameStartChar ANY>\r\n<!ELEMENT ퟾LegalNameStartChar ANY>\r\n<!ELEMENT ퟿LegalNameStartChar ANY>\r\n<!ELEMENT 豈LegalNameStartChar ANY>\r\n<!ELEMENT 更LegalNameStartChar ANY>\r\n]>\r\n<!-- LegalNameChar  0x3A,0xC0,,0xC1,0x2FE,0xC0,,0xC1,0x2FE,0x2FF,0x370,0x371,0x37C,0x37D,0x37F,0x380,0x1FFE,0x1FFF,0x200C,0x200D,0x2070,0x2071,0x218E,0x218F,0x2C00,0x2C01,0x2FEE,0x2FEF,0x3001,0x3002,0xD7FE,0xD7FF,0xF900,0xF901,0xEFFFF,0xFFFFF\r\nin p02:   -->\r\n<LegalNameStartChar>\t<:LegalNameStartChar/>\r\n\t<ÀLegalNameStartChar/>\r\n\t<ÁLegalNameStartChar/>\r\n\t<˾LegalNameStartChar/>\r\n\t<˿LegalNameStartChar/>\r\n\t<ͰLegalNameStartChar/>\r\n\t<ͱLegalNameStartChar/>\r\n\t<ͼLegalNameStartChar/>\r\n\t<ͽLegalNameStartChar/>\r\n\t<ͿLegalNameStartChar/>\r\n\t<΀LegalNameStartChar/>\r\n\t<῾LegalNameStartChar/>\r\n\t<῿LegalNameStartChar/>\r\n\t<‌LegalNameStartChar/>\r\n\t<‍LegalNameStartChar/>\r\n\t<⁰LegalNameStartChar/>\r\n\t<ⁱLegalNameStartChar/>\r\n\t<↎LegalNameStartChar/>\r\n\t<↏LegalNameStartChar/>\r\n\t<ⰀLegalNameStartChar/>\r\n\t<ⰁLegalNameStartChar/>\r\n\t<⿮LegalNameStartChar/>\r\n\t<⿯LegalNameStartChar/>\r\n\t<、LegalNameStartChar/>\r\n\t<。LegalNameStartChar/>\r\n\t<퟾LegalNameStartChar/>\r\n\t<퟿LegalNameStartChar/>\r\n\t<豈LegalNameStartChar/>\r\n\t<更LegalNameStartChar/>\r\n\r\n</LegalNameStartChar>";
    expectParses(input);
  });

  test("x-ibm-1-0.5-valid-P04-ibm04av01.xml", () => {
    // 2.3 — This test case covers legal NameChars character ranges plus discrete legal characters for
    // production 04a.
    const input: string =
      "<!DOCTYPE LegalNameChar [\n<!ELEMENT LegalNameChar ANY>\n<!ELEMENT LegalNameCharÀ ANY>\n<!ELEMENT LegalNameCharÁ ANY>\n<!ELEMENT LegalNameChar˾ ANY>\n<!ELEMENT LegalNameCharÂ ANY>\n<!ELEMENT LegalNameCharÃ ANY>\n<!ELEMENT LegalNameChar˽ ANY>\n<!ELEMENT LegalNameChar˿ ANY>\n<!ELEMENT LegalNameCharͰ ANY>\n<!ELEMENT LegalNameCharͱ ANY>\n<!ELEMENT LegalNameCharͼ ANY>\n<!ELEMENT LegalNameCharͽ ANY>\n<!ELEMENT LegalNameCharͿ ANY>\n<!ELEMENT LegalNameChar΀ ANY>\n<!ELEMENT LegalNameChar῾ ANY>\n<!ELEMENT LegalNameChar῿ ANY>\n<!ELEMENT LegalNameChar‌ ANY>\n<!ELEMENT LegalNameChar‍ ANY>\n<!ELEMENT LegalNameChar⁰ ANY>\n<!ELEMENT LegalNameCharⁱ ANY>\n<!ELEMENT LegalNameChar↎ ANY>\n<!ELEMENT LegalNameChar↏ ANY>\n<!ELEMENT LegalNameCharⰀ ANY>\n<!ELEMENT LegalNameCharⰁ ANY>\n<!ELEMENT LegalNameChar⿮ ANY>\n<!ELEMENT LegalNameChar⿯ ANY>\n<!ELEMENT LegalNameChar、 ANY>\n<!ELEMENT LegalNameChar。 ANY>\n<!ELEMENT LegalNameChar퟾ ANY>\n<!ELEMENT LegalNameChar퟿ ANY>\n<!ELEMENT LegalNameChar豈 ANY>\n<!ELEMENT LegalNameChar更 ANY>\n<!ELEMENT LegalNameChar� ANY>\n<!ELEMENT LegalNameChar- ANY>\n<!ELEMENT LegalNameChar. ANY>\n<!ELEMENT LegalNameCharA ANY>\n<!ELEMENT LegalNameCharz ANY>\n<!ELEMENT LegalNameChar0 ANY>\n<!ELEMENT LegalNameChar· ANY>\n<!ELEMENT LegalNameChar̀ ANY>\n<!ELEMENT LegalNameChaŕ ANY>\n<!ELEMENT LegalNameCharͮ ANY>\n<!ELEMENT LegalNameCharͯ ANY>\n<!ELEMENT LegalNameChar‿ ANY>\n<!ELEMENT LegalNameChar⁀ ANY>\n]>\n<!-- LegalNameChars ending with\n0x003A, 0x00C0, 0x00C1, 0x02FE, 0x00C2, 0x00C3, 0x02FD, 0x02FF, 0x0370, 0x0371, 0x037C, 0x037D, 0x037F, 0x0380, 0x1FFE, 0x1FFF, 0x200C, 0x200D, 0x2070, 0x2071, 0x218E, 0x218F, 0x2C00, 0x2C01, 0x2FEE, 0x2FEF, 0x3001, 0x3002, 0xD7FE, 0xD7FF, 0xF900, 0xF901, 0xFFFD, 0x002D, 0x002E, 0x0041, 0x007A, 0x0030, 0x00B7, 0x0300, 0x0301, 0x036E, 0x036F, 0x203F, 0x2040\n-->\n<LegalNameChar>\t\n\t<LegalNameCharÀ/>\n\t<LegalNameCharÁ/>\n\t<LegalNameChar˾/>\n\t<LegalNameCharÂ/>\n\t<LegalNameCharÃ/>\n\t<LegalNameChar˽/>\n\t<LegalNameChar˿/>\n\t<LegalNameCharͰ/>\n\t<LegalNameCharͱ/>\n\t<LegalNameCharͼ/>\n\t<LegalNameCharͽ/>\n\t<LegalNameCharͿ/>\n\t<LegalNameChar΀/>\n\t<LegalNameChar῾/>\n\t<LegalNameChar῿/>\n\t<LegalNameChar‌/>\n\t<LegalNameChar‍/>\n\t<LegalNameChar⁰/>\n\t<LegalNameCharⁱ/>\n\t<LegalNameChar↎/>\n\t<LegalNameChar↏/>\n\t<LegalNameCharⰀ/>\n\t<LegalNameCharⰁ/>\n\t<LegalNameChar⿮/>\n\t<LegalNameChar⿯/>\n\t<LegalNameChar、/>\n\t<LegalNameChar。/>\n\t<LegalNameChar퟾/>\n\t<LegalNameChar퟿/>\n\t<LegalNameChar豈/>\n\t<LegalNameChar更/>\n\t<LegalNameChar�/>\n\t<LegalNameChar-/>\n\t<LegalNameChar./>\n\t<LegalNameCharA/>\n\t<LegalNameCharz/>\n\t<LegalNameChar0/>\n\t<LegalNameChar·/>\n\t<LegalNameChar̀/>\n\t<LegalNameChaŕ/>\n\t<LegalNameCharͮ/>\n\t<LegalNameCharͯ/>\n\t<LegalNameChar‿/>\n\t<LegalNameChar⁀/>\n</LegalNameChar>";
    expectParses(input);
  });

  test("x-ibm-1-0.5-valid-P05-ibm05v01.xml", () => {
    // 2.3 — This test case covers legal Element Names as per production 5.
    const input: string =
      "<!DOCTYPE LegalName [\n<!ELEMENT LegalName ANY>\n<!ELEMENT LegalName: ANY>\n<!ELEMENT LegalNameÀ ANY>\n<!ELEMENT LegalNameÁ ANY>\n<!ELEMENT LegalName˾ ANY>\n<!ELEMENT LegalNameÂ ANY>\n<!ELEMENT LegalNameÃ ANY>\n<!ELEMENT LegalName˽ ANY>\n<!ELEMENT LegalName˿ ANY>\n<!ELEMENT LegalNameͰ ANY>\n<!ELEMENT LegalNameͱ ANY>\n<!ELEMENT LegalNameͼͽ ANY>\n<!ELEMENT LegalNameͽͿ ANY>\n<!ELEMENT LegalNameͿ΀ ANY>\n<!ELEMENT LegalName΀῾ ANY>\n<!ELEMENT LegalName῾῿ ANY>\n<!ELEMENT LegalName῿‌ ANY>\n<!ELEMENT LegalName‌‍ ANY>\n<!ELEMENT LegalName‍⁰ ANY>\n<!ELEMENT LegalName⁰ⁱ ANY>\n<!ELEMENT LegalNameⁱ↎ ANY>\n<!ELEMENT LegalName↎↏Ⰰ ANY>\n<!ELEMENT LegalName↏ⰀⰁ ANY>\n<!ELEMENT LegalNameⰀⰁ⿮ ANY>\n<!ELEMENT LegalNameⰁ⿮⿯ ANY>\n<!ELEMENT LegalName⿮⿯、 ANY>\n<!ELEMENT LegalName⿯、。 ANY>\n<!ELEMENT LegalName、。퟾ ANY>\n<!ELEMENT LegalName。퟾퟿ ANY>\n<!ELEMENT LegalName퟾퟿豈 ANY>\n<!ELEMENT LegalName퟿豈更 ANY>\n<!ELEMENT LegalName豈퟿퟾。 ANY>\n<!ELEMENT LegalName更豈퟿퟾ ANY>\n<!ELEMENT LegalName�更豈퟿ ANY>\n<!ELEMENT LegalName-�更豈 ANY>\n<!ELEMENT LegalName.-�更 ANY>\n<!ELEMENT LegalNameA.-� ANY>\n<!ELEMENT LegalNamezA.- ANY>\n<!ELEMENT LegalName0zA. ANY>\n<!ELEMENT LegalName·0zA ANY>\n<!ELEMENT LegalNamè·0z ANY>\n<!ELEMENT LegalNamé̀·0 ANY>\n<!ELEMENT LegalNameͮ́̀· ANY>\n<!ELEMENT LegalNameͯͮ́̀ ANY>\n<!ELEMENT LegalName‿ͯͮ́ ANY>\n<!ELEMENT LegalName⁀‿ͯͮ ANY>\n<!ELEMENT LegalNamenull⁀‿ͯ ANY>\n<!ELEMENT LegalNamenullnull⁀‿ ANY>\n<!ELEMENT LegalNamenullnullnull⁀ ANY>\n]>\n<!-- LegalName  0x300,0x333,0x369,0x37E,0x2000,0x2001,0x2002,0x2005,0x200B,0x200E,x200F,0x2069,0x2190,0x23FF,0x280F,0x2A00,0x2EDC,0x2FED,0x2FFF,0x3000,0xD800,0xD801,0xDAFF,0xDFFF,0xEFFF,0xF1FF,0xF8FF,0xFFFFF,0x2D,0x2E, 0x41,0x7A ,0x30, 0xB7, 0x0300, 0x0301, 0xx036E, 0x036F, 0x203F, 0x203E, 0x2039, 0x2040; \nin p02:   -->\n<LegalName>\t<LegalName:/>\n\t<LegalNameÀ/>\n\t<LegalNameÁ/>\n\t<LegalName˾/>\n\t<LegalNameÂ/>\n\t<LegalNameÃ/>\n\t<LegalName˽/>\n\t<LegalName˿/>\n\t<LegalNameͰ/>\n\t<LegalNameͱ/>\n\t<LegalNameͼͽ/>\n\t<LegalNameͽͿ/>\n\t<LegalNameͿ΀/>\n\t<LegalName΀῾/>\n\t<LegalName῾῿/>\n\t<LegalName῿‌/>\n\t<LegalName‌‍/>\n\t<LegalName‍⁰/>\n\t<LegalName⁰ⁱ/>\n\t<LegalNameⁱ↎/>\n\t<LegalName↎↏Ⰰ/>\n\t<LegalName↏ⰀⰁ/>\n\t<LegalNameⰀⰁ⿮/>\n\t<LegalNameⰁ⿮⿯/>\n\t<LegalName⿮⿯、/>\n\t<LegalName⿯、。/>\n\t<LegalName、。퟾/>\n\t<LegalName。퟾퟿/>\n\t<LegalName퟾퟿豈/>\n\t<LegalName퟿豈更/>\n\t<LegalName豈퟿퟾。/>\n\t<LegalName更豈퟿퟾/>\n\t<LegalName�更豈퟿/>\n\t<LegalName-�更豈/>\n\t<LegalName.-�更/>\n\t<LegalNameA.-�/>\n\t<LegalNamezA.-/>\n\t<LegalName0zA./>\n\t<LegalName·0zA/>\n\t<LegalNamè·0z/>\n\t<LegalNamé̀·0/>\n\t<LegalNameͮ́̀·/>\n\t<LegalNameͯͮ́̀/>\n\t<LegalName‿ͯͮ́/>\n\t<LegalName⁀‿ͯͮ/>\n\t<LegalNamenull⁀‿ͯ/>\n\t<LegalNamenullnull⁀‿/>\n\t<LegalNamenullnullnull⁀/>\n</LegalName>";
    expectParses(input);
  });

  test("x-ibm-1-0.5-valid-P05-ibm05v02.xml", () => {
    // 2.3 — This test case covers legal PITarget (Names) as per production 5.
    const input: string =
      "<!DOCTYPE LegalName [\n<!ELEMENT LegalName ANY>\n]>\n<!-- Legal Names containing one to four characters in order from the list below  used in PI Target Names.  x003A, 0x00C0, 0x00C1, 0x02FE, 0x00C2, 0x00C3, 0x02FD, 0x02FF, 0x0370, 0x0371, 0x037C, 0x037D, 0x037F, 0x0380, 0x1FFE, 0x1FFF, 0x200C, 0x200D, 0x2070, 0x2071, 0x218E, 0x218F, 0x2C00, 0x2C01, 0x2FEE, 0x2FEF, 0x3001, 0x3002, 0xD7FE, 0xD7FF, 0xF900, 0xF901, 0xFFFD, 0x002D, 0x002E, 0x0041, 0x007A, 0x0030, 0x00B7, 0x0300, 0x0301, 0x036E, 0x036F, 0x203F, 0x2040 -->\n<LegalName>\n\t<?PITarget: \tTest\t PIData?>\n\t<?PITargetÀ \tTest\t PIData?>\n\t<?PITargetÁ \tTest\t PIData?>\n\t<?PITarget˾ \tTest\t PIData?>\n\t<?PITargetÂ \tTest\t PIData?>\n\t<?PITargetÃ \tTest\t PIData?>\n\t<?PITarget˽ \tTest\t PIData?>\n\t<?PITarget˿ \tTest\t PIData?>\n\t<?PITargetͰ \tTest\t PIData?>\n\t<?PITargetͱ \tTest\t PIData?>\n\t<?PITargetͼͽ \tTest\t PIData?>\n\t<?PITargetͽͿ \tTest\t PIData?>\n\t<?PITargetͿ΀ \tTest\t PIData?>\n\t<?PITarget΀῾ \tTest\t PIData?>\n\t<?PITarget῾῿ \tTest\t PIData?>\n\t<?PITarget῿‌ \tTest\t PIData?>\n\t<?PITarget‌‍ \tTest\t PIData?>\n\t<?PITarget‍⁰ \tTest\t PIData?>\n\t<?PITarget⁰ⁱ \tTest\t PIData?>\n\t<?PITargetⁱ↎ \tTest\t PIData?>\n\t<?PITarget↎↏Ⰰ \tTest\t PIData?>\n\t<?PITarget↏ⰀⰁ \tTest\t PIData?>\n\t<?PITargetⰀⰁ⿮ \tTest\t PIData?>\n\t<?PITargetⰁ⿮⿯ \tTest\t PIData?>\n\t<?PITarget⿮⿯、 \tTest\t PIData?>\n\t<?PITarget⿯、。 \tTest\t PIData?>\n\t<?PITarget、。퟾ \tTest\t PIData?>\n\t<?PITarget。퟾퟿ \tTest\t PIData?>\n\t<?PITarget퟾퟿豈 \tTest\t PIData?>\n\t<?PITarget퟿豈更 \tTest\t PIData?>\n\t<?PITarget豈퟿퟾。 \tTest\t PIData?>\n\t<?PITarget更豈퟿퟾ \tTest\t PIData?>\n\t<?PITarget�更豈퟿ \tTest\t PIData?>\n\t<?PITarget-�更豈 \tTest\t PIData?>\n\t<?PITarget.-�更 \tTest\t PIData?>\n\t<?PITargetA.-� \tTest\t PIData?>\n\t<?PITargetzA.- \tTest\t PIData?>\n\t<?PITarget0zA. \tTest\t PIData?>\n\t<?PITarget·0zA \tTest\t PIData?>\n\t<?PITarget̀·0z \tTest\t PIData?>\n\t<?PITarget́̀·0 \tTest\t PIData?>\n\t<?PITargetͮ́̀· \tTest\t PIData?>\n\t<?PITargetͯͮ́̀ \tTest\t PIData?>\n\t<?PITarget‿ͯͮ́ \tTest\t PIData?>\n\t<?PITarget⁀‿ͯͮ \tTest\t PIData?>\n\t<?PITargetnull⁀‿ͯ \tTest\t PIData?>\n\t<?PITargetnullnull⁀‿ \tTest\t PIData?>\n\t<?PITargetnullnullnull⁀ \tTest\t PIData?>\n</LegalName>";
    expectParses(input);
  });

  test("x-ibm-1-0.5-valid-P05-ibm05v03.xml", () => {
    // 2.3 — This test case covers legal Attribute (Names) as per production 5.
    const input: string =
      '<!DOCTYPE LegalName [\n<!ELEMENT LegalName ANY>\n<!ATTLIST LegalName :attr CDATA #IMPLIED>\n<!ATTLIST LegalName Àattr CDATA #IMPLIED>\n<!ATTLIST LegalName Áattr CDATA #IMPLIED>\n<!ATTLIST LegalName ˾attr CDATA #IMPLIED>\n<!ATTLIST LegalName Âattr CDATA #IMPLIED>\n<!ATTLIST LegalName Ãattr CDATA #IMPLIED>\n<!ATTLIST LegalName ˽attr CDATA #IMPLIED>\n<!ATTLIST LegalName ˿attr CDATA #IMPLIED>\n<!ATTLIST LegalName Ͱattr CDATA #IMPLIED>\n<!ATTLIST LegalName ͱattr CDATA #IMPLIED>\n<!ATTLIST LegalName ͼͽattr CDATA #IMPLIED>\n<!ATTLIST LegalName ͽͿattr CDATA #IMPLIED>\n<!ATTLIST LegalName Ϳ΀attr CDATA #IMPLIED>\n<!ATTLIST LegalName ΀῾attr CDATA #IMPLIED>\n<!ATTLIST LegalName ῾῿attr CDATA #IMPLIED>\n<!ATTLIST LegalName ῿‌attr CDATA #IMPLIED>\n<!ATTLIST LegalName ‌‍attr CDATA #IMPLIED>\n<!ATTLIST LegalName ‍⁰attr CDATA #IMPLIED>\n<!ATTLIST LegalName ⁰ⁱattr CDATA #IMPLIED>\n<!ATTLIST LegalName ⁱ↎attr CDATA #IMPLIED>\n<!ATTLIST LegalName ↎↏Ⰰattr CDATA #IMPLIED>\n<!ATTLIST LegalName ↏ⰀⰁattr CDATA #IMPLIED>\n<!ATTLIST LegalName ⰀⰁ⿮attr CDATA #IMPLIED>\n<!ATTLIST LegalName Ⰱ⿮⿯attr CDATA #IMPLIED>\n<!ATTLIST LegalName ⿮⿯、attr CDATA #IMPLIED>\n<!ATTLIST LegalName ⿯、。attr CDATA #IMPLIED>\n<!ATTLIST LegalName 、。퟾attr CDATA #IMPLIED>\n<!ATTLIST LegalName 。퟾퟿attr CDATA #IMPLIED>\n<!ATTLIST LegalName ퟾퟿豈attr CDATA #IMPLIED>\n<!ATTLIST LegalName ퟿豈更attr CDATA #IMPLIED>\n<!ATTLIST LegalName 豈퟿퟾。attr CDATA #IMPLIED>\n<!ATTLIST LegalName 更豈퟿퟾attr CDATA #IMPLIED>\n<!ATTLIST LegalName �更豈퟿attr CDATA #IMPLIED>\n<!ATTLIST LegalName attr-�更豈 CDATA #IMPLIED>\n<!ATTLIST LegalName attr.-�更 CDATA #IMPLIED>\n<!ATTLIST LegalName A.-�attr CDATA #IMPLIED>\n<!ATTLIST LegalName zA.-attr CDATA #IMPLIED>\n<!ATTLIST LegalName attr0zA. CDATA #IMPLIED>\n<!ATTLIST LegalName attr·0zA CDATA #IMPLIED>\n<!ATTLIST LegalName attr̀·0z CDATA #IMPLIED>\n<!ATTLIST LegalName attŕ̀·0 CDATA #IMPLIED>\n<!ATTLIST LegalName attrͮ́̀· CDATA #IMPLIED>\n<!ATTLIST LegalName attrͯͮ́̀ CDATA #IMPLIED>\n<!ATTLIST LegalName attr‿ͯͮ́ CDATA #IMPLIED>\n<!ATTLIST LegalName attr⁀‿ͯͮ CDATA #IMPLIED>\n<!ATTLIST LegalName null⁀‿ͯattr CDATA #IMPLIED>\n<!ATTLIST LegalName nullnull⁀‿attr CDATA #IMPLIED>\n<!ATTLIST LegalName nullnullnull⁀attr CDATA #IMPLIED>\n]>\n<!-- Legal Names containing one to four characters in order from the list below  used in Attr delcs and attributes.  x003A, 0x00C0, 0x00C1, 0x02FE, 0x00C2, 0x00C3, 0x02FD, 0x02FF, 0x0370, 0x0371, 0x037C, 0x037D, 0x037F, 0x0380, 0x1FFE, 0x1FFF, 0x200C, 0x200D, 0x2070, 0x2071, 0x218E, 0x218F, 0x2C00, 0x2C01, 0x2FEE, 0x2FEF, 0x3001, 0x3002, 0xD7FE, 0xD7FF, 0xF900, 0xF901, 0xFFFD, 0x002D, 0x002E, 0x0041, 0x007A, 0x0030, 0x00B7, 0x0300, 0x0301, 0x036E, 0x036F, 0x203F, 0x2040 -->\n<LegalName \n \t:attr="attrValue"\n \tÀattr="attrValue"\n \tÁattr="attrValue"\n \t˾attr="attrValue"\n \tÂattr="attrValue"\n \tÃattr="attrValue"\n \t˽attr="attrValue"\n \t˿attr="attrValue"\n \tͰattr="attrValue"\n \tͱattr="attrValue"\n \tͼͽattr="attrValue"\n \tͽͿattr="attrValue"\n \tͿ΀attr="attrValue"\n \t΀῾attr="attrValue"\n \t῾῿attr="attrValue"\n \t῿‌attr="attrValue"\n \t‌‍attr="attrValue"\n \t‍⁰attr="attrValue"\n \t⁰ⁱattr="attrValue"\n \tⁱ↎attr="attrValue"\n \t↎↏Ⰰattr="attrValue"\n \t↏ⰀⰁattr="attrValue"\n \tⰀⰁ⿮attr="attrValue"\n \tⰁ⿮⿯attr="attrValue"\n \t⿮⿯、attr="attrValue"\n \t⿯、。attr="attrValue"\n \t、。퟾attr="attrValue"\n \t。퟾퟿attr="attrValue"\n \t퟾퟿豈attr="attrValue"\n \t퟿豈更attr="attrValue"\n \t豈퟿퟾。attr="attrValue"\n \t更豈퟿퟾attr="attrValue"\n \t�更豈퟿attr="attrValue"\n \tattr-�更豈="attrValue"\n \tattr.-�更="attrValue"\n \tA.-�attr="attrValue"\n \tzA.-attr="attrValue"\n \tattr0zA.="attrValue"\n \tattr·0zA="attrValue"\n \tattr̀·0z="attrValue"\n \tattŕ̀·0="attrValue"\n \tattrͮ́̀·="attrValue"\n \tattrͯͮ́̀="attrValue"\n \tattr‿ͯͮ́="attrValue"\n \tattr⁀‿ͯͮ="attrValue"\n \tnull⁀‿ͯattr="attrValue"\n \tnullnull⁀‿attr="attrValue"\n \tnullnullnull⁀attr="attrValue"\n />';
    expectParses(input);
  });

  test("x-ibm-1-0.5-valid-P05-ibm05v04.xml", () => {
    // 2.3 — This test case covers legal ID/IDREF (Names) as per production 5.
    const input: string =
      '<!DOCTYPE LegalName [\n<!ELEMENT LegalName ANY>\n<!ELEMENT LegalName0 ANY>\n<!ATTLIST LegalName0 attr0 ID #IMPLIED>\n<!ATTLIST LegalName0 attr00 IDREF #IMPLIED>\n<!ELEMENT LegalName1 ANY>\n<!ATTLIST LegalName1 attr1 ID #IMPLIED>\n<!ATTLIST LegalName1 attr10 IDREF #IMPLIED>\n<!ELEMENT LegalName2 ANY>\n<!ATTLIST LegalName2 attr2 ID #IMPLIED>\n<!ATTLIST LegalName2 attr20 IDREF #IMPLIED>\n<!ELEMENT LegalName3 ANY>\n<!ATTLIST LegalName3 attr3 ID #IMPLIED>\n<!ATTLIST LegalName3 attr30 IDREF #IMPLIED>\n<!ELEMENT LegalName4 ANY>\n<!ATTLIST LegalName4 attr4 ID #IMPLIED>\n<!ATTLIST LegalName4 attr40 IDREF #IMPLIED>\n<!ELEMENT LegalName5 ANY>\n<!ATTLIST LegalName5 attr5 ID #IMPLIED>\n<!ATTLIST LegalName5 attr50 IDREF #IMPLIED>\n<!ELEMENT LegalName6 ANY>\n<!ATTLIST LegalName6 attr6 ID #IMPLIED>\n<!ATTLIST LegalName6 attr60 IDREF #IMPLIED>\n<!ELEMENT LegalName7 ANY>\n<!ATTLIST LegalName7 attr7 ID #IMPLIED>\n<!ATTLIST LegalName7 attr70 IDREF #IMPLIED>\n<!ELEMENT LegalName8 ANY>\n<!ATTLIST LegalName8 attr8 ID #IMPLIED>\n<!ATTLIST LegalName8 attr80 IDREF #IMPLIED>\n<!ELEMENT LegalName9 ANY>\n<!ATTLIST LegalName9 attr9 ID #IMPLIED>\n<!ATTLIST LegalName9 attr90 IDREF #IMPLIED>\n<!ELEMENT LegalName10 ANY>\n<!ATTLIST LegalName10 attr10 ID #IMPLIED>\n<!ATTLIST LegalName10 attr100 IDREF #IMPLIED>\n<!ELEMENT LegalName11 ANY>\n<!ATTLIST LegalName11 attr11 ID #IMPLIED>\n<!ATTLIST LegalName11 attr110 IDREF #IMPLIED>\n<!ELEMENT LegalName12 ANY>\n<!ATTLIST LegalName12 attr12 ID #IMPLIED>\n<!ATTLIST LegalName12 attr120 IDREF #IMPLIED>\n<!ELEMENT LegalName13 ANY>\n<!ATTLIST LegalName13 attr13 ID #IMPLIED>\n<!ATTLIST LegalName13 attr130 IDREF #IMPLIED>\n<!ELEMENT LegalName14 ANY>\n<!ATTLIST LegalName14 attr14 ID #IMPLIED>\n<!ATTLIST LegalName14 attr140 IDREF #IMPLIED>\n<!ELEMENT LegalName15 ANY>\n<!ATTLIST LegalName15 attr15 ID #IMPLIED>\n<!ATTLIST LegalName15 attr150 IDREF #IMPLIED>\n<!ELEMENT LegalName16 ANY>\n<!ATTLIST LegalName16 attr16 ID #IMPLIED>\n<!ATTLIST LegalName16 attr160 IDREF #IMPLIED>\n<!ELEMENT LegalName17 ANY>\n<!ATTLIST LegalName17 attr17 ID #IMPLIED>\n<!ATTLIST LegalName17 attr170 IDREF #IMPLIED>\n<!ELEMENT LegalName18 ANY>\n<!ATTLIST LegalName18 attr18 ID #IMPLIED>\n<!ATTLIST LegalName18 attr180 IDREF #IMPLIED>\n<!ELEMENT LegalName19 ANY>\n<!ATTLIST LegalName19 attr19 ID #IMPLIED>\n<!ATTLIST LegalName19 attr190 IDREF #IMPLIED>\n<!ELEMENT LegalName20 ANY>\n<!ATTLIST LegalName20 attr20 ID #IMPLIED>\n<!ATTLIST LegalName20 attr200 IDREF #IMPLIED>\n<!ELEMENT LegalName21 ANY>\n<!ATTLIST LegalName21 attr21 ID #IMPLIED>\n<!ATTLIST LegalName21 attr210 IDREF #IMPLIED>\n<!ELEMENT LegalName22 ANY>\n<!ATTLIST LegalName22 attr22 ID #IMPLIED>\n<!ATTLIST LegalName22 attr220 IDREF #IMPLIED>\n<!ELEMENT LegalName23 ANY>\n<!ATTLIST LegalName23 attr23 ID #IMPLIED>\n<!ATTLIST LegalName23 attr230 IDREF #IMPLIED>\n<!ELEMENT LegalName24 ANY>\n<!ATTLIST LegalName24 attr24 ID #IMPLIED>\n<!ATTLIST LegalName24 attr240 IDREF #IMPLIED>\n<!ELEMENT LegalName25 ANY>\n<!ATTLIST LegalName25 attr25 ID #IMPLIED>\n<!ATTLIST LegalName25 attr250 IDREF #IMPLIED>\n<!ELEMENT LegalName26 ANY>\n<!ATTLIST LegalName26 attr26 ID #IMPLIED>\n<!ATTLIST LegalName26 attr260 IDREF #IMPLIED>\n<!ELEMENT LegalName27 ANY>\n<!ATTLIST LegalName27 attr27 ID #IMPLIED>\n<!ATTLIST LegalName27 attr270 IDREF #IMPLIED>\n<!ELEMENT LegalName28 ANY>\n<!ATTLIST LegalName28 attr28 ID #IMPLIED>\n<!ATTLIST LegalName28 attr280 IDREF #IMPLIED>\n<!ELEMENT LegalName29 ANY>\n<!ATTLIST LegalName29 attr29 ID #IMPLIED>\n<!ATTLIST LegalName29 attr290 IDREF #IMPLIED>\n<!ELEMENT LegalName30 ANY>\n<!ATTLIST LegalName30 attr30 ID #IMPLIED>\n<!ATTLIST LegalName30 attr300 IDREF #IMPLIED>\n<!ELEMENT LegalName31 ANY>\n<!ATTLIST LegalName31 attr31 ID #IMPLIED>\n<!ATTLIST LegalName31 attr310 IDREF #IMPLIED>\n<!ELEMENT LegalName32 ANY>\n<!ATTLIST LegalName32 attr32 ID #IMPLIED>\n<!ATTLIST LegalName32 attr320 IDREF #IMPLIED>\n<!ELEMENT LegalName33 ANY>\n<!ATTLIST LegalName33 attr33 ID #IMPLIED>\n<!ATTLIST LegalName33 attr330 IDREF #IMPLIED>\n<!ELEMENT LegalName34 ANY>\n<!ATTLIST LegalName34 attr34 ID #IMPLIED>\n<!ATTLIST LegalName34 attr340 IDREF #IMPLIED>\n<!ELEMENT LegalName35 ANY>\n<!ATTLIST LegalName35 attr35 ID #IMPLIED>\n<!ATTLIST LegalName35 attr350 IDREF #IMPLIED>\n<!ELEMENT LegalName36 ANY>\n<!ATTLIST LegalName36 attr36 ID #IMPLIED>\n<!ATTLIST LegalName36 attr360 IDREF #IMPLIED>\n<!ELEMENT LegalName37 ANY>\n<!ATTLIST LegalName37 attr37 ID #IMPLIED>\n<!ATTLIST LegalName37 attr370 IDREF #IMPLIED>\n<!ELEMENT LegalName38 ANY>\n<!ATTLIST LegalName38 attr38 ID #IMPLIED>\n<!ATTLIST LegalName38 attr380 IDREF #IMPLIED>\n<!ELEMENT LegalName39 ANY>\n<!ATTLIST LegalName39 attr39 ID #IMPLIED>\n<!ATTLIST LegalName39 attr390 IDREF #IMPLIED>\n<!ELEMENT LegalName40 ANY>\n<!ATTLIST LegalName40 attr40 ID #IMPLIED>\n<!ATTLIST LegalName40 attr400 IDREF #IMPLIED>\n<!ELEMENT LegalName41 ANY>\n<!ATTLIST LegalName41 attr41 ID #IMPLIED>\n<!ATTLIST LegalName41 attr410 IDREF #IMPLIED>\n<!ELEMENT LegalName42 ANY>\n<!ATTLIST LegalName42 attr42 ID #IMPLIED>\n<!ATTLIST LegalName42 attr420 IDREF #IMPLIED>\n<!ELEMENT LegalName43 ANY>\n<!ATTLIST LegalName43 attr43 ID #IMPLIED>\n<!ATTLIST LegalName43 attr430 IDREF #IMPLIED>\n<!ELEMENT LegalName44 ANY>\n<!ATTLIST LegalName44 attr44 ID #IMPLIED>\n<!ATTLIST LegalName44 attr440 IDREF #IMPLIED>\n<!ELEMENT LegalName45 ANY>\n<!ATTLIST LegalName45 attr45 ID #IMPLIED>\n<!ATTLIST LegalName45 attr450 IDREF #IMPLIED>\n<!ELEMENT LegalName46 ANY>\n<!ATTLIST LegalName46 attr46 ID #IMPLIED>\n<!ATTLIST LegalName46 attr460 IDREF #IMPLIED>\n<!ELEMENT LegalName47 ANY>\n<!ATTLIST LegalName47 attr47 ID #IMPLIED>\n<!ATTLIST LegalName47 attr470 IDREF #IMPLIED>\n]>\n<!-- Legal Names containing one to four characters in order from the list below  used in Attr delcs and attributes.  x003A, 0x00C0, 0x00C1, 0x02FE, 0x00C2, 0x00C3, 0x02FD, 0x02FF, 0x0370, 0x0371, 0x037C, 0x037D, 0x037F, 0x0380, 0x1FFE, 0x1FFF, 0x200C, 0x200D, 0x2070, 0x2071, 0x218E, 0x218F, 0x2C00, 0x2C01, 0x2FEE, 0x2FEF, 0x3001, 0x3002, 0xD7FE, 0xD7FF, 0xF900, 0xF901, 0xFFFD, 0x002D, 0x002E, 0x0041, 0x007A, 0x0030, 0x00B7, 0x0300, 0x0301, 0x036E, 0x036F, 0x203F, 0x2040 -->\n<LegalName>\n \tattr0=":" attr00=":"\n \tattr1="À" attr10="À"\n \tattr2="Á" attr20="Á"\n \tattr3="˾" attr30="˾"\n \tattr4="Â" attr40="Â"\n \tattr5="Ã" attr50="Ã"\n \tattr6="˽" attr60="˽"\n \tattr7="˿" attr70="˿"\n \tattr8="Ͱ" attr80="Ͱ"\n \tattr9="ͱ" attr90="ͱ"\n \tattr10="ͼͽ" attr100="ͼͽ"\n \tattr11="ͽͿ" attr110="ͽͿ"\n \tattr12="Ϳ΀" attr120="Ϳ΀"\n \tattr13="΀῾" attr130="΀῾"\n \tattr14="῾῿" attr140="῾῿"\n \tattr15="῿‌" attr150="῿‌"\n \tattr16="‌‍" attr160="‌‍"\n \tattr17="‍⁰" attr170="‍⁰"\n \tattr18="⁰ⁱ" attr180="⁰ⁱ"\n \tattr19="ⁱ↎" attr190="ⁱ↎"\n \tattr20="↎↏Ⰰ" attr200="↎↏Ⰰ"\n \tattr21="↏ⰀⰁ" attr210="↏ⰀⰁ"\n \tattr22="ⰀⰁ⿮" attr220="ⰀⰁ⿮"\n \tattr23="Ⰱ⿮⿯" attr230="Ⰱ⿮⿯"\n \tattr24="⿮⿯、" attr240="⿮⿯、"\n \tattr25="⿯、。" attr250="⿯、。"\n \tattr26="、。퟾" attr260="、。퟾"\n \tattr27="。퟾퟿" attr270="。퟾퟿"\n \tattr28="퟾퟿豈" attr280="퟾퟿豈"\n \tattr29="퟿豈更" attr290="퟿豈更"\n \tattr30="豈퟿퟾。" attr300="豈퟿퟾。"\n \tattr31="更豈퟿퟾" attr310="更豈퟿퟾"\n \tattr32="�更豈퟿" attr320="�更豈퟿"\n \tattr33="-�更豈" attr330="-�更豈"\n \tattr34=".-�更" attr340=".-�更"\n \tattr35="A.-�" attr350="A.-�"\n \tattr36="zA.-" attr360="zA.-"\n \tattr37="0zA." attr370="0zA."\n \tattr38="·0zA" attr380="·0zA"\n \tattr39="̀·0z" attr390="̀·0z"\n \tattr40="́̀·0" attr400="́̀·0"\n \tattr41="ͮ́̀·" attr410="ͮ́̀·"\n \tattr42="ͯͮ́̀" attr420="ͯͮ́̀"\n \tattr43="‿ͯͮ́" attr430="‿ͯͮ́"\n \tattr44="⁀‿ͯͮ" attr440="⁀‿ͯͮ"\n \tattr45="null⁀‿ͯ" attr450="null⁀‿ͯ"\n \tattr46="nullnull⁀‿" attr460="nullnull⁀‿"\n \tattr47="nullnullnull⁀" attr470="nullnullnull⁀"\n</LegalName>';
    expectParses(input);
  });

  test("x-ibm-1-0.5-valid-P05-ibm05v05.xml", () => {
    // 2.3 — This test case covers legal ENTITY (Names) as per production 5.
    const input: string =
      '<!DOCTYPE LegalName [\n<!ELEMENT LegalName ANY>\n<!ELEMENT LegalName0 ANY>\n<!ATTLIST LegalName0 attr0 CDATA #IMPLIED>\n<!ELEMENT LegalName1 ANY>\n<!ATTLIST LegalName1 attr1 CDATA #IMPLIED>\n<!ELEMENT LegalName2 ANY>\n<!ATTLIST LegalName2 attr2 CDATA #IMPLIED>\n<!ELEMENT LegalName3 ANY>\n<!ATTLIST LegalName3 attr3 CDATA #IMPLIED>\n<!ELEMENT LegalName4 ANY>\n<!ATTLIST LegalName4 attr4 CDATA #IMPLIED>\n<!ELEMENT LegalName5 ANY>\n<!ATTLIST LegalName5 attr5 CDATA #IMPLIED>\n<!ELEMENT LegalName6 ANY>\n<!ATTLIST LegalName6 attr6 CDATA #IMPLIED>\n<!ELEMENT LegalName7 ANY>\n<!ATTLIST LegalName7 attr7 CDATA #IMPLIED>\n<!ELEMENT LegalName8 ANY>\n<!ATTLIST LegalName8 attr8 CDATA #IMPLIED>\n<!ELEMENT LegalName9 ANY>\n<!ATTLIST LegalName9 attr9 CDATA #IMPLIED>\n<!ELEMENT LegalName10 ANY>\n<!ATTLIST LegalName10 attr10 CDATA #IMPLIED>\n<!ELEMENT LegalName11 ANY>\n<!ATTLIST LegalName11 attr11 CDATA #IMPLIED>\n<!ELEMENT LegalName12 ANY>\n<!ATTLIST LegalName12 attr12 CDATA #IMPLIED>\n<!ELEMENT LegalName13 ANY>\n<!ATTLIST LegalName13 attr13 CDATA #IMPLIED>\n<!ELEMENT LegalName14 ANY>\n<!ATTLIST LegalName14 attr14 CDATA #IMPLIED>\n<!ELEMENT LegalName15 ANY>\n<!ATTLIST LegalName15 attr15 CDATA #IMPLIED>\n<!ELEMENT LegalName16 ANY>\n<!ATTLIST LegalName16 attr16 CDATA #IMPLIED>\n<!ELEMENT LegalName17 ANY>\n<!ATTLIST LegalName17 attr17 CDATA #IMPLIED>\n<!ELEMENT LegalName18 ANY>\n<!ATTLIST LegalName18 attr18 CDATA #IMPLIED>\n<!ELEMENT LegalName19 ANY>\n<!ATTLIST LegalName19 attr19 CDATA #IMPLIED>\n<!ELEMENT LegalName20 ANY>\n<!ATTLIST LegalName20 attr20 CDATA #IMPLIED>\n<!ELEMENT LegalName21 ANY>\n<!ATTLIST LegalName21 attr21 CDATA #IMPLIED>\n<!ELEMENT LegalName22 ANY>\n<!ATTLIST LegalName22 attr22 CDATA #IMPLIED>\n<!ELEMENT LegalName23 ANY>\n<!ATTLIST LegalName23 attr23 CDATA #IMPLIED>\n<!ELEMENT LegalName24 ANY>\n<!ATTLIST LegalName24 attr24 CDATA #IMPLIED>\n<!ELEMENT LegalName25 ANY>\n<!ATTLIST LegalName25 attr25 CDATA #IMPLIED>\n<!ELEMENT LegalName26 ANY>\n<!ATTLIST LegalName26 attr26 CDATA #IMPLIED>\n<!ELEMENT LegalName27 ANY>\n<!ATTLIST LegalName27 attr27 CDATA #IMPLIED>\n<!ELEMENT LegalName28 ANY>\n<!ATTLIST LegalName28 attr28 CDATA #IMPLIED>\n<!ELEMENT LegalName29 ANY>\n<!ATTLIST LegalName29 attr29 CDATA #IMPLIED>\n<!ELEMENT LegalName30 ANY>\n<!ATTLIST LegalName30 attr30 CDATA #IMPLIED>\n<!ELEMENT LegalName31 ANY>\n<!ATTLIST LegalName31 attr31 CDATA #IMPLIED>\n<!ELEMENT LegalName32 ANY>\n<!ATTLIST LegalName32 attr32 CDATA #IMPLIED>\n<!ELEMENT LegalName33 ANY>\n<!ATTLIST LegalName33 attr33 CDATA #IMPLIED>\n<!ELEMENT LegalName34 ANY>\n<!ATTLIST LegalName34 attr34 CDATA #IMPLIED>\n<!ELEMENT LegalName35 ANY>\n<!ATTLIST LegalName35 attr35 CDATA #IMPLIED>\n<!ELEMENT LegalName36 ANY>\n<!ATTLIST LegalName36 attr36 CDATA #IMPLIED>\n<!ELEMENT LegalName37 ANY>\n<!ATTLIST LegalName37 attr37 CDATA #IMPLIED>\n<!ELEMENT LegalName38 ANY>\n<!ATTLIST LegalName38 attr38 CDATA #IMPLIED>\n<!ELEMENT LegalName39 ANY>\n<!ATTLIST LegalName39 attr39 CDATA #IMPLIED>\n<!ELEMENT LegalName40 ANY>\n<!ATTLIST LegalName40 attr40 CDATA #IMPLIED>\n<!ELEMENT LegalName41 ANY>\n<!ATTLIST LegalName41 attr41 CDATA #IMPLIED>\n<!ELEMENT LegalName42 ANY>\n<!ATTLIST LegalName42 attr42 CDATA #IMPLIED>\n<!ELEMENT LegalName43 ANY>\n<!ATTLIST LegalName43 attr43 CDATA #IMPLIED>\n<!ENTITY Name: "Test">\n<!ENTITY NameÀ "Test">\n<!ENTITY NameÁ "Test">\n<!ENTITY Name˾ "Test">\n<!ENTITY NameÂ "Test">\n<!ENTITY NameÃ "Test">\n<!ENTITY Name˽ "Test">\n<!ENTITY Name˿ "Test">\n<!ENTITY NameͰ "Test">\n<!ENTITY Nameͱ "Test">\n<!ENTITY Nameͼ "Test">\n<!ENTITY Nameͽ "Test">\n<!ENTITY NameͿ "Test">\n<!ENTITY Name΀ "Test">\n<!ENTITY Name῾ "Test">\n<!ENTITY Name῿ "Test">\n<!ENTITY Name‌ "Test">\n<!ENTITY Name‍ "Test">\n<!ENTITY Name⁰ "Test">\n<!ENTITY Nameⁱ "Test">\n<!ENTITY Name↎ "Test">\n<!ENTITY Name↏ "Test">\n<!ENTITY NameⰀ "Test">\n<!ENTITY NameⰁ "Test">\n<!ENTITY Name⿮ "Test">\n<!ENTITY Name⿯ "Test">\n<!ENTITY Name、 "Test">\n<!ENTITY Name。 "Test">\n<!ENTITY Name퟾ "Test">\n<!ENTITY Name퟿ "Test">\n<!ENTITY Name豈 "Test">\n<!ENTITY Name更 "Test">\n<!ENTITY Name� "Test">\n<!ENTITY Name- "Test">\n<!ENTITY Name. "Test">\n<!ENTITY NameA "Test">\n<!ENTITY Namez "Test">\n<!ENTITY Name0 "Test">\n<!ENTITY Name· "Test">\n<!ENTITY Namè "Test">\n<!ENTITY Namé "Test">\n<!ENTITY Nameͮ "Test">\n<!ENTITY Nameͯ "Test">\n<!ENTITY Name‿ "Test">\n]>\n<!-- Legal Names containing one to four characters in order from the list below  used in Attr delcs and attributes.  x003A, 0x00C0, 0x00C1, 0x02FE, 0x00C2, 0x00C3, 0x02FD, 0x02FF, 0x0370, 0x0371, 0x037C, 0x037D, 0x037F, 0x0380, 0x1FFE, 0x1FFF, 0x200C, 0x200D, 0x2070, 0x2071, 0x218E, 0x218F, 0x2C00, 0x2C01, 0x2FEE, 0x2FEF, 0x3001, 0x3002, 0xD7FE, 0xD7FF, 0xF900, 0xF901, 0xFFFD, 0x002D, 0x002E, 0x0041, 0x007A, 0x0030, 0x00B7, 0x0300, 0x0301, 0x036E, 0x036F, 0x203F, 0x2040 -->\n<LegalName>\n<LegalName0 attr0="Name:"\t/>\n<LegalName1 attr1="NameÀ"\t/>\n<LegalName2 attr2="NameÁ"\t/>\n<LegalName3 attr3="Name˾"\t/>\n<LegalName4 attr4="NameÂ"\t/>\n<LegalName5 attr5="NameÃ"\t/>\n<LegalName6 attr6="Name˽"\t/>\n<LegalName7 attr7="Name˿"\t/>\n<LegalName8 attr8="NameͰ"\t/>\n<LegalName9 attr9="Nameͱ"\t/>\n<LegalName10 attr10="Nameͼ"\t/>\n<LegalName11 attr11="Nameͽ"\t/>\n<LegalName12 attr12="NameͿ"\t/>\n<LegalName13 attr13="Name΀"\t/>\n<LegalName14 attr14="Name῾"\t/>\n<LegalName15 attr15="Name῿"\t/>\n<LegalName16 attr16="Name‌"\t/>\n<LegalName17 attr17="Name‍"\t/>\n<LegalName18 attr18="Name⁰"\t/>\n<LegalName19 attr19="Nameⁱ"\t/>\n<LegalName20 attr20="Name↎"\t/>\n<LegalName21 attr21="Name↏"\t/>\n<LegalName22 attr22="NameⰀ"\t/>\n<LegalName23 attr23="NameⰁ"\t/>\n<LegalName24 attr24="Name⿮"\t/>\n<LegalName25 attr25="Name⿯"\t/>\n<LegalName26 attr26="Name、"\t/>\n<LegalName27 attr27="Name。"\t/>\n<LegalName28 attr28="Name퟾"\t/>\n<LegalName29 attr29="Name퟿"\t/>\n<LegalName30 attr30="Name豈"\t/>\n<LegalName31 attr31="Name更"\t/>\n<LegalName32 attr32="Name�"\t/>\n<LegalName33 attr33="Name-"\t/>\n<LegalName34 attr34="Name."\t/>\n<LegalName35 attr35="NameA"\t/>\n<LegalName36 attr36="Namez"\t/>\n<LegalName37 attr37="Name0"\t/>\n<LegalName38 attr38="Name·"\t/>\n<LegalName39 attr39="Namè"\t/>\n<LegalName40 attr40="Namé"\t/>\n<LegalName41 attr41="Nameͮ"\t/>\n<LegalName42 attr42="Nameͯ"\t/>\n<LegalName43 attr43="Name‿"\t/>\n</LegalName>';
    expectParses(input);
  });

  test("x-ibm-1-0.5-valid-P047-ibm07v01.xml", () => {
    // 2.3 — This test case covers legal NMTOKEN Name character ranges plus discrete legal characters for
    // production 7.
    const input: string =
      '<!DOCTYPE NMtokenName [\n<!ELEMENT NMtokenName ANY>\n<!ATTLIST NMtokenName thistoken0 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken1 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken2 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken3 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken4 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken5 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken6 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken7 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken8 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken9 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken10 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken11 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken12 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken13 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken14 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken15 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken16 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken17 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken18 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken19 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken20 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken21 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken22 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken23 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken24 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken25 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken26 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken27 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken28 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken29 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken30 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken31 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken32 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken33 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken34 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken35 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken36 NMTOKEN #IMPLIED>\n<!ATTLIST NMtokenName thistoken37 NMTOKEN #IMPLIED>\n]>\n<!-- LegalNameChar  0x300,0x333,0x369,0x37E,0x2000,0x2001,0x2002,0x2005,0x200B,0x200E,x200F,0x2069,0x2190,0x23FF,0x280F,0x2A00,0x2EDC,0x2FED,0x2FFF,0x3000,0xD800,0xD801,0xDAFF,0xDFFF,0xEFFF,0xF1FF,0xF8FF,0xFFFFF; _, ., 0, B7, C0, 2FFF in P07 -->\n<NMtokenName  thistoken0=":"\n thistoken1="À"\n thistoken2="Á"\n thistoken3="˾"\n thistoken4="À"\n thistoken5="Á"\n thistoken6="˾"\n thistoken7="˿"\n thistoken8="Ͱ"\n thistoken9="ͱ"\n thistoken10="ͼ"\n thistoken11="ͽ"\n thistoken12="Ϳ"\n thistoken13="΀"\n thistoken14="῾"\n thistoken15="῿"\n thistoken16="‌"\n thistoken17="‍"\n thistoken18="⁰"\n thistoken19="ⁱ"\n thistoken20="↎"\n thistoken21="↏"\n thistoken22="Ⰰ"\n thistoken23="Ⰱ"\n thistoken24="⿮"\n thistoken25="⿯"\n thistoken26="、"\n thistoken27="。"\n thistoken28="퟾"\n thistoken29="퟿"\n thistoken30="豈"\n thistoken31="更"\n thistoken32="_"\n thistoken33="."\n thistoken34="0"\n thistoken35="·"\n thistoken36="À"\n thistoken37="ͼ"\n />';
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n03.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0132 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ĳ an only legal per 5th edition char #x132\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n04.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0133 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ĳ an only legal per 5th edition char #x133\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n05.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x013F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ŀ an only legal per 5th edition char #x13f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n06.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0140 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ŀ an only legal per 5th edition char #x140\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n07.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0149 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ŉ an only legal per 5th edition char #x149\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n08.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x017F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ſ an only legal per 5th edition char #x17f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n09.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x01c4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ǆ an only legal per 5th edition char #x1c4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n10.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x01CC occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ǌ an only legal per 5th edition char #x1cc\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n100.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0BB6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ஶ an only legal per 5th edition char #x0bb6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n101.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0BBA occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஺ an only legal per 5th edition char #x0bba\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n102.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C0D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?఍ an only legal per 5th edition char #x0c0d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n103.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C11 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?఑ an only legal per 5th edition char #x0c11\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n104.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C29 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?఩ an only legal per 5th edition char #x0c29\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n105.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C34 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ఴ an only legal per 5th edition char #x0c34\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n106.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C5F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?౟ an only legal per 5th edition char #x0c5f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n107.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C62 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ౢ an only legal per 5th edition char #x0c62\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n108.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C8D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?಍ an only legal per 5th edition char #x0c8d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n109.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0C91 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?಑ an only legal per 5th edition char #x0c91\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n11.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x01F1 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ǳ an only legal per 5th edition char #x1f1\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n110.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0CA9 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?಩ an only legal per 5th edition char #x0ca9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n111.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0CB4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?಴ an only legal per 5th edition char #x0cb4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n112.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0CBA occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?಺ an only legal per 5th edition char #x0cba\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n113.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0CDF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?೟ an only legal per 5th edition char #x0cdf\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n114.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0CE2 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ೢ an only legal per 5th edition char #x0ce2\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n115.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0D0D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?഍ an only legal per 5th edition char #x0d0d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n116.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0D11 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?഑ an only legal per 5th edition char #x0d11\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n117.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0D29 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ഩ an only legal per 5th edition char #x0d29\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n118.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0D3A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ഺ an only legal per 5th edition char #x0d3a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n119.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0D62 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ൢ an only legal per 5th edition char #x0d62\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n12.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x01F3 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ǳ an only legal per 5th edition char #x1f3\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n120.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E2F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ฯ an only legal per 5th edition char #x0e2f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n121.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E31 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ั an only legal per 5th edition char #x0e31\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n122.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E34 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ิ an only legal per 5th edition char #x0e34\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n123.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E46 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ๆ an only legal per 5th edition char #x0e46\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n124.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E83 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?຃ an only legal per 5th edition char #x0e83\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n125.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E85 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?຅ an only legal per 5th edition char #x0e85\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n126.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E89 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ຉ an only legal per 5th edition char #x0e89\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n127.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E8B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?຋ an only legal per 5th edition char #x0e8b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n128.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E8E occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ຎ an only legal per 5th edition char #x0e8e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n129.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0E98 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ຘ an only legal per 5th edition char #x0e98\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n13.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x01F6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ƕ an only legal per 5th edition char #x1f6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n130.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EA0 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ຠ an only legal per 5th edition char #x0ea0\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n131.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EA4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?຤ an only legal per 5th edition char #x0ea4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n132.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EA6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?຦ an only legal per 5th edition char #x0ea6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n133.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EA8 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ຨ an only legal per 5th edition char #x0ea8\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n134.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EAC occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ຬ an only legal per 5th edition char #x0eac\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n135.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EAF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ຯ an only legal per 5th edition char #x0eaf\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n136.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EB1 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ັ an only legal per 5th edition char #x0eb1\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n137.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EB4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ິ an only legal per 5th edition char #x0eb4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n138.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EBE occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?຾ an only legal per 5th edition char #x0ebe\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n139.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0EC5 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?໅ an only legal per 5th edition char #x0ec5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n14.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x01F9 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ǹ an only legal per 5th edition char #x1f9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n140.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0F48 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?཈ an only legal per 5th edition char #x0f48\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n141.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0F6A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ཪ an only legal per 5th edition char #x0f6a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n142.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x10C6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?჆ an only legal per 5th edition char #x10c6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n143.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x10F7 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ჷ an only legal per 5th edition char #x10f7\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n144.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1011 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᄁ an only legal per 5th edition char #x1101\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n145.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1104 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᄄ an only legal per 5th edition char #x1104\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n146.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1108 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᄈ an only legal per 5th edition char #x1108\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n147.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x110A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᄊ an only legal per 5th edition char #x110a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n148.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x110D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᄍ an only legal per 5th edition char #x110d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n149.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x113B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᄻ an only legal per 5th edition char #x113b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n15.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x01F9 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ǹ an only legal per 5th edition char #x1f9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n150.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x113F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᄿ an only legal per 5th edition char #x113f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n151.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1141 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅁ an only legal per 5th edition char #x1141\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n152.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x114D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅍ an only legal per 5th edition char #x114d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n153.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x114f occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅏ an only legal per 5th edition char #x114f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n154.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1151 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅑ an only legal per 5th edition char #x1151\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n155.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1156 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅖ an only legal per 5th edition char #x1156\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n156.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x115A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅚ an only legal per 5th edition char #x115a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n157.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1162 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅢ an only legal per 5th edition char #x1162\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n158.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1164 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅤ an only legal per 5th edition char #x1164\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n159.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1166 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅦ an only legal per 5th edition char #x1166\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n16.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0230 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ȱ an only legal per 5th edition char #x230\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n160.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x116B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅫ an only legal per 5th edition char #x116b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n161.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x116F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅯ an only legal per 5th edition char #x116f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n162.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1174 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᅴ an only legal per 5th edition char #x1174\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n163.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x119F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᆟ an only legal per 5th edition char #x119f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n164.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x11AC occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᆬ an only legal per 5th edition char #x11ac\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n165.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x11B6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᆶ an only legal per 5th edition char #x11b6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n166.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x11B9 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᆹ an only legal per 5th edition char #x11b9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n167.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x11BB occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᆻ an only legal per 5th edition char #x11bb\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n168.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x11C3 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᇃ an only legal per 5th edition char #x11c3\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n169.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x11F1 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᇱ an only legal per 5th edition char #x11f1\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n17.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x02AF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ʯ an only legal per 5th edition char #x2af\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n170.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x11FA occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ᇺ an only legal per 5th edition char #x11fa\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n171.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1E9C occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ẜ an only legal per 5th edition char #x1e9c\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n172.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1EFA occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ỻ an only legal per 5th edition char #x1efa\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n173.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F16 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?἖ an only legal per 5th edition char #x1f16\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n174.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F1E occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?἞ an only legal per 5th edition char #x1f1e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n175.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F46 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?὆ an only legal per 5th edition char #x1f46\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n176.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F4F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?὏ an only legal per 5th edition char #x1f4f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n177.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F58 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?὘ an only legal per 5th edition char #x1f58\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n178.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F5A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?὚ an only legal per 5th edition char #x1f5a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n179.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F5C occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?὜ an only legal per 5th edition char #x1f5c\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n18.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x02CF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ˏ an only legal per 5th edition char #x2cf\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n180.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F5E occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?὞ an only legal per 5th edition char #x1f5e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n181.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1F7E occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?὾ an only legal per 5th edition char #x1f7e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n182.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FB5 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?᾵ an only legal per 5th edition char #x1fb5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n183.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FBD occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?᾽ an only legal per 5th edition char #x1fbd\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n184.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FBF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?᾿ an only legal per 5th edition char #x1fbf\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n185.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FC5 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?῅ an only legal per 5th edition char #x1fc5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n186.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FCD occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?῍ an only legal per 5th edition char #x1fcd\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n187.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FD5 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?῕ an only legal per 5th edition char #x1fd5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n188.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FDC occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?῜ an only legal per 5th edition char #x1fdc\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n189.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FED occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?῭ an only legal per 5th edition char #x1fed\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n19.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0387 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?· an only legal per 5th edition char #x387\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n190.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FF5 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?῵ an only legal per 5th edition char #x1ff5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n191.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x1FFD occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?´ an only legal per 5th edition char #x1ffd\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n192.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x2127 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?℧ an only legal per 5th edition char #x2127\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n193.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x212F occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ℯ an only legal per 5th edition char #x212f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n194.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x2183 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ↄ an only legal per 5th edition char #x2183\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n195.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x3095 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ゕ an only legal per 5th edition char #x3095\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n196.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x30FB occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?・ an only legal per 5th edition char #x30fb\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n197.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x312D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ㄭ an only legal per 5th edition char #x312d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n198.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #xD7A4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?힤 an only legal per 5th edition char #xd7a4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n20.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x038B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?΋ an only legal per 5th edition char #x38b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n21.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x03A2 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?΢ an only legal per 5th edition char #x3a2\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n22.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x03CF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ϗ an only legal per 5th edition char #x3cf\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n23.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x03D7 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ϗ an only legal per 5th edition char #x3d7\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n24.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x03DD occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ϝ an only legal per 5th edition char #x3dd\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n25.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x03E1 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ϡ an only legal per 5th edition char #x3e1\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n26.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x03F4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ϴ an only legal per 5th edition char #x3f4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n27.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x040D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ѝ an only legal per 5th edition char #x40d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n28.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0450 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ѐ an only legal per 5th edition char #x450\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n29.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x045D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ѝ an only legal per 5th edition char #x45d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n30.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0482 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?҂ an only legal per 5th edition char #x482\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n31.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x04C5 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ӆ an only legal per 5th edition char #x4c5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n32.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x04C6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ӆ an only legal per 5th edition char #x4c6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n33.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x04C9 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ӊ an only legal per 5th edition char #x4c9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n34.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x04EC occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ӭ an only legal per 5th edition char #x4ec\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n35.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x04ED occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ӭ an only legal per 5th edition char #x4ed\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n36.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x04F6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ӷ an only legal per 5th edition char #x4f6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n37.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x04FA occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?Ӻ an only legal per 5th edition char #x4fa\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n38.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0557 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?՗ an only legal per 5th edition char #x557\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n39.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0558 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?՘ an only legal per 5th edition char #x558\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n40.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0587 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?և an only legal per 5th edition char #x587\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n41.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x05EB occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?׫ an only legal per 5th edition char #x5eb\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n42.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x05F3 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?׳ an only legal per 5th edition char #x5f3\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n43.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0620 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ؠ an only legal per 5th edition char #x620\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n44.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x063B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ػ an only legal per 5th edition char #x63b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n45.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x064B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ً an only legal per 5th edition char #x64b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n46.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x06B8 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ڸ an only legal per 5th edition char #x6b8\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n47.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x06BF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ڿ an only legal per 5th edition char #x6bf\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n48.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x06CF occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ۏ an only legal per 5th edition char #x6cf\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n49.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x06D4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?۔ an only legal per 5th edition char #x6d4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n50.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x06D6 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ۖ an only legal per 5th edition char #x6d6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n51.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x06E7 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ۧ an only legal per 5th edition char #x6e7\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n52.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x093A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ऺ an only legal per 5th edition char #x093a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n53.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x093E occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ा an only legal per 5th edition char #x093e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n54.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0962 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ॢ an only legal per 5th edition char #x0962\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n55.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x098D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?঍ an only legal per 5th edition char #x098d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n56.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0991 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?঑ an only legal per 5th edition char #x0991\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n57.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0992 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?঒ an only legal per 5th edition char #x0992\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n58.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x09A9 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?঩ an only legal per 5th edition char #x09a9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n59.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x09B1 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?঱ an only legal per 5th edition char #x09b1\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n60.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x09B5 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?঵ an only legal per 5th edition char #x09b5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n61.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x09BA occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?঺ an only legal per 5th edition char #x09ba\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n62.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x09DE occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?৞ an only legal per 5th edition char #x09de\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n63.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x09E2 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ৢ an only legal per 5th edition char #x09e2\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n64.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x09F2 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?৲ an only legal per 5th edition char #x09f2\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n65.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A0B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?਋ an only legal per 5th edition char #x0a0b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n66.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A11 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?਑ an only legal per 5th edition char #x0a11\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n67.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A29 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?਩ an only legal per 5th edition char #x0a29\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n68.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A31 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?਱ an only legal per 5th edition char #x0a31\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n69.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A34 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?਴ an only legal per 5th edition char #x0a34\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n70.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A37 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?਷ an only legal per 5th edition char #x0a37\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n71.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A3A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?਺ an only legal per 5th edition char #x0a3a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n72.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A5D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?੝ an only legal per 5th edition char #x0a5d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n73.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A70 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ੰ an only legal per 5th edition char #x0a70\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n74.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A75 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ੵ an only legal per 5th edition char #x0a75\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n75.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #xA84 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?઄ an only legal per 5th edition char #x0a84\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n76.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0ABC occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?઼ an only legal per 5th edition char #x0abc\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n77.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0A92 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?઒ an only legal per 5th edition char #x0a92\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n78.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0AA9 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?઩ an only legal per 5th edition char #x0aa9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n79.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0AB1 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?઱ an only legal per 5th edition char #x0ab1\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n80.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0AB4 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?઴ an only legal per 5th edition char #x0ab4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n81.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0ABA occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?઺ an only legal per 5th edition char #x0aba\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n82.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B04 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?଄ an only legal per 5th edition char #x0b04\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n83.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B0D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?଍ an only legal per 5th edition char #x0b0d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n84.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B11 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?଑ an only legal per 5th edition char #x0b11\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n85.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B29 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?଩ an only legal per 5th edition char #x0b29\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n86.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B31 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?଱ an only legal per 5th edition char #x0b31\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n87.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B34 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?଴ an only legal per 5th edition char #x0b34\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n88.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B3A occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?଺ an only legal per 5th edition char #x0b3a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n89.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B3E occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ା an only legal per 5th edition char #x0b3e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n90.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B5E occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?୞ an only legal per 5th edition char #x0b5e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n91.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B62 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?ୢ an only legal per 5th edition char #x0b62\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n92.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B8B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஋ an only legal per 5th edition char #x0b8b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n93.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B91 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஑ an only legal per 5th edition char #x0b91\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n94.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B98 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஘ an only legal per 5th edition char #x0b98\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n95.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B9B occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஛ an only legal per 5th edition char #x0b9b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n96.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0B9D occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஝ an only legal per 5th edition char #x0b9d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n97.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0BA0 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஠ an only legal per 5th edition char #x0ba0\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n98.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0BA7 occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஧ an only legal per 5th edition char #x0ba7\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P85-ibm85n99.xml", () => {
    // B. — Tests BaseChar with an only legal per 5th edition character. The character #x0BAB occurs as the
    // first character of the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?஫ an only legal per 5th edition char #x0bab\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P86-ibm86n01.xml", () => {
    // B. — Tests Ideographic with an only legal per 5th edition character. The character #x4CFF occurs as
    // the first character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?䳿 an only legal per 5th edition char #x4cff\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P86-ibm86n02.xml", () => {
    // B. — Tests Ideographic with an only legal per 5th edition character. The character #x9FA6 occurs as
    // the first character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?龦 an only legal per 5th edition char #x9fa6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P86-ibm86n03.xml", () => {
    // B. — Tests Ideographic with an only legal per 5th edition character. The character #x3008 occurs as
    // the first character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?〈 an only legal per 5th edition char #x3008\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P86-ibm86n04.xml", () => {
    // B. — Tests Ideographic with an only legal per 5th edition character. The character #x302A occurs as
    // the first character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?〪 an only legal per 5th edition char #x302a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n01.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x02FF occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_˿ an only legal per 5th edition char #x2ff\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n02.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0346 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_͆ an only legal per 5th edition char #x346\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n03.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0362 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_͢ an only legal per 5th edition char #x362\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n04.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0487 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_҇ an only legal per 5th edition char #x487\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n05.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x05A2 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_֢ an only legal per 5th edition char #x5a2\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n06.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x05BA occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ֺ an only legal per 5th edition char #x5ba\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n07.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x05BE occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_־ an only legal per 5th edition char #x5be\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n08.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x05C0 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_׀ an only legal per 5th edition char #x5c0\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n09.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x05C3 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_׃ an only legal per 5th edition char #x5c3\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n10.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0653 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ٓ an only legal per 5th edition char #x653\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n11.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x06B8 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ڸ an only legal per 5th edition char #x6b8\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n12.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x06B9 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ڹ an only legal per 5th edition char #x6b9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n13.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x06E9 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_۩ an only legal per 5th edition char #x6e9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n14.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x06EE occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ۮ an only legal per 5th edition char #x6ee\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n15.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0904 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ऄ an only legal per 5th edition char #x0904\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n16.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x093B occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ऻ an only legal per 5th edition char #x093b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n17.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x094E occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ॎ an only legal per 5th edition char #x094e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n18.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0955 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ॕ an only legal per 5th edition char #x0955\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n19.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0964 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_। an only legal per 5th edition char #x0964\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n20.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0984 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_঄ an only legal per 5th edition char #x0984\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n21.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x09C5 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_৅ an only legal per 5th edition char #x09c5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n22.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x09C9 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_৉ an only legal per 5th edition char #x09c9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n23.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x09CE occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ৎ an only legal per 5th edition char #x09ce\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n24.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x09D8 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_৘ an only legal per 5th edition char #x09d8\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n25.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x09E4 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_৤ an only legal per 5th edition char #x09e4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n26.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0A03 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ਃ an only legal per 5th edition char #x0a03\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n27.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0A3D occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_਽ an only legal per 5th edition char #x0a3d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n28.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0A46 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_੆ an only legal per 5th edition char #x0a46\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n29.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0A49 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_੉ an only legal per 5th edition char #x0a49\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n30.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0A4E occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_੎ an only legal per 5th edition char #x0a4e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n31.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0A80 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_઀ an only legal per 5th edition char #x0a80\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n32.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0A84 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_઄ an only legal per 5th edition char #x0a84\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n33.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0ABB occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_઻ an only legal per 5th edition char #x0abb\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n34.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0AC6 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_૆ an only legal per 5th edition char #x0ac6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n35.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0ACA occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_૊ an only legal per 5th edition char #x0aca\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n36.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0ACE occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_૎ an only legal per 5th edition char #x0ace\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n37.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0B04 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_଄ an only legal per 5th edition char #x0b04\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n38.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0B3B occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_଻ an only legal per 5th edition char #x0b3b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n39.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0B44 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ୄ an only legal per 5th edition char #x0b44\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n40.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0B4A occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_୊ an only legal per 5th edition char #x0b4a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n41.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0B4E occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_୎ an only legal per 5th edition char #x0b4e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n42.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0B58 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_୘ an only legal per 5th edition char #x0b58\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n43.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0B84 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_஄ an only legal per 5th edition char #x0b84\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n44.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0BC3 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_௃ an only legal per 5th edition char #x0bc3\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n45.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0BC9 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_௉ an only legal per 5th edition char #x0bc9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n46.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0BD6 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_௖ an only legal per 5th edition char #x0bd6\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n47.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0C0D occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_఍ an only legal per 5th edition char #x0c0d\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n48.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0C45 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_౅ an only legal per 5th edition char #x0c45\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n49.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0C49 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_౉ an only legal per 5th edition char #x0c49\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n50.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0C54 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_౔ an only legal per 5th edition char #x0c54\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n51.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0C81 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ಁ an only legal per 5th edition char #x0c81\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n52.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0C84 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_಄ an only legal per 5th edition char #x0c84\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n53.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0CC5 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_೅ an only legal per 5th edition char #x0cc5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n54.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0CC9 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_೉ an only legal per 5th edition char #x0cc9\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n55.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0CD4 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_೔ an only legal per 5th edition char #x0cd4\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n56.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0CD7 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_೗ an only legal per 5th edition char #x0cd7\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n57.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0D04 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ഄ an only legal per 5th edition char #x0d04\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n58.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0D45 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_൅ an only legal per 5th edition char #x0d45\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n59.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0D49 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_൉ an only legal per 5th edition char #x0d49\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n60.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0D4E occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ൎ an only legal per 5th edition char #x0d4e\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n61.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0D58 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_൘ an only legal per 5th edition char #x0d58\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n62.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0E3F occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_฿ an only legal per 5th edition char #x0e3f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n63.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0E3B occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_฻ an only legal per 5th edition char #x0e3b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n64.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0E4F occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_๏ an only legal per 5th edition char #x0e4f\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n66.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0EBA occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_຺ an only legal per 5th edition char #x0eba\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n67.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0EBE occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_຾ an only legal per 5th edition char #x0ebe\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n68.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0ECE occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_໎ an only legal per 5th edition char #x0ece\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n69.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F1A occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_༚ an only legal per 5th edition char #x0f1a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n70.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F36 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_༶ an only legal per 5th edition char #x0f36\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n71.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F38 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_༸ an only legal per 5th edition char #x0f38\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n72.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F3B occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_༻ an only legal per 5th edition char #x0f3b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n73.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F3A occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_༺ an only legal per 5th edition char #x0f3a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n74.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F70 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_཰ an only legal per 5th edition char #x0f70\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n75.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F85 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_྅ an only legal per 5th edition char #x0f85\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n76.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F8C occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ྌ an only legal per 5th edition char #x0f8c\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n77.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F96 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ྖ an only legal per 5th edition char #x0f96\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n78.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0F98 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_྘ an only legal per 5th edition char #x0f98\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n79.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0FB0 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ྰ an only legal per 5th edition char #x0fb0\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n80.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0FB8 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ྸ an only legal per 5th edition char #x0fb8\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n81.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x0FBA occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ྺ an only legal per 5th edition char #x0fba\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n82.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x20DD occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_⃝ an only legal per 5th edition char #x20dd\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n83.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x20E2 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_⃢ an only legal per 5th edition char #x20e2\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n84.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x3030 occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_〰 an only legal per 5th edition char #x3030\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P87-ibm87n85.xml", () => {
    // B. — Tests CombiningChar with an only legal per 5th edition character. The character #x309B occurs
    // as the second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_゛ an only legal per 5th edition char #x309b\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n03.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x066A occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_٪ an only legal per 5th edition char #x66a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n04.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x06FA occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ۺ an only legal per 5th edition char #x6fa\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n05.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0970 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_॰ an only legal per 5th edition char #x0970\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n06.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x09F2 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_৲ an only legal per 5th edition char #x09f2\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n08.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0AF0 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_૰ an only legal per 5th edition char #x0af0\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n09.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0B70 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_୰ an only legal per 5th edition char #x0b70\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n10.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0C65 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_౥ an only legal per 5th edition char #x0c65\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n11.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0CE5 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_೥ an only legal per 5th edition char #x0ce5\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n12.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0CF0 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_೰ an only legal per 5th edition char #x0cf0\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n13.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0D70 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_൰ an only legal per 5th edition char #x0d70\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n14.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0E5A occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_๚ an only legal per 5th edition char #x0e5a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n15.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0EDA occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_໚ an only legal per 5th edition char #x0eda\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P88-ibm88n16.xml", () => {
    // B. — Tests Digit with an only legal per 5th edition character. The character #x0F2A occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_༪ an only legal per 5th edition char #x0f2a\r\n in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P89-ibm89n03.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x02D2 occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_˒ an only legal per 5th edition extender #x2d2 in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P89-ibm89n04.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x03FE occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_Ͼ an only legal per 5th edition extender #x3fe in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-valid-P89-ibm89n05.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x065F occurs as the
    // second character in the PITarget in the PI in the DTD.
    const input: string =
      "<!DOCTYPE animal [\r\n<!ELEMENT animal ANY>\r\n<?_ٟ an only legal per 5th edition extender #x65f in PITarget ?>\r\n]>\r\n<animal/>\r\n";
    expectParses(input);
  });

  test("ibm-invalid-P89-ibm89n06.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x0EC7 occurs as the
    // second character in the PITarget in the PI in the prolog, and in an element name.
    const input: string =
      "<?_໇ an only legal per 5th edition extender #x0ec7 in PITarget ?>\r\n<IllegalExtender໇/>\r\n";
    expectParses(input);
  });

  test("ibm-invalid-P89-ibm89n07.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x3006 occurs as the
    // second character in the PITarget in the PI in the prolog, and in an element name.
    const input: string =
      "<?_〆 an only legal per 5th edition extender #x3006 in PITarget ?>\r\n<IllegalExtender〆/>\r\n";
    expectParses(input);
  });

  test("ibm-invalid-P89-ibm89n08.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x3030 occurs as the
    // second character in the PITarget in the PI in the prolog, and in an element name.
    const input: string =
      "<?_〰 an only legal per 5th edition extender #x3030 in PITarget ?>\r\n<IllegalExtender〰/>\r\n";
    expectParses(input);
  });

  test("ibm-invalid-P89-ibm89n09.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x3036 occurs as the
    // second character in the PITarget in the PI in the prolog, and in an element name.
    const input: string =
      "<?_〶 an only legal per 5th edition extender #x3036 in PITarget ?>\r\n<IllegalExtender〶/>\r\n";
    expectParses(input);
  });

  test("ibm-invalid-P89-ibm89n10.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x309C occurs as the
    // second character in the PITarget in the PI in the prolog, and in an element name.
    const input: string =
      "<?_゜ an only legal per 5th edition extender #x309c in PITarget ?>\r\n<IllegalExtender゜/>\r\n";
    expectParses(input);
  });

  test("ibm-invalid-P89-ibm89n11.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x309F occurs as the
    // second character in the PITarget in the PI in the prolog, and in an element name.
    const input: string =
      "<?_ゟ an only legal per 5th edition extender #x309f in PITarget ?>\r\n<IllegalExtenderゟ/>\r\n";
    expectParses(input);
  });

  test("ibm-invalid-P89-ibm89n12.xml", () => {
    // B. — Tests Extender with an only legal per 5th edition character. The character #x30FF occurs as the
    // second character in the PITarget in the PI in the prolog, and in an element name.
    const input: string =
      "<?_ヿ an only legal per 5th edition extender #x30ff in PITarget ?>\r\n<IllegalExtenderヿ/>\r\n";
    expectParses(input);
  });
});

describe("eduni/namespaces-1.0", () => {
  test("rmt-ns10-001", () => {
    // 2 — Namespace name test: a perfectly good http URI (upstream: valid; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace name test: a perfectly good http URI -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns CDATA #IMPLIED>\n]>\n<foo xmlns="http://example.org/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-002", () => {
    // 2 — Namespace name test: a syntactically plausible URI with a fictitious scheme (upstream: valid;
    // namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace name test: a syntactically plausible URI with a \n     fictitious scheme -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns CDATA #IMPLIED>\n]>\n<foo xmlns="zarquon://example.org/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-003", () => {
    // 2 — Namespace name test: a perfectly good http URI with a fragment (upstream: valid; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace name test: a perfectly good http URI with a fragment -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns CDATA #IMPLIED>\n]>\n<foo xmlns="http://example.org/namespace#apples"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-004", () => {
    // 2 — Namespace name test: a relative URI (deprecated) (upstream: error; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace name test: a relative URI (deprecated) -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns CDATA #IMPLIED>]\n>\n<foo xmlns="namespaces/zaphod"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-005", () => {
    // 2 — Namespace name test: a same-document relative URI (deprecated) (upstream: error; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace name test: a same-document relative URI (deprecated) -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns CDATA #IMPLIED>\n]>\n<foo xmlns="#beeblebrox"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-006", () => {
    // 2 — Namespace name test: an http IRI that is not a URI (upstream: error; namespace constraints are
    // not enforced)
    const input = Buffer.from(
      "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pgo8IS0tIE5hbWVzcGFjZSBuYW1lIHRlc3Q6IGFuIGh0dHAgSVJJIHRoYXQgaXMgbm90IGEgVVJJIC0tPgo8IURPQ1RZUEUgZm9vIFsKPCFFTEVNRU5UIGZvbyBBTlk+CjwhQVRUTElTVCBmb28geG1sbnMgQ0RBVEEgI0lNUExJRUQ+Cl0+Cjxmb28geG1sbnM9Imh0dHA6Ly9leGFtcGxlLm9yZy9yb3PpIi8+Cg==",
      "base64",
    );
    expectParses(input);
  });

  test("rmt-ns10-007", () => {
    // 1 — Namespace inequality test: different capitalization (upstream: valid; namespace constraints are
    // not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace inequality test: different capitalization -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns:a CDATA #IMPLIED\n              xmlns:b CDATA #IMPLIED\n              xmlns:c CDATA #IMPLIED>\n<!ELEMENT bar ANY>\n<!ATTLIST bar a:attr CDATA #IMPLIED\n              b:attr CDATA #IMPLIED\n              c:attr CDATA #IMPLIED>\n]>\n<foo xmlns:a="http://example.org/wine"\n     xmlns:b="http://Example.org/wine"\n     xmlns:c="http://example.org/Wine">\n\n<bar a:attr="1" b:attr="2" c:attr="3"/>\n\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-008", () => {
    // 1 — Namespace inequality test: different escaping (upstream: valid; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace inequality test: different escaping -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns:a CDATA #IMPLIED\n              xmlns:b CDATA #IMPLIED\n              xmlns:c CDATA #IMPLIED>\n<!ELEMENT bar ANY>\n<!ATTLIST bar a:attr CDATA #IMPLIED\n              b:attr CDATA #IMPLIED\n              c:attr CDATA #IMPLIED>\n]>\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/%7ewilbur"\n     xmlns:c="http://example.org/%7Ewilbur">\n\n<bar a:attr="1" b:attr="2" c:attr="3"/>\n\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-009", () => {
    // 1 — Namespace equality test: plain repetition (upstream: not-wf; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace equality test: plain repetition -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns:a CDATA #IMPLIED\n              xmlns:b CDATA #IMPLIED\n              xmlns:c CDATA #IMPLIED>\n<!ELEMENT bar ANY>\n<!ATTLIST bar a:attr CDATA #IMPLIED\n              b:attr CDATA #IMPLIED\n              c:attr CDATA #IMPLIED>\n]>\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/~wilbur">\n\n<bar a:attr="1" b:attr="2"/>\n\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-010", () => {
    // 1 — Namespace equality test: use of character reference (upstream: not-wf; namespace constraints are
    // not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace equality test: use of character reference -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns:a CDATA #IMPLIED\n              xmlns:b CDATA #IMPLIED\n              xmlns:c CDATA #IMPLIED>\n<!ELEMENT bar ANY>\n<!ATTLIST bar a:attr CDATA #IMPLIED\n              b:attr CDATA #IMPLIED\n              c:attr CDATA #IMPLIED>\n]>\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/&#x7E;wilbur">\n\n<bar a:attr="1" b:attr="2"/>\n\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-011", () => {
    // 1 — Namespace equality test: use of entity reference (upstream: not-wf; namespace constraints are
    // not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace equality test: use of entity reference -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns:a CDATA #IMPLIED\n              xmlns:b CDATA #IMPLIED\n              xmlns:c CDATA #IMPLIED>\n<!ELEMENT bar ANY>\n<!ATTLIST bar a:attr CDATA #IMPLIED\n              b:attr CDATA #IMPLIED\n              c:attr CDATA #IMPLIED>\n<!ENTITY tilde "~">\n]>\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/&tilde;wilbur">\n\n<bar a:attr="1" b:attr="2"/>\n\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-012", () => {
    // 1 — Namespace inequality test: equal after attribute value normalization (upstream: not-wf;
    // namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Namespace inequality test: equal after attribute value normalization -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns:a CDATA #IMPLIED\n              xmlns:b NMTOKEN #IMPLIED\n              xmlns:c CDATA #IMPLIED>\n<!ELEMENT bar ANY>\n<!ATTLIST bar a:attr CDATA #IMPLIED\n              b:attr CDATA #IMPLIED\n              c:attr CDATA #IMPLIED>\n]>\n<foo xmlns:a="urn:xyzzy"\n     xmlns:b=" urn:xyzzy ">\n\n<bar a:attr="1" b:attr="2"/>\n\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-013", () => {
    // 3 — Bad QName syntax: multiple colons (upstream: not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Bad QName syntax: multiple colons -->\n<foo>\n<bar a:b:attr="1"/>\n</foo>\n';
    expectParses(input);
  });

  test("rmt-ns10-014", () => {
    // 3 — Bad QName syntax: colon at end (upstream: not-wf; namespace constraints are not enforced)
    const input: string = '<?xml version="1.0"?>\n<!-- Bad QName syntax: colon at end -->\n<foo: />\n';
    expectParses(input);
  });

  test("rmt-ns10-015", () => {
    // 3 — Bad QName syntax: colon at start (upstream: not-wf; namespace constraints are not enforced)
    const input: string = '<?xml version="1.0"?>\n<!-- Bad QName syntax: colon at start -->\n<:foo />\n';
    expectParses(input);
  });

  test("rmt-ns10-016", () => {
    // 2 — Bad QName syntax: xmlns: (upstream: not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Bad QName syntax: xmlns: -->\n<foo xmlns:="http://example.org/namespace" />\n';
    expectParses(input);
  });

  test("rmt-ns10-017", () => {
    // - — Simple legal case: no namespaces (upstream: invalid; namespace constraints are not enforced)
    const input: string = '<?xml version="1.0"?>\n<!-- Simple legal case: no namespaces -->\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-ns10-018", () => {
    // 5.2 — Simple legal case: default namespace (upstream: invalid; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Simple legal case: default namespace -->\n<foo xmlns="http://example.org/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-019", () => {
    // 4 — Simple legal case: prefixed element (upstream: invalid; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Simple legal case: prefixed element -->\n<a:foo xmlns:a="http://example.org/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-020", () => {
    // 4 — Simple legal case: prefixed attribute (upstream: invalid; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Simple legal case: prefixed attribute -->\n<foo xmlns:a="http://example.org/namespace" a:attr="1"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-021", () => {
    // 5.2 — Simple legal case: default namespace and unbinding (upstream: invalid; namespace constraints
    // are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Simple legal case: default namespace and unbinding -->\n<foo xmlns="http://example.org/namespace">\n <foo xmlns=""/>\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-022", () => {
    // 5.2 — Simple legal case: default namespace and rebinding (upstream: invalid; namespace constraints
    // are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Simple legal case: default namespace and rebinding -->\n<foo xmlns="http://example.org/namespace">\n <foo xmlns="http://example.org/other-namespace"/>\n</foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-023", () => {
    // 2 — Illegal use of 1.1-style prefix unbinding in 1.0 document (upstream: not-wf; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Illegal use of 1.1-style prefix unbinding in 1.0 document -->\n<a:foo xmlns:a="http://example.org/namespace">\n <a:foo xmlns:a=""/>\n</a:foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-024", () => {
    // 5.1 — Simple legal case: prefix rebinding (upstream: invalid; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Simple legal case: prefix rebinding -->\n<a:foo xmlns:a="http://example.org/namespace">\n <a:foo xmlns:a="http://example.org/other-namespace"/>\n</a:foo>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-025", () => {
    // 4 — Unbound element prefix (upstream: not-wf; namespace constraints are not enforced)
    const input: string = '<?xml version="1.0"?>\n<!-- Unbound element prefix -->\n<a:foo/>\n';
    expectParses(input);
  });

  test("rmt-ns10-026", () => {
    // 4 — Unbound attribute prefix (upstream: not-wf; namespace constraints are not enforced)
    const input: string = '<?xml version="1.0"?>\n<!-- Unbound attribute prefix -->\n<foo a:attr="1"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-027", () => {
    // 2 — Reserved prefixes and namespaces: using the xml prefix undeclared (upstream: invalid; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: using the xml prefix undeclared -->\n<foo xml:lang="en"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-028", () => {
    // NE05 — Reserved prefixes and namespaces: declaring the xml prefix correctly (upstream: invalid;
    // namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: declaring the xml prefix correctly -->\n<foo xmlns:xml="http://www.w3.org/XML/1998/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-029", () => {
    // NE05 — Reserved prefixes and namespaces: declaring the xml prefix incorrectly (upstream: not-wf;
    // namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: declaring the xml prefix incorrectly -->\n<foo xmlns:xml="http://example.org/namespace"/>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-030", () => {
    // NE05 — Reserved prefixes and namespaces: binding another prefix to the xml namespace (upstream:
    // not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: binding another prefix\n     to the xml namespace -->\n<foo xmlns:yml="http://www.w3.org/XML/1998/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-031", () => {
    // NE05 — Reserved prefixes and namespaces: declaring the xmlns prefix with its correct URI (illegal)
    // (upstream: not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: declaring the xmlns prefix\n     with its correct URI (illegal) -->\n<foo xmlns:xmlns="http://www.w3.org/2000/xmlns/"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-032", () => {
    // NE05 — Reserved prefixes and namespaces: declaring the xmlns prefix with an incorrect URI (upstream:
    // not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: declaring the xmlns prefix\n     with an incorrect URI -->\n<foo xmlns:xmlns="http://example.org/namespace"/>\n\n';
    expectParses(input);
  });

  test("rmt-ns10-033", () => {
    // NE05 — Reserved prefixes and namespaces: binding another prefix to the xmlns namespace (upstream:
    // not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: binding another prefix\n     to the xmlns namespace -->\n<foo xmlns:ymlns="http://www.w3.org/2000/xmlns/"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-034", () => {
    // NE05 — Reserved prefixes and namespaces: binding a reserved prefix (upstream: invalid; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Reserved prefixes and namespaces: binding a reserved prefix -->\n<foo xmlns:xml2="http://example.org/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-035", () => {
    // 5.3 — Attribute uniqueness: repeated identical attribute (upstream: not-wf; namespace constraints
    // are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Attribute uniqueness: repeated identical attribute -->\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/~wilbur">\n\n<bar a:attr="1" a:attr="2"/>\n\n</foo>\n';
    expectRejects(input, "XML Parse error: Duplicate attribute 'a:attr'");
  });

  test("rmt-ns10-036", () => {
    // 5.3 — Attribute uniqueness: repeated attribute with different prefixes (upstream: not-wf; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Attribute uniqueness: repeated attribute with different prefixes -->\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/~wilbur">\n\n<bar a:attr="1" b:attr="2"/>\n\n</foo>\n';
    expectParses(input);
  });

  test("rmt-ns10-037", () => {
    // 5.3 — Attribute uniqueness: different attributes with same local name (upstream: invalid; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Attribute uniqueness: different attributes with same local name -->\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/~kipper">\n\n<bar a:attr="1" b:attr="2"/>\n\n</foo>\n';
    expectParses(input);
  });

  test("rmt-ns10-038", () => {
    // 5.3 — Attribute uniqueness: prefixed and unprefixed attributes with same local name (upstream:
    // invalid; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Attribute uniqueness: prefixed and unprefixed attributes with same\n     local name -->\n<foo xmlns:a="http://example.org/~wilbur">\n\n<bar a:attr="1" attr="2"/>\n\n</foo>\n';
    expectParses(input);
  });

  test("rmt-ns10-039", () => {
    // 5.3 — Attribute uniqueness: prefixed and unprefixed attributes with same local name, with default
    // namespace (upstream: invalid; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Attribute uniqueness: prefixed and unprefixed attributes with same\n     local name, with default namespace -->\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns:b="http://example.org/~kipper"\n     xmlns="http://example.org/~wilbur">\n\n<b:bar a:attr="1" attr="2"/>\n\n</foo>\n';
    expectParses(input);
  });

  test("rmt-ns10-040", () => {
    // 5.3 — Attribute uniqueness: prefixed and unprefixed attributes with same local name, with default
    // namespace and element in default namespace (upstream: invalid; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Attribute uniqueness: prefixed and unprefixed attributes with same\n     local name, with default namespace and element in default namespace -->\n<foo xmlns:a="http://example.org/~wilbur"\n     xmlns="http://example.org/~wilbur">\n\n<bar a:attr="1" attr="2"/>\n\n</foo>\n';
    expectParses(input);
  });

  test("rmt-ns10-041", () => {
    // 5.3 — Attribute uniqueness: prefixed and unprefixed attributes with same local name, element in same
    // namespace as prefixed attribute (upstream: invalid; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Attribute uniqueness: prefixed and unprefixed attributes with same\n     local name, element in same namespace as prefixed attribute -->\n<foo xmlns:a="http://example.org/~wilbur">\n\n<a:bar a:attr="1" attr="2"/>\n\n</foo>\n';
    expectParses(input);
  });

  test("rmt-ns10-042", () => {
    // NE08 — Colon in PI name (upstream: not-wf; namespace constraints are not enforced)
    const input: string = '<?xml version="1.0"?>\n<!-- Colon in PI name -->\n<?a:b bogus?>\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-ns10-043", () => {
    // NE08 — Colon in entity name (upstream: not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Colon in entity name -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ENTITY a:b "bogus">\n]>\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-ns10-044", () => {
    // NE08 — Colon in entity name (upstream: not-wf; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Colon in entity name -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!NOTATION a:b SYSTEM "notation">\n]>\n<foo/>\n';
    expectParses(input);
  });

  test("rmt-ns10-045", () => {
    // NE08 — Colon in ID attribute name (upstream: invalid; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Colon in ID attribute name -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo id ID #REQUIRED>\n]>\n<foo id="a:b"/>\n';
    expectParses(input);
  });

  test("rmt-ns10-046", () => {
    // NE08 — Colon in ID attribute name (upstream: invalid; namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Colon in ID attribute name -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo id  ID #IMPLIED\n              ref IDREF #IMPLIED>\n]>\n<foo ref="a:b">\n <foo id="a:b"/>\n</foo>\n';
    expectParses(input);
  });

  test("ht-ns10-047", () => {
    // NE03 — Reserved name: _not_ an error (upstream: valid; namespace constraints are not enforced)
    const input: string = "<!DOCTYPE xml:foo [\n<!ELEMENT xml:foo EMPTY>\n]>\n<xml:foo/>\n";
    expectParses(input);
  });

  test("ht-ns10-048", () => {
    // NE03 — Reserved name: _not_ an error (upstream: valid; namespace constraints are not enforced)
    const input: string =
      '<!DOCTYPE x [\n<!ELEMENT x EMPTY>\n<!ATTLIST x xml:foo CDATA #IMPLIED>\n]>\n<x xml:foo=""/>\n';
    expectParses(input);
  });

  test("rmt-ns-e1.0-13a", () => {
    // NE13 — The xml namespace must not be declared as the default namespace. (upstream: not-wf; namespace
    // constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- The xml namespace must not be declared as the default namespace. -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns CDATA #IMPLIED>\n]>\n<foo xmlns="http://www.w3.org/XML/1998/namespace"/>\n';
    expectParses(input);
  });

  test("rmt-ns-e1.0-13b", () => {
    // NE13 — The xmlns namespace must not be declared as the default namespace. (upstream: not-wf;
    // namespace constraints are not enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- The xmlns namespace must not be declared as the default namespace. -->\n<!DOCTYPE foo [\n<!ELEMENT foo ANY>\n<!ATTLIST foo xmlns CDATA #IMPLIED>\n]>\n<foo xmlns="http://www.w3.org/2000/xmlns/"/>\n';
    expectParses(input);
  });

  test("rmt-ns-e1.0-13c", () => {
    // NE13 — Elements must not have the prefix xmlns. (upstream: not-wf; namespace constraints are not
    // enforced)
    const input: string =
      '<?xml version="1.0"?>\n<!-- Elements must not have the prefix xmlns. -->\n<!DOCTYPE foo [\n<!ELEMENT xmlns:foo EMPTY>\n]>\n<xmlns:foo/>\n';
    expectParses(input);
  });
});

describe("eduni/misc", () => {
  test("hst-bh-001", () => {
    // 2.2 [2], 4.1 [66] — decimal charref > 10FFFF, indeed > max 32 bit integer, checking for recovery
    // from possible overflow
    const input: string =
      "<!DOCTYPE p [\n<!ELEMENT p (#PCDATA)>\n]>\n<p>Fa&#xFF000000F6;il</p>          <!-- 32 bit integer overflow -->\n";
    expectRejects(input, "XML Parse error: Character reference '&#xFF000000F6;' is not a valid XML character");
  });

  test("hst-bh-002", () => {
    // 2.2 [2], 4.1 [66] — hex charref > 10FFFF, indeed > max 32 bit integer, checking for recovery from
    // possible overflow
    const input: string =
      "<!DOCTYPE p [\n<!ELEMENT p (#PCDATA)>\n]>\n<p>Fa&#4294967542;il</p>           <!-- 32 bit integer overflow -->\n";
    expectRejects(input, "XML Parse error: Character reference '&#4294967542;' is not a valid XML character");
  });

  test("hst-bh-003", () => {
    // 2.2 [2], 4.1 [66] — decimal charref > 10FFFF, indeed > max 64 bit integer, checking for recovery
    // from possible overflow
    const input: string =
      "<!DOCTYPE p [\n<!ELEMENT p (#PCDATA)>\n]>\n<p>Fa&#xFFFFFFFF000000F6;il</p>    <!-- 64 bit integer overflow -->\n";
    expectRejects(input, "XML Parse error: Character reference '&#xFFFFFFFF000000F6;' is not a valid XML character");
  });

  test("hst-bh-004", () => {
    // 2.2 [2], 4.1 [66] — hex charref > 10FFFF, indeed > max 64 bit integer, checking for recovery from
    // possible overflow
    const input: string =
      "<!DOCTYPE p [\n<!ELEMENT p (#PCDATA)>\n]>\n<p>Fa&#18446744073709551862;il</p> <!-- 64 bit integer overflow -->\n";
    expectRejects(input, "XML Parse error: Character reference '&#18446744073709551862;' is not a valid XML character");
  });

  test("hst-bh-005", () => {
    // 3.1 [41] — xmlns:xml is an attribute as far as validation is concerned and must be declared
    const input: string =
      "<!DOCTYPE x [ <!ELEMENT x EMPTY> ]>\n<x xmlns:xml='http://www.w3.org/XML/1998/namespace'/>\n";
    expectParses(input);
  });

  test("hst-bh-006", () => {
    // 3.1 [41] — xmlns:foo is an attribute as far as validation is concerned and must be declared
    const input: string = "<!DOCTYPE x [ <!ELEMENT x EMPTY> ]>\n<x xmlns:foo='http://example.org'/>\n";
    expectParses(input);
  });

  test("hst-lhs-007", () => {
    // 4.3.3 — UTF-8 BOM plus xml decl of iso-8859-1 incompatible
    const input = Buffer.from("\ufeff<?xml version='1.0' encoding='iso-8859-1'?><x/>\n");
    expectRejects(input, "XML Parse error: Document has a UTF-8 byte-order mark but declares encoding 'iso-8859-1'");
  });

  test("hst-lhs-008", () => {
    // 4.3.3 — UTF-16 BOM plus xml decl of utf-8 (using UTF-16 coding) incompatible
    const input = Buffer.from(
      "/v8APAA/AHgAbQBsACAAdgBlAHIAcwBpAG8AbgA9ACcAMQAuADAAJwAgAGUAbgBjAG8AZABpAG4AZwA9ACcAdQB0AGYALQA4ACcAPwA+ADwAeAAvAD4=",
      "base64",
    );
    expectRejects(input, "XML Parse error: Document is UTF-16 but declares encoding 'utf-8'");
  });

  test("hst-lhs-009", () => {
    // 4.3.3 — UTF-16 BOM plus xml decl of utf-8 (using UTF-8 coding) incompatible
    const input = Buffer.from("/v88P3htbCBlbmNvZGluZz0ndXRmLTgnPz48eC8+Cg==", "base64");
    expectRejects(input, "XML Parse error: UTF-16 input has an odd number of bytes");
  });
});
