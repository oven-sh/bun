/**
 * demo-mouse.ts — Mouse Interaction Demo
 *
 * Enables mouse tracking and allows the user to:
 * - Click to place colored markers on the screen
 * - Click and drag to draw lines
 * - See live mouse coordinates
 * - Scroll to cycle through marker colors
 * - Right-click to erase markers
 *
 * Demonstrates: enableMouseTracking, disableMouseTracking, onmouse,
 * TUIKeyReader, TUITerminalWriter, style (fg/bg), fill, setText,
 * drawBox, alt screen, and cursor options.
 *
 * Run: bun run test/js/bun/tui/demos/demo-mouse.ts
 * Exit: Press 'q' or Ctrl+C
 */

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();
writer.enableMouseTracking();

// --- State ---

// Canvas stores placed markers: key is "x,y", value is color index
const canvas = new Map<string, number>();

// Current mouse position
let mouseX = 0;
let mouseY = 0;

// Is the mouse button currently held down (for drag drawing)?
let isDragging = false;

// Color palette for markers
const markerColors = [
  0xff5555, // red
  0xff8800, // orange
  0xffff55, // yellow
  0x55ff55, // green
  0x55ffff, // cyan
  0x5555ff, // blue
  0xff55ff, // magenta
  0xffffff, // white
];
let colorIndex = 0;

// Event log (most recent events shown in the info panel)
const eventLog: string[] = [];
function logEvent(msg: string) {
  eventLog.push(msg);
  if (eventLog.length > 100) eventLog.shift();
}

// --- Styles ---
const titleStyle = screen.style({ fg: 0x000000, bg: 0x61afef, bold: true });
const infoLabel = screen.style({ fg: 0xabb2bf });
const infoValue = screen.style({ fg: 0xe5c07b });
const coordsStyle = screen.style({ fg: 0x98c379, bold: true });
const borderStyle = screen.style({ fg: 0x5c6370 });
const footerStyle = screen.style({ fg: 0x5c6370, italic: true });
const logStyle = screen.style({ fg: 0x5c6370 });
const canvasBg = screen.style({ bg: 0x1e2127 });
const crosshairH = screen.style({ fg: 0x3e4451 });
const crosshairV = screen.style({ fg: 0x3e4451 });

// --- Layout ---
const HEADER_HEIGHT = 1;
const SIDEBAR_WIDTH = 28;
const FOOTER_HEIGHT = 1;

function canvasLeft() {
  return 0;
}
function canvasTop() {
  return HEADER_HEIGHT;
}
function canvasWidth() {
  return Math.max(1, cols - SIDEBAR_WIDTH);
}
function canvasHeight() {
  return Math.max(1, rows - HEADER_HEIGHT - FOOTER_HEIGHT);
}

// --- Drawing helpers ---

/** Place a marker on the canvas at the given position. */
function placeMarker(x: number, y: number) {
  const cx = x - canvasLeft();
  const cy = y - canvasTop();
  if (cx >= 0 && cx < canvasWidth() && cy >= 0 && cy < canvasHeight()) {
    canvas.set(`${cx},${cy}`, colorIndex);
  }
}

/** Erase a marker from the canvas. */
function eraseMarker(x: number, y: number) {
  const cx = x - canvasLeft();
  const cy = y - canvasTop();
  canvas.delete(`${cx},${cy}`);
}

