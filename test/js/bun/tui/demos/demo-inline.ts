/**
 * demo-inline.ts — Inline TUI Rendering (No Alt Screen)
 *
 * Renders styled content directly into the terminal's scrollback buffer
 * without entering alt screen mode. Useful for CLI tools that want to
 * output rich formatted content (tables, trees, status bars) inline.
 *
 * Demonstrates: rendering without alt screen, multiple sequential renders
 * to the same region, writer.clear() to reset diff state, small fixed-size
 * screens, setText, fill, style, drawBox, TUITerminalWriter, TUIScreen.
 *
 * Run: bun run test/js/bun/tui/demos/demo-inline.ts
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);

// --- Inline render: small screens rendered directly into scrollback ---

// 1. Styled banner
{
  const screen = new Bun.TUIScreen(60, 3);
  const bannerBg = screen.style({ fg: 0x000000, bg: 0x61afef, bold: true });
  screen.fill(0, 0, 60, 3, " ", bannerBg);
  screen.setText(4, 1, "\u26A1 Bun TUI — Inline Rendering Demo \u26A1", bannerBg);
  writer.render(screen);
  writer.clear();
  // Print a blank line after
  writer.write("\r\n");
}

// 2. Dependency tree
{
  const w = 50;
  const screen = new Bun.TUIScreen(w, 10);
  const header = screen.style({ fg: 0x61afef, bold: true });
  const pkg = screen.style({ fg: 0x98c379 });
  const ver = screen.style({ fg: 0xe5c07b });
  const tree = screen.style({ fg: 0x5c6370 });

  screen.setText(0, 0, "Dependencies:", header);
  screen.setText(0, 1, "\u251C\u2500\u2500 ", tree);
  screen.setText(4, 1, "typescript", pkg);
  screen.setText(15, 1, "^5.7.2", ver);
  screen.setText(0, 2, "\u251C\u2500\u2500 ", tree);
  screen.setText(4, 2, "esbuild", pkg);
  screen.setText(15, 2, "^0.24.0", ver);
  screen.setText(0, 3, "\u251C\u2500\u2500 ", tree);
  screen.setText(4, 3, "@types/node", pkg);
  screen.setText(15, 3, "^22.10.0", ver);
  screen.setText(0, 4, "\u2502   \u2514\u2500\u2500 ", tree);
  screen.setText(8, 4, "undici-types", pkg);
  screen.setText(21, 4, "~6.20.0", ver);
  screen.setText(0, 5, "\u251C\u2500\u2500 ", tree);
  screen.setText(4, 5, "prettier", pkg);
  screen.setText(15, 5, "^3.4.2", ver);
  screen.setText(0, 6, "\u2514\u2500\u2500 ", tree);
  screen.setText(4, 6, "vitest", pkg);
  screen.setText(15, 6, "^2.1.8", ver);
  screen.setText(0, 8, "5 dependencies, 1 nested", screen.style({ fg: 0x5c6370, italic: true }));

  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// 3. Inline table
{
  const w = 65;
  const screen = new Bun.TUIScreen(w, 8);
  const headerBg = screen.style({ fg: 0x000000, bg: 0x3e4451, bold: true });
  const row = screen.style({ fg: 0xabb2bf });
  const rowAlt = screen.style({ fg: 0xabb2bf, bg: 0x21252b });
  const num = screen.style({ fg: 0xe5c07b });
  const numAlt = screen.style({ fg: 0xe5c07b, bg: 0x21252b });
  const pass = screen.style({ fg: 0x98c379, bold: true });
  const fail = screen.style({ fg: 0xe06c75, bold: true });
  const border = screen.style({ fg: 0x5c6370 });

  screen.drawBox(0, 0, w, 8, { style: "rounded", styleId: border });
  screen.setText(2, 0, " Test Results ", screen.style({ fg: 0x61afef, bold: true }));

  // Header
  screen.fill(1, 1, w - 2, 1, " ", headerBg);
  screen.setText(2, 1, "Suite", headerBg);
  screen.setText(22, 1, "Tests", headerBg);
  screen.setText(32, 1, "Pass", headerBg);
  screen.setText(42, 1, "Fail", headerBg);
  screen.setText(52, 1, "Time", headerBg);

  // Rows
  const data = [
    ["screen.test.ts", "105", "105", "0", "680ms"],
    ["writer.test.ts", "83", "83", "0", "643ms"],
    ["key-reader.test.ts", "28", "28", "0", "12.3s"],
    ["e2e.test.ts", "27", "27", "0", "1.16s"],
    ["bench.test.ts", "14", "14", "0", "657ms"],
  ];

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const y = 2 + i;
    const isAlt = i % 2 === 1;
    const rs = isAlt ? rowAlt : row;
    const ns = isAlt ? numAlt : num;
    if (isAlt) screen.fill(1, y, w - 2, 1, " ", rowAlt);
    screen.setText(2, y, d[0], rs);
    screen.setText(22, y, d[1], ns);
    screen.setText(32, y, d[2], pass);
    screen.setText(42, y, d[3], parseInt(d[3]) > 0 ? fail : pass);
    screen.setText(52, y, d[4], rs);
  }

  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// 4. Status bars / progress
{
  const w = 60;
  const screen = new Bun.TUIScreen(w, 4);
  const label = screen.style({ fg: 0xabb2bf });
  const barFill = screen.style({ bg: 0x98c379 });
  const barEmpty = screen.style({ bg: 0x2c313a });
  const pct = screen.style({ fg: 0x98c379, bold: true });
  const done = screen.style({ fg: 0x98c379, bold: true });

  screen.setText(0, 0, "Build:", label);
  screen.fill(8, 0, 40, 1, " ", barFill);
  screen.setText(49, 0, "100%", pct);
  screen.setText(54, 0, "\u2713", done);

  screen.setText(0, 1, "Tests:", label);
  screen.fill(8, 1, 34, 1, " ", barFill);
  screen.fill(42, 1, 6, 1, " ", barEmpty);
  screen.setText(49, 1, " 85%", screen.style({ fg: 0xe5c07b, bold: true }));

  screen.setText(0, 2, "Lint:", label);
  screen.fill(8, 2, 20, 1, " ", barFill);
  screen.fill(28, 2, 20, 1, " ", barEmpty);
  screen.setText(49, 2, " 50%", screen.style({ fg: 0xe5c07b }));

  screen.setText(0, 3, "\u2714 Build complete  \u25cf 257 tests  \u26A0 3 warnings", screen.style({ fg: 0x5c6370 }));

  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// 5. Colored text art
{
  const screen = new Bun.TUIScreen(40, 5);
  const colors = [0xff5555, 0xff8800, 0xffff55, 0x55ff55, 0x55ffff, 0x5555ff, 0xff55ff];
  const text = "Bun TUI";
  const artLines = [
    " ____                _____  _   _  ___  ",
    "| __ ) _   _ _ __   |_   _|| | | ||_ _| ",
    "|  _ \\| | | | '_ \\    | |  | | | | | |  ",
    "| |_) | |_| | | | |   | |  | |_| | | |  ",
    "|____/ \\__,_|_| |_|   |_|   \\___/ |___|  ",
  ];

  for (let y = 0; y < artLines.length; y++) {
    const line = artLines[y];
    for (let x = 0; x < line.length && x < 40; x++) {
      const colorIdx = Math.floor((x / 40) * colors.length);
      const color = colors[colorIdx % colors.length];
      screen.setText(x, y, line[x], screen.style({ fg: color, bold: true }));
    }
  }

  writer.render(screen);
  writer.clear();
  writer.write("\r\n");
}

// Clean up
writer.close();
