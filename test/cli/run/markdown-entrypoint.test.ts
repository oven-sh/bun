import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runMd(source: string, env: Record<string, string> = {}) {
  using dir = tempDir("md-entry-", { "doc.md": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./doc.md"],
    env: { ...bunEnv, FORCE_COLOR: "1", TERM: "xterm-256color", ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

describe("bun <file.md>", () => {
  test("renders headings with underlines", async () => {
    expect(
      await runMd(
        [
          "# Heading 1",
          "",
          "## Heading 2",
          "",
          "### Heading 3",
          "",
          "body",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders bold, italic, strikethrough, inline code", async () => {
    expect(
      await runMd(
        "**bold** *italic* ~~strike~~ `code` regular\n",
      ),
    ).toMatchSnapshot();
  });

  test("renders ordered, unordered, and task lists", async () => {
    expect(
      await runMd(
        [
          "1. first",
          "2. second",
          "3. third",
          "",
          "- apple",
          "- banana",
          "- cherry",
          "",
          "- [ ] todo",
          "- [x] done",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders blockquotes and nested blockquotes", async () => {
    expect(
      await runMd(
        [
          "> A quote",
          ">",
          "> > Nested quote",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders horizontal rules", async () => {
    expect(
      await runMd(
        [
          "above",
          "",
          "---",
          "",
          "below",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders fenced code block with JS syntax highlighting", async () => {
    expect(
      await runMd(
        [
          "```js",
          'const name = "world";',
          "console.log(`hello ${name}`);",
          "```",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders fenced code block without language", async () => {
    expect(
      await runMd(
        [
          "```",
          "plain text",
          "no highlighting",
          "```",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders hyperlinks with OSC 8 escape sequence", async () => {
    expect(
      await runMd(
        "Visit [Bun](https://bun.com) today.\n",
      ),
    ).toMatchSnapshot();
  });

  test("renders hyperlinks without OSC 8 when no TTY", async () => {
    // The spawned process doesn't have a TTY on stdout so hyperlinks fall
    // back to "text (url)" format. This is the default for runMd().
    expect(
      await runMd(
        "see [Bun](https://bun.com)\n",
      ),
    ).toMatchSnapshot();
  });

  test("renders images as alt text with link", async () => {
    expect(
      await runMd(
        "![an image](https://bun.com/logo.png)\n",
      ),
    ).toMatchSnapshot();
  });

  test("renders wikilinks", async () => {
    expect(
      await runMd(
        "see [[SomePage]] for more\n",
      ),
    ).toMatchSnapshot();
  });

  test("renders simple table with alignment", async () => {
    expect(
      await runMd(
        [
          "| Name  | Age | City |",
          "|:------|:---:|-----:|",
          "| Alice |  30 |  NYC |",
          "| Bob   |  25 |   LA |",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders table with CJK multi-width graphemes", async () => {
    expect(
      await runMd(
        [
          "| 名前   | 言語       | 都市       |",
          "|:-------|:----------:|-----------:|",
          "| 山田   | 日本語     | 東京       |",
          "| Alice  | English    | NYC        |",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders table with emoji graphemes", async () => {
    expect(
      await runMd(
        [
          "| Status | Label  |",
          "|:------:|:-------|",
          "| ✅     | pass   |",
          "| ❌     | fail   |",
          "| 🚀     | launch |",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders combining characters without breaking alignment", async () => {
    expect(
      await runMd(
        [
          "| Name   | Note |",
          "|:-------|:-----|",
          "| café   | hot  |",
          "| naïve  | ok   |",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders mixed inline styles with autolinks", async () => {
    expect(
      await runMd(
        "Check **https://bun.com** and <me@example.com>!\n",
      ),
    ).toMatchSnapshot();
  });

  test("renders nested lists", async () => {
    expect(
      await runMd(
        [
          "- outer",
          "  - inner 1",
          "  - inner 2",
          "    - deep",
          "- second outer",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("runs without colors when NO_COLOR is set", async () => {
    using dir = tempDir("md-no-color-", {
      "doc.md": "# Hello\n\n**world**\n",
    });
    const env = { ...bunEnv, NO_COLOR: "1" };
    // FORCE_COLOR set to anything (even "") forces colors on, so drop it.
    delete env.FORCE_COLOR;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "./doc.md"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    // No escape characters expected
    expect(stdout).not.toContain("\x1b[");
    expect(stdout).toMatchSnapshot();
  });

  test("renders via `bun run ./file.md`", async () => {
    using dir = tempDir("md-run-", { "doc.md": "# Title\n\nbody\n" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "./doc.md"],
      env: { ...bunEnv, FORCE_COLOR: "1", TERM: "xterm-256color" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  test("renders .markdown extension too", async () => {
    using dir = tempDir("md-ext-", { "doc.markdown": "# yep\n" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "./doc.markdown"],
      env: { ...bunEnv, FORCE_COLOR: "1", TERM: "xterm-256color" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });
});
