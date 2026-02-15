import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const Mdx = (Bun as any).mdx as { compile(input: string): string };

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
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("function\nIntegration");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

const running: Bun.Subprocess[] = [];
afterEach(() => {
  for (const proc of running.splice(0)) {
    proc.kill();
  }
});

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
    running.push(proc);

    const output = await readUntil(proc, text => text.includes("url: "));
    const urlMatch = output.match(/url:\s*(\S+)/);
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
    running.push(proc);

    const output = await readUntil(proc, text => text.includes("Routes:"));
    expect(output).toContain("/docs");
  });
});
