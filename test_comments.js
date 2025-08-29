// Test XML comments
console.log("Testing XML comments...\n");

const xmlWithComments = `<root>
  <!-- This is a comment -->
  <message>Hello</message>
  <!-- Another comment -->
  <data>Value</data>
  <!-- Final comment -->
</root>`;

console.log("Input XML:");
console.log(xmlWithComments);

const result = Bun.XML.parse(xmlWithComments);
console.log("\nParsed result:");
console.log(JSON.stringify(result, null, 2));