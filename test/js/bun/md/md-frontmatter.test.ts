import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const { frontmatter, html, ansi, render, react } = Bun.markdown;

describe("Bun.markdown.frontmatter", () => {
  test("yaml fences", () => {
    expect(frontmatter("---\ntitle: Hello\ntags:\n  - a\n  - b\n---\n# Heading\n")).toEqual({
      data: { title: "Hello", tags: ["a", "b"] },
      content: "# Heading\n",
    });
  });

  test("toml fences", () => {
    expect(frontmatter('+++\ntitle = "Hello"\nweight = 3\n+++\nbody\n')).toEqual({
      data: { title: "Hello", weight: 3 },
      content: "body\n",
    });
  });

  test("fenced json parses through the yaml parser", () => {
    expect(frontmatter('---\n{"title": "Hello"}\n---\nbody')).toEqual({
      data: { title: "Hello" },
      content: "body",
    });
  });

  test("fenced json matches JSON.parse semantics", () => {
    // JSON is valid YAML: no-space colons, duplicate keys (last wins),
    // escapes, and nesting must come out exactly as JSON.parse reads them.
    const json = '{"k":1,"a":{"b":[1,2,3],"c":"x y"},"s":"\\u00e9}","n":1e3,"t":true,"z":null,"k":2}';
    expect(frontmatter(`---\n${json}\n---\nbody`).data).toEqual(JSON.parse(json));
  });

  test("empty block is {} (distinct from no block)", () => {
    expect(frontmatter("---\n---\nbody")).toEqual({ data: {}, content: "body" });
    expect(frontmatter("---\n# just a comment\n---\nbody")).toEqual({ data: {}, content: "body" });
    expect(frontmatter("+++\n+++\nbody")).toEqual({ data: {}, content: "body" });
  });

  test("no block is null", () => {
    expect(frontmatter("# Heading\n")).toEqual({ data: null, content: "# Heading\n" });
    expect(frontmatter("")).toEqual({ data: null, content: "" });
  });

  test("block must start at offset 0", () => {
    const blank = "\n---\ntitle: x\n---\n";
    expect(frontmatter(blank)).toEqual({ data: null, content: blank });
    const indented = " ---\ntitle: x\n---\n";
    expect(frontmatter(indented)).toEqual({ data: null, content: indented });
  });

  test("unclosed fences are not front matter", () => {
    const yaml = "---\ntitle: x\n";
    expect(frontmatter(yaml)).toEqual({ data: null, content: yaml });
    const mismatched = "+++\ntitle = 'x'\n---\nbody";
    expect(frontmatter(mismatched)).toEqual({ data: null, content: mismatched });
  });

  test("scalar and sequence metadata throws (must be a mapping)", () => {
    expect(() => frontmatter("---\nFoo\n---\nBar\n")).toThrow(SyntaxError);
    expect(() => frontmatter("---\nFoo\n---\nBar\n")).toThrow("YAML front matter must be a mapping");
    expect(() => frontmatter("---\n- a\n- b\n---\nbody")).toThrow("YAML front matter must be a mapping");
    // The likelier typo: a missing colon parses as a valid YAML scalar.
    expect(() => frontmatter("---\ntitle Hello\n---\nbody")).toThrow("YAML front matter must be a mapping");
  });

  test("a blank first inner line is not front matter", () => {
    const doc = "---\n\ntitle: x\n---\nbody";
    expect(frontmatter(doc)).toEqual({ data: null, content: doc });
  });

  test("yaml's `...` document-end marker does not close the block", () => {
    const doc = "---\ntitle: x\n...\nbody";
    expect(frontmatter(doc)).toEqual({ data: null, content: doc });
  });

  test("four markers are a thematic break, not a fence", () => {
    const doc = "----\ntitle: x\n----\n";
    expect(frontmatter(doc)).toEqual({ data: null, content: doc });
  });

  test("closing fence may end at EOF and carry trailing whitespace", () => {
    expect(frontmatter("---\ntitle: x\n---")).toEqual({ data: { title: "x" }, content: "" });
    expect(frontmatter("---  \ntitle: x\n---\t\nbody")).toEqual({ data: { title: "x" }, content: "body" });
  });

  test("crlf line endings", () => {
    expect(frontmatter("---\r\ntitle: x\r\n---\r\nbody\r\n")).toEqual({
      data: { title: "x" },
      content: "body\r\n",
    });
  });

  test("utf-8 bom before the opening fence", () => {
    expect(frontmatter("\uFEFF---\ntitle: x\n---\nbody")).toEqual({
      data: { title: "x" },
      content: "body",
    });
  });

  test("a fence inside a block scalar does not close the block", () => {
    const doc = "---\ndescription: |\n  text\n  ---\n  more\ntitle: x\n---\nbody";
    expect(frontmatter(doc)).toEqual({
      data: { description: "text\n---\nmore\n", title: "x" },
      content: "body",
    });
  });

  test("yaml anchors and aliases resolve", () => {
    expect(frontmatter("---\nbase: &b\n  x: 1\nref: *b\n---\n").data).toEqual({
      base: { x: 1 },
      ref: { x: 1 },
    });
  });

  test("invalid yaml in fences throws SyntaxError", () => {
    expect(() => frontmatter("---\ntitle: [broken\n---\nbody")).toThrow(SyntaxError);
  });

  test("invalid toml in fences throws SyntaxError", () => {
    expect(() => frontmatter("+++\n= broken\n+++\nbody")).toThrow(SyntaxError);
  });

  test("bare `{…}` objects are not front matter", () => {
    // Only explicit `---`/`+++` fences mark front matter; a document that
    // opens with a JSON snippet or template braces keeps its first block.
    const json = '{"title": "Hello"}\nbody';
    expect(frontmatter(json)).toEqual({ data: null, content: json });
    const tpl = "{{ template }}\nbody";
    expect(frontmatter(tpl)).toEqual({ data: null, content: tpl });
  });

  test("buffer input", () => {
    expect(frontmatter(Buffer.from("---\ntitle: x\n---\nhi"))).toEqual({
      data: { title: "x" },
      content: "hi",
    });
  });

  test("missing and nullish input throws", () => {
    expect(() => (frontmatter as any)()).toThrow("Expected a string or buffer to parse");
    expect(() => (frontmatter as any)(undefined)).toThrow("Expected a string or buffer to parse");
    expect(() => (frontmatter as any)(null)).toThrow("Expected a string or buffer to parse");
  });
});

