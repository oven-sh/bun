import { test, expect } from "bun:test";

test("Bun.XML.parse - simple text element", () => {
  const xml = "<message>Hello World</message>";
  const result = Bun.XML.parse(xml);
  expect(result).toBe("Hello World");
});

test("Bun.XML.parse - element with whitespace", () => {
  const xml = "<test>  content  </test>";
  const result = Bun.XML.parse(xml);
  expect(result).toBe("content");
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
    __attrs: {
      id: "1",
      type: "info"
    },
    __text: "Hello"
  });
});

test("Bun.XML.parse - with XML declaration", () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><root>content</root>';
  const result = Bun.XML.parse(xml);
  expect(result).toBe("content");
});

test("Bun.XML.parse - empty string", () => {
  const xml = "";
  const result = Bun.XML.parse(xml);
  expect(result).toBe(null);
});

test("Bun.XML.parse - self-closing tag with attributes", () => {
  const xml = '<config debug="true" version="1.0"/>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __attrs: {
      debug: "true",
      version: "1.0"
    }
  });
});

test("Bun.XML.parse - self-closing tag without attributes", () => {
  const xml = '<br/>';
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
    children: ["John", "30"]
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
    __attrs: {
      name: "John"
    },
    children: [{
      __attrs: {
        type: "home"
      },
      children: ["New York"]
    }]
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
    children: ["value"],
    __text: "Some text\n    \n    More text"
  });
});

test("Bun.XML.parse - XML entities", () => {
  const xml = "<message>Hello &lt;world&gt; &amp; &quot;everyone&quot; &#39;here&#39;</message>";
  const result = Bun.XML.parse(xml);
  expect(result).toBe("Hello <world> & \"everyone\" 'here'");
});

test("Bun.XML.parse - numeric entities", () => {
  const xml = "<test>&#65;&#66;&#67;</test>";
  const result = Bun.XML.parse(xml);
  expect(result).toBe("ABC");
});

test("Bun.XML.parse - entities in attributes", () => {
  const xml = '<tag attr="&lt;value&gt;">content</tag>';
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({
    __attrs: {
      attr: "<value>"
    },
    __text: "content"
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
    children: ["Hello"]
  });
});