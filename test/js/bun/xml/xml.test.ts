import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, mkdirSync, existsSync } from "fs";

const { XML } = Bun;

describe("Bun.XML", () => {
  test("XML is defined on Bun object", () => {
    expect(Bun.XML).toBeDefined();
    expect(typeof XML.parse).toBe("function");
  });

  describe("parse", () => {
    test("parses simple XML elements", () => {
      expect(XML.parse("<root></root>")).toBe(null);
      expect(XML.parse("<root>text</root>")).toBe("text");
      expect(XML.parse("<root><child>value</child></root>")).toEqual({
        __text: "value",
      });
    });

    test("parses XML with attributes", () => {
      expect(XML.parse('<root attr="value"></root>')).toEqual({
        "@attr": "value",
      });
      expect(XML.parse('<root attr="value">text</root>')).toEqual({
        "@attr": "value",
        __text: "text",
      });
    });

    test("parses XML with multiple attributes", () => {
      expect(XML.parse('<root id="1" name="test" active="true"></root>')).toEqual({
        "@id": "1",
        "@name": "test",
        "@active": "true",
      });
    });

    test("parses nested XML elements", () => {
      const xml = `
        <person>
          <name>John Doe</name>
          <age>30</age>
          <address>
            <street>123 Main St</street>
            <city>Springfield</city>
            <zip>12345</zip>
          </address>
        </person>
      `;
      expect(XML.parse(xml)).toEqual({
        __children: [
          "John Doe",
          "30",
          {
            __children: [
              "123 Main St",
              "Springfield",
              "12345"
            ]
          }
        ]
      });
    });

    test("parses XML with mixed content", () => {
      const xml = '<root>Text before <child>child content</child> text after</root>';
      expect(XML.parse(xml)).toEqual({
        __children: [
          "Text before ",
          "child content",
          " text after"
        ]
      });
    });

    test("parses self-closing XML elements", () => {
      expect(XML.parse('<root/>')).toBe(null);
      expect(XML.parse('<root attr="value"/>')).toEqual({
        "@attr": "value",
      });
    });

    test("parses XML with CDATA sections", () => {
      const xml = '<root><![CDATA[This is <raw> content & special chars]]></root>';
      expect(XML.parse(xml)).toBe("This is <raw> content & special chars");
    });

    test("parses XML with comments (ignores them)", () => {
      const xml = `
        <root>
          <!-- This is a comment -->
          <child>value</child>
          <!-- Another comment -->
        </root>
      `;
      expect(XML.parse(xml)).toEqual({
        __text: "value",
      });
    });

    test("parses XML with processing instructions (ignores them)", () => {
      const xml = `
        <?xml version="1.0" encoding="UTF-8"?>
        <root>
          <child>value</child>
        </root>
      `;
      expect(XML.parse(xml)).toEqual({
        __text: "value",
      });
    });

    test("handles XML entity references", () => {
      expect(XML.parse('<root>&lt;hello&gt;</root>')).toBe("<hello>");
      expect(XML.parse('<root>&amp;test&amp;</root>')).toBe("&test&");
      expect(XML.parse('<root>&quot;quoted&quot;</root>')).toBe('"quoted"');
      expect(XML.parse("<root>&apos;single&apos;</root>")).toBe("'single'");
    });

    test("handles XML character references", () => {
      expect(XML.parse('<root>&#65;</root>')).toBe("A");
      expect(XML.parse('<root>&#x41;</root>')).toBe("A");
      expect(XML.parse('<root>&#8364;</root>')).toBe("€");
    });

    test("parses complex nested XML", () => {
      const xml = `
        <library>
          <book id="1" category="fiction">
            <title>The Great Gatsby</title>
            <author>F. Scott Fitzgerald</author>
            <year>1925</year>
            <price currency="USD">12.99</price>
          </book>
          <book id="2" category="non-fiction">
            <title>A Brief History of Time</title>
            <author>Stephen Hawking</author>
            <year>1988</year>
            <price currency="USD">15.99</price>
          </book>
        </library>
      `;
      expect(XML.parse(xml)).toEqual({
        __children: [
          {
            "@id": "1",
            "@category": "fiction",
            __children: [
              "The Great Gatsby",
              "F. Scott Fitzgerald",
              "1925",
              {
                "@currency": "USD",
                __text: "12.99"
              }
            ]
          },
          {
            "@id": "2",
            "@category": "non-fiction",
            __children: [
              "A Brief History of Time",
              "Stephen Hawking",
              "1988",
              {
                "@currency": "USD",
                __text: "15.99"
              }
            ]
          }
        ]
      });
    });

    test("handles empty and whitespace-only text nodes", () => {
      const xml = `
        <root>
          <child1>  </child1>
          <child2></child2>
          <child3>actual content</child3>
        </root>
      `;
      expect(XML.parse(xml)).toEqual({
        __children: [
          null,  // Empty or whitespace-only should be null
          null,  // Empty element
          "actual content"
        ]
      });
    });

    test("parses XML with namespaces", () => {
      const xml = `
        <root xmlns:custom="http://example.com/custom">
          <custom:element attr="value">content</custom:element>
        </root>
      `;
      expect(XML.parse(xml)).toEqual({
        "@xmlns:custom": "http://example.com/custom",
        __text: "content"
      });
    });

    test("throws on malformed XML", () => {
      expect(() => XML.parse("<root><unclosed>")).toThrow();
      expect(() => XML.parse("<root></different>")).toThrow();
      expect(() => XML.parse("not xml at all")).toThrow();
      expect(() => XML.parse("<root attr=value></root>")).toThrow(); // Missing quotes
    });

    test("throws on XML with syntax errors", () => {
      expect(() => XML.parse("<root><![CDATA[unclosed cdata")).toThrow();
      expect(() => XML.parse("<root><!-- unclosed comment")).toThrow();
      expect(() => XML.parse("<root><invalid&entity;</root>")).toThrow();
    });

    test("handles large XML documents", () => {
      let xml = "<root>";
      for (let i = 0; i < 1000; i++) {
        xml += `<item id="${i}">Item ${i}</item>`;
      }
      xml += "</root>";
      
      const result = XML.parse(xml);
      expect(Array.isArray(result.__children)).toBe(true);
      expect(result.__children.length).toBe(1000);
      expect(result.__children[0]).toEqual({
        "@id": "0",
        __text: "Item 0"
      });
      expect(result.__children[999]).toEqual({
        "@id": "999",
        __text: "Item 999"
      });
    });

    test("handles XML with DTD declarations (ignores them)", () => {
      const xml = `
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"
          "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
        <root>
          <child>content</child>
        </root>
      `;
      expect(XML.parse(xml)).toEqual({
        __text: "content",
      });
    });

    test("preserves order of elements", () => {
      const xml = `
        <root>
          <first>1</first>
          <second>2</second>
          <third>3</third>
        </root>
      `;
      const result = XML.parse(xml);
      expect(result.__children).toEqual(["1", "2", "3"]);
    });

    test("handles mixed attributes and elements correctly", () => {
      const xml = `
        <config version="1.0" debug="true">
          <database>
            <host>localhost</host>
            <port>5432</port>
          </database>
          <cache enabled="true">
            <ttl>300</ttl>
          </cache>
        </config>
      `;
      expect(XML.parse(xml)).toEqual({
        "@version": "1.0",
        "@debug": "true",
        __children: [
          {
            __children: ["localhost", "5432"]
          },
          {
            "@enabled": "true",
            __text: "300"
          }
        ]
      });
    });

    test("handles unusual XML edge cases", () => {
      // Test multiple root elements (should still parse first one)
      expect(XML.parse("<root>first</root><second>ignored</second>")).toBe("first");
      
      // Test empty attribute values
      expect(XML.parse('<root empty="" full="value"></root>')).toEqual({
        "@empty": "",
        "@full": "value"
      });
      
      // Test attribute with single quotes
      expect(XML.parse("<root attr='single-quoted'></root>")).toEqual({
        "@attr": "single-quoted"
      });
    });

    test("handles XML with numeric and boolean-like values", () => {
      const xml = `
        <data>
          <count>42</count>
          <price>19.99</price>
          <active>true</active>
          <disabled>false</disabled>
          <zero>0</zero>
        </data>
      `;
      expect(XML.parse(xml)).toEqual({
        __children: ["42", "19.99", "true", "false", "0"]
      });
    });

    test("handles deeply nested XML structures", () => {
      const xml = `
        <level1>
          <level2>
            <level3>
              <level4>
                <level5>deep content</level5>
              </level4>
            </level3>
          </level2>
        </level1>
      `;
      expect(XML.parse(xml)).toEqual({
        __text: "deep content"
      });
    });

    test("handles XML with unicode characters", () => {
      const xml = '<root>Hello 世界 🌍 Ñoño café</root>';
      expect(XML.parse(xml)).toBe("Hello 世界 🌍 Ñoño café");
    });

    test("handles XML with escaped quotes in attributes", () => {
      const xml = '<root title="He said &quot;Hello&quot; to me"></root>';
      expect(XML.parse(xml)).toEqual({
        "@title": 'He said "Hello" to me'
      });
    });

    test("handles complex CDATA with special content", () => {
      const xml = `
        <script>
          <![CDATA[
            function test() {
              return "<div>Hello & goodbye</div>";
            }
          ]]>
        </script>
      `;
      expect(XML.parse(xml)).toBe(`
            function test() {
              return "<div>Hello & goodbye</div>";
            }
          `);
    });

    test("parses SVG-like XML with multiple attributes", () => {
      const xml = `
        <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red"/>
          <text x="50" y="50" text-anchor="middle">SVG</text>
        </svg>
      `;
      const result = XML.parse(xml);
      expect(result).toEqual({
        "@width": "100",
        "@height": "100",
        "@xmlns": "http://www.w3.org/2000/svg",
        __children: [
          {
            "@cx": "50",
            "@cy": "50",
            "@r": "40",
            "@stroke": "black",
            "@stroke-width": "3",
            "@fill": "red"
          },
          {
            "@x": "50",
            "@y": "50",
            "@text-anchor": "middle",
            __text: "SVG"
          }
        ]
      });
    });

    test("handles XML with inline styles and complex attributes", () => {
      const xml = `
        <div class="container" style="color: red; font-size: 14px;">
          <span id="test-span" data-value="123">Styled content</span>
        </div>
      `;
      expect(XML.parse(xml)).toEqual({
        "@class": "container",
        "@style": "color: red; font-size: 14px;",
        __text: "Styled content"
      });
    });

    test("performance test with moderately sized XML", () => {
      let xml = "<catalog>";
      for (let i = 0; i < 100; i++) {
        xml += `
          <product id="${i}" featured="${i % 2 === 0}">
            <name>Product ${i}</name>
            <price currency="USD">${(Math.random() * 100).toFixed(2)}</price>
            <description>This is product number ${i}</description>
          </product>
        `;
      }
      xml += "</catalog>";

      const start = performance.now();
      const result = XML.parse(xml);
      const duration = performance.now() - start;

      expect(result.__children).toHaveLength(100);
      expect(duration).toBeLessThan(100); // Should parse in less than 100ms
    });

    test("handles XML fragments without root wrapper", () => {
      // These should still parse successfully by treating the first element as root
      expect(XML.parse("<item>test</item>")).toBe("test");
      expect(XML.parse('<item id="1">test</item>')).toEqual({
        "@id": "1",
        __text: "test"
      });
    });

    test("handles XML with processing instructions", () => {
      const xml = `
        <?xml version="1.0" encoding="UTF-8"?>
        <?xml-stylesheet type="text/xsl" href="style.xsl"?>
        <document>
          <content>data</content>
        </document>
      `;
      expect(XML.parse(xml)).toEqual({
        __text: "data"
      });
    });
  });

  describe("error handling", () => {
    test("throws descriptive errors for common XML problems", () => {
      // Unclosed tags
      expect(() => XML.parse("<root><child>")).toThrowError(/unclosed/i);
      
      // Mismatched tags
      expect(() => XML.parse("<root><child></different></root>")).toThrowError();
      
      // Invalid characters in tag names
      expect(() => XML.parse("<root><123invalid>content</123invalid></root>")).toThrowError();
      
      // Duplicate attributes
      expect(() => XML.parse('<root id="1" id="2">content</root>')).toThrowError();
    });

    test("handles null and undefined inputs", () => {
      expect(() => XML.parse(null)).toThrowError();
      expect(() => XML.parse(undefined)).toThrowError();
      expect(() => XML.parse("")).toThrowError();
    });

    test("handles non-string inputs", () => {
      expect(() => XML.parse(123)).toThrowError();
      expect(() => XML.parse({})).toThrowError();
      expect(() => XML.parse([])).toThrowError();
    });

    test("handles extremely malformed XML", () => {
      expect(() => XML.parse("<><><")).toThrowError();
      expect(() => XML.parse("<<>>")).toThrowError();
      expect(() => XML.parse("<root><></root>")).toThrowError();
    });
  });

  describe("file parsing", () => {
    test("can parse XML from file content", () => {
      const testDir = join(tmpdir(), "bun-xml-test-" + Date.now());
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }

      const xmlContent = `
        <?xml version="1.0" encoding="UTF-8"?>
        <books>
          <book id="1">
            <title>Test Book</title>
            <author>Test Author</author>
          </book>
        </books>
      `;
      
      const filePath = join(testDir, "test.xml");
      writeFileSync(filePath, xmlContent);
      
      const fileContent = Bun.file(filePath).text();
      const result = XML.parse(fileContent);
      
      expect(result).toEqual({
        __children: [{
          "@id": "1",
          __children: ["Test Book", "Test Author"]
        }]
      });
    });
  });
});

