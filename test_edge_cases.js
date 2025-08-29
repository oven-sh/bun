// Test edge cases that might cause issues in code review
console.log("Testing XML parser edge cases...\n");

const edgeCases = [
  {
    name: "Malformed XML - unclosed tag",
    xml: "<open>content"
  },
  {
    name: "Malformed XML - mismatched tags", 
    xml: "<open>content</close>"
  },
  {
    name: "Invalid XML - no root element",
    xml: "just text"
  },
  {
    name: "Empty attributes",
    xml: '<tag attr="">content</tag>'
  },
  {
    name: "Special characters in content",
    xml: "<test>&lt;&gt;&amp;&quot;&#39;</test>"
  },
  {
    name: "Very nested structure",
    xml: "<a><b><c><d><e><f>deep</f></e></d></c></b></a>"
  },
  {
    name: "Comments (should be unsupported)",
    xml: "<root><!-- comment -->text</root>"
  },
  {
    name: "CDATA sections (should be unsupported)", 
    xml: "<root><![CDATA[raw data]]></root>"
  },
  {
    name: "Processing instructions",
    xml: "<?xml-stylesheet type='text/xsl' href='style.xsl'?><root>content</root>"
  }
];

edgeCases.forEach((testCase, index) => {
  console.log(`${index + 1}. ${testCase.name}`);
  try {
    const result = Bun.XML.parse(testCase.xml);
    console.log("   ✅ Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.log("   ❌ Error:", error.message);
  }
  console.log();
});