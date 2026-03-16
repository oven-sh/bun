/**
 * demo-canvas.ts — Pixel Canvas with Half-Block Rendering
 *
 * A drawing canvas that uses Unicode half-block characters (▀▄█) to achieve
 * double vertical resolution — each terminal cell represents 2 pixels.
 * Includes shape tools, a color picker, and undo support.
 *
 * Demonstrates: half-block pixel rendering, fg+bg color combination per cell,
 * efficient cell updates, style interning for pixel colors, setText, fill,
 * style (fg/bg), drawBox, TUITerminalWriter, TUIKeyReader, alt screen, resize.
 *
 * Run: bun run test/js/bun/tui/demos/demo-canvas.ts
 * Controls: Arrow keys to move cursor, Space to plot pixel, 1-8 select color,
 *           F fill area, C clear, U undo, Q quit
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0xe5c07b, bold: true }),
  border: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  label: screen.style({ fg: 0xabb2bf }),
  value: screen.style({ fg: 0xe5c07b, bold: true }),
  cursor: screen.style({ fg: 0xffffff, bold: true }),
  dim: screen.style({ fg: 0x5c6370 }),
  swatch: screen.style({ fg: 0xe5c07b, bold: true }),
};

// --- Palette ---
const palette = [
  0x000000, // Black
  0xff5555, // Red
  0x55ff55, // Green
  0x5555ff, // Blue
  0xffff55, // Yellow
  0xff55ff, // Magenta
  0x55ffff, // Cyan
  0xffffff, // White
];

const paletteNames = ["Black", "Red", "Green", "Blue", "Yellow", "Magenta", "Cyan", "White"];

// --- Canvas state ---
const HEADER_H = 1;
const SIDEBAR_W = 16;
const FOOTER_H = 1;

function canvasCellW() {
  return Math.max(4, cols - SIDEBAR_W - 2);
}
function canvasCellH() {
  return Math.max(3, rows - HEADER_H - FOOTER_H - 2);
}
// Pixel dimensions (2x vertical resolution via half-blocks)
function canvasPixW() {
  return canvasCellW();
}
function canvasPixH() {
  return canvasCellH() * 2;
}

// Pixel buffer: 0 = transparent, 1-8 = palette index
let pixels: number[][] = [];
let cursorX = 0;
let cursorY = 0;
let selectedColor = 2; // Green
let undoStack: { x: number; y: number; oldColor: number }[][] = [];
let currentStroke: { x: number; y: number; oldColor: number }[] = [];

function initPixels() {
  const w = canvasPixW();
  const h = canvasPixH();
  pixels = [];
  for (let y = 0; y < h; y++) {
    pixels.push(new Array(w).fill(0));
  }
  cursorX = Math.min(cursorX, w - 1);
  cursorY = Math.min(cursorY, h - 1);
}

function getPixel(x: number, y: number): number {
  if (y < 0 || y >= pixels.length || x < 0 || x >= (pixels[0]?.length ?? 0)) return 0;
  return pixels[y][x];
}

function setPixel(x: number, y: number, color: number) {
  if (y < 0 || y >= pixels.length || x < 0 || x >= (pixels[0]?.length ?? 0)) return;
  const old = pixels[y][x];
  if (old !== color) {
    currentStroke.push({ x, y, oldColor: old });
    pixels[y][x] = color;
  }
}

function commitStroke() {
  if (currentStroke.length > 0) {
    undoStack.push(currentStroke);
    if (undoStack.length > 100) undoStack.shift();
    currentStroke = [];
  }
}

function undo() {
  const stroke = undoStack.pop();
  if (!stroke) return;
  for (const { x, y, oldColor } of stroke) {
    if (y >= 0 && y < pixels.length && x >= 0 && x < pixels[0].length) {
      pixels[y][x] = oldColor;
    }
  }
}

// Draw a built-in pattern
function drawPattern() {
  const w = canvasPixW();
  const h = canvasPixH();
  // Draw a simple Bun logo-ish shape
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const r = Math.min(Math.floor(w / 4), Math.floor(h / 4));
  // Circle
  for (let angle = 0; angle < 360; angle += 2) {
    const rad = (angle * Math.PI) / 180;
    const px = Math.round(cx + r * Math.cos(rad));
    const py = Math.round(cy + r * Math.sin(rad));
    setPixel(px, py, 5); // Yellow
  }
  // Fill center with a pattern
  for (let dy = -r + 2; dy < r - 2; dy++) {
    for (let dx = -r + 2; dx < r - 2; dx++) {
      if (dx * dx + dy * dy < (r - 2) * (r - 2)) {
        const px = cx + dx;
        const py = cy + dy;
        if ((px + py) % 3 === 0) setPixel(px, py, 3); // Green
      }
    }
  }
  // Eyes
  setPixel(cx - 3, cy - 2, 1); // Black eye
  setPixel(cx + 3, cy - 2, 1);
  // Smile
  for (let dx = -2; dx <= 2; dx++) {
    setPixel(cx + dx, cy + 3, 1);
  }
  commitStroke();
}

// --- Render ---
function render() {
  screen.clear();

  const cellW = canvasCellW();
  const cellH = canvasCellH();
  const ox = 1; // canvas offset X
  const oy = HEADER_H + 1; // canvas offset Y

  // Title bar
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Pixel Canvas ", st.titleBar);

  // Border around canvas
  screen.drawBox(ox - 1, oy - 1, cellW + 2, cellH + 2, { style: "rounded", styleId: st.border });

  // Render pixels using half-block characters
  // Each cell row represents 2 pixel rows: top pixel = fg, bottom pixel = bg
  for (let cy = 0; cy < cellH; cy++) {
    const py0 = cy * 2; // top pixel row
    const py1 = cy * 2 + 1; // bottom pixel row

    for (let cx = 0; cx < cellW; cx++) {
      const top = getPixel(cx, py0);
      const bot = getPixel(cx, py1);

      if (top === 0 && bot === 0) {
        // Both transparent — skip (already cleared)
        continue;
      }

      let ch: string;
      let fg: number;
      let bg: number;

      if (top !== 0 && bot !== 0) {
        // Both pixels set: use upper half block, fg=top color, bg=bottom color
        ch = "\u2580"; // ▀
        fg = palette[top - 1] ?? 0xffffff;
        bg = palette[bot - 1] ?? 0xffffff;
      } else if (top !== 0) {
        // Only top pixel: use upper half block with fg=top, bg=transparent(black)
        ch = "\u2580"; // ▀
        fg = palette[top - 1] ?? 0xffffff;
        bg = 0x1a1a1a;
      } else {
        // Only bottom pixel: use lower half block with fg=bottom
        ch = "\u2584"; // ▄
        fg = palette[bot - 1] ?? 0xffffff;
        bg = 0x1a1a1a;
      }

      const sid = screen.style({ fg, bg });
      screen.setText(ox + cx, oy + cy, ch, sid);
    }
  }

  // Draw cursor
  const cursorCellX = cursorX;
  const cursorCellY = Math.floor(cursorY / 2);
  const isTopHalf = cursorY % 2 === 0;
  if (cursorCellX >= 0 && cursorCellX < cellW && cursorCellY >= 0 && cursorCellY < cellH) {
    // Use a crosshair indicator
    const cursorChar = isTopHalf ? "\u2580" : "\u2584"; // ▀ or ▄
    const curColor = palette[selectedColor - 1] ?? 0xffffff;
    screen.setText(ox + cursorCellX, oy + cursorCellY, cursorChar, screen.style({ fg: curColor, bg: 0x333333 }));
  }

  // --- Sidebar ---
  const sx = ox + cellW + 2;
  if (sx + SIDEBAR_W <= cols) {
    let sy = oy;

    screen.setText(sx, sy, "Cursor", st.label);
    sy++;
    screen.setText(sx, sy, `(${cursorX}, ${cursorY})`, st.value);
    sy += 2;

    screen.setText(sx, sy, "Color", st.label);
    sy++;
    // Color palette
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const isActive = i + 1 === selectedColor;
      const indicator = isActive ? "\u25b6" : " ";
      const indStyle = isActive ? st.swatch : st.dim;
      screen.setText(sx, sy, indicator, indStyle);
      screen.fill(sx + 2, sy, 2, 1, " ", screen.style({ bg: c }));
      const label = `${i + 1}:${paletteNames[i]}`;
      screen.setText(sx + 5, sy, label.slice(0, SIDEBAR_W - 6), isActive ? st.value : st.dim);
      sy++;
    }

    sy++;
    screen.setText(sx, sy, "Canvas", st.label);
    sy++;
    screen.setText(sx, sy, `${canvasPixW()}x${canvasPixH()}px`, st.value);
    sy++;
    const pixCount = pixels.flat().filter(p => p !== 0).length;
    screen.setText(sx, sy, `${pixCount} pixels`, st.dim);
    sy++;
    screen.setText(sx, sy, `${undoStack.length} undos`, st.dim);
  }

  // Footer
  const footerText = " Arrows:Move Space:Draw 1-8:Color F:Fill C:Clear U:Undo D:Demo q:Quit ";
  screen.setText(0, rows - 1, footerText.slice(0, cols), st.footer);

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  const pw = canvasPixW();
  const ph = canvasPixH();

  switch (name) {
    case "up":
    case "k":
      cursorY = Math.max(0, cursorY - 1);
      break;
    case "down":
    case "j":
      cursorY = Math.min(ph - 1, cursorY + 1);
      break;
    case "left":
    case "h":
      cursorX = Math.max(0, cursorX - 1);
      break;
    case "right":
    case "l":
      cursorX = Math.min(pw - 1, cursorX + 1);
      break;
    case " ":
      setPixel(cursorX, cursorY, selectedColor);
      commitStroke();
      break;
    case "x":
      // Erase pixel
      setPixel(cursorX, cursorY, 0);
      commitStroke();
      break;
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
      selectedColor = parseInt(name);
      break;
    case "f":
      // Fill entire canvas with selected color
      for (let py = 0; py < ph; py++) {
        for (let px = 0; px < pw; px++) {
          setPixel(px, py, selectedColor);
        }
      }
      commitStroke();
      break;
    case "c":
      // Clear canvas
      for (let py = 0; py < ph; py++) {
        for (let px = 0; px < pw; px++) {
          setPixel(px, py, 0);
        }
      }
      commitStroke();
      break;
    case "u":
      undo();
      break;
    case "d":
      drawPattern();
      break;
  }

  render();
};

// --- Resize ---
writer.onresize = (newCols: number, newRows: number) => {
  cols = newCols;
  rows = newRows;
  screen.resize(cols, rows);
  initPixels();
  render();
};

// --- Cleanup ---
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  reader.close();
  writer.exitAltScreen();
  writer.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// --- Start ---
initPixels();
render();
