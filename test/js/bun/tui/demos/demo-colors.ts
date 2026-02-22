/**
 * demo-colors.ts — Color Palette Showcase
 *
 * Displays the full range of terminal styling capabilities:
 * - All 256 indexed-style colors (via true color approximation)
 * - True color gradients (RGB ramps)
 * - All text attributes (bold, italic, underline variants, strikethrough, etc.)
 * - Box drawing styles (single, double, rounded, heavy)
 *
 * Demonstrates: style (fg, bg, bold, italic, faint, blink, inverse, invisible,
 * strikethrough, overline, underline variants, underlineColor), fill, setText,
 * drawBox, TUITerminalWriter, TUIKeyReader.
 *
 * Run: bun run test/js/bun/tui/demos/demo-colors.ts
 * Exit: Press 'q' or Ctrl+C
 */

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);
let scrollY = 0;

writer.enterAltScreen();

// --- Styles ---
const headerStyle = screen.style({ fg: 0x61afef, bold: true });
const subheaderStyle = screen.style({ fg: 0xe5c07b, bold: true });
const labelStyle = screen.style({ fg: 0xabb2bf });
const dimStyle = screen.style({ fg: 0x5c6370 });
const footerStyle = screen.style({ fg: 0x5c6370, italic: true });

// --- Standard 16-color palette (approximate RGB values) ---
const ansi16: number[] = [
  0x000000,
  0xcc0000,
  0x00cc00,
  0xcccc00,
  0x0000cc,
  0xcc00cc,
  0x00cccc,
  0xcccccc, // normal
  0x555555,
  0xff5555,
  0x55ff55,
  0xffff55,
  0x5555ff,
  0xff55ff,
  0x55ffff,
  0xffffff, // bright
];

// --- Build the "virtual canvas" content, then render the visible window ---
// We build an array of draw commands so we can scroll through them.

interface Section {
  title: string;
  height: number;
  draw: (startX: number, startY: number, width: number) => void;
}

const sections: Section[] = [];

// --- Section 1: Text Attributes ---
sections.push({
  title: "Text Attributes",
  height: 14,
  draw(x, y, _w) {
    const attrs: { label: string; opts: Record<string, any> }[] = [
      { label: "Bold", opts: { bold: true } },
      { label: "Italic", opts: { italic: true } },
      { label: "Faint (Dim)", opts: { faint: true } },
      { label: "Underline (single)", opts: { underline: "single" } },
      { label: "Underline (double)", opts: { underline: "double" } },
      { label: "Underline (curly)", opts: { underline: "curly" } },
      { label: "Underline (dotted)", opts: { underline: "dotted" } },
      { label: "Underline (dashed)", opts: { underline: "dashed" } },
      { label: "Strikethrough", opts: { strikethrough: true } },
      { label: "Overline", opts: { overline: true } },
      { label: "Inverse", opts: { inverse: true } },
      { label: "Blink", opts: { blink: true } },
      { label: "Bold + Italic + Underline", opts: { bold: true, italic: true, underline: "single" } },
    ];

    for (let i = 0; i < attrs.length; i++) {
      const { label, opts } = attrs[i];
      const sid = screen.style(opts as any);
      screen.setText(x, y + i, `  ${label.padEnd(30)}`, labelStyle);
      screen.setText(x + 32, y + i, "The quick brown fox", sid);
    }
  },
});

// --- Section 2: Underline with Color ---
sections.push({
  title: "Colored Underlines",
  height: 6,
  draw(x, y, _w) {
    const colors = [
      { label: "Red underline", color: 0xff0000 },
      { label: "Green underline", color: 0x00ff00 },
      { label: "Blue underline", color: 0x0000ff },
      { label: "Yellow curly", color: 0xffff00 },
      { label: "Magenta dashed", color: 0xff00ff },
    ];
    const ulTypes: Array<"single" | "single" | "single" | "curly" | "dashed"> = [
      "single",
      "single",
      "single",
      "curly",
      "dashed",
    ];
    for (let i = 0; i < colors.length; i++) {
      const { label, color } = colors[i];
      const sid = screen.style({
        underline: ulTypes[i],
        underlineColor: color,
        fg: 0xffffff,
      });
      screen.setText(x, y + i, `  ${label.padEnd(22)}`, labelStyle);
      screen.setText(x + 24, y + i, "Styled underline text", sid);
    }
  },
});

// --- Section 3: 16 Standard Colors ---
sections.push({
  title: "Standard 16 Colors (Foreground)",
  height: 3,
  draw(x, y, _w) {
    for (let i = 0; i < 16; i++) {
      const sid = screen.style({ fg: ansi16[i] });
      const colX = x + 2 + i * 4;
      screen.setText(colX, y, `${String(i).padStart(2)} `, labelStyle);
      screen.setText(colX, y + 1, "\u2588\u2588", sid); // full block characters
    }
  },
});

sections.push({
  title: "Standard 16 Colors (Background)",
  height: 3,
  draw(x, y, _w) {
    for (let i = 0; i < 16; i++) {
      const sid = screen.style({ bg: ansi16[i], fg: i < 8 ? 0xffffff : 0x000000 });
      const colX = x + 2 + i * 4;
      screen.setText(colX, y, `${String(i).padStart(2)} `, labelStyle);
      screen.fill(colX, y + 1, 3, 1, " ", sid);
      screen.setText(colX, y + 1, `${String(i).padStart(2)}`, sid);
    }
  },
});

// --- Section 4: 6x6x6 Color Cube (216 colors, indices 16-231) ---
sections.push({
  title: "216 Color Cube (6x6x6)",
  height: 8,
  draw(x, y, w) {
    // Display as 6 rows of 36 colors
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 36; col++) {
        const idx = row * 36 + col;
        // Convert 216-index to RGB
        const r = Math.floor(idx / 36);
        const g = Math.floor((idx % 36) / 6);
        const b = idx % 6;
        const rVal = r === 0 ? 0 : 55 + r * 40;
        const gVal = g === 0 ? 0 : 55 + g * 40;
        const bVal = b === 0 ? 0 : 55 + b * 40;
        const rgb = (rVal << 16) | (gVal << 8) | bVal;
        const sid = screen.style({ bg: rgb });
        const colX = x + 2 + col * 2;
        if (colX + 1 < x + w) {
          screen.fill(colX, y + row, 2, 1, " ", sid);
        }
      }
    }
    // Label
    screen.setText(x + 2, y + 7, "Rows: R(0-5) | Columns: G*6+B", dimStyle);
  },
});

// --- Section 5: Grayscale Ramp (24 shades, indices 232-255) ---
sections.push({
  title: "24-Step Grayscale Ramp",
  height: 3,
  draw(x, y, w) {
    for (let i = 0; i < 24; i++) {
      const v = 8 + i * 10; // 8, 18, 28, ... 238
      const rgb = (v << 16) | (v << 8) | v;
      const sid = screen.style({ bg: rgb });
      const colX = x + 2 + i * 3;
      if (colX + 2 < x + w) {
        screen.fill(colX, y, 3, 1, " ", sid);
        // Show hex value below for some
        if (i % 4 === 0) {
          const hex = v.toString(16).padStart(2, "0");
          screen.setText(colX, y + 1, hex, dimStyle);
        }
      }
    }
  },
});

// --- Section 6: True Color Gradients ---
sections.push({
  title: "True Color Gradients",
  height: 8,
  draw(x, y, w) {
    const barWidth = Math.min(64, w - 4);

    // Red gradient
    screen.setText(x + 2, y, "R:", labelStyle);
    for (let i = 0; i < barWidth; i++) {
      const v = Math.round((i / (barWidth - 1)) * 255);
      const sid = screen.style({ bg: v << 16 });
      screen.fill(x + 4 + i, y, 1, 1, " ", sid);
    }

    // Green gradient
    screen.setText(x + 2, y + 1, "G:", labelStyle);
    for (let i = 0; i < barWidth; i++) {
      const v = Math.round((i / (barWidth - 1)) * 255);
      const sid = screen.style({ bg: v << 8 });
      screen.fill(x + 4 + i, y + 1, 1, 1, " ", sid);
    }

    // Blue gradient
    screen.setText(x + 2, y + 2, "B:", labelStyle);
    for (let i = 0; i < barWidth; i++) {
      const v = Math.round((i / (barWidth - 1)) * 255);
      const sid = screen.style({ bg: v });
      screen.fill(x + 4 + i, y + 2, 1, 1, " ", sid);
    }

    // Rainbow gradient (hue sweep)
    screen.setText(x + 2, y + 4, "Rainbow:", labelStyle);
    for (let i = 0; i < barWidth; i++) {
      const hue = (i / barWidth) * 360;
      const rgb = hslToRgb(hue, 1.0, 0.5);
      const sid = screen.style({ bg: rgb });
      screen.fill(x + 4 + i, y + 4, 1, 1, " ", sid);
    }

    // Foreground rainbow text
    screen.setText(x + 2, y + 6, "Text:", labelStyle);
    const sampleText = "The quick brown fox jumps over the lazy dog";
    for (let i = 0; i < Math.min(sampleText.length, barWidth); i++) {
      const hue = (i / sampleText.length) * 360;
      const rgb = hslToRgb(hue, 1.0, 0.5);
      const sid = screen.style({ fg: rgb });
      screen.setText(x + 8 + i, y + 6, sampleText[i], sid);
    }
  },
});

