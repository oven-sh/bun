/**
 * demo-table.ts — Sortable Data Table
 *
 * An interactive data table with column headers, sorting, row selection,
 * scrolling, and a detail panel.
 *
 * Demonstrates: tabular layout, column alignment, sort state, setText, fill,
 * style (fg/bg/bold/italic/inverse), drawBox, TUITerminalWriter, TUIKeyReader,
 * alt screen, and resize handling.
 *
 * Run: bun run test/js/bun/tui/demos/demo-table.ts
 * Controls: j/k or arrows to navigate, 1-5 to sort by column, Tab to toggle
 *           sort direction, Q / Ctrl+C to quit
 */

// --- Data ---
interface Row {
  name: string;
  language: string;
  stars: number;
  version: string;
  license: string;
}

const DATA: Row[] = [
  { name: "Bun", language: "Zig", stars: 75200, version: "1.3.9", license: "MIT" },
  { name: "Node.js", language: "C++", stars: 109000, version: "22.11.0", license: "MIT" },
  { name: "Deno", language: "Rust", stars: 97800, version: "2.1.4", license: "MIT" },
  { name: "esbuild", language: "Go", stars: 38500, version: "0.24.0", license: "MIT" },
  { name: "swc", language: "Rust", stars: 31800, version: "1.9.3", license: "Apache-2.0" },
  { name: "Vite", language: "TypeScript", stars: 70100, version: "6.0.3", license: "MIT" },
  { name: "webpack", language: "JavaScript", stars: 64900, version: "5.97.1", license: "MIT" },
  { name: "Rollup", language: "JavaScript", stars: 25400, version: "4.28.1", license: "MIT" },
  { name: "Parcel", language: "JavaScript", stars: 43500, version: "2.13.2", license: "MIT" },
  { name: "Turbopack", language: "Rust", stars: 26100, version: "2.3.3", license: "MPL-2.0" },
  { name: "Rome", language: "Rust", stars: 23900, version: "12.1.3", license: "MIT" },
  { name: "Biome", language: "Rust", stars: 16200, version: "1.9.4", license: "MIT" },
  { name: "Rspack", language: "Rust", stars: 10300, version: "1.1.8", license: "MIT" },
  { name: "tsup", language: "TypeScript", stars: 9400, version: "8.3.5", license: "MIT" },
  { name: "unbuild", language: "TypeScript", stars: 2400, version: "2.0.0", license: "MIT" },
  { name: "tsx", language: "TypeScript", stars: 9800, version: "4.19.2", license: "MIT" },
  { name: "Oxc", language: "Rust", stars: 12600, version: "0.40.0", license: "MIT" },
  { name: "Prettier", language: "JavaScript", stars: 49800, version: "3.4.2", license: "MIT" },
  { name: "ESLint", language: "JavaScript", stars: 25200, version: "9.16.0", license: "MIT" },
  { name: "TypeScript", language: "TypeScript", stars: 101000, version: "5.7.2", license: "Apache-2.0" },
];

type ColKey = keyof Row;
const COLUMNS: { key: ColKey; label: string; width: number; align: "left" | "right" }[] = [
  { key: "name", label: "Name", width: 16, align: "left" },
  { key: "language", label: "Language", width: 14, align: "left" },
  { key: "stars", label: "Stars", width: 10, align: "right" },
  { key: "version", label: "Version", width: 12, align: "left" },
  { key: "license", label: "License", width: 14, align: "left" },
];

// --- State ---
let selectedIndex = 0;
let scrollOffset = 0;
let sortColumn: ColKey = "stars";
let sortAscending = false;
let sortedData = sortData();

function sortData(): Row[] {
  const copy = [...DATA];
  copy.sort((a, b) => {
    const av = a[sortColumn];
    const bv = b[sortColumn];
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv));
    }
    return sortAscending ? cmp : -cmp;
  });
  return copy;
}

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const s = {
  titleBar: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  headerBg: screen.style({ fg: 0xffffff, bg: 0x3e4451, bold: true }),
  headerSort: screen.style({ fg: 0xe5c07b, bg: 0x3e4451, bold: true }),
  rowEven: screen.style({ fg: 0xabb2bf }),
  rowOdd: screen.style({ fg: 0xabb2bf, bg: 0x21252b }),
  rowSelected: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  number: screen.style({ fg: 0xe5c07b }),
  numberOdd: screen.style({ fg: 0xe5c07b, bg: 0x21252b }),
  numberSelected: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  border: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  detailLabel: screen.style({ fg: 0xabb2bf }),
  detailValue: screen.style({ fg: 0xe5c07b }),
  detailHeader: screen.style({ fg: 0x61afef, bold: true }),
  summary: screen.style({ fg: 0x98c379 }),
};

