/**
 * demo-interactive-list.ts — Interactive Scrollable List
 *
 * A filterable, scrollable list with keyboard navigation.
 * Demonstrates: TUIKeyReader (arrows, enter, escape, typing), style
 * (fg/bg/bold/inverse), setText, fill, clearRect, drawBox, alt screen,
 * and search filtering.
 *
 * Run: bun run test/js/bun/tui/demos/demo-interactive-list.ts
 * Exit: Escape or Ctrl+C
 */

// --- Item data ---
interface ListItem {
  name: string;
  description: string;
  category: string;
}

const ALL_ITEMS: ListItem[] = [
  { name: "Bun.serve()", description: "Start an HTTP server", category: "HTTP" },
  { name: "Bun.file()", description: "Reference a file on disk", category: "File I/O" },
  { name: "Bun.write()", description: "Write data to a file", category: "File I/O" },
  { name: "Bun.spawn()", description: "Spawn a child process", category: "Process" },
  { name: "Bun.build()", description: "Bundle JavaScript/TypeScript", category: "Bundler" },
  { name: "Bun.password", description: "Hash and verify passwords", category: "Crypto" },
  { name: "Bun.hash()", description: "Fast non-cryptographic hashing", category: "Crypto" },
  { name: "Bun.Transpiler", description: "JavaScript/TypeScript transpiler", category: "Bundler" },
  { name: "Bun.sleep()", description: "Async sleep for given duration", category: "Utilities" },
  { name: "Bun.which()", description: "Find an executable in PATH", category: "Process" },
  { name: "Bun.peek()", description: "Read a promise without awaiting", category: "Utilities" },
  { name: "Bun.gzipSync()", description: "Synchronous gzip compression", category: "Compression" },
  { name: "Bun.deflateSync()", description: "Synchronous deflate compression", category: "Compression" },
  { name: "Bun.inflateSync()", description: "Synchronous inflate decompression", category: "Compression" },
  { name: "Bun.gunzipSync()", description: "Synchronous gunzip decompression", category: "Compression" },
  { name: "Bun.color()", description: "Parse and convert colors", category: "Utilities" },
  { name: "Bun.semver", description: "Semantic versioning utilities", category: "Utilities" },
  { name: "Bun.dns", description: "DNS resolution", category: "Network" },
  { name: "Bun.connect()", description: "TCP/TLS client connection", category: "Network" },
  { name: "Bun.listen()", description: "TCP/TLS server listener", category: "Network" },
  { name: "Bun.udpSocket()", description: "UDP socket creation", category: "Network" },
  { name: "Bun.sql", description: "SQL database client (Postgres)", category: "Database" },
  { name: "Bun.redis", description: "Redis client", category: "Database" },
  { name: "Bun.s3()", description: "S3-compatible object storage", category: "Cloud" },
  { name: "Bun.Glob", description: "File pattern matching", category: "File I/O" },
  { name: "Bun.stringWidth()", description: "Display width of a string", category: "Utilities" },
  { name: "Bun.TUIScreen", description: "Terminal screen buffer", category: "TUI" },
  { name: "Bun.TUITerminalWriter", description: "Terminal ANSI writer", category: "TUI" },
  { name: "Bun.TUIKeyReader", description: "Terminal input reader", category: "TUI" },
  { name: "Bun.TUIBufferWriter", description: "Buffer-backed ANSI writer", category: "TUI" },
];

// --- State ---
let selectedIndex = 0;
let scrollOffset = 0;
let searchQuery = "";
let searchMode = false;
let filteredItems = [...ALL_ITEMS];

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const styles = {
  title: screen.style({ fg: 0x61afef, bold: true }),
  searchLabel: screen.style({ fg: 0xe5c07b, bold: true }),
  searchText: screen.style({ fg: 0xffffff }),
  searchPlaceholder: screen.style({ fg: 0x5c6370, italic: true }),
  itemName: screen.style({ fg: 0xc678dd, bold: true }),
  itemDesc: screen.style({ fg: 0xabb2bf }),
  itemCategory: screen.style({ fg: 0x56b6c2, italic: true }),
  selectedName: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  selectedDesc: screen.style({ fg: 0x000000, bg: 0x61afef }),
  selectedCategory: screen.style({ fg: 0x000000, bg: 0x61afef, italic: true }),
  selectedBg: screen.style({ bg: 0x61afef }),
  border: screen.style({ fg: 0x5c6370 }),
  scrollIndicator: screen.style({ fg: 0x61afef, bold: true }),
  footer: screen.style({ fg: 0x5c6370 }),
  count: screen.style({ fg: 0xe5c07b }),
  detailHeader: screen.style({ fg: 0x61afef, bold: true }),
  detailLabel: screen.style({ fg: 0xabb2bf }),
  detailValue: screen.style({ fg: 0xe5c07b }),
  noResults: screen.style({ fg: 0xe06c75, italic: true }),
};

