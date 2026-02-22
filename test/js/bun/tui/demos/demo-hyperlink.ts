/**
 * demo-hyperlink.ts — Terminal Hyperlinks & Unicode Showcase
 *
 * Demonstrates OSC 8 terminal hyperlinks (clickable URLs), CJK wide characters,
 * emoji with ZWJ sequences, combining marks, and the full Unicode handling
 * powered by Ghostty's grapheme clustering.
 *
 * Demonstrates: hyperlink(url), setHyperlink(x, y, id), setText with CJK/emoji,
 * style (fg/bg/bold/italic/underline), drawBox, TUITerminalWriter, TUIKeyReader,
 * alt screen, resize handling.
 *
 * Run: bun run test/js/bun/tui/demos/demo-hyperlink.ts
 * Controls: j/k scroll, Tab switch section, Q quit
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0x56b6c2, bold: true }),
  header: screen.style({ fg: 0x61afef, bold: true }),
  subheader: screen.style({ fg: 0xe5c07b, bold: true }),
  text: screen.style({ fg: 0xabb2bf }),
  link: screen.style({ fg: 0x61afef, underline: "single", bold: true }),
  linkDesc: screen.style({ fg: 0xabb2bf }),
  cjk: screen.style({ fg: 0xe5c07b }),
  emoji: screen.style({ fg: 0xffffff }),
  code: screen.style({ fg: 0x98c379, bg: 0x21252b }),
  dim: screen.style({ fg: 0x5c6370 }),
  border: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  tabActive: screen.style({ fg: 0x000000, bg: 0x56b6c2, bold: true }),
  tabInactive: screen.style({ fg: 0xabb2bf, bg: 0x2c313a }),
  accent: screen.style({ fg: 0xc678dd, bold: true }),
  wide: screen.style({ fg: 0xe06c75, bg: 0x21252b }),
  combining: screen.style({ fg: 0x98c379 }),
};

// --- Link data ---
const links = [
  { url: "https://bun.sh", text: "bun.sh", desc: "Bun - JavaScript runtime & toolkit" },
  { url: "https://bun.sh/docs", text: "bun.sh/docs", desc: "Bun Documentation" },
  { url: "https://github.com/oven-sh/bun", text: "github.com/oven-sh/bun", desc: "Bun on GitHub" },
  { url: "https://ghostty.org", text: "ghostty.org", desc: "Ghostty Terminal Emulator" },
  { url: "https://github.com/ghostty-org/ghostty", text: "github.com/ghostty-org/ghostty", desc: "Ghostty on GitHub" },
  { url: "https://ziglang.org", text: "ziglang.org", desc: "Zig Programming Language" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/API", text: "MDN Web APIs", desc: "Mozilla Developer Network" },
  { url: "https://nodejs.org", text: "nodejs.org", desc: "Node.js Runtime" },
];

// --- Unicode showcase data ---
const cjkSamples = [
  { text: "\u5FEB\u901F", label: "Fast (Chinese)" },
  { text: "\u30D0\u30F3", label: "Bun (Japanese Katakana)" },
  { text: "\uD55C\uAD6D\uC5B4", label: "Korean" },
  { text: "\u6027\u80FD", label: "Performance (Chinese)" },
  { text: "\u30BF\u30FC\u30DF\u30CA\u30EB", label: "Terminal (Japanese)" },
  { text: "\uC548\uB155", label: "Hello (Korean)" },
];

const emojiSamples = [
  { text: "\u{1F680}", label: "Rocket" },
  { text: "\u{1F525}", label: "Fire" },
  { text: "\u26A1", label: "Lightning" },
  { text: "\u{1F4E6}", label: "Package" },
  { text: "\u{1F3AF}", label: "Bullseye" },
  { text: "\u{2728}", label: "Sparkles" },
  { text: "\u{1F40D}", label: "Snake" },
  { text: "\u{1F980}", label: "Crab" },
  { text: "\u{1F439}", label: "Hamster" },
  { text: "\u2615", label: "Coffee" },
  { text: "\u{1F4BB}", label: "Laptop" },
  { text: "\u{1F310}", label: "Globe" },
];

const zwjSamples = [
  { text: "\u{1F468}\u200D\u{1F4BB}", label: "Man Technologist (ZWJ)" },
  { text: "\u{1F469}\u200D\u{1F52C}", label: "Woman Scientist (ZWJ)" },
  { text: "\u{1F3F3}\uFE0F\u200D\u{1F308}", label: "Rainbow Flag (ZWJ)" },
  { text: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", label: "Family (ZWJ)" },
];

const boxDrawing = [
  { chars: "\u250C\u2500\u2510\u2502\u2514\u2518", label: "Single box" },
  { chars: "\u2554\u2550\u2557\u2551\u255A\u255D", label: "Double box" },
  { chars: "\u256D\u2500\u256E\u2502\u2570\u256F", label: "Rounded box" },
  { chars: "\u2501\u2503\u250F\u2513\u2517\u251B", label: "Heavy box" },
  { chars: "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588", label: "Block elements" },
  { chars: "\u2591\u2592\u2593\u2588", label: "Shade blocks" },
];

// --- State ---
let activeTab = 0;
let scrollY = 0;
const tabs = ["Hyperlinks", "CJK & Emoji", "Box Drawing"];

// --- Render ---
function render() {
  screen.clear();

  // Title bar
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Hyperlinks & Unicode ", st.titleBar);

  // Tabs
  let tx = 2;
  for (let i = 0; i < tabs.length; i++) {
    const label = ` ${i + 1}:${tabs[i]} `;
    screen.setText(tx, 1, label, i === activeTab ? st.tabActive : st.tabInactive);
    tx += label.length + 1;
  }

  const contentY = 3;
  const contentH = rows - contentY - 1;

  if (activeTab === 0) {
    renderHyperlinks(contentY, contentH);
  } else if (activeTab === 1) {
    renderUnicode(contentY, contentH);
  } else {
    renderBoxDrawing(contentY, contentH);
  }

  // Footer
  const footerText = " j/k:Scroll | 1-3:Section | Tab:Next | q:Quit ";
  screen.setText(0, rows - 1, footerText.slice(0, cols), st.footer);

  writer.render(screen, { cursorVisible: false });
}

function renderHyperlinks(startY: number, height: number) {
  let y = startY - scrollY;

  // Section: Clickable Hyperlinks
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Clickable Terminal Hyperlinks (OSC 8)", st.header);
  }
  y += 2;

  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Click any link below in a supporting terminal:", st.dim);
  }
  y += 2;

  for (const link of links) {
    if (y >= startY && y < startY + height) {
      // Register hyperlink
      const hid = screen.hyperlink(link.url);

      // Draw the link text
      const linkLen = screen.setText(4, y, link.text, st.link);

      // Apply hyperlink to the cells
      for (let x = 0; x < linkLen; x++) {
        screen.setHyperlink(4 + x, y, hid);
      }

      // Description
      screen.setText(4 + linkLen + 2, y, link.desc, st.linkDesc);
    }
    y += 2;
  }

  // Code example
  y += 1;
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Usage in code:", st.subheader);
  }
  y += 1;

  const codeLines = [
    "const hid = screen.hyperlink('https://bun.sh');",
    "screen.setText(0, 0, 'Click me!', linkStyle);",
    "for (let x = 0; x < 9; x++)",
    "  screen.setHyperlink(x, 0, hid);",
  ];
  for (const line of codeLines) {
    if (y >= startY && y < startY + height) {
      screen.setText(4, y, line, st.code);
    }
    y++;
  }
}

function renderUnicode(startY: number, height: number) {
  let y = startY - scrollY;

  // CJK
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "CJK Wide Characters (2 cells each)", st.header);
  }
  y += 2;

  for (const sample of cjkSamples) {
    if (y >= startY && y < startY + height) {
      const w = screen.setText(4, y, sample.text, st.cjk);
      screen.setText(4 + w + 2, y, sample.label, st.dim);
    }
    y++;
  }

  // Emoji
  y += 1;
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Emoji (wide characters)", st.header);
  }
  y += 2;

  let ex = 4;
  let ey = y;
  for (const sample of emojiSamples) {
    if (ex + 14 > cols - 4) {
      ex = 4;
      ey += 2;
    }
    if (ey >= startY && ey < startY + height) {
      const w = screen.setText(ex, ey, sample.text, st.emoji);
      screen.setText(ex + w, ey, ` ${sample.label}`, st.dim);
    }
    ex += sample.label.length + 5;
  }
  y = ey + 3;

  // ZWJ sequences
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "ZWJ Sequences (Grapheme Clustering)", st.header);
  }
  y += 2;

  for (const sample of zwjSamples) {
    if (y >= startY && y < startY + height) {
      const w = screen.setText(4, y, sample.text, st.emoji);
      screen.setText(4 + w + 2, y, sample.label, st.dim);
    }
    y++;
  }

  y += 1;
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Powered by Ghostty's grapheme clustering engine", st.accent);
  }
}

function renderBoxDrawing(startY: number, height: number) {
  let y = startY - scrollY;

  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Box Drawing Characters", st.header);
  }
  y += 2;

  for (const sample of boxDrawing) {
    if (y >= startY && y < startY + height) {
      screen.setText(4, y, sample.chars, st.text);
      screen.setText(4 + sample.chars.length + 2, y, sample.label, st.dim);
    }
    y += 2;
  }

  // Live box drawing examples
  y += 1;
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Live Box Styles", st.header);
  }
  y += 1;

  const boxStyles = ["single", "double", "rounded", "heavy", "ascii"];
  let bx = 2;
  for (const style of boxStyles) {
    if (bx + 14 < cols && y + 4 < startY + height) {
      screen.drawBox(bx, y, 14, 5, { style, styleId: st.border, fill: true });
      const labelX = bx + Math.floor((14 - style.length) / 2);
      screen.setText(labelX, y + 2, style, st.accent);
    }
    bx += 16;
  }
  y += 6;

  // Braille patterns
  if (y >= startY && y < startY + height) {
    screen.setText(2, y, "Braille Patterns (U+2800-U+28FF)", st.header);
  }
  y += 2;

  if (y >= startY && y < startY + height) {
    let bpx = 4;
    for (let i = 0; i < 64 && bpx < cols - 4; i++) {
      const cp = 0x2800 + i;
      screen.setText(bpx, y, String.fromCodePoint(cp), st.text);
      bpx += 2;
    }
  }
  y++;
  if (y >= startY && y < startY + height) {
    let bpx = 4;
    for (let i = 64; i < 128 && bpx < cols - 4; i++) {
      const cp = 0x2800 + i;
      screen.setText(bpx, y, String.fromCodePoint(cp), st.text);
      bpx += 2;
    }
  }
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  switch (name) {
    case "up":
    case "k":
      scrollY = Math.max(0, scrollY - 1);
      break;
    case "down":
    case "j":
      scrollY++;
      break;
    case "pageup":
      scrollY = Math.max(0, scrollY - (rows - 5));
      break;
    case "pagedown":
      scrollY += rows - 5;
      break;
    case "1":
      activeTab = 0;
      scrollY = 0;
      break;
    case "2":
      activeTab = 1;
      scrollY = 0;
      break;
    case "3":
      activeTab = 2;
      scrollY = 0;
      break;
    case "tab":
      activeTab = (activeTab + 1) % tabs.length;
      scrollY = 0;
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