// --- Render ---
function render() {
  screen.clear();

  // Title
  screen.fill(0, 0, cols, 1, " ", s.titleBar);
  const title = " JS Runtime & Build Tool Comparison ";
  screen.setText(Math.max(0, Math.floor((cols - title.length) / 2)), 0, title, s.titleBar);

  const tableX = 1;
  const tableY = 2;
  const tableW = COLUMNS.reduce((sum, c) => sum + c.width + 1, 0) + 1;
  const maxVisibleRows = rows - tableY - 4; // header + footer + detail

  // Ensure selected is visible
  if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
  if (selectedIndex >= scrollOffset + maxVisibleRows) scrollOffset = selectedIndex - maxVisibleRows + 1;

  // --- Column headers ---
  const headerY = tableY;
  screen.fill(tableX, headerY, Math.min(tableW, cols - tableX), 1, " ", s.headerBg);
  let hx = tableX;
  for (let ci = 0; ci < COLUMNS.length; ci++) {
    const col = COLUMNS[ci];
    const isSorted = col.key === sortColumn;
    const arrow = isSorted ? (sortAscending ? " \u25b2" : " \u25bc") : "";
    const label = `${ci + 1}:${col.label}${arrow}`;
    const headerStyle = isSorted ? s.headerSort : s.headerBg;
    if (col.align === "right") {
      const padded = label.padStart(col.width);
      screen.setText(hx, headerY, padded.slice(0, col.width), headerStyle);
    } else {
      screen.setText(hx, headerY, label.slice(0, col.width), headerStyle);
    }
    hx += col.width + 1;
  }

  // --- Separator ---
  const sepY = headerY + 1;
  for (let i = 0; i < Math.min(tableW, cols - tableX); i++) {
    screen.setText(tableX + i, sepY, "\u2500", s.border);
  }

  // --- Data rows ---
  const visibleCount = Math.min(maxVisibleRows, sortedData.length - scrollOffset);
  for (let vi = 0; vi < visibleCount; vi++) {
    const dataIdx = scrollOffset + vi;
    const row = sortedData[dataIdx];
    const rowY = sepY + 1 + vi;
    const isSelected = dataIdx === selectedIndex;
    const isOdd = vi % 2 === 1;

    // Row background
    const rowStyle = isSelected ? s.rowSelected : isOdd ? s.rowOdd : s.rowEven;
    const numStyle = isSelected ? s.numberSelected : isOdd ? s.numberOdd : s.number;

    if (isSelected) {
      screen.fill(tableX, rowY, Math.min(tableW, cols - tableX), 1, " ", s.rowSelected);
    } else if (isOdd) {
      screen.fill(tableX, rowY, Math.min(tableW, cols - tableX), 1, " ", s.rowOdd);
    }

    let rx = tableX;
    for (const col of COLUMNS) {
      const val = String(row[col.key]);
      const isNum = col.key === "stars";
      const cellStyle = isNum ? numStyle : rowStyle;
      if (col.align === "right") {
        const formatted = isNum ? Number(row[col.key]).toLocaleString() : val;
        const padded = formatted.padStart(col.width);
        screen.setText(rx, rowY, padded.slice(0, col.width), cellStyle);
      } else {
        screen.setText(rx, rowY, val.slice(0, col.width), cellStyle);
      }
      rx += col.width + 1;
    }
  }

  // --- Detail panel (right side) ---
  const detailX = tableX + tableW + 1;
  const detailW = cols - detailX - 1;
  if (detailW > 16 && selectedIndex < sortedData.length) {
    const sel = sortedData[selectedIndex];
    const detailY = tableY;
    screen.drawBox(detailX, detailY, detailW, 10, {
      style: "rounded",
      styleId: s.border,
      fill: true,
    });
    screen.setText(detailX + 2, detailY, " Details ", s.detailHeader);

    let dy = detailY + 1;
    const pairs: [string, string][] = [
      ["Name:", sel.name],
      ["Language:", sel.language],
      ["Stars:", Number(sel.stars).toLocaleString()],
      ["Version:", sel.version],
      ["License:", sel.license],
    ];
    for (const [label, value] of pairs) {
      screen.setText(detailX + 2, dy, label, s.detailLabel);
      screen.setText(detailX + 12, dy, value.slice(0, detailW - 14), s.detailValue);
      dy++;
    }

    // Summary
    dy++;
    const avgStars = Math.round(sortedData.reduce((sum, r) => sum + r.stars, 0) / sortedData.length);
    screen.setText(detailX + 2, dy, `Avg: ${avgStars.toLocaleString()} stars`, s.summary);
  }

  // --- Footer ---
  const footerY = rows - 1;
  const sortInfo = `Sorted by ${sortColumn} ${sortAscending ? "\u25b2" : "\u25bc"}`;
  const navInfo = `${selectedIndex + 1}/${sortedData.length}`;
  const footerText = ` \u2191\u2193/jk: Navigate | 1-5: Sort column | Tab: Toggle direction | ${sortInfo} | ${navInfo} | q: Quit `;
  screen.setText(0, footerY, footerText.slice(0, cols), s.footer);

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
    case "up":
    case "k":
      if (selectedIndex > 0) selectedIndex--;
      break;
    case "down":
    case "j":
      if (selectedIndex < sortedData.length - 1) selectedIndex++;
      break;
    case "home":
    case "g":
      selectedIndex = 0;
      break;
    case "end":
      selectedIndex = sortedData.length - 1;
      break;
    case "pageup":
      selectedIndex = Math.max(0, selectedIndex - (rows - 6));
      break;
    case "pagedown":
      selectedIndex = Math.min(sortedData.length - 1, selectedIndex + (rows - 6));
      break;
    case "tab":
      sortAscending = !sortAscending;
      sortedData = sortData();
      break;
    case "1":
    case "2":
    case "3":
    case "4":
    case "5": {
      const idx = parseInt(name) - 1;
      if (idx < COLUMNS.length) {
        if (sortColumn === COLUMNS[idx].key) {
          sortAscending = !sortAscending;
        } else {
          sortColumn = COLUMNS[idx].key;
          sortAscending = sortColumn === "name" || sortColumn === "language";
        }
        sortedData = sortData();
      }
      break;
    }
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