describe("renderers skip front matter by default", () => {
  const doc = "---\ntitle: Hello\n---\n# Heading\n";

  test("html", () => {
    expect(html(doc)).toBe("<h1>Heading</h1>\n");
  });

  test("html with frontmatter: false", () => {
    expect(html(doc, { frontmatter: false })).toBe("<hr />\n<h2>title: Hello</h2>\n<h1>Heading</h1>\n");
  });

  test("toml fences", () => {
    expect(html('+++\ntitle = "Hello"\n+++\n# Heading\n')).toBe("<h1>Heading</h1>\n");
  });

  test("bare `{…}` objects render as content", () => {
    expect(html('{"title": "Hello"}\n# Heading\n')).toBe(
      "<p>{&quot;title&quot;: &quot;Hello&quot;}</p>\n<h1>Heading</h1>\n",
    );
  });

  test("unparseable metadata is still skipped (detection is structural)", () => {
    expect(html("---\ntitle: [broken\n---\nbody\n")).toBe("<p>body</p>\n");
    expect(html("---\ntitle: [broken\n---\nbody\n", { frontmatter: false })).toBe(
      "<hr />\n<h2>title: [broken</h2>\n<p>body</p>\n",
    );
  });

  test("a scalar block is skipped; frontmatter: false restores the spec reading", () => {
    expect(html("---\nFoo\n---\nBar\n---\nBaz")).toBe("<h2>Bar</h2>\n<p>Baz</p>\n");
    expect(html("---\nFoo\n---\nBar\n---\nBaz", { frontmatter: false })).toBe(
      "<hr />\n<h2>Foo</h2>\n<h2>Bar</h2>\n<p>Baz</p>\n",
    );
  });

  test("a blank first inner line renders as markdown", () => {
    expect(html("---\n\nFoo\n---\n")).toBe("<hr />\n<h2>Foo</h2>\n");
  });

  test("empty block is skipped; frontmatter: false restores two thematic breaks", () => {
    expect(html("---\n---\n")).toBe("");
    expect(html("---\n---\n", { frontmatter: false })).toBe("<hr />\n<hr />\n");
  });

  test("document that is only front matter renders to nothing", () => {
    expect(html("---\ntitle: Hello\n---")).toBe("");
  });

  test("ansi", () => {
    expect(ansi(doc, { colors: false })).toMatchInlineSnapshot(`
      "Heading
      =======
      "
    `);
    expect(ansi(doc, { colors: false, frontmatter: false })).toMatchInlineSnapshot(`
      "------------------------------------------------------------

      title: Hello
      ------------

      Heading
      =======
      "
    `);
  });

  test("render", () => {
    const cb = { heading: (c: string, m: { level: number }) => `[h${m.level}:${c}]` };
    expect(render(doc, cb)).toBe("[h1:Heading]");
    expect(render(doc, cb, { frontmatter: false })).toBe("[h2:title: Hello][h1:Heading]");
  });

  test("react", () => {
    const el = react(doc) as any;
    expect(el.props.children.map((c: any) => c.type)).toEqual(["h1"]);
    const off = react(doc, undefined, { frontmatter: false }) as any;
    expect(off.props.children.map((c: any) => c.type)).toEqual(["hr", "h2", "h1"]);
  });

  test("the .md import loader skips front matter", async () => {
    using dir = tempDir("md-loader-fm-", {
      "post.md": "---\ntitle: Hello\n---\n# Heading\n",
      "main.ts": `import html from "./post.md";\nconsole.log(JSON.stringify(html));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toBe("<h1>Heading</h1>\n");
    expect(exitCode).toBe(0);
  });
});
