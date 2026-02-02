/**
 * demo-split.ts — Split Pane Layout
 *
 * Demonstrates a composable split-pane layout with multiple independent
 * panels: a sidebar navigation, a main content area, and a bottom status/log
 * panel. Each pane has its own scroll state and focus behavior.
 *
 * Demonstrates: clipping (clip/unclip), copy between screens, multi-pane
 * layouts, independent scroll states, focus tracking, drawBox, setText, fill,
 * style, TUITerminalWriter, TUIKeyReader, alt screen, resize.
 *
 * Run: bun run test/js/bun/tui/demos/demo-split.ts
 * Controls: Tab switch pane, j/k scroll active pane, Enter select, Q quit
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  borderFocused: screen.style({ fg: 0x61afef, bold: true }),
  borderUnfocused: screen.style({ fg: 0x3e4451 }),
  panelTitle: screen.style({ fg: 0x61afef, bold: true }),
  panelTitleFocused: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  item: screen.style({ fg: 0xabb2bf }),
  itemSelected: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  itemActive: screen.style({ fg: 0x98c379, bold: true }),
  header: screen.style({ fg: 0xc678dd, bold: true }),
  text: screen.style({ fg: 0xabb2bf }),
  code: screen.style({ fg: 0x98c379, bg: 0x21252b }),
  dim: screen.style({ fg: 0x5c6370 }),
  logInfo: screen.style({ fg: 0x61afef }),
  logWarn: screen.style({ fg: 0xe5c07b }),
  logError: screen.style({ fg: 0xe06c75 }),
  logTime: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  focusIndicator: screen.style({ fg: 0xe5c07b, bold: true }),
};

// --- Content data ---
interface NavItem {
  name: string;
  icon: string;
  content: string[];
}

const navItems: NavItem[] = [
  {
    name: "Getting Started",
    icon: "\u{1F680}",
    content: [
      "Getting Started with Bun TUI",
      "",
      "The Bun TUI library provides low-level primitives for",
      "building terminal user interfaces. It uses Ghostty's",
      "cell grid internally for efficient rendering.",
      "",
      "Quick Start:",
      "",
      "  const screen = new Bun.TUIScreen(80, 24);",
      "  const writer = new Bun.TUITerminalWriter(Bun.stdout);",
      "  const reader = new Bun.TUIKeyReader();",
      "",
      "  screen.setText(0, 0, 'Hello, World!');",
      "  writer.render(screen);",
      "",
      "The screen is a grid of cells, each with a codepoint",
      "and a style ID. Styles are interned for efficiency.",
    ],
  },
  {
    name: "Screen API",
    icon: "\u{1F4FA}",
    content: [
      "TuiScreen API Reference",
      "",
      "Constructor:",
      "  new Bun.TUIScreen(cols, rows)",
      "",
      "Methods:",
      "  setText(x, y, text, styleId?)",
      "  fill(x, y, w, h, char, styleId?)",
      "  clear()",
      "  clearRect(x, y, w, h)",
      "  resize(cols, rows)",
      "  copy(src, sx, sy, dx, dy, w, h)",
      "  style({ fg, bg, bold, ... })",
      "  drawBox(x, y, w, h, options?)",
      "  clip(x1, y1, x2, y2)",
      "  unclip()",
      "  getCell(x, y)",
      "  hyperlink(url)",
      "  setHyperlink(x, y, id)",
      "",
      "Properties:",
      "  width  - column count",
      "  height - row count",
    ],
  },
  {
    name: "Writer API",
    icon: "\u{270D}",
    content: [
      "TuiTerminalWriter API Reference",
      "",
      "Constructor:",
      "  new Bun.TUITerminalWriter(Bun.stdout)",
      "",
      "Methods:",
      "  render(screen, options?)",
      "  clear()",
      "  close() / end()",
      "  enterAltScreen() / exitAltScreen()",
      "  enableMouseTracking()",
      "  disableMouseTracking()",
      "  enableFocusTracking()",
      "  disableFocusTracking()",
      "  enableBracketedPaste()",
      "  disableBracketedPaste()",
      "  write(string)",
      "",
      "Properties:",
      "  columns / rows - terminal dimensions",
      "  onresize - resize callback",
      "",
      "The writer does cell-level diffing between frames,",
      "only emitting ANSI for changed cells.",
    ],
  },
  {
    name: "Key Reader",
    icon: "\u{2328}",
    content: [
      "TuiKeyReader API Reference",
      "",
      "Constructor:",
      "  new Bun.TUIKeyReader()",
      "",
      "Callbacks:",
      "  onkeypress = (event) => { ... }",
      "    event: { name, sequence, ctrl, shift, alt }",
      "",
      "  onmouse = (event) => { ... }",
      "    event: { type, button, x, y, shift, alt, ctrl }",
      "    types: down, up, drag, move, scrollUp, scrollDown",
      "",
      "  onpaste = (text) => { ... }",
      "  onfocus = () => { ... }",
      "  onblur = () => { ... }",
      "",
      "Methods:",
      "  close() - restore terminal, stop reading",
    ],
  },
  {
    name: "Styling",
    icon: "\u{1F3A8}",
    content: [
      "Style System",
      "",
      "Styles are interned objects with numeric IDs:",
      "",
      "  const id = screen.style({",
      "    fg: 0xff0000,        // RGB foreground",
      "    bg: 0x000088,        // RGB background",
      "    bold: true,",
      "    italic: true,",
      "    underline: 'curly',  // single|double|curly|dotted|dashed",
      "    underlineColor: 0xffff00,",
      "    strikethrough: true,",
      "    overline: true,",
      "    faint: true,",
      "    blink: true,",
      "    inverse: true,",
      "  });",
      "",
      "Style 0 is always the default (no styling).",
      "Up to 4096 unique styles per screen.",
      "",
      "Colors can be specified as:",
      "  - Number: 0xff0000",
      "  - Hex string: '#ff0000'",
      "  - Object: { r: 255, g: 0, b: 0 }",
      "  - Palette: { palette: 196 }",
    ],
  },
];

// --- Log entries ---
interface LogMsg {
  time: string;
  level: "info" | "warn" | "error";
  text: string;
}

const logMessages: LogMsg[] = [
  { time: "12:00:01", level: "info", text: "Application started" },
  { time: "12:00:01", level: "info", text: "TUI screen initialized (80x24)" },
  { time: "12:00:02", level: "info", text: "Key reader started in raw mode" },
  { time: "12:00:03", level: "info", text: "Alt screen entered" },
  { time: "12:00:05", level: "warn", text: "Terminal does not support true color, falling back" },
  { time: "12:00:10", level: "info", text: "First render completed in 2ms" },
  { time: "12:00:15", level: "info", text: "Diff render: 0 changed cells" },
  { time: "12:00:20", level: "error", text: "Style capacity warning: 3800/4096 used" },
  { time: "12:00:25", level: "info", text: "Resize detected: 120x45" },
  { time: "12:00:30", level: "info", text: "Styles migrated after resize: 42 styles" },
];

// --- State ---
let focusedPane = 0; // 0=sidebar, 1=content, 2=logs
let sidebarSelected = 0;
let sidebarScroll = 0;
let contentScroll = 0;
let logScroll = 0;

// --- Layout ---
function sidebarW() {
  return Math.min(28, Math.floor(cols * 0.25));
}
function contentW() {
  return cols - sidebarW();
}
function contentH() {
  return rows - 1 - logPanelH();
} // -1 for title
function logPanelH() {
  return Math.max(4, Math.floor(rows * 0.25));
}

// --- Render ---
function render() {
  screen.clear();

  const sw = sidebarW();
  const cw = contentW();
  const ch = contentH();
  const lh = logPanelH();

  // Title bar
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Split Pane Demo ", st.titleBar);
  const paneNames = ["Sidebar", "Content", "Logs"];
  screen.setText(cols - paneNames[focusedPane].length - 12, 0, `Focus: ${paneNames[focusedPane]}`, st.titleBar);

  // --- Sidebar ---
  const sbBorder = focusedPane === 0 ? st.borderFocused : st.borderUnfocused;
  const sbTitle = focusedPane === 0 ? st.panelTitleFocused : st.panelTitle;
  screen.drawBox(0, 1, sw, ch, { style: "rounded", styleId: sbBorder });
  screen.setText(2, 1, " Navigation ", sbTitle);

  screen.clip(1, 2, sw - 1, ch);
  const sbVisH = ch - 2;
  if (sidebarSelected < sidebarScroll) sidebarScroll = sidebarSelected;
  if (sidebarSelected >= sidebarScroll + sbVisH) sidebarScroll = sidebarSelected - sbVisH + 1;

  for (let i = 0; i < sbVisH; i++) {
    const idx = sidebarScroll + i;
    if (idx >= navItems.length) break;
    const item = navItems[idx];
    const y = 2 + i;
    const isSel = idx === sidebarSelected;

    if (isSel) {
      screen.fill(1, y, sw - 2, 1, " ", st.itemSelected);
      screen.setText(2, y, `${item.icon} ${item.name}`, st.itemSelected);
    } else {
      screen.setText(2, y, `${item.icon} ${item.name}`, st.item);
    }
  }
  screen.unclip();

  // --- Content pane ---
  const cx = sw;
  const cBorder = focusedPane === 1 ? st.borderFocused : st.borderUnfocused;
  const cTitle = focusedPane === 1 ? st.panelTitleFocused : st.panelTitle;
  screen.drawBox(cx, 1, cw, ch, { style: "rounded", styleId: cBorder });
  screen.setText(cx + 2, 1, ` ${navItems[sidebarSelected].name} `, cTitle);

  screen.clip(cx + 1, 2, cx + cw - 1, ch);
  const content = navItems[sidebarSelected].content;
  const contentVisH = ch - 2;
  if (contentScroll > Math.max(0, content.length - contentVisH)) {
    contentScroll = Math.max(0, content.length - contentVisH);
  }

  for (let i = 0; i < contentVisH; i++) {
    const lineIdx = contentScroll + i;
    if (lineIdx >= content.length) break;
    const line = content[lineIdx];
    const y = 2 + i;

    if (lineIdx === 0) {
      screen.setText(cx + 2, y, line.slice(0, cw - 4), st.header);
    } else if (line.startsWith("  ")) {
      screen.setText(cx + 2, y, line.slice(0, cw - 4), st.code);
    } else {
      screen.setText(cx + 2, y, line.slice(0, cw - 4), st.text);
    }
  }

  // Scroll indicator
  if (content.length > contentVisH) {
    const pct = Math.round((contentScroll / Math.max(1, content.length - contentVisH)) * 100);
    screen.setText(cx + cw - 6, 1, ` ${pct}% `, st.dim);
  }
  screen.unclip();

  // --- Log panel ---
  const ly = 1 + ch;
  const lBorder = focusedPane === 2 ? st.borderFocused : st.borderUnfocused;
  const lTitle = focusedPane === 2 ? st.panelTitleFocused : st.panelTitle;
  screen.drawBox(0, ly, cols, lh, { style: "rounded", styleId: lBorder });
  screen.setText(2, ly, " Output ", lTitle);

  screen.clip(1, ly + 1, cols - 1, ly + lh - 1);
  const logVisH = lh - 2;
  const maxLogScroll = Math.max(0, logMessages.length - logVisH);
  if (logScroll > maxLogScroll) logScroll = maxLogScroll;

  for (let i = 0; i < logVisH; i++) {
    const idx = logScroll + i;
    if (idx >= logMessages.length) break;
    const msg = logMessages[idx];
    const y = ly + 1 + i;

    screen.setText(1, y, msg.time, st.logTime);
    const lvlStyle = msg.level === "error" ? st.logError : msg.level === "warn" ? st.logWarn : st.logInfo;
    screen.setText(11, y, `[${msg.level.toUpperCase().padEnd(5)}]`, lvlStyle);
    screen.setText(19, y, msg.text.slice(0, cols - 21), st.text);
  }
  screen.unclip();

  // Focus indicators (dots next to focused pane)
  const focusY = [Math.floor(ch / 2) + 1, Math.floor(ch / 2) + 1, ly + Math.floor(lh / 2)];
  const focusX = [0, cx, 0];
  screen.setText(focusX[focusedPane], focusY[focusedPane], "\u25b6", st.focusIndicator);

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  switch (name) {
    case "tab":
      focusedPane = (focusedPane + 1) % 3;
      break;
    case "up":
    case "k":
      if (focusedPane === 0) {
        if (sidebarSelected > 0) sidebarSelected--;
        contentScroll = 0; // reset content scroll on nav change
      } else if (focusedPane === 1) {
        contentScroll = Math.max(0, contentScroll - 1);
      } else {
        logScroll = Math.max(0, logScroll - 1);
      }
      break;
    case "down":
    case "j":
      if (focusedPane === 0) {
        if (sidebarSelected < navItems.length - 1) sidebarSelected++;
        contentScroll = 0;
      } else if (focusedPane === 1) {
        contentScroll++;
      } else {
        logScroll++;
      }
      break;
    case "pageup":
      if (focusedPane === 1) contentScroll = Math.max(0, contentScroll - 10);
      else if (focusedPane === 2) logScroll = Math.max(0, logScroll - 5);
      break;
    case "pagedown":
      if (focusedPane === 1) contentScroll += 10;
      else if (focusedPane === 2) logScroll += 5;
      break;
    case "enter":
      if (focusedPane === 0) {
        focusedPane = 1; // switch to content pane
        contentScroll = 0;
      }
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

// --- Start ---
render();
