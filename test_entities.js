// Test XML entity handling
console.log("Testing XML entities...");

const xmlWithEntities = `<message>Hello &lt;world&gt; &amp; &quot;everyone&quot; &#39;here&#39;</message>`;
console.log("Input:", xmlWithEntities);

const result = Bun.XML.parse(xmlWithEntities);
console.log("Current result:", JSON.stringify(result));
console.log("Expected result: Hello <world> & \"everyone\" 'here'");

// Test numeric entities
const xmlNumeric = `<test>&#65; &#66; &#67;</test>`;  // Should be "A B C"
console.log("\nNumeric entities input:", xmlNumeric);
const numResult = Bun.XML.parse(xmlNumeric);
console.log("Current result:", JSON.stringify(numResult));
console.log("Expected result: A B C");