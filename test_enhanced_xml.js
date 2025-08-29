// Test enhanced XML parsing features
console.log("Testing enhanced XML parsing...\n");

// Test attributes
console.log("1. Testing attributes:");
try {
    const xmlWithAttrs = `<message id="123" type="info">Hello</message>`;
    const result = Bun.XML.parse(xmlWithAttrs);
    console.log("Result:", JSON.stringify(result, null, 2));
} catch (e) {
    console.log("Error:", e.message);
}

// Test self-closing tag
console.log("\n2. Testing self-closing tag:");
try {
    const selfClosing = `<config debug="true" version="1.0"/>`;
    const result = Bun.XML.parse(selfClosing);
    console.log("Result:", JSON.stringify(result, null, 2));
} catch (e) {
    console.log("Error:", e.message);
}

// Test nested elements
console.log("\n3. Testing nested elements:");
try {
    const nested = `<person>
        <name>John</name>
        <age>30</age>
    </person>`;
    const result = Bun.XML.parse(nested);
    console.log("Result:", JSON.stringify(result, null, 2));
} catch (e) {
    console.log("Error:", e.message);
}

// Test complex structure
console.log("\n4. Testing complex structure:");
try {
    const complex = `<person name="John" age="30">
        <address type="home">
            <city>New York</city>
            <country>USA</country>
        </address>
        <skills>
            <skill level="expert">JavaScript</skill>
            <skill level="intermediate">Python</skill>
        </skills>
    </person>`;
    const result = Bun.XML.parse(complex);
    console.log("Result:", JSON.stringify(result, null, 2));
} catch (e) {
    console.log("Error:", e.message);
}