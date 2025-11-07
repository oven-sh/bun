import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("markdown text-loader", () => {
  it("should import .md files as text by default", () => {
    const dir = tempDirWithFiles("md-import", {
      "prompt.md": "# Hello World\n\nThis is a markdown file.",
      "test.ts": `
        import content from "./prompt.md";
        console.log(content);
      `,
    });

    const result = spawnSync({
      cmd: [bunExe(), join(dir, "test.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    expect(result.stdout.toString().trim()).toBe("# Hello World\n\nThis is a markdown file.");
    expect(result.exitCode).toBe(0);
  });

  it("should import .md files dynamically", async () => {
    const dir = tempDirWithFiles("md-dynamic-import", {
      "llm-prompt.md": "You are a helpful AI assistant.\n\n## Instructions\n- Be concise\n- Use examples",
      "test.ts": `
        const content = await import("./llm-prompt.md");
        console.log(content.default);
      `,
    });

    const result = spawnSync({
      cmd: [bunExe(), join(dir, "test.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    expect(result.stdout.toString().trim()).toBe(
      "You are a helpful AI assistant.\n\n## Instructions\n- Be concise\n- Use examples",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should work without bunfig.toml", () => {
    const dir = tempDirWithFiles("md-no-config", {
      "content.md": "# LLM Prompt\n\nGenerate code for: {task}",
      "index.ts": `
        import prompt from "./content.md";
        console.log(typeof prompt);
        console.log(prompt.includes("LLM Prompt"));
      `,
    });

    const result = spawnSync({
      cmd: [bunExe(), join(dir, "index.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    const output = result.stdout.toString();
    expect(output).toContain("string");
    expect(output).toContain("true");
    expect(result.exitCode).toBe(0);
  });

  it("should work in monorepo without individual configs", () => {
    const dir = tempDirWithFiles("md-monorepo", {
      "packages/app1/prompt.md": "System prompt for app1",
      "packages/app1/index.ts": `
        import prompt from "./prompt.md";
        console.log("app1:", prompt);
      `,
      "packages/app2/prompt.md": "System prompt for app2",
      "packages/app2/index.ts": `
        import prompt from "./prompt.md";
        console.log("app2:", prompt);
      `,
    });

    const result1 = spawnSync({
      cmd: [bunExe(), join(dir, "packages/app1/index.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    const result2 = spawnSync({
      cmd: [bunExe(), join(dir, "packages/app2/index.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    expect(result1.stdout.toString().trim()).toBe("app1: System prompt for app1");
    expect(result1.exitCode).toBe(0);

    expect(result2.stdout.toString().trim()).toBe("app2: System prompt for app2");
    expect(result2.exitCode).toBe(0);
  });
});

