/**
 * demo-flags.ts — Renders several country flags using colored block characters.
 * Shows France, Germany, Italy, Japan, and Ukraine using full and half blocks.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 72);
const height = 22;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });
const labelStyle = screen.style({ fg: 0xabb2bf });

// Flag dimensions
const flagW = 12;
const flagH = 4;

interface Flag {
  name: string;
  render: (sx: number, sy: number) => void;
}

function fillBlock(sx: number, sy: number, w: number, h: number, color: number) {
  const s = screen.style({ fg: color, bg: color });
  screen.fill(sx, sy, w, h, "\u2588", s);
}

// Use half-block technique: top half uses fg color, bottom half uses bg with upper-half block
function halfRow(sx: number, y: number, w: number, topColor: number, bottomColor: number) {
  const s = screen.style({ fg: topColor, bg: bottomColor });
  screen.fill(sx, y, w, 1, "\u2580", s);
}

const flags: Flag[] = [
  {
    name: "France",
    render: (sx, sy) => {
      const third = Math.floor(flagW / 3);
      fillBlock(sx, sy, third, flagH, 0x002395); // Blue
      fillBlock(sx + third, sy, third, flagH, 0xffffff); // White
      fillBlock(sx + third * 2, sy, flagW - third * 2, flagH, 0xed2939); // Red
    },
  },
  {
    name: "Germany",
    render: (sx, sy) => {
      // 3 horizontal stripes - use half blocks for better resolution
      halfRow(sx, sy, flagW, 0x000000, 0x000000); // Black top
      halfRow(sx, sy + 1, flagW, 0x000000, 0xdd0000); // Black / Red
      halfRow(sx, sy + 2, flagW, 0xdd0000, 0xffcc00); // Red / Gold
      halfRow(sx, sy + 3, flagW, 0xffcc00, 0xffcc00); // Gold bottom
    },
  },
  {
    name: "Italy",
    render: (sx, sy) => {
      const third = Math.floor(flagW / 3);
      fillBlock(sx, sy, third, flagH, 0x009246); // Green
      fillBlock(sx + third, sy, third, flagH, 0xffffff); // White
      fillBlock(sx + third * 2, sy, flagW - third * 2, flagH, 0xce2b37); // Red
    },
  },
  {
    name: "Japan",
    render: (sx, sy) => {
      // White background
      fillBlock(sx, sy, flagW, flagH, 0xffffff);
      // Red circle in center (approximated with blocks)
      const cx = sx + Math.floor(flagW / 2);
      const cy = sy + Math.floor(flagH / 2);
      const redStyle = screen.style({ fg: 0xbc002d, bg: 0xbc002d });
      // Draw a rough circle
      screen.fill(cx - 1, cy - 1, 3, 1, "\u2588", redStyle);
      screen.fill(cx - 2, cy, 5, 1, "\u2588", redStyle);
      screen.fill(cx - 1, cy + 1, 3, 1, "\u2588", redStyle);
    },
  },
  {
    name: "Ukraine",
    render: (sx, sy) => {
      // Blue top half, yellow bottom half
      fillBlock(sx, sy, flagW, 2, 0x0057b7); // Blue
      fillBlock(sx, sy + 2, flagW, 2, 0xffd700); // Yellow
    },
  },
];

// Title
screen.setText(2, 0, "World Flags", titleStyle);
screen.setText(2, 1, "\u2500".repeat(width - 4), dimStyle);

// Layout: 3 flags per row
const gap = 3;
const colWidth = flagW + gap;
const flagsPerRow = 3;
let y = 3;

for (let i = 0; i < flags.length; i++) {
  const col = i % flagsPerRow;
  const row = Math.floor(i / flagsPerRow);
  const x = 2 + col * (colWidth + 2);
  const fy = y + row * (flagH + 3);

  // Label
  screen.setText(x, fy, flags[i].name, labelStyle);

  // Draw flag
  flags[i].render(x, fy + 1);
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
