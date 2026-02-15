import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

const fixtureDir = path.join(import.meta.dir, "fixtures", "mdx");

/** Matches the "url: http://..." line printed by the dev server. */
const URL_REGEX = /url:\s*(\S+)/;
/** The last-route marker (└──) used to wait until the full route tree is printed. */
const LAST_ROUTE_ENTRY = "\u2514\u2500\u2500";
/** Matches a single route entry like "  ├── /docs  → docs/index.mdx". */
const ROUTE_ENTRY_REGEX = /[├└]──\s+(\/\S*)\s+→\s+(\S+)/g;

const Mdx = (Bun as any).mdx as {
  compile(
    input: string | Uint8Array,
    options?: { jsxImportSource?: string; hardSoftBreaks?: boolean; hard_soft_breaks?: boolean },
  ): string;
};

describe("Bun.mdx.compile", () => {
  test("compiles markdown to JSX module", () => {
    const output = Mdx.compile("# Hello\n\nWorld");
    expect(output).toContain("export default function MDXContent");
    expect(output).toContain("_components.h1");
    expect(output).toContain("Hello");
  });

  test("supports frontmatter and top-level statements", () => {
    const output = Mdx.compile(
      ["---", "title: Demo", "---", 'import { X } from "./x"', "export const year = 2026", "", "# Heading"].join("\n"),
    );
    expect(output).toContain('import { X } from "./x"');
    expect(output).toContain("export const year = 2026");
    expect(output).toContain('export const frontmatter = {"title": "Demo"}');
  });

  test("preserves inline expressions", () => {
    const output = Mdx.compile("Count: {props.count}");
    expect(output).toContain("{props.count}");
  });

  test("typed array input accepted", () => {
    const buf = new TextEncoder().encode("# Hello\n\nTypedArray");
    const output = Mdx.compile(buf);
    expect(output).toContain("export default function MDXContent");
    expect(output).toContain("Hello");
    expect(output).toContain("TypedArray");
  });

  test("jsxImportSource and option aliases hardSoftBreaks and hard_soft_breaks", () => {
    const src = "# Hi\n\nLine2";
    const outReact = Mdx.compile(src, { jsxImportSource: "react" });
    expect(outReact).not.toContain("@jsxImportSource react");

    const outPreact = Mdx.compile(src, { jsxImportSource: "preact" });
    expect(outPreact).toContain("@jsxImportSource preact");

    const baseline = Mdx.compile("a\nb");
    const outHardCamel = Mdx.compile("a\nb", { hardSoftBreaks: true });
    const outHardSnake = Mdx.compile("a\nb", { hard_soft_breaks: true });
    expect(outHardCamel).toBe(outHardSnake);
    expect(outHardCamel).not.toBe(baseline);
  });

  test("invalid arguments throw", () => {
    expect(() => Mdx.compile(undefined as any)).toThrow("Expected a string or buffer to compile");
    expect(() => Mdx.compile(null as any)).toThrow("Expected a string or buffer to compile");
    expect(() => Mdx.compile("ok", { jsxImportSource: 123 as any })).toThrow("jsxImportSource must be a string");
  });

  test("malformed mdx throws syntax-like error", () => {
    expect(() => Mdx.compile("---\n\n{unclosed")).toThrow(/compile error|syntax|unexpected|parse/i);
  });

  test("compiles real fixture documents", () => {
    const expectByFile: Record<string, string[]> = {
      "frontmatter-and-exports.mdx": ["export const frontmatter", 'export const version = "1.0.0"'],
      "components-and-expressions.mdx": ["Box", "Button"],
      "gfm-mixed-content.mdx": ["_components.table", "_components.code"],
      "nested-structure.mdx": ["_components.blockquote", "_components.ol"],
    };
    const files = fs.readdirSync(fixtureDir).filter(f => f.endsWith(".mdx") && !f.startsWith("invalid-"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const fullPath = path.join(fixtureDir, file);
      const src = fs.readFileSync(fullPath, "utf8");
      const output = Mdx.compile(src);
      expect(output).toContain("export default function MDXContent");
      const expectations = expectByFile[file];
      expect(expectations).toBeDefined();
      for (const substr of expectations!) expect(output).toContain(substr);
    }
  });
});

describe("MDX loader integration", () => {
  test("imports mdx from tsx entrypoint", async () => {
    using dir = tempDir("mdx-loader", {
      "entry.tsx": `
        import Post, { frontmatter } from "./post.mdx";
        console.log(typeof Post);
        console.log(frontmatter.title);
      `,
      "post.mdx": `
---
title: Integration
---

# Hello from MDX
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.tsx"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("function\nIntegration");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("import/export heavy mdx entrypoint runtime test", async () => {
    using dir = tempDir("mdx-heavy", {
      "entry.tsx": `
        import Page, { frontmatter, meta } from "./page.mdx";
        console.log(typeof Page);
        console.log(frontmatter.title);
        console.log(meta.version);
      `,
      "page.mdx": `
---
title: Heavy
---
import { Box } from "./Box";
export const meta = { version: "2.0" };

# {frontmatter.title}
<Box />
      `,
      "Box.tsx": "export function Box() { return <div>Box</div>; }",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.tsx"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("function\nHeavy\n2.0");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("malformed mdx import reports compile failure", async () => {
    using dir = tempDir("mdx-bad", {
      "entry.tsx": 'import Bad from "./bad.mdx"; console.log(Bad);',
      "bad.mdx": "---\n---\n\n{unclosed expression",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.tsx"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/Failed to compile MDX|MDX compile error/);
  });
});

describe("MDX transpiler integration", () => {
  test("Bun.Transpiler with loader mdx transformSync", () => {
    const transpiler = new Bun.Transpiler({ loader: "mdx" });
    const result = transpiler.transformSync("# Hello MDX");
    expect(result).toContain("export default function MDXContent");
    expect(result).toContain("Hello");
  });
});

async function readUntil(proc: Bun.Subprocess, predicate: (text: string) => boolean) {
  const stdout = proc.stdout;
  if (!stdout || typeof stdout === "number") {
    throw new Error("Expected subprocess stdout to be piped");
  }
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      output += decoder.decode(result.value, { stream: true });
      if (predicate(output)) {
        return output;
      }
    }
    output += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return output;
}

describe("MDX direct serve mode", () => {
  test("bun file.mdx serves HTML shell", async () => {
    using dir = tempDir("mdx-serve", {
      "index.mdx": `# Hello`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mdx", "--port=0"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => URL_REGEX.test(text));
    const urlMatch = output.match(URL_REGEX);
    expect(urlMatch).not.toBeNull();

    const response = await fetch(urlMatch![1]);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<div id="root"></div>`);
    expect(html).toContain(`<script type="module"`);
  });

  test("bun ./*.mdx prints mapped routes", async () => {
    using dir = tempDir("mdx-routes", {
      "index.mdx": `# Home`,
      "docs/index.mdx": `# Docs`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "./*.mdx", "./docs/*.mdx", "--port=0"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => text.includes(LAST_ROUTE_ENTRY));
    expect(output).toContain("/docs");
  });

  test("route matrix index/docs/guides", async () => {
    using dir = tempDir("mdx-matrix", {
      "index.mdx": `# Home`,
      "docs/index.mdx": `# Docs`,
      "docs/guides/index.mdx": `# Guides`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "./*.mdx", "./docs/*.mdx", "./docs/guides/*.mdx", "--port=0"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => URL_REGEX.test(text));
    const urlMatch = output.match(URL_REGEX);
    expect(urlMatch).not.toBeNull();
    const baseUrl = urlMatch![1];

    const homeRes = await fetch(baseUrl);
    expect(homeRes.status).toBe(200);
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain(`<div id="root"></div>`);
    expect(homeHtml).toContain(`<script type="module"`);

    const docsRes = await fetch(baseUrl + "/docs");
    expect(docsRes.status).toBe(200);
    const docsHtml = await docsRes.text();
    expect(docsHtml).toContain(`<div id="root"></div>`);
    expect(docsHtml).toContain(`<script type="module"`);

    const guidesRes = await fetch(baseUrl + "/docs/guides");
    expect(guidesRes.status).toBe(200);
    const guidesHtml = await guidesRes.text();
    expect(guidesHtml).toContain(`<div id="root"></div>`);
    expect(guidesHtml).toContain(`<script type="module"`);
  });

  test("overlapping glob dedupe check", async () => {
    using dir = tempDir("mdx-dedupe", {
      "index.mdx": `# Root`,
      "docs/index.mdx": `# Docs`,
      "docs/guide.mdx": `# Guide`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "./**/*.mdx", "./docs/*.mdx", "--port=0"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => text.includes(LAST_ROUTE_ENTRY));
    const routes = [...output.matchAll(ROUTE_ENTRY_REGEX)].map(m => m[1]);
    const docsIndexCount = routes.filter(r => r === "/docs").length;
    const docsGuideCount = routes.filter(r => r === "/docs/guide").length;
    expect(docsIndexCount).toBe(1);
    expect(docsGuideCount).toBe(1);
  });

  test("--hostname=127.0.0.1 reachable URL", async () => {
    using dir = tempDir("mdx-host", {
      "index.mdx": `# Hello`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mdx", "--port=0", "--hostname=127.0.0.1"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => URL_REGEX.test(text));
    const urlMatch = output.match(URL_REGEX);
    expect(urlMatch).not.toBeNull();
    expect(urlMatch![1]).toContain("127.0.0.1");

    const res = await fetch(urlMatch![1]);
    expect(res.status).toBe(200);
  });
});
