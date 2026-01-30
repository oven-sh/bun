import { expect, test } from "bun:test";

test("Bun.markdown.html() should skip YAML frontmatter", () => {
  const md = `---
title: "Hello World"
author: "Bun"
---

# Heading
`;

  const html = Bun.markdown.html(md);

  // Should NOT contain frontmatter content
  expect(html).not.toContain("title:");
  expect(html).not.toContain("Hello World");
  expect(html).not.toContain("author:");
  expect(html).not.toContain("<hr");
  expect(html).not.toContain("<h2>");

  // Should contain the actual heading
  expect(html).toContain("<h1>Heading</h1>");
});

test("Bun.markdown.html() should handle frontmatter with ... closing delimiter", () => {
  const md = `---
title: Test
...

# Content
`;

  const html = Bun.markdown.html(md);
  expect(html).not.toContain("title:");
  expect(html).toContain("<h1>Content</h1>");
});

test("Bun.markdown.html() should handle minimal frontmatter", () => {
  const md = `---
a: b
---

# Heading
`;

  const html = Bun.markdown.html(md);
  expect(html).not.toContain("a:");
  expect(html).toContain("<h1>Heading</h1>");
});

test("Bun.markdown.html() should not treat empty --- blocks as frontmatter", () => {
  // Empty frontmatter (no colon) should be treated as setext heading
  const md = `---
---

# Heading
`;

  const html = Bun.markdown.html(md);
  // Without a colon inside, this is not frontmatter - it's an hr followed by an hr
  expect(html).toContain("<hr");
  expect(html).toContain("<h1>Heading</h1>");
});

test("Bun.markdown.html() should not treat --- as frontmatter when not at document start", () => {
  const md = `# Heading

---

Some text
`;

  const html = Bun.markdown.html(md);
  // The --- should be treated as a thematic break (hr)
  expect(html).toContain("<hr");
  expect(html).toContain("<h1>Heading</h1>");
});

test("Bun.markdown.html() should handle frontmatter with spaces after delimiters", () => {
  const md = `---
title: Test
---

# Content
`;

  const html = Bun.markdown.html(md);
  expect(html).not.toContain("title:");
  expect(html).toContain("<h1>Content</h1>");
});

test("Bun.markdown.html() should not skip frontmatter when disabled", () => {
  const md = `---
title: "Hello"
---

# Heading
`;

  const html = Bun.markdown.html(md, { frontmatter: false });

  // With frontmatter disabled, --- becomes hr and title becomes h2
  expect(html).toContain("<hr");
});

test("Bun.markdown.html() should handle document with only frontmatter", () => {
  const md = `---
title: Test
---
`;

  const html = Bun.markdown.html(md);
  // Should result in empty/minimal output
  expect(html.trim()).toBe("");
});

test("Bun.markdown.html() should handle frontmatter with complex YAML content", () => {
  const md = `---
title: "Test Document"
tags:
  - javascript
  - markdown
date: 2024-01-15
nested:
  key: value
---

# Main Content

Paragraph text.
`;

  const html = Bun.markdown.html(md);
  expect(html).not.toContain("tags:");
  expect(html).not.toContain("javascript");
  expect(html).not.toContain("nested:");
  expect(html).toContain("<h1>Main Content</h1>");
  expect(html).toContain("<p>Paragraph text.</p>");
});

test("Bun.markdown.html() should handle frontmatter with --- inside code blocks", () => {
  const md = `---
title: Test
---

# Heading

\`\`\`yaml
---
inner: frontmatter
---
\`\`\`
`;

  const html = Bun.markdown.html(md);
  expect(html).not.toContain("title: Test");
  expect(html).toContain("<h1>Heading</h1>");
  // The code block should contain the --- markers
  expect(html).toContain("inner: frontmatter");
});

test("Bun.markdown.html() handles unclosed frontmatter by treating it as regular content", () => {
  const md = `---
title: Test

# Heading
`;

  const html = Bun.markdown.html(md);
  // Without a closing ---, the document should be treated normally
  // The --- becomes an hr, and title: becomes content
  expect(html).toContain("<hr");
});