/** Draw a line between two points using Bresenham's algorithm. */
function drawLine(x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let cx = x0;
  let cy = y0;

  while (true) {
    placeMarker(cx, cy);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

// Track last drag position for continuous line drawing
let lastDragX = -1;
let lastDragY = -1;

// --- Render ---
function render() {
  screen.clear();

  // Title bar
  screen.fill(0, 0, cols, HEADER_HEIGHT, " ", titleStyle);
  const title = " Mouse Demo - Click to Draw ";
  screen.setText(Math.max(0, Math.floor((cols - title.length) / 2)), 0, title, titleStyle);

  // Canvas area background
  const cw = canvasWidth();
  const ch = canvasHeight();
  const cl = canvasLeft();
  const ct = canvasTop();
  screen.fill(cl, ct, cw, ch, " ", canvasBg);

  // Draw crosshairs at mouse position
  const relMx = mouseX - cl;
  const relMy = mouseY - ct;
  if (relMx >= 0 && relMx < cw && relMy >= 0 && relMy < ch) {
    // Horizontal crosshair
    for (let x = 0; x < cw; x++) {
      if (x !== relMx) {
        screen.setText(cl + x, mouseY, "\u00b7", crosshairH); // middle dot
      }
    }
    // Vertical crosshair
    for (let y = 0; y < ch; y++) {
      if (y !== relMy) {
        screen.setText(mouseX, ct + y, "\u00b7", crosshairV); // middle dot
      }
    }
  }

  // Draw all markers
  for (const [key, ci] of canvas) {
    const [cx, cy] = key.split(",").map(Number);
    if (cx < cw && cy < ch) {
      const color = markerColors[ci % markerColors.length];
      const sid = screen.style({ fg: color, bold: true });
      screen.setText(cl + cx, ct + cy, "\u2588", sid); // full block
    }
  }

  // --- Sidebar ---
  const sx = cols - SIDEBAR_WIDTH;
  screen.drawBox(sx, ct, SIDEBAR_WIDTH, ch, {
    style: "rounded",
    styleId: borderStyle,
    fill: true,
  });
  screen.setText(sx + 2, ct, " Info ", screen.style({ fg: 0x61afef, bold: true }));

  let sy = ct + 1;

  // Mouse coordinates
  screen.setText(sx + 2, sy, "Position:", infoLabel);
  screen.setText(sx + 12, sy, `(${mouseX}, ${mouseY})`, coordsStyle);
  sy++;

  // Canvas-relative coordinates
  screen.setText(sx + 2, sy, "Canvas:", infoLabel);
  screen.setText(sx + 12, sy, `(${relMx}, ${relMy})`, infoValue);
  sy++;

  // Dragging state
  screen.setText(sx + 2, sy, "Dragging:", infoLabel);
  screen.setText(sx + 12, sy, isDragging ? "Yes" : "No", infoValue);
  sy++;

  // Marker count
  screen.setText(sx + 2, sy, "Markers:", infoLabel);
  screen.setText(sx + 12, sy, `${canvas.size}`, infoValue);
  sy += 2;

  // Current color
  screen.setText(sx + 2, sy, "Color:", infoLabel);
  const currentColor = markerColors[colorIndex];
  const colorSwatch = screen.style({ bg: currentColor });
  screen.fill(sx + 9, sy, 3, 1, " ", colorSwatch);
  const hexStr = `#${currentColor.toString(16).padStart(6, "0")}`;
  screen.setText(sx + 13, sy, hexStr, infoValue);
  sy += 2;

  // Color palette
  screen.setText(sx + 2, sy, "Palette (scroll):", infoLabel);
  sy++;
  for (let i = 0; i < markerColors.length; i++) {
    const c = markerColors[i];
    const sw = screen.style({ bg: c });
    const indicator = i === colorIndex ? "\u25b6" : " ";
    const indStyle = i === colorIndex ? screen.style({ fg: 0xe5c07b, bold: true }) : infoLabel;
    screen.setText(sx + 2, sy + i, indicator, indStyle);
    screen.fill(sx + 4, sy + i, 2, 1, " ", sw);
    const hex = `#${c.toString(16).padStart(6, "0")}`;
    screen.setText(sx + 7, sy + i, hex, i === colorIndex ? infoValue : infoLabel);
  }
  sy += markerColors.length + 1;

  // Recent events
  if (sy + 2 < ct + ch - 1) {
    screen.setText(sx + 2, sy, "Events:", infoLabel);
    sy++;
    const maxEvents = Math.min(eventLog.length, ct + ch - 1 - sy);
    const startIdx = Math.max(0, eventLog.length - maxEvents);
    for (let i = startIdx; i < eventLog.length; i++) {
      if (sy >= ct + ch - 1) break;
      const msg = eventLog[i].slice(0, SIDEBAR_WIDTH - 4);
      screen.setText(sx + 2, sy, msg, logStyle);
      sy++;
    }
  }

  // Footer
  const footerY = rows - 1;
  const footerText = " Click: Draw | Drag: Line | Right-click: Erase | Scroll: Color | c: Clear | q: Quit ";
  screen.setText(0, footerY, footerText.slice(0, cols), footerStyle);

  writer.render(screen, { cursorVisible: false });
}

// --- Mouse event handling ---
reader.onmouse = (event: {
  type: string;
  button: number;
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}) => {
  mouseX = event.x;
  mouseY = event.y;

  switch (event.type) {
    case "down":
      if (event.button === 0) {
        // Left click
        isDragging = true;
        lastDragX = mouseX;
        lastDragY = mouseY;
        placeMarker(mouseX, mouseY);
        logEvent(`click (${mouseX},${mouseY})`);
      } else if (event.button === 2) {
        // Right click - erase
        eraseMarker(mouseX, mouseY);
        logEvent(`erase (${mouseX},${mouseY})`);
      }
      break;

    case "up":
      if (isDragging) {
        isDragging = false;
        lastDragX = -1;
        lastDragY = -1;
        logEvent(`release (${mouseX},${mouseY})`);
      }
      break;

    case "drag":
      if (isDragging) {
        if (lastDragX >= 0 && lastDragY >= 0) {
          drawLine(lastDragX, lastDragY, mouseX, mouseY);
        }
        lastDragX = mouseX;
        lastDragY = mouseY;
      }
      break;

    case "move":
      // Just update coordinates
      break;

    case "scrollUp":
      colorIndex = (colorIndex - 1 + markerColors.length) % markerColors.length;
      logEvent(`color: ${colorIndex}`);
      break;

    case "scrollDown":
      colorIndex = (colorIndex + 1) % markerColors.length;
      logEvent(`color: ${colorIndex}`);
      break;
  }

  render();
};

// --- Keyboard ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  if (name === "c" && !ctrl) {
    // Clear canvas
    canvas.clear();
    logEvent("canvas cleared");
  }

  // Number keys 1-8 to select color directly
  const num = parseInt(name);
  if (num >= 1 && num <= markerColors.length) {
    colorIndex = num - 1;
    logEvent(`color: ${colorIndex}`);
  }

  render();
};

// --- Resize ---
writer.onresize = (newCols: number, newRows: number) => {
  cols = newCols;
  rows = newRows;
  screen.resize(cols, rows);
  render();
};

// --- Cleanup ---
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  writer.disableMouseTracking();
  reader.close();
  writer.exitAltScreen();
  writer.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// --- Initial render ---
render();
