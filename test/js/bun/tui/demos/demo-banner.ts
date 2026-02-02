/**
 * demo-banner.ts — Large ASCII art banner with rainbow gradient colors.
 * Renders "BUN" in big block letters using style() with different fg colors per column.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = writer.columns || 80;
const height = 12;
const screen = new Bun.TUIScreen(width, height);

// "BUN" in 5-row block letters (each char is 6 columns wide + 1 gap)
const letters: Record<string, string[]> = {
  B: ["█████ ", "█   █ ", "█████ ", "█   █ ", "█████ "],
  U: ["█   █ ", "█   █ ", "█   █ ", "█   █ ", "█████ "],
  N: ["█   █ ", "██  █ ", "█ █ █ ", "█  ██ ", "█   █ "],
};

const word = "BUN";
const letterWidth = 6;
const totalWidth = word.length * (letterWidth + 1);
const startX = Math.max(0, Math.floor((width - totalWidth) / 2));
const startY = 2;

// Rainbow colors for the gradient
const rainbow = [
  0xff0000, // red
  0xff4400, // orange-red
  0xff8800, // orange
  0xffcc00, // yellow-orange
  0xffff00, // yellow
  0x88ff00, // yellow-green
  0x00ff00, // green
  0x00ff88, // green-cyan
  0x00ffff, // cyan
  0x0088ff, // blue-cyan
  0x0044ff, // blue
  0x4400ff, // blue-violet
  0x8800ff, // violet
  0xcc00ff, // magenta-violet
  0xff00ff, // magenta
  0xff0088, // magenta-red
  0xff0044, // red-magenta
  0xff0000, // red again
];

// Title line
const titleStyle = screen.style({ fg: 0xffffff, bold: true, faint: true });
const titleText = "~ Bun TUI Demo: Rainbow Banner ~";
const titleX = Math.max(0, Math.floor((width - titleText.length) / 2));
screen.setText(titleX, 0, titleText, titleStyle);

// Draw the block letters with per-column rainbow colors
for (let ci = 0; ci < word.length; ci++) {
  const char = word[ci];
  const rows = letters[char];
  for (let row = 0; row < rows.length; row++) {
    const line = rows[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] === " ") continue;
      const globalCol = ci * (letterWidth + 1) + col;
      const colorIdx = Math.floor((globalCol / totalWidth) * rainbow.length) % rainbow.length;
      const s = screen.style({ fg: rainbow[colorIdx], bold: true });
      screen.setText(startX + globalCol, startY + row, line[col], s);
    }
  }
}

// Tagline
const tagline = "JavaScript runtime & toolkit";
const tagStyle = screen.style({ fg: 0xaaaaaa, italic: true });
const tagX = Math.max(0, Math.floor((width - tagline.length) / 2));
screen.setText(tagX, startY + 6, tagline, tagStyle);

// Underline decoration
const underline = "\u2500".repeat(Math.min(totalWidth, width - 2));
const ulStyle = screen.style({ fg: 0x555555 });
const ulX = Math.max(0, Math.floor((width - underline.length) / 2));
screen.setText(ulX, startY + 8, underline, ulStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
