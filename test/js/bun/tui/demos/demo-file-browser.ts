/**
 * demo-file-browser.ts — File Browser
 *
 * A keyboard-navigable file browser with directory tree, file details,
 * file type icons, and breadcrumb path display.
 *
 * Demonstrates: real filesystem integration (fs.readdirSync, fs.statSync),
 * tree navigation, setText, fill, style (fg/bg/bold/italic), drawBox,
 * TUITerminalWriter, TUIKeyReader, alt screen, resize handling.
 *
 * Run: bun run test/js/bun/tui/demos/demo-file-browser.ts
 * Controls: j/k or arrows to navigate, Enter to open dir, Backspace to go up,
 *           / to filter, Q / Ctrl+C to quit
 */

import { readdirSync, statSync } from "fs";
import { basename, dirname, join, resolve } from "path";

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  pathBg: screen.style({ fg: 0xabb2bf, bg: 0x21252b }),
  pathSegment: screen.style({ fg: 0x61afef, bg: 0x21252b, bold: true }),
  pathSep: screen.style({ fg: 0x5c6370, bg: 0x21252b }),
  dir: screen.style({ fg: 0x61afef, bold: true }),
  dirSelected: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  file: screen.style({ fg: 0xabb2bf }),
  fileSelected: screen.style({ fg: 0x000000, bg: 0x61afef }),
  symlink: screen.style({ fg: 0xc678dd, italic: true }),
  symlinkSelected: screen.style({ fg: 0x000000, bg: 0xc678dd }),
  executable: screen.style({ fg: 0x98c379, bold: true }),
  execSelected: screen.style({ fg: 0x000000, bg: 0x98c379, bold: true }),
  hidden: screen.style({ fg: 0x5c6370 }),
  hiddenSelected: screen.style({ fg: 0x000000, bg: 0x5c6370 }),
  icon: screen.style({ fg: 0xe5c07b }),
  iconSelected: screen.style({ fg: 0x000000, bg: 0x61afef }),
  selectedBg: screen.style({ bg: 0x61afef }),
  border: screen.style({ fg: 0x5c6370 }),
  detailHeader: screen.style({ fg: 0x61afef, bold: true }),
  detailLabel: screen.style({ fg: 0xabb2bf }),
  detailValue: screen.style({ fg: 0xe5c07b }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  count: screen.style({ fg: 0xe5c07b }),
  error: screen.style({ fg: 0xe06c75, italic: true }),
  filterLabel: screen.style({ fg: 0xe5c07b, bold: true }),
  filterText: screen.style({ fg: 0xffffff }),
};

// --- File type icons ---
function getIcon(name: string, isDir: boolean): string {
  if (isDir) return "\u{1F4C1}"; // 📁
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "\u{1F7E6}"; // 🟦
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "\u{1F7E8}"; // 🟨
    case "json":
      return "\u{1F4CB}"; // 📋
    case "md":
    case "txt":
      return "\u{1F4DD}"; // 📝
    case "zig":
      return "\u26A1"; // ⚡
    case "cpp":
    case "c":
    case "h":
      return "\u2699"; // ⚙
    case "rs":
      return "\u{1F980}"; // 🦀
    case "go":
      return "\u{1F439}"; // 🐹
    case "py":
      return "\u{1F40D}"; // 🐍
    case "toml":
    case "yaml":
    case "yml":
      return "\u2699"; // ⚙
    case "lock":
      return "\u{1F512}"; // 🔒
    case "gitignore":
      return "\u{1F6AB}"; // 🚫
    default:
      return "\u{1F4C4}"; // 📄
  }
}

// --- Entry type ---
interface Entry {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  isExecutable: boolean;
  isHidden: boolean;
  size: number;
  mtime: Date;
}

// --- State ---
let currentPath = resolve(process.cwd());
let entries: Entry[] = [];
let filteredEntries: Entry[] = [];
let selectedIndex = 0;
let scrollOffset = 0;
let filterMode = false;
let filterText = "";
let errorMsg = "";