// --- Filter logic ---
function filterItems() {
  if (searchQuery.length === 0) {
    filteredItems = [...ALL_ITEMS];
  } else {
    const q = searchQuery.toLowerCase();
    filteredItems = ALL_ITEMS.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }
  // Reset selection if out of range
  if (selectedIndex >= filteredItems.length) {
    selectedIndex = Math.max(0, filteredItems.length - 1);
  }
  scrollOffset = 0;
}

// --- Render ---
function render() {
  screen.clear();

  const listWidth = Math.min(60, cols - 4);
  const listX = 2;
  const headerY = 0;

  // Title
  const titleText = "Bun API Explorer";
  screen.setText(listX, headerY, titleText, styles.title);

  // Search bar
  const searchY = headerY + 2;
  const searchLabel = searchMode ? "> " : "/ ";
  screen.setText(listX, searchY, searchLabel, styles.searchLabel);
  if (searchQuery.length > 0) {
    screen.setText(listX + 2, searchY, searchQuery.slice(0, listWidth - 4), styles.searchText);
    // Cursor indicator in search mode
    if (searchMode) {
      const curX = listX + 2 + searchQuery.length;
      if (curX < listX + listWidth) {
        screen.setText(curX, searchY, "_", styles.searchText);
      }
    }
  } else if (!searchMode) {
    screen.setText(listX + 2, searchY, "Type '/' to search...", styles.searchPlaceholder);
  } else {
    screen.setText(listX + 2, searchY, "Type to filter...", styles.searchPlaceholder);
  }

  // Item count
  const countText = `${filteredItems.length}/${ALL_ITEMS.length} items`;
  if (cols > listWidth + countText.length + 4) {
    screen.setText(cols - countText.length - 2, searchY, countText, styles.count);
  }

  // Separator
  const sepY = searchY + 1;
  const sepChar = "\u2500"; // horizontal line
  for (let i = 0; i < listWidth; i++) {
    screen.setText(listX + i, sepY, sepChar, styles.border);
  }

  // List area
  const listY = sepY + 1;
  const maxVisibleItems = rows - listY - 2; // leave room for footer

  if (filteredItems.length === 0) {
    screen.setText(listX + 2, listY + 1, "No matching items found.", styles.noResults);
  } else {
    // Ensure selected item is visible
    if (selectedIndex < scrollOffset) {
      scrollOffset = selectedIndex;
    } else if (selectedIndex >= scrollOffset + maxVisibleItems) {
      scrollOffset = selectedIndex - maxVisibleItems + 1;
    }

    const visibleCount = Math.min(maxVisibleItems, filteredItems.length - scrollOffset);

    for (let i = 0; i < visibleCount; i++) {
      const itemIdx = scrollOffset + i;
      const item = filteredItems[itemIdx];
      const y = listY + i;
      const isSelected = itemIdx === selectedIndex;

      if (isSelected) {
        // Highlight entire row
        screen.fill(listX, y, listWidth, 1, " ", styles.selectedBg);
      }

      // Arrow indicator for selected item
      const arrow = isSelected ? "\u25b6 " : "  ";
      screen.setText(listX, y, arrow, isSelected ? styles.selectedName : styles.itemName);

      // Item name
      const nameWidth = Math.min(item.name.length, Math.floor(listWidth * 0.4));
      screen.setText(listX + 2, y, item.name.slice(0, nameWidth), isSelected ? styles.selectedName : styles.itemName);

      // Description
      const descX = listX + 2 + nameWidth + 1;
      const descWidth = listWidth - nameWidth - 3;
      if (descWidth > 0) {
        screen.setText(
          descX,
          y,
          item.description.slice(0, descWidth),
          isSelected ? styles.selectedDesc : styles.itemDesc,
        );
      }
    }

    // Scroll indicators
    if (scrollOffset > 0) {
      screen.setText(listX + listWidth - 1, listY, "\u25b2", styles.scrollIndicator); // up arrow
    }
    if (scrollOffset + maxVisibleItems < filteredItems.length) {
      screen.setText(listX + listWidth - 1, listY + visibleCount - 1, "\u25bc", styles.scrollIndicator); // down arrow
    }
  }

  // Detail panel (right side, if room)
  const detailX = listX + listWidth + 2;
  const detailWidth = cols - detailX - 2;
  if (detailWidth > 20 && filteredItems.length > 0) {
    const item = filteredItems[selectedIndex];
    const detailY = listY;
    screen.drawBox(detailX, detailY - 1, detailWidth, 8, {
      style: "rounded",
      styleId: styles.border,
      fill: true,
    });
    screen.setText(detailX + 2, detailY - 1, " Details ", styles.detailHeader);

    let dy = detailY;
    screen.setText(detailX + 2, dy, "Name:", styles.detailLabel);
    screen.setText(detailX + 12, dy, item.name.slice(0, detailWidth - 14), styles.detailValue);
    dy++;

    screen.setText(detailX + 2, dy, "Category:", styles.detailLabel);
    screen.setText(detailX + 12, dy, item.category, styles.itemCategory);
    dy++;

    dy++;
    screen.setText(detailX + 2, dy, "Description:", styles.detailLabel);
    dy++;
    // Word-wrap description
    const words = item.description.split(" ");
    let line = "";
    for (const word of words) {
      if (line.length + word.length + 1 > detailWidth - 4) {
        screen.setText(detailX + 2, dy, line, styles.itemDesc);
        dy++;
        line = word;
      } else {
        line = line.length > 0 ? line + " " + word : word;
      }
    }
    if (line.length > 0) {
      screen.setText(detailX + 2, dy, line, styles.itemDesc);
    }
  }

  // Footer
  const footerY = rows - 1;
  const footerParts = ["\u2191\u2193 Navigate", "Enter Select", "/ Search", "Esc Cancel", "Ctrl+C Quit"];
  const footerText = " " + footerParts.join("  |  ") + " ";
  screen.setText(0, footerY, footerText.slice(0, cols), styles.footer);

  writer.render(screen, { cursorVisible: false });
}

