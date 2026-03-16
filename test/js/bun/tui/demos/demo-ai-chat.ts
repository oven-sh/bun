/**
 * demo-ai-chat.ts — Claude Code-style AI Chat (Inline, No Alt Screen)
 *
 * An inline chat interface inspired by Claude Code's terminal UI. Shows a
 * conversation with streaming-style token output, tool use blocks, thinking
 * indicators, and styled markdown-like formatting — all rendered inline
 * without alt screen.
 *
 * Run: bun run test/js/bun/tui/demos/demo-ai-chat.ts
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);

const W = Math.min(writer.columns || 80, 90);

// --- Styles (reused across screens) ---
function makeStyles(screen: InstanceType<typeof Bun.TUIScreen>) {
  return {
    prompt: screen.style({ fg: 0x61afef, bold: true }),
    userText: screen.style({ fg: 0xffffff, bold: true }),
    assistantLabel: screen.style({ fg: 0xc678dd, bold: true }),
    text: screen.style({ fg: 0xdcdcdc }),
    dim: screen.style({ fg: 0x5c6370 }),
    code: screen.style({ fg: 0x98c379, bg: 0x1e2127 }),
    codeBorder: screen.style({ fg: 0x3e4451 }),
    codeLabel: screen.style({ fg: 0x5c6370, bg: 0x1e2127 }),
    toolName: screen.style({ fg: 0xe5c07b, bold: true }),
    toolBorder: screen.style({ fg: 0x3e4451 }),
    toolLabel: screen.style({ fg: 0x5c6370 }),
    thinking: screen.style({ fg: 0x5c6370, italic: true }),
    thinkDots: screen.style({ fg: 0xc678dd }),
    bold: screen.style({ fg: 0xffffff, bold: true }),
    bullet: screen.style({ fg: 0x61afef }),
    separator: screen.style({ fg: 0x2c313a }),
    cost: screen.style({ fg: 0x5c6370 }),
    duration: screen.style({ fg: 0x98c379 }),
    fileRef: screen.style({ fg: 0x61afef, underline: "single" }),
  };
}

function renderBlock(
  lines: string[],
  styles: ReturnType<typeof makeStyles>,
  drawFn: (screen: InstanceType<typeof Bun.TUIScreen>, st: typeof styles) => void,
) {
  const h = lines.length;
  const screen = new Bun.TUIScreen(W, h);
  drawFn(screen, makeStyles(screen));
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- Helper: word wrap ---
function wrap(text: string, width: number): string[] {
  const result: string[] = [];
  for (const para of text.split("\n")) {
    if (para.length === 0) {
      result.push("");
      continue;
    }
    const words = para.split(" ");
    let cur = "";
    for (const w of words) {
      if (cur.length === 0) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += " " + w;
      else {
        result.push(cur);
        cur = w;
      }
    }
    if (cur) result.push(cur);
  }
  return result;
}

// ============================================================
// Render the conversation
// ============================================================

// --- 1. User prompt ---
{
  const screen = new Bun.TUIScreen(W, 3);
  const st = makeStyles(screen);
  screen.setText(0, 0, "\u276f ", st.prompt);
  screen.setText(2, 0, "Fix the bug in src/bun.js/api/tui/screen.zig where styles overflow", st.userText);
  screen.setText(2, 1, "  after 256 unique colors and add a style cache to prevent it", st.userText);
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- 2. Thinking indicator ---
{
  const screen = new Bun.TUIScreen(W, 2);
  const st = makeStyles(screen);
  screen.setText(0, 0, "\u2728 ", st.assistantLabel);
  screen.setText(2, 0, "Claude", st.assistantLabel);
  screen.setText(0, 1, "  \u25CF\u25CB\u25CB ", st.thinkDots);
  screen.setText(6, 1, "Thinking...", st.thinking);
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- 3. Assistant response with markdown-like formatting ---
{
  const responseText = [
    "I found the issue. The Ghostty `StyleSet` is initialized with a capacity of",
    "256, but the demo creates 500+ unique styles (216-color cube + gradients).",
    "When the set is full, `styles.add()` returns an error, but `clearCells()`",
    "then tries to `release()` styles that were never properly ref-counted,",
    "hitting an assertion in the `RefCountedSet`.",
    "",
    "Here's my plan:",
    "",
    "  1. Increase style capacity from 256 to 4096",
    "  2. Add a StyleCache to deduplicate and prevent ref-count overflow",
    "  3. Fix clear() to zero cells directly instead of calling clearCells()",
    "  4. Fix resize() to re-add cached styles to the new page",
  ];

  const screen = new Bun.TUIScreen(W, responseText.length + 1);
  const st = makeStyles(screen);

  for (let i = 0; i < responseText.length; i++) {
    const line = responseText[i];
    if (line.startsWith("  ") && /^\s+\d\./.test(line)) {
      // Numbered list
      const numEnd = line.indexOf(".");
      screen.setText(0, i, line.slice(0, numEnd + 1), st.bullet);
      screen.setText(numEnd + 1, i, line.slice(numEnd + 1), st.text);
    } else if (line.includes("`")) {
      // Inline code
      let x = 0;
      let inCode = false;
      for (const part of line.split("`")) {
        screen.setText(x, i, part, inCode ? st.code : st.text);
        x += part.length;
        inCode = !inCode;
      }
    } else {
      screen.setText(0, i, line, st.text);
    }
  }
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- 4. Tool use: Read file ---
{
  const screen = new Bun.TUIScreen(W, 4);
  const st = makeStyles(screen);
  screen.setText(0, 0, "  \u250C\u2500 ", st.toolBorder);
  screen.setText(5, 0, "Read", st.toolName);
  screen.setText(10, 0, "src/bun.js/api/tui/screen.zig", st.fileRef);
  screen.setText(0, 1, "  \u2502", st.toolBorder);
  screen.setText(4, 1, " 795 lines | Zig", st.toolLabel);
  screen.setText(
    0,
    2,
    "  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    st.toolBorder,
  );
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- 5. Tool use: Edit file ---
{
  const codeLines = [
    "    const page = Page.init(.{",
    "-       .cols = cols, .rows = rows, .styles = 256",
    "+       .cols = cols, .rows = rows, .styles = 4096",
    "    }) catch {",
  ];
  const screen = new Bun.TUIScreen(W, codeLines.length + 3);
  const st = makeStyles(screen);

  screen.setText(0, 0, "  \u250C\u2500 ", st.toolBorder);
  screen.setText(5, 0, "Edit", st.toolName);
  screen.setText(10, 0, "src/bun.js/api/tui/screen.zig:118", st.fileRef);
  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i];
    screen.setText(0, i + 1, "  \u2502", st.toolBorder);
    if (line.startsWith("-")) {
      screen.setText(4, i + 1, line, screen.style({ fg: 0xe06c75, bg: 0x2a1517 }));
    } else if (line.startsWith("+")) {
      screen.setText(4, i + 1, line, screen.style({ fg: 0x98c379, bg: 0x152a17 }));
    } else {
      screen.setText(4, i + 1, line, st.code);
    }
  }
  screen.setText(
    0,
    codeLines.length + 1,
    "  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    st.toolBorder,
  );
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- 6. Tool use: Run tests ---
{
  const screen = new Bun.TUIScreen(W, 5);
  const st = makeStyles(screen);
  screen.setText(0, 0, "  \u250C\u2500 ", st.toolBorder);
  screen.setText(5, 0, "Bash", st.toolName);
  screen.setText(10, 0, "bun bd test test/js/bun/tui/screen.test.ts", st.codeLabel);
  screen.setText(0, 1, "  \u2502", st.toolBorder);
  screen.setText(4, 1, " 105 pass", screen.style({ fg: 0x98c379, bold: true }));
  screen.setText(0, 2, "  \u2502", st.toolBorder);
  screen.setText(4, 2, " 0 fail", screen.style({ fg: 0x98c379 }));
  screen.setText(0, 3, "  \u2502", st.toolBorder);
  screen.setText(4, 3, " Ran 105 tests across 1 file. [680ms]", st.toolLabel);
  screen.setText(
    0,
    4,
    "  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    st.toolBorder,
  );
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- 7. Completion summary ---
{
  const summaryLines = [
    "Fixed the style capacity overflow. Changes:",
    "",
    "  \u2022 Increased StyleSet capacity: 256 \u2192 4096 (screen.zig, renderer.zig)",
    "  \u2022 Added StyleCache hash map to prevent ref-count overflow on repeated style() calls",
    "  \u2022 clear()/clearRect() now zero cells via @memset instead of clearCells()",
    "  \u2022 resize() re-adds cached styles sorted by ID to preserve stability",
    "",
    "All 105 tests pass.",
  ];

  const screen = new Bun.TUIScreen(W, summaryLines.length + 1);
  const st = makeStyles(screen);
  for (let i = 0; i < summaryLines.length; i++) {
    const line = summaryLines[i];
    if (line.startsWith("  \u2022")) {
      screen.setText(0, i, "  \u2022", st.bullet);
      // Find the colon to bold the label
      const colonIdx = line.indexOf(":");
      if (colonIdx > 4) {
        screen.setText(4, i, line.slice(4, colonIdx + 1), st.bold);
        screen.setText(4 + colonIdx - 3, i, line.slice(colonIdx + 1), st.text);
      } else {
        screen.setText(4, i, line.slice(4), st.text);
      }
    } else {
      screen.setText(0, i, line, st.text);
    }
  }
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// --- 8. Footer with cost/duration ---
{
  const screen = new Bun.TUIScreen(W, 2);
  const st = makeStyles(screen);
  const sep = "\u2500".repeat(W);
  screen.setText(0, 0, sep, st.separator);
  screen.setText(0, 1, "Cooked for 1m 6s", st.duration);
  screen.setText(20, 1, "\u2022 3 tool uses", st.cost);
  screen.setText(36, 1, "\u2022 $0.04", st.cost);
  screen.setText(46, 1, "\u2022 4.2K tokens in, 1.8K out", st.cost);
  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

writer.close();