function loadDir(path: string) {
  errorMsg = "";
  try {
    const names = readdirSync(path);
    entries = [];
    for (const name of names) {
      try {
        const full = join(path, name);
        const stat = statSync(full, { throwIfNoEntry: false });
        if (!stat) continue;
        entries.push({
          name,
          isDir: stat.isDirectory(),
          isSymlink: stat.isSymbolicLink(),
          isExecutable: !stat.isDirectory() && (stat.mode & 0o111) !== 0,
          isHidden: name.startsWith("."),
          size: stat.size,
          mtime: stat.mtime,
        });
      } catch {
        // Skip entries we can't stat
      }
    }
    // Sort: dirs first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    // Clear filter when navigating to a new directory
    filterText = "";
    filterMode = false;
    applyFilter();
    selectedIndex = 0;
    scrollOffset = 0;
    currentPath = path;
  } catch (e: any) {
    errorMsg = e.message || "Failed to read directory";
  }
}

function applyFilter() {
  if (filterText.length === 0) {
    filteredEntries = entries;
  } else {
    const q = filterText.toLowerCase();
    filteredEntries = entries.filter(e => e.name.toLowerCase().includes(q));
  }
  if (selectedIndex >= filteredEntries.length) {
    selectedIndex = Math.max(0, filteredEntries.length - 1);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// --- Render ---
function render() {
  screen.clear();

  // Title bar
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(1, 0, " File Browser ", st.titleBar);

  // Breadcrumb path
  screen.fill(0, 1, cols, 1, " ", st.pathBg);
  const pathParts = currentPath.split("/").filter(Boolean);
  let px = 1;
  screen.setText(px, 1, "/", st.pathSep);
  px++;
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (px + part.length + 1 >= cols - 3) {
      screen.setText(px, 1, "...", st.pathSep);
      break;
    }
    screen.setText(px, 1, part, st.pathSegment);
    px += part.length;
    if (i < pathParts.length - 1) {
      screen.setText(px, 1, "/", st.pathSep);
      px++;
    }
  }

  // Filter bar (if active)
  const filterY = 2;
  if (filterMode) {
    screen.setText(1, filterY, "/ ", st.filterLabel);
    screen.setText(3, filterY, filterText + "_", st.filterText);
  } else if (filterText.length > 0) {
    screen.setText(1, filterY, "Filter: ", st.detailLabel);
    screen.setText(9, filterY, filterText, st.filterText);
    screen.setText(9 + filterText.length + 1, filterY, `(${filteredEntries.length}/${entries.length})`, st.count);
  }

  // File list area
  const listY = 3;
  const listH = rows - listY - 1;
  const detailW = 30;
  const listW = cols - detailW - 3;

  // Ensure selected is visible
  if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
  if (selectedIndex >= scrollOffset + listH) scrollOffset = selectedIndex - listH + 1;

  // Error message
  if (errorMsg.length > 0) {
    screen.setText(2, listY + 1, errorMsg.slice(0, listW - 2), st.error);
    writer.render(screen, { cursorVisible: false });
    return;
  }

  // File entries
  const visibleCount = Math.min(listH, filteredEntries.length - scrollOffset);
  for (let vi = 0; vi < visibleCount; vi++) {
    const idx = scrollOffset + vi;
    const entry = filteredEntries[idx];
    const y = listY + vi;
    const isSelected = idx === selectedIndex;

    if (isSelected) {
      screen.fill(0, y, listW + 1, 1, " ", st.selectedBg);
    }

    // Icon (using 2 chars for wide emoji)
    const icon = getIcon(entry.name, entry.isDir);
    screen.setText(1, y, icon, isSelected ? st.iconSelected : st.icon);

    // Name
    let nameStyle: number;
    if (entry.isDir) {
      nameStyle = isSelected ? st.dirSelected : st.dir;
    } else if (entry.isSymlink) {
      nameStyle = isSelected ? st.symlinkSelected : st.symlink;
    } else if (entry.isExecutable) {
      nameStyle = isSelected ? st.execSelected : st.executable;
    } else if (entry.isHidden) {
      nameStyle = isSelected ? st.hiddenSelected : st.hidden;
    } else {
      nameStyle = isSelected ? st.fileSelected : st.file;
    }

    const nameX = 4; // after icon + space
    const maxNameW = listW - nameX - 12;
    let displayName = entry.name;
    if (entry.isDir) displayName += "/";
    if (displayName.length > maxNameW) displayName = displayName.slice(0, maxNameW - 1) + "\u2026";
    screen.setText(nameX, y, displayName, nameStyle);

    // Size (right-aligned)
    if (!entry.isDir) {
      const sizeStr = formatSize(entry.size).padStart(10);
      screen.setText(listW - 10, y, sizeStr, isSelected ? st.fileSelected : st.detailLabel);
    }
  }

  // Scroll indicators
  if (scrollOffset > 0) {
    screen.setText(listW, listY, "\u25b2", st.count); // ▲
  }
  if (scrollOffset + listH < filteredEntries.length) {
    screen.setText(listW, listY + listH - 1, "\u25bc", st.count); // ▼
  }

  // --- Detail panel ---
  const detailX = listW + 2;
  if (detailW > 14 && filteredEntries.length > 0 && selectedIndex < filteredEntries.length) {
    const sel = filteredEntries[selectedIndex];
    screen.drawBox(detailX, listY, detailW, Math.min(12, listH), {
      style: "rounded",
      styleId: st.border,
      fill: true,
    });
    screen.setText(detailX + 2, listY, " Details ", st.detailHeader);

    let dy = listY + 1;
    screen.setText(detailX + 2, dy, "Name:", st.detailLabel);
    screen.setText(detailX + 9, dy, sel.name.slice(0, detailW - 11), st.detailValue);
    dy++;

    screen.setText(detailX + 2, dy, "Type:", st.detailLabel);
    const typeStr = sel.isDir ? "Directory" : sel.isSymlink ? "Symlink" : "File";
    screen.setText(detailX + 9, dy, typeStr, st.detailValue);
    dy++;

    if (!sel.isDir) {
      screen.setText(detailX + 2, dy, "Size:", st.detailLabel);
      screen.setText(detailX + 9, dy, formatSize(sel.size), st.detailValue);
      dy++;
    }

    screen.setText(detailX + 2, dy, "Modified:", st.detailLabel);
    dy++;
    screen.setText(detailX + 2, dy, formatDate(sel.mtime).slice(0, detailW - 4), st.detailValue);
    dy++;

    if (sel.isExecutable) {
      dy++;
      screen.setText(detailX + 2, dy, "Executable", st.executable);
    }
    if (sel.isHidden) {
      dy++;
      screen.setText(detailX + 2, dy, "Hidden", st.hidden);
    }
  }

  // Footer
  const footerY = rows - 1;
  const footerText = " \u2191\u2193/jk: Navigate | Enter: Open | Backspace: Up | /: Filter | q: Quit ";
  screen.setText(0, footerY, footerText.slice(0, cols), st.footer);

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean; alt: boolean; sequence: string }) => {
  const { name, ctrl } = event;

  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  if (filterMode) {
    switch (name) {
      case "escape":
        filterMode = false;
        filterText = "";
        applyFilter();
        break;
      case "enter":
        filterMode = false;
        break;
      case "backspace":
        if (filterText.length > 0) {
          filterText = filterText.slice(0, -1);
          applyFilter();
        } else {
          filterMode = false;
        }
        break;
      default:
        if (!ctrl && !event.alt && name.length === 1) {
          filterText += name;
          applyFilter();
        }
        break;
    }
    render();
    return;
  }

  switch (name) {
    case "q":
      cleanup();
      return;
    case "up":
    case "k":
      if (selectedIndex > 0) selectedIndex--;
      break;
    case "down":
    case "j":
      if (selectedIndex < filteredEntries.length - 1) selectedIndex++;
      break;
    case "home":
    case "g":
      selectedIndex = 0;
      break;
    case "end":
      selectedIndex = Math.max(0, filteredEntries.length - 1);
      break;
    case "pageup":
      selectedIndex = Math.max(0, selectedIndex - (rows - 5));
      break;
    case "pagedown":
      selectedIndex = Math.min(filteredEntries.length - 1, selectedIndex + (rows - 5));
      break;
    case "enter": {
      const sel = filteredEntries[selectedIndex];
      if (sel?.isDir) {
        loadDir(join(currentPath, sel.name));
      }
      break;
    }
    case "backspace": {
      const parent = dirname(currentPath);
      if (parent !== currentPath) {
        const oldDir = basename(currentPath);
        loadDir(parent);
        // Try to select the directory we came from
        const idx = filteredEntries.findIndex(e => e.name === oldDir);
        if (idx >= 0) selectedIndex = idx;
      }
      break;
    }
    case "/":
      filterMode = true;
      filterText = "";
      break;
    case "escape":
      if (filterText.length > 0) {
        filterText = "";
        applyFilter();
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
loadDir(currentPath);
render();
