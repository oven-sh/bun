// Simple test for XML parsing
const xml = `<person name="John" age="30">
    <address>
        <city>New York</city>
        <country>USA</country>
    </address>
    <hobbies>
        <hobby>reading</hobby>
        <hobby>swimming</hobby>
    </hobbies>
</person>`;

try {
    const result = Bun.XML.parse(xml);
    console.log("XML Parse Result:", JSON.stringify(result, null, 2));
} catch (err) {
    console.error("XML Parse Error:", err.message);
}

// Test simple text element
const simpleXml = `<message>Hello World</message>`;
try {
    const simpleResult = Bun.XML.parse(simpleXml);
    console.log("Simple XML Result:", JSON.stringify(simpleResult, null, 2));
} catch (err) {
    console.error("Simple XML Error:", err.message);
}

// Test self-closing element
const selfClosing = `<config debug="true"/>`;
try {
    const selfClosingResult = Bun.XML.parse(selfClosing);
    console.log("Self-closing XML Result:", JSON.stringify(selfClosingResult, null, 2));
} catch (err) {
    console.error("Self-closing XML Error:", err.message);
}