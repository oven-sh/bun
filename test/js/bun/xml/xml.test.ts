import { expect, test } from "bun:test";

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
      type: "info",
    },
    __text: "Hello",
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
      version: "1.0",
    },
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
    name: "John",
    age: "30",
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
      name: "John",
    },
    address: {
      __attrs: {
        type: "home",
      },
      city: "New York",
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
  expect(result).toMatchInlineSnapshot(`
    {
      "__text": 
    "Some text
        
        More text"
    ,
      "child": "value",
    }
  `);
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
    message: "Hello",
  });
});

test("Bun.XML.parse - duplicate tags become arrays", () => {
  const xml = "<root><item>1</item><item>2</item></root>";
  const result = Bun.XML.parse(xml);
  expect(result).toEqual({ item: ["1", "2"] });
});

test("Bun.XML.parse - CDATA sections", () => {
  const xml = "<message><![CDATA[Hello <world> & \"everyone\"]]></message>";
  const result = Bun.XML.parse(xml);
  expect(result).toBe("Hello <world> & \"everyone\"");
});

test("Bun.XML.parse - top-level comments are ignored", () => {
  const xml = `<!-- Top comment -->
  <root>content</root>
  <!-- Another top comment -->`;
  const result = Bun.XML.parse(xml);
  expect(result).toBe("content");
});

test("Bun.XML.parse - mismatched closing tag throws error", () => {
  expect(() => Bun.XML.parse("<root><a></b></root>")).toThrow();
  try {
    Bun.XML.parse("<root><a></b></root>");
    expect(false).toBe(true); // Should not reach here
  } catch (e) {
    expect(e.message).toContain("Mismatched closing tag");
  }
});

test("Bun.XML.parse - unclosed tag throws error", () => {
  expect(() => Bun.XML.parse("<root><a>")).toThrow();
  try {
    Bun.XML.parse("<root><a>");
    expect(false).toBe(true); // Should not reach here
  } catch (e) {
    expect(e.message).toContain("closing tag");
  }
});

test("Bun.XML.parse - unterminated XML declaration throws error", () => {
  expect(() => Bun.XML.parse("<?xml version='1.0'")).toThrow();
  try {
    Bun.XML.parse("<?xml version='1.0'");
    expect(false).toBe(true); // Should not reach here
  } catch (e) {
    expect(e.message).toContain("Unterminated XML declaration");
  }
});

test("Bun.XML.parse - unterminated CDATA throws error", () => {
  expect(() => Bun.XML.parse("<root><![CDATA[unclosed")).toThrow();
  try {
    Bun.XML.parse("<root><![CDATA[unclosed");
    expect(false).toBe(true); // Should not reach here
  } catch (e) {
    expect(e.message).toContain("Unterminated CDATA section");
  }
});

test("Bun.XML.parse - no arguments throws TypeError", () => {
  expect(() => (Bun.XML.parse as any)()).toThrow();
  try {
    (Bun.XML.parse as any)();
    expect(false).toBe(true); // Should not reach here
  } catch (e) {
    expect(e.constructor.name).toBe("TypeError");
  }
});

test("Bun.XML.parse - non-string argument throws TypeError", () => {
  expect(() => (Bun.XML.parse as any)(123)).toThrow();
  try {
    (Bun.XML.parse as any)(123);
    expect(false).toBe(true); // Should not reach here
  } catch (e) {
    expect(e.constructor.name).toBe("TypeError");
  }
});
