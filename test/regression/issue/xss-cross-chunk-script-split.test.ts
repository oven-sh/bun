import { expect, test } from "bun:test";

// Regression test for cross-chunk script tag splitting vulnerability in SSR streaming.
// The toSingleQuote function escapes </script> tags, but when applied independently
// per-chunk, a </script> split across two chunks would bypass the escaping.
// The fix is to combine all chunks before escaping.

// Copy of the toSingleQuote function from ssr.tsx
function toSingleQuote(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/<!--/g, "<\\!--")
    .replace(/<\/(script)/gi, "</\\$1");
}

// Simulates the VULNERABLE (old) behavior: escape per-chunk independently
function simulateWriteManyVulnerable(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder("utf-8");
  let result = "";
  for (let i = 0; i < chunks.length; i++) {
    const str = toSingleQuote(decoder.decode(chunks[i], { stream: true }));
    if (i === 0) result += "'";
    result += str;
  }
  result += "')</script>";
  return result;
}

// Simulates the FIXED behavior: combine all chunks, then escape once
function simulateWriteManyFixed(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder("utf-8");
  let combined = "";
  for (let i = 0; i < chunks.length; i++) {
    combined += decoder.decode(chunks[i], { stream: true });
  }
  return "'" + toSingleQuote(combined) + "')</script>";
}

function getContentBeforeFinalTag(output: string): string {
  return output.slice(0, output.lastIndexOf("')</script>"));
}

test("toSingleQuote escapes </script> in a single string", () => {
  const input = "hello</script><img src=x onerror=alert(1)>world";
  const escaped = toSingleQuote(input);
  expect(escaped).not.toContain("</script>");
  expect(escaped).toContain("</\\script>");
});

test("old per-chunk escaping is vulnerable to cross-chunk </script> split", () => {
  // Split "</script>" across two chunks: "</sc" in chunk1, "ript>" in chunk2
  const chunk1 = new TextEncoder().encode("hello</sc");
  const chunk2 = new TextEncoder().encode("ript><img src=x onerror=alert(1)>world");

  const output = simulateWriteManyVulnerable([chunk1, chunk2]);
  const content = getContentBeforeFinalTag(output);

  // The vulnerable version DOES contain an unescaped </script>
  expect(content).toContain("</script>");
});

test("fixed combined escaping prevents cross-chunk </script> split", () => {
  // Same split as above
  const chunk1 = new TextEncoder().encode("hello</sc");
  const chunk2 = new TextEncoder().encode("ript><img src=x onerror=alert(1)>world");

  const output = simulateWriteManyFixed([chunk1, chunk2]);
  const content = getContentBeforeFinalTag(output);

  // The fixed version should NOT contain an unescaped </script>
  expect(content).not.toContain("</script>");
  expect(content).toContain("</\\script>");
});

test("fixed escaping handles various split points of </script>", () => {
  const splits = [
    ["<", "/script>"],
    ["</", "script>"],
    ["</s", "cript>"],
    ["</sc", "ript>"],
    ["</scr", "ipt>"],
    ["</scri", "pt>"],
    ["</scrip", "t>"],
    ["</script", ">"],
  ];

  for (const [prefix, suffix] of splits) {
    const chunk1 = new TextEncoder().encode("data" + prefix);
    const chunk2 = new TextEncoder().encode(suffix + "payload");

    const output = simulateWriteManyFixed([chunk1, chunk2]);
    const content = getContentBeforeFinalTag(output);

    expect(content).not.toContain("</script>");
  }
});

test("fixed escaping handles </SCRIPT> case-insensitive split", () => {
  const chunk1 = new TextEncoder().encode("data</SC");
  const chunk2 = new TextEncoder().encode("RIPT>payload");

  const output = simulateWriteManyFixed([chunk1, chunk2]);
  const content = getContentBeforeFinalTag(output);

  expect(content).not.toContain("</SCRIPT>");
});

test("fixed escaping handles split across three chunks", () => {
  const chunk1 = new TextEncoder().encode("data</");
  const chunk2 = new TextEncoder().encode("scri");
  const chunk3 = new TextEncoder().encode("pt>payload");

  const output = simulateWriteManyFixed([chunk1, chunk2, chunk3]);
  const content = getContentBeforeFinalTag(output);

  expect(content).not.toContain("</script>");
});

test("fixed escaping handles <!-- split across chunks", () => {
  const chunk1 = new TextEncoder().encode("data<!-");
  const chunk2 = new TextEncoder().encode("-comment-->");

  const output = simulateWriteManyFixed([chunk1, chunk2]);
  const content = getContentBeforeFinalTag(output);

  expect(content).not.toContain("<!--");
});