// --- Section 7: Box Drawing Styles ---
sections.push({
  title: "Box Drawing Styles",
  height: 8,
  draw(x, y, w) {
    const boxStyles: Array<{ name: string; style: string }> = [
      { name: "single", style: "single" },
      { name: "double", style: "double" },
      { name: "rounded", style: "rounded" },
      { name: "heavy", style: "heavy" },
    ];
    const boxWidth = Math.min(16, Math.floor((w - 4) / boxStyles.length));

    for (let i = 0; i < boxStyles.length; i++) {
      const { name, style } = boxStyles[i];
      const bx = x + 2 + i * (boxWidth + 1);
      const borderColor = screen.style({ fg: 0x61afef });
      screen.drawBox(bx, y, boxWidth, 5, {
        style,
        styleId: borderColor,
        fill: true,
      });
      // Label inside the box
      const labelX = bx + Math.max(1, Math.floor((boxWidth - name.length) / 2));
      screen.setText(labelX, y + 2, name, labelStyle);
    }

    // Nested boxes demo
    if (w > 40) {
      const nestedX = x + 2;
      const nestedY = y + 6;
      const outerBorder = screen.style({ fg: 0xe06c75 });
      const innerBorder = screen.style({ fg: 0x98c379 });
      screen.drawBox(nestedX, nestedY, 20, 2, { style: "double", styleId: outerBorder });
      // Note: nested box needs at least 2x2 to render
    }
  },
});

// --- Section 8: Combined Styles ---
sections.push({
  title: "Combined Foreground + Background",
  height: 6,
  draw(x, y, _w) {
    const combos: Array<{ label: string; fg: number; bg: number; extra?: Record<string, any> }> = [
      { label: "White on Red", fg: 0xffffff, bg: 0xcc0000 },
      { label: "Black on Yellow", fg: 0x000000, bg: 0xcccc00 },
      { label: "Cyan on Blue", fg: 0x00ffff, bg: 0x000088 },
      { label: "Bold Green on Black", fg: 0x00ff00, bg: 0x000000, extra: { bold: true } },
      { label: "Italic White on Purple", fg: 0xffffff, bg: 0x880088, extra: { italic: true } },
    ];
    for (let i = 0; i < combos.length; i++) {
      const { label, fg, bg, extra } = combos[i];
      const sid = screen.style({ fg, bg, ...extra } as any);
      screen.setText(x + 2, y + i, `  ${label.padEnd(30)}`, labelStyle);
      screen.setText(x + 34, y + i, ` ${label} `, sid);
    }
  },
});

// --- HSL to RGB helper ---
function hslToRgb(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

// --- Calculate total virtual height ---
function totalHeight(): number {
  let h = 1; // top padding
  for (const section of sections) {
    h += 1 + section.height + 1; // header + content + spacing
  }
  return h;
}

// --- Render ---
function render() {
  screen.clear();

  // Title bar
  const titleBar = screen.style({ fg: 0x000000, bg: 0x61afef, bold: true });
  screen.fill(0, 0, cols, 1, " ", titleBar);
  const title = " Bun TUI Color Palette ";
  screen.setText(Math.max(0, Math.floor((cols - title.length) / 2)), 0, title, titleBar);

  // Scrollable content area
  const contentStartY = 1;
  const contentHeight = rows - 2; // leave room for footer
  let virtualY = 1 - scrollY; // current y position in virtual space

  for (const section of sections) {
    // Section header
    if (virtualY >= contentStartY - 1 && virtualY < contentStartY + contentHeight) {
      const drawY = virtualY;
      if (drawY >= contentStartY && drawY < contentStartY + contentHeight) {
        screen.setText(1, drawY, `\u2500\u2500 ${section.title} `, headerStyle);
        // Fill rest of line with thin rule
        const ruleStart = 5 + section.title.length;
        for (let rx = ruleStart; rx < cols - 1; rx++) {
          screen.setText(rx, drawY, "\u2500", dimStyle);
        }
      }
    }
    virtualY++;

    // Section content
    const contentDrawY = virtualY;
    if (contentDrawY + section.height > contentStartY && contentDrawY < contentStartY + contentHeight) {
      // Clip to visible area
      screen.clip(0, contentStartY, cols, contentStartY + contentHeight);
      section.draw(0, contentDrawY, cols);
      screen.unclip();
    }
    virtualY += section.height + 1; // content + spacing
  }

  // Footer
  const footerY = rows - 1;
  screen.fill(0, footerY, cols, 1, " ", dimStyle);
  const total = totalHeight();
  const scrollPct = total > contentHeight ? Math.round((scrollY / (total - contentHeight)) * 100) : 0;
  const footerText = ` Scroll: \u2191\u2193/PgUp/PgDn  |  ${scrollPct}%  |  q/Ctrl+C: Quit `;
  screen.setText(0, footerY, footerText.slice(0, cols), footerStyle);

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  const maxScroll = Math.max(0, totalHeight() - (rows - 2));

  switch (name) {
    case "up":
    case "k":
      scrollY = Math.max(0, scrollY - 1);
      break;
    case "down":
    case "j":
      scrollY = Math.min(maxScroll, scrollY + 1);
      break;
    case "pageup":
      scrollY = Math.max(0, scrollY - (rows - 3));
      break;
    case "pagedown":
      scrollY = Math.min(maxScroll, scrollY + (rows - 3));
      break;
    case "home":
      scrollY = 0;
      break;
    case "end":
      scrollY = maxScroll;
      break;
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
  reader.close();
  writer.exitAltScreen();
  writer.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// --- Initial render ---
render();
