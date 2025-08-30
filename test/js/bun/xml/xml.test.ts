import { expect, test } from "bun:test";

test("Bun.XML.parse - simple text element", () => {
  const xml = "<message>Hello World</message>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __text: "Hello World",
  });
});

test("Bun.XML.parse - element with whitespace", () => {
  const xml = "<test>  content  </test>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __text: "  content  ",
  });
});

test("Bun.XML.parse - empty element", () => {
  const xml = "<empty></empty>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({});
});

test("Bun.XML.parse - element with attributes", () => {
  const xml = '<message id="1" type="info">Hello</message>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    id: "1",
    type: "info",
    __text: "Hello",
  });
});

test("Bun.XML.parse - with XML declaration", () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><root>content</root>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __text: "content",
  });
});

test("Bun.XML.parse - empty string", () => {
  expect(() => Bun.XML.parse("")).toThrow({
    name: "Error",
    message: "TypeError XML.parse: unsupported AST node type",
  });
});

test("Bun.XML.parse - self-closing tag with attributes", () => {
  const xml = '<config debug="true" version="1.0"/>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    debug: "true",
    version: "1.0",
  });
});

test("Bun.XML.parse - self-closing tag without attributes", () => {
  const xml = "<br/>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({});
});

test("Bun.XML.parse - nested elements", () => {
  const xml = `<person>
    <name>John</name>
    <age>30</age>
  </person>`;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    name: { __text: "John" },
    age: { __text: "30" },
  });
});

test("Bun.XML.parse - complex nested structure", () => {
  const xml = `<person name="John">
    <address type="home">
      <city>New York</city>
    </address>
  </person>`;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    name: "John",
    address: {
      type: "home",
      city: { __text: "New York" },
    },
  });
});

test("Bun.XML.parse - mixed content (text and children)", () => {
  const xml = `<doc>
  Some text
  <child>value</child>
  More text
</doc>`;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    child: { __text: "value" },
  });
});

test("Bun.XML.parse - XML entities", () => {
  const xml = "<message>Hello &lt;world&gt; &amp; &quot;everyone&quot; &#39;here&#39;</message>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __text: `Hello <world> & "everyone" 'here'`,
  });
});

test("Bun.XML.parse - numeric entities", () => {
  const xml = "<test>&#65;&#66;&#67;</test>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __text: "ABC",
  });
});

test("Bun.XML.parse - entities in attributes", () => {
  const xml = '<tag attr="&lt;value&gt;">content</tag>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    attr: "<value>",
    __text: "content",
  });
});

test("Bun.XML.parse - XML comments are ignored", () => {
  const xml = `<root>
    <!-- This is a comment -->
    <message>Hello</message>
    <!-- Another comment -->
  </root>`;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    message: { __text: "Hello" },
  });
});

test("Bun.XML.parse - duplicate tags become arrays", () => {
  const xml = "<root><item>1</item><item>2</item></root>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    item: [{ __text: "1" }, { __text: "2" }],
  });
});

test("Bun.XML.parse - CDATA sections", () => {
  const xml = '<message><![CDATA[Hello <world> & "everyone"]]></message>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __text: `Hello <world> & "everyone"`,
  });
});

test("Bun.XML.parse - top-level comments are ignored", () => {
  const xml = `<!-- Top comment -->
  <root>content</root>
  <!-- Another top comment -->`;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __text: "content",
  });
});

test("Bun.XML.parse - mismatched closing tag throws error", () => {
  expect(() => Bun.XML.parse("<root><a></b></root>")).toThrow({
    name: "BuildMessage",
    message: "Mismatched closing tag",
  });
});

test("Bun.XML.parse - unclosed tag throws error", () => {
  expect(() => Bun.XML.parse("<root><a>")).toThrow({
    name: "BuildMessage",
    message: "Expected closing tag",
  });
});

test("Bun.XML.parse - unterminated XML declaration throws error", () => {
  expect(() => Bun.XML.parse("<?xml version='1.0'")).toThrow({
    name: "BuildMessage",
    message: "Unterminated XML declaration",
  });
});

test("Bun.XML.parse - unterminated CDATA throws error", () => {
  expect(() => Bun.XML.parse("<root><![CDATA[unclosed")).toThrow({
    name: "BuildMessage",
    message: "Unterminated CDATA section",
  });
});

test("Bun.XML.parse - no arguments throws TypeError", () => {
  expect(() => (Bun.XML.parse as any)()).toThrow({
    name: "TypeError",
    message: "XML.parse() requires 1 argument (xmlString)",
  });
});

test("Bun.XML.parse - non-string argument throws TypeError", () => {
  expect(() => (Bun.XML.parse as any)(123)).toThrow({
    name: "TypeError",
    message: "XML.parse() expects a string as first argument",
  });
});
