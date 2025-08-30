import { expect, test } from "bun:test";

test("Bun.XML.parse - simple text element", () => {
  const xml = "<message>Hello World</message>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "message",
    __text: "Hello World",
  });
});

test("Bun.XML.parse - element with whitespace", () => {
  const xml = "<test>  content  </test>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "test",
    __text: "  content  ",
  });
});

test("Bun.XML.parse - empty element", () => {
  const xml = "<empty></empty>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "empty",
  });
});

test("Bun.XML.parse - element with attributes", () => {
  const xml = '<message id="1" type="info">Hello</message>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "message",
    __attrs: {
      id: "1",
      type: "info",
    },
    __text: "Hello",
  });
});

test("Bun.XML.parse - with XML declaration", () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><root>content</root>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "root",
    __text: "content",
  });
});

test("Bun.XML.parse - empty string", () => {
  expect(() => Bun.XML.parse("")).toThrow();
});

test("Bun.XML.parse - self-closing tag with attributes", () => {
  const xml = '<config debug="true" version="1.0"/>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "config",
    __attrs: {
      debug: "true",
      version: "1.0",
    },
  });
});

test("Bun.XML.parse - self-closing tag without attributes", () => {
  const xml = "<br/>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "br",
  });
});

test("Bun.XML.parse - nested elements", () => {
  const xml = `<person>
    <name>John</name>
    <age>30</age>
  </person>`;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "person",
    __children: [
      { __name: "name", __text: "John" },
      { __name: "age", __text: "30" },
    ],
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
    __name: "person",
    __attrs: {
      name: "John",
    },
    __children: [
      {
        __name: "address",
        __attrs: {
          type: "home",
        },
        __children: [
          {
            __name: "city",
            __text: "New York",
          },
        ],
      },
    ],
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
    __name: "doc",
    __children: [
      {
        __name: "child",
        __text: "value",
      },
    ],
  });
});

test("Bun.XML.parse - XML entities", () => {
  const xml = "<message>Hello &lt;world&gt; &amp; &quot;everyone&quot; &#39;here&#39;</message>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "message",
    __text: `Hello <world> & "everyone" 'here'`,
  });
});

test("Bun.XML.parse - numeric entities", () => {
  const xml = "<test>&#65;&#66;&#67;</test>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "test",
    __text: "ABC",
  });
});

test("Bun.XML.parse - entities in attributes", () => {
  const xml = '<tag attr="&lt;value&gt;">content</tag>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "tag",
    __attrs: {
      attr: "<value>",
    },
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
    __name: "root",
    __children: [
      {
        __name: "message",
        __text: "Hello",
      },
    ],
  });
});

test("Bun.XML.parse - duplicate tags become arrays", () => {
  const xml = "<root><item>1</item><item>2</item></root>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "root",
    __children: [
      { __name: "item", __text: "1" },
      { __name: "item", __text: "2" },
    ],
  });
});

test("Bun.XML.parse - CDATA sections", () => {
  const xml = '<message><![CDATA[Hello <world> & "everyone"]]></message>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "message",
    __text: `Hello <world> & "everyone"`,
  });
});

test("Bun.XML.parse - top-level comments are ignored", () => {
  const xml = `<!-- Top comment -->
  <root>content</root>
  <!-- Another top comment -->`;
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __name: "root",
    __text: "content",
  });
});

test("Bun.XML.parse - mismatched closing tag throws error", () => {
  expect(() => Bun.XML.parse("<root><a></b></root>")).toThrow();
});

test("Bun.XML.parse - unclosed tag throws error", () => {
  expect(() => Bun.XML.parse("<root><a>")).toThrow();
});

test("Bun.XML.parse - unterminated XML declaration throws error", () => {
  expect(() => Bun.XML.parse("<?xml version='1.0'")).toThrow();
});

test("Bun.XML.parse - unterminated CDATA throws error", () => {
  expect(() => Bun.XML.parse("<root><![CDATA[unclosed")).toThrow();
});

test("Bun.XML.parse - no arguments throws TypeError", () => {
  expect(() => (Bun.XML.parse as any)()).toThrow();
});

test("Bun.XML.parse - non-string argument throws TypeError", () => {
  expect(() => (Bun.XML.parse as any)(123)).toThrow();
});