// --- Input handling ---
reader.onkeypress = (event: { name: string; ctrl: boolean; shift: boolean; alt: boolean; sequence: string }) => {
  const { name, ctrl } = event;

  // Ctrl+C always quits
  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  if (searchMode) {
    // Search mode input handling
    switch (name) {
      case "escape":
        searchMode = false;
        searchQuery = "";
        filterItems();
        break;
      case "enter":
        searchMode = false;
        break;
      case "backspace":
        if (searchQuery.length > 0) {
          searchQuery = searchQuery.slice(0, -1);
          filterItems();
        }
        break;
      case "up":
        searchMode = false;
        if (selectedIndex > 0) selectedIndex--;
        break;
      case "down":
        searchMode = false;
        if (selectedIndex < filteredItems.length - 1) selectedIndex++;
        break;
      default:
        // Printable character
        if (!ctrl && !event.alt && name.length === 1) {
          searchQuery += name;
          filterItems();
        }
        break;
    }
  } else {
    // Normal mode input handling
    switch (name) {
      case "up":
      case "k":
        if (selectedIndex > 0) selectedIndex--;
        break;
      case "down":
      case "j":
        if (selectedIndex < filteredItems.length - 1) selectedIndex++;
        break;
      case "home":
        selectedIndex = 0;
        break;
      case "end":
        selectedIndex = Math.max(0, filteredItems.length - 1);
        break;
      case "pageup": {
        const pageSize = rows - 6;
        selectedIndex = Math.max(0, selectedIndex - pageSize);
        break;
      }
      case "pagedown": {
        const pageSize = rows - 6;
        selectedIndex = Math.min(filteredItems.length - 1, selectedIndex + pageSize);
        break;
      }
      case "/":
        searchMode = true;
        searchQuery = "";
        break;
      case "escape":
        if (searchQuery.length > 0) {
          searchQuery = "";
          filterItems();
        } else {
          cleanup();
        }
        break;
      case "enter":
        // Could do something with selected item; for now just flash
        break;
    }
  }

  render();
};

// --- Handle paste into search ---
reader.onpaste = (text: string) => {
  if (searchMode) {
    // Add pasted text to search (first line only, no newlines)
    const firstLine = text.split("\n")[0];
    searchQuery += firstLine;
    filterItems();
    render();
  }
};

// --- Handle resize ---
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