// Additional tests for XML parser edge cases and real-world scenarios
describe("Bun.XML - Real World Examples", () => {
  test("parses RSS feed structure", () => {
    const rss = `
      <rss version="2.0">
        <channel>
          <title>Test Blog</title>
          <description>A test blog</description>
          <item>
            <title>First Post</title>
            <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
            <guid>1</guid>
          </item>
        </channel>
      </rss>
    `;
    
    const result = XML.parse(rss);
    expect(result).toEqual({
      "@version": "2.0",
      __children: [{
        __children: [
          "Test Blog",
          "A test blog",
          {
            __children: [
              "First Post", 
              "Mon, 01 Jan 2024 00:00:00 GMT",
              "1"
            ]
          }
        ]
      }]
    });
  });

  test("parses SOAP envelope structure", () => {
    const soap = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <GetUserInfo xmlns="http://example.com/">
            <UserId>12345</UserId>
          </GetUserInfo>
        </soap:Body>
      </soap:Envelope>
    `;
    
    const result = XML.parse(soap);
    expect(result["@xmlns:soap"]).toBe("http://schemas.xmlsoap.org/soap/envelope/");
    expect(result).toHaveProperty("__text");
  });

  test("parses configuration XML with mixed content", () => {
    const config = `
      <configuration>
        <appSettings>
          <add key="DatabaseConnection" value="Server=localhost;Database=test"/>
          <add key="Debug" value="true"/>
        </appSettings>
        <system.web>
          <compilation debug="true" targetFramework="4.8"/>
        </system.web>
      </configuration>
    `;
    
    const result = XML.parse(config);
    expect(Array.isArray(result.__children)).toBe(true);
    expect(result.__children).toHaveLength(2);
  });

  describe("fixture tests", () => {
    test("can parse simple fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "simple.xml")).text();
      const result = XML.parse(content);
      
      expect(result).toEqual({
        __children: ["Hello, World!", "42", "true"]
      });
    });

    test("can parse complex fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "complex.xml")).text();
      const result = XML.parse(content);
      
      // Verify the structure exists
      expect(result).toHaveProperty("__children");
      expect(Array.isArray(result.__children)).toBe(true);
      expect(result.__children.length).toBeGreaterThan(0);
      
      // Verify specific nested content
      const books = result.__children.find(child => 
        typeof child === 'object' && child?.__children?.some(book => 
          typeof book === 'object' && book?.["@id"] === "book001"
        )
      );
      expect(books).toBeDefined();
    });

    test("can parse namespace fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "namespace.xml")).text();
      const result = XML.parse(content);
      
      // Check for namespace attributes
      expect(result).toHaveProperty("@xmlns:app");
      expect(result).toHaveProperty("@xmlns:config");
      expect(result).toHaveProperty("@xmlns:user");
      expect(result["@xmlns:app"]).toBe("http://example.com/app");
    });

    test("can parse entities fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "entities.xml")).text();
      const result = XML.parse(content);
      
      expect(result).toHaveProperty("__children");
      expect(Array.isArray(result.__children)).toBe(true);
      expect(result.__children.length).toBeGreaterThan(0);
    });

    test("can parse RSS fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "rss.xml")).text();
      const result = XML.parse(content);
      
      expect(result).toHaveProperty("@version");
      expect(result["@version"]).toBe("2.0");
      expect(result).toHaveProperty("@xmlns:atom");
    });

    test("can parse SVG fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "svg.xml")).text();
      const result = XML.parse(content);
      
      expect(result).toHaveProperty("@width");
      expect(result).toHaveProperty("@height");
      expect(result).toHaveProperty("@xmlns");
      expect(result["@xmlns"]).toBe("http://www.w3.org/2000/svg");
    });

    test("can parse SOAP fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "soap.xml")).text();
      const result = XML.parse(content);
      
      expect(result).toHaveProperty("@xmlns:soap");
      expect(result["@xmlns:soap"]).toBe("http://schemas.xmlsoap.org/soap/envelope/");
      expect(result).toHaveProperty("__children");
    });

    test("throws on malformed fixture", async () => {
      const content = await Bun.file(join(__dirname, "fixtures", "malformed.xml")).text();
      
      expect(() => XML.parse(content)).toThrow();
    });
  });
});