import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

const fixtureDir = path.join(import.meta.dir, "fixtures", "mdx");
const repoRoot = path.resolve(import.meta.dir, "../../../..");
const repoNodeModules = path.join(repoRoot, "node_modules");

function linkNodeModules(dir: string) {
  fs.symlinkSync(repoNodeModules, path.join(dir, "node_modules"), "junction");
}

function extractFrontmatterObjectLiteral(compiled: string): string {
  const prefix = "export const frontmatter = ";
  const start = compiled.indexOf(prefix);
  if (start === -1) {
    throw new Error("frontmatter export not found in compiled output");
  }

  const objectStart = start + prefix.length;
  if (compiled[objectStart] !== "{") {
    throw new Error("frontmatter export does not start with an object literal");
  }

  let depth = 0;
  for (let i = objectStart; i < compiled.length; i++) {
    const ch = compiled[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return compiled.slice(objectStart, i + 1);
      }
    }
  }

  throw new Error("frontmatter object literal was not closed");
}

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

  test("preserves expressions with closing brace in template/string literals", () => {
    const templateExpr = "Value: {`has } brace`}";
    const templateOut = Mdx.compile(templateExpr);
    expect(templateOut).toContain("{`has } brace`}");

    const singleQuotedExpr = "Value: {'has } brace'}";
    const singleQuotedOut = Mdx.compile(singleQuotedExpr);
    expect(singleQuotedOut).toContain("{'has } brace'}");
  });

  test("skips braces inside line comments", () => {
    const src = "Result: {value\n// ignore }\n+ 1}";
    const output = Mdx.compile(src);
    expect(output).toContain("{value\n// ignore }\n+ 1}");
    // Regression guard: if brace counting closes early, trailing text gets rendered as markdown.
    expect(output).not.toContain("<p>+ 1}</p>");
  });

  test("skips braces inside block comments", () => {
    const src = "Result: {value /* } */ + rest}";
    const output = Mdx.compile(src);
    expect(output).toContain("{value /* } */ + rest}");
    expect(output).not.toContain("<p>+ rest}</p>");
  });

  test("skips braces inside double-quoted strings", () => {
    const src = 'Value: {"has } brace"}';
    const output = Mdx.compile(src);
    expect(output).toContain('{"has } brace"}');
  });

  test("handles template literals with ${...} containing braces", () => {
    const src = "Value: {`${obj.a}`}";
    const output = Mdx.compile(src);
    expect(output).toContain("{`${obj.a}`}");

    const nested = "Value: {`${fn({a:1})}`}";
    const nestedOut = Mdx.compile(nested);
    expect(nestedOut).toContain("{`${fn({a:1})}`}");
  });

  test("handles nested template literals", () => {
    const src = "Value: {`outer ${`inner ${x}`}`}";
    const output = Mdx.compile(src);
    expect(output).toContain("{`outer ${`inner ${x}`}`}");
  });

  test("handles escaped quotes inside strings within expressions", () => {
    const src = "Value: {'it\\'s } here'}";
    const output = Mdx.compile(src);
    expect(output).toContain("{'it\\'s } here'}");
    expect(output).not.toContain("<p>here'}</p>");
  });

  test("handles comments inside template expression interpolations", () => {
    const src = "Value: {`${value /* } */}`}";
    const output = Mdx.compile(src);
    expect(output).toContain("{`${value /* } */}`}");
  });

  test("supports multiline top-level import statements", () => {
    const src = ["import {", "  Box,", "  Button,", '} from "./ui";', "", "# Heading"].join("\n");

    const output = Mdx.compile(src);

    expect(output).toContain('import {\n  Box,\n  Button,\n} from "./ui";');
    expect(output).toContain("export default function MDXContent");
    expect(output).not.toContain("<p>Box,</p>");
    expect(output).not.toContain("<p>} from &quot;./ui&quot;;</p>");
  });

  test("supports multiline top-level export statements with trailing comments", () => {
    const src = ["export const label =", '  "hello" + // keep concatenating', '  " world";', "", "# Heading"].join(
      "\n",
    );

    const output = Mdx.compile(src);

    expect(output).toContain('export const label =\n  "hello" + // keep concatenating\n  " world";');
    expect(output).toContain("export default function MDXContent");
    expect(output).not.toContain("<p>&quot; world&quot;;</p>");
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
  });

  test("jsxImportSource accepts undefined, null, empty string, and coerces numbers", () => {
    const src = "# Hi";
    const outDefault = Mdx.compile(src);
    expect(outDefault).toContain("export default function MDXContent");

    const outUndefined = Mdx.compile(src, { jsxImportSource: undefined });
    expect(outUndefined).toContain("export default function MDXContent");
    expect(outUndefined).not.toContain("@jsxImportSource");

    const outNull = Mdx.compile(src, { jsxImportSource: null as any });
    expect(outNull).toContain("export default function MDXContent");
    expect(outNull).not.toContain("@jsxImportSource");

    const outEmpty = Mdx.compile(src, { jsxImportSource: "" });
    expect(outEmpty).toContain("export default function MDXContent");
    expect(outEmpty).not.toContain("@jsxImportSource");

    const outNumber = Mdx.compile(src, { jsxImportSource: 42 as any });
    expect(outNumber).toContain("export default function MDXContent");
    expect(outNumber).toContain("@jsxImportSource 42");
  });

  test("jsxImportSource rejects Symbol values", () => {
    expect(() => Mdx.compile("# Hi", { jsxImportSource: Symbol("x") as any })).toThrow(/jsxImportSource|string/i);
  });

  test("frontmatter supports arrays, booleans, numbers, and nested objects", () => {
    const src = [
      "---",
      "tags: [alpha, beta, gamma]",
      "draft: true",
      "version: 3",
      "author:",
      "  name: Alice",
      "  url: https://example.com",
      "---",
      "",
      "# Content",
    ].join("\n");

    const output = Mdx.compile(src);
    const frontmatter = JSON.parse(extractFrontmatterObjectLiteral(output));
    expect(frontmatter).toEqual({
      tags: ["alpha", "beta", "gamma"],
      draft: true,
      version: 3,
      author: {
        name: "Alice",
        url: "https://example.com",
      },
    });
  });

  test("complex fixture compiles with deep frontmatter and no placeholder leakage", () => {
    const src = fs.readFileSync(path.join(fixtureDir, "complex-frontmatter.mdx"), "utf8");
    const output = Mdx.compile(src);
    const frontmatter = JSON.parse(extractFrontmatterObjectLiteral(output));

    expect(frontmatter.title).toBe("Complex Frontmatter + MDX Parse Torture Test");
    expect(frontmatter.flags).toEqual({
      parserStrict: true,
      allowExperimental: false,
    });
    expect(frontmatter.metadata.owners).toEqual([
      {
        name: "Parser Bot",
        email: "parser.bot@snyder.tech",
        roles: ["maintainer", "reviewer"],
      },
      {
        name: "Fixture Curator",
        email: "fixture.curator@snyder.tech",
        roles: ["author", "qa"],
      },
    ]);
    expect(frontmatter.matrix).toEqual({
      dimensions: { rows: 3, cols: 3 },
      values: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    });
    expect(frontmatter.nullableField).toBeNull();
    expect(frontmatter["key:with:colons"]).toBe("still valid");

    expect(output).toContain("export const parserMatrix =");
    expect(output).toContain("export const numericSequence =");
    expect(output).toContain("export default function MDXContent");
    expect(output).toContain("Enabled checks:");
    expect(output).not.toContain("MDXE");
  });

  test("malformed mdx throws syntax-like error", () => {
    expect(() => Mdx.compile("---\n\n{unclosed")).toThrow(/compile error|syntax|unexpected|parse/i);
  });

  test("compiles real fixture documents", () => {
    const expectByFile: Record<string, string[]> = {
      "complex-frontmatter.mdx": ["export const parserMatrix =", "export const numericSequence =", "_components.table"],
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
    const staleKeys = Object.keys(expectByFile).filter(k => !files.includes(k));
    expect(staleKeys).toEqual([]);
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
    linkNodeModules(String(dir));

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
    linkNodeModules(String(dir));

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

  test("complex fixture runtime SSR contains evaluated content and no placeholders", async () => {
    const fixture = fs.readFileSync(path.join(fixtureDir, "complex-frontmatter.mdx"), "utf8");
    using dir = tempDir("mdx-complex-runtime", {
      "entry.tsx": `
        import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import Page, { frontmatter } from "./page.mdx";

        const html = renderToStaticMarkup(React.createElement(Page));
        console.log(frontmatter.title);
        console.log("HAS_SUMMARY:" + html.includes("3/3 checks enabled"));
        console.log("HAS_ENABLED:" + html.includes("Enabled checks: fm-title, jsx-inline, code-fence"));
        console.log("HAS_MDXE:" + html.includes("MDXE"));
      `,
      "page.mdx": fixture,
    });
    linkNodeModules(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.tsx"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("Complex Frontmatter + MDX Parse Torture Test");
    expect(stdout).toContain("HAS_SUMMARY:true");
    expect(stdout).toContain("HAS_ENABLED:true");
    expect(stdout).toContain("HAS_MDXE:false");
    expect(stdout).not.toContain("\x01MDXE");
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
    expect(stderr).toMatch(/Failed to compile MDX:\s*[A-Za-z_]\w*/);
    expect(exitCode).not.toBe(0);
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

const READ_UNTIL_TIMEOUT_MS = 30_000;

async function readUntil(
  proc: Bun.Subprocess,
  predicate: (text: string) => boolean,
  timeoutMs = READ_UNTIL_TIMEOUT_MS,
) {
  const stdout = proc.stdout;
  if (!stdout || typeof stdout === "number") {
    throw new Error("Expected subprocess stdout to be piped");
  }
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      (async () => {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          output += decoder.decode(chunk.value, { stream: true });
          if (predicate(output)) {
            return output;
          }
        }
        output += decoder.decode();
        return undefined;
      })(),
      new Promise<"timeout">(
        resolve =>
          (timeoutId = setTimeout(() => {
            resolve("timeout");
          }, timeoutMs)),
      ),
    ]);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (result === "timeout") {
      reader.cancel().catch(() => {});
      throw new Error(`readUntil: timed out after ${timeoutMs}ms.\nAccumulated output:\n${output}`);
    }
    if (result === undefined) {
      throw new Error(`readUntil: stream ended without predicate match.\nAccumulated output:\n${output}`);
    }
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    reader.releaseLock();
  }
}

describe("test helpers", () => {
  test("readUntil throws on timeout", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "setTimeout(() => {}, 60000)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await expect(readUntil(proc, () => false, 500)).rejects.toThrow(/timed out/i);
  });

  test("readUntil resolves before timeout", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('ready')"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => text.includes("ready"), 5_000);
    expect(output).toContain("ready");
  });
});

describe("MDX direct serve mode", () => {
  test("bun file.mdx serves HTML shell", async () => {
    using dir = tempDir("mdx-serve", {
      "index.mdx": `# Hello`,
    });
    linkNodeModules(String(dir));

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
    linkNodeModules(String(dir));

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
    linkNodeModules(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "./*.mdx", "./docs/*.mdx", "./docs/guides/*.mdx", "--port=0"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => URL_REGEX.test(text) && text.includes(LAST_ROUTE_ENTRY));
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
    linkNodeModules(String(dir));

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

  test("title with special characters is HTML-escaped", async () => {
    using dir = tempDir("mdx-escape", {
      "a&b.mdx": `# Ampersand test`,
    });
    linkNodeModules(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "a&b.mdx", "--port=0"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => URL_REGEX.test(text));
    const urlMatch = output.match(URL_REGEX);
    expect(urlMatch).not.toBeNull();

    const res = await fetch(urlMatch![1]);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>a&amp;b</title>");
    expect(html).not.toContain("<title>a&b</title>");
  });

  test("--hostname=127.0.0.1 reachable URL", async () => {
    using dir = tempDir("mdx-host", {
      "index.mdx": `# Hello`,
    });
    linkNodeModules(String(dir));

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

  test("complex fixture direct serve bundle has no unresolved placeholders", async () => {
    const fixture = fs.readFileSync(path.join(fixtureDir, "complex-frontmatter.mdx"), "utf8");
    using dir = tempDir("mdx-complex-serve", {
      "index.mdx": fixture,
    });
    linkNodeModules(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mdx", "--port=0"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await readUntil(proc, text => URL_REGEX.test(text));
    expect(output).not.toContain("MDXE");
    const urlMatch = output.match(URL_REGEX);
    expect(urlMatch).not.toBeNull();
    const baseUrl = urlMatch![1];

    const pageRes = await fetch(baseUrl);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).not.toContain("MDXE");

    const scriptMatch = html.match(/<script type="module"[^>]*src="([^"]+)"/);
    expect(scriptMatch).not.toBeNull();
    const scriptUrl = new URL(scriptMatch![1], baseUrl).toString();

    const scriptRes = await fetch(scriptUrl);
    expect(scriptRes.status).toBe(200);
    const js = await scriptRes.text();
    expect(js).toContain("Enabled checks:");
    expect(js).not.toContain("MDXE");
  });
});
