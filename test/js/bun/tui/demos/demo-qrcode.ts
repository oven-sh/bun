/**
 * demo-qrcode.ts — A QR-code-like pattern rendered using block and space characters.
 * Generates a deterministic pattern that visually resembles a QR code.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const qrSize = 25; // 25x25 modules (standard QR version 2 size)
const width = Math.max(qrSize + 4, 40);
const height = Math.ceil(qrSize / 2) + 5; // Half-block rendering doubles vertical resolution
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });

// QR code data: true = dark module, false = light module
const grid: boolean[][] = Array.from({ length: qrSize }, () => Array(qrSize).fill(false));

// Finder patterns (7x7 squares in 3 corners)
function drawFinder(cx: number, cy: number) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      // Outer border
      if (y === 0 || y === 6 || x === 0 || x === 6) {
        grid[cy + y][cx + x] = true;
      }
      // Inner 3x3 block
      else if (y >= 2 && y <= 4 && x >= 2 && x <= 4) {
        grid[cy + y][cx + x] = true;
      }
    }
  }
}

drawFinder(0, 0); // Top-left
drawFinder(qrSize - 7, 0); // Top-right
drawFinder(0, qrSize - 7); // Bottom-left

// Timing patterns (alternating dots between finders)
for (let i = 8; i < qrSize - 8; i++) {
  grid[6][i] = i % 2 === 0;
  grid[i][6] = i % 2 === 0;
}

// Alignment pattern (5x5 at position 18,18 for version 2+)
const apx = 18,
  apy = 18;
for (let y = -2; y <= 2; y++) {
  for (let x = -2; x <= 2; x++) {
    if (Math.abs(x) === 2 || Math.abs(y) === 2 || (x === 0 && y === 0)) {
      grid[apy + y][apx + x] = true;
    }
  }
}

// Separator patterns (white border around finders)
// Already false by default

// Fill data area with pseudo-random but deterministic pattern
let seed = 12345;
function prng() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

for (let y = 0; y < qrSize; y++) {
  for (let x = 0; x < qrSize; x++) {
    // Skip finder patterns and timing
    if (x < 9 && y < 9) continue; // top-left finder + separator
    if (x >= qrSize - 8 && y < 9) continue; // top-right finder + separator
    if (x < 9 && y >= qrSize - 8) continue; // bottom-left finder + separator
    if (y === 6 || x === 6) continue; // timing patterns
    if (Math.abs(x - apx) <= 2 && Math.abs(y - apy) <= 2) continue; // alignment

    grid[y][x] = prng() > 0.5;
  }
}

// Title
screen.setText(2, 0, "QR Code Pattern", titleStyle);

// Render using half-blocks for double vertical resolution
// Upper-half block: top pixel dark, bottom pixel light = \u2580 (fg=dark)
// Lower-half block: top pixel light, bottom pixel dark = \u2584 (fg=dark)
// Full block: both dark = \u2588
// Space: both light = " "

const qrDark = 0x222222;
const qrLight = 0xffffff;
const startX = 2;
const startY = 2;

for (let row = 0; row < qrSize; row += 2) {
  for (let col = 0; col < qrSize; col++) {
    const top = grid[row][col];
    const bottom = row + 1 < qrSize ? grid[row + 1][col] : false;
    const x = startX + col;
    const y = startY + Math.floor(row / 2);

    if (top && bottom) {
      const s = screen.style({ fg: qrDark });
      screen.setText(x, y, "\u2588", s);
    } else if (top && !bottom) {
      const s = screen.style({ fg: qrDark, bg: qrLight });
      screen.setText(x, y, "\u2580", s);
    } else if (!top && bottom) {
      const s = screen.style({ fg: qrDark, bg: qrLight });
      screen.setText(x, y, "\u2584", s);
    } else {
      const s = screen.style({ fg: qrLight });
      screen.setText(x, y, " ", s);
    }
  }
}

// Caption
const captionY = startY + Math.ceil(qrSize / 2) + 1;
screen.setText(2, captionY, "Scan me! (decorative only)", dimStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
