/**
 * demo-text-editor.ts — Simple Text Editor
 *
 * A minimal text editor with cursor movement, typing, backspace, enter,
 * line numbers, scrolling, and a status bar.
 * Demonstrates: alt screen, TUIKeyReader (arrow keys, printable chars,
 * ctrl keys, shift), TUITerminalWriter, cursor rendering, setText, fill,
 * style, clearRect, drawBox, clipboard paste.
 *
 * Run: bun run test/js/bun/tui/demos/demo-text-editor.ts
 * Exit: Ctrl+Q
 */

// --- Editor state ---
let lines: string[] = [
  "Welcome to the Bun TUI text editor!",
  "",
  "This is a minimal editor built with Bun.TUIScreen",
  "and Bun.TUIKeyReader. Try the following:",
  "",
  "  - Type to insert text at the cursor",
  "  - Arrow keys to move the cursor",
  "  - Enter to create a new line",
  "  - Backspace / Delete to remove characters",
  "  - Home / End to jump to line start / end",
  "  - Page Up / Page Down to scroll",
  "  - Ctrl+Q to quit",
  "",
  "The editor supports basic scrolling when the",
  "document is taller than the screen.",
  "",
  "Have fun!",
];
let cursorRow = 0;
let cursorCol = 0;
let scrollY = 0; // first visible line index

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Layout constants ---
const GUTTER_WIDTH = 5; // width reserved for line numbers
const STATUS_HEIGHT = 2; // status bar height at bottom
function editableRows() {
  return rows - STATUS_HEIGHT;
}

// --- Styles ---
const styles = {
  lineNumber: screen.style({ fg: 0x5c6370 }),
  lineNumberCurrent: screen.style({ fg: 0xe5c07b, bold: true }),
  text: 0, // default style
  statusBar: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  statusBarRight: screen.style({ fg: 0x000000, bg: 0x61afef }),
  helpBar: screen.style({ fg: 0x5c6370, bg: 0x282c34 }),
  gutter: screen.style({ fg: 0x5c6370, bg: 0x21252b }),
  cursor: screen.style({ fg: 0x000000, bg: 0x61afef }),
};

// --- Ensure cursor is visible by adjusting scroll ---
function ensureCursorVisible() {
  const maxRow = editableRows();
  if (cursorRow < scrollY) {
    scrollY = cursorRow;
  } else if (cursorRow >= scrollY + maxRow) {
    scrollY = cursorRow - maxRow + 1;
  }
}

// --- Clamp cursor to valid positions ---
function clampCursor() {
  if (cursorRow < 0) cursorRow = 0;
  if (cursorRow >= lines.length) cursorRow = lines.length - 1;
  if (cursorCol < 0) cursorCol = 0;
  if (cursorCol > lines[cursorRow].length) cursorCol = lines[cursorRow].length;
}

// --- Render the editor ---
function render() {
  screen.clear();
  const maxRow = editableRows();
  const textWidth = cols - GUTTER_WIDTH;

  // Draw each visible line
  for (let i = 0; i < maxRow; i++) {
    const lineIdx = scrollY + i;
    const y = i;

    // Gutter background
    screen.fill(0, y, GUTTER_WIDTH - 1, 1, " ", styles.gutter);

    if (lineIdx < lines.length) {
      // Line number
      const numStr = String(lineIdx + 1).padStart(GUTTER_WIDTH - 2, " ") + " ";
      const numStyle = lineIdx === cursorRow ? styles.lineNumberCurrent : styles.lineNumber;
      screen.setText(0, y, numStr, numStyle);

      // Line content (clipped to available width)
      const line = lines[lineIdx];
      if (line.length > 0) {
        const displayLine = line.slice(0, textWidth);
        screen.setText(GUTTER_WIDTH, y, displayLine, styles.text);
      }
    } else {
      // Tilde for lines beyond the buffer
      screen.setText(GUTTER_WIDTH - 2, y, "~", styles.lineNumber);
    }
  }

  // --- Status bar ---
  const statusY = rows - STATUS_HEIGHT;
  screen.fill(0, statusY, cols, 1, " ", styles.statusBar);

  // Left side: mode and file info
  const modeText = " EDIT ";
  screen.setText(0, statusY, modeText, styles.statusBar);
  const fileInfo = " [scratch buffer] ";
  screen.setText(modeText.length, statusY, fileInfo, styles.statusBarRight);

  // Right side: cursor position
  const posText = `Ln ${cursorRow + 1}, Col ${cursorCol + 1}  Lines: ${lines.length} `;
  if (cols > posText.length + modeText.length + fileInfo.length) {
    screen.setText(cols - posText.length, statusY, posText, styles.statusBarRight);
  }

  // Help bar
  const helpY = rows - 1;
  screen.fill(0, helpY, cols, 1, " ", styles.helpBar);
  const helpText = " Ctrl+Q: Quit | Arrows: Move | Enter: New Line | Backspace: Delete ";
  screen.setText(0, helpY, helpText.slice(0, cols), styles.helpBar);

  // Render with cursor
  const cursorScreenY = cursorRow - scrollY;
  const cursorScreenX = GUTTER_WIDTH + cursorCol;
  writer.render(screen, {
    cursorX: cursorScreenX,
    cursorY: cursorScreenY,
    cursorVisible: true,
    cursorStyle: "line",
    cursorBlinking: true,
  });
}

// --- Handle keyboard input ---
reader.onkeypress = (event: { name: string; ctrl: boolean; shift: boolean; alt: boolean; sequence: string }) => {
  const { name, ctrl, shift } = event;

  // Ctrl+Q to quit
  if (ctrl && name === "q") {
    cleanup();
    return;
  }
  // Ctrl+C also quits
  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  switch (name) {
    case "up":
      cursorRow--;
      clampCursor();
      break;
    case "down":
      cursorRow++;
      clampCursor();
      break;
    case "left":
      if (cursorCol > 0) {
        cursorCol--;
      } else if (cursorRow > 0) {
        // Wrap to end of previous line
        cursorRow--;
        cursorCol = lines[cursorRow].length;
      }
      break;
    case "right":
      if (cursorCol < lines[cursorRow].length) {
        cursorCol++;
      } else if (cursorRow < lines.length - 1) {
        // Wrap to start of next line
        cursorRow++;
        cursorCol = 0;
      }
      break;
    case "home":
      cursorCol = 0;
      break;
    case "end":
      cursorCol = lines[cursorRow].length;
      break;
    case "pageup": {
      const pageSize = editableRows() - 1;
      cursorRow = Math.max(0, cursorRow - pageSize);
      clampCursor();
      break;
    }
    case "pagedown": {
      const pageSize = editableRows() - 1;
      cursorRow = Math.min(lines.length - 1, cursorRow + pageSize);
      clampCursor();
      break;
    }
    case "enter": {
      // Split current line at cursor
      const currentLine = lines[cursorRow];
      const before = currentLine.slice(0, cursorCol);
      const after = currentLine.slice(cursorCol);
      lines[cursorRow] = before;
      lines.splice(cursorRow + 1, 0, after);
      cursorRow++;
      cursorCol = 0;
      break;
    }
    case "backspace": {
      if (cursorCol > 0) {
        // Delete character before cursor
        const line = lines[cursorRow];
        lines[cursorRow] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
        cursorCol--;
      } else if (cursorRow > 0) {
        // Merge with previous line
        const prevLen = lines[cursorRow - 1].length;
        lines[cursorRow - 1] += lines[cursorRow];
        lines.splice(cursorRow, 1);
        cursorRow--;
        cursorCol = prevLen;
      }
      break;
    }
    case "delete": {
      const line = lines[cursorRow];
      if (cursorCol < line.length) {
        // Delete character at cursor
        lines[cursorRow] = line.slice(0, cursorCol) + line.slice(cursorCol + 1);
      } else if (cursorRow < lines.length - 1) {
        // Merge with next line
        lines[cursorRow] += lines[cursorRow + 1];
        lines.splice(cursorRow + 1, 1);
      }
      break;
    }
    case "tab": {
      // Insert two spaces
      const line = lines[cursorRow];
      lines[cursorRow] = line.slice(0, cursorCol) + "  " + line.slice(cursorCol);
      cursorCol += 2;
      break;
    }
    default: {
      // Insert printable character
      if (!ctrl && !event.alt && name.length === 1) {
        const line = lines[cursorRow];
        lines[cursorRow] = line.slice(0, cursorCol) + name + line.slice(cursorCol);
        cursorCol++;
      }
      break;
    }
  }

  ensureCursorVisible();
  render();
};

// Handle paste
reader.onpaste = (text: string) => {
  // Insert pasted text at cursor, splitting on newlines
  const pasteLines = text.split("\n");
  for (let i = 0; i < pasteLines.length; i++) {
    if (i > 0) {
      // Insert a newline
      const currentLine = lines[cursorRow];
      const before = currentLine.slice(0, cursorCol);
      const after = currentLine.slice(cursorCol);
      lines[cursorRow] = before;
      lines.splice(cursorRow + 1, 0, after);
      cursorRow++;
      cursorCol = 0;
    }
    // Insert the text
    const insertText = pasteLines[i];
    const line = lines[cursorRow];
    lines[cursorRow] = line.slice(0, cursorCol) + insertText + line.slice(cursorCol);
    cursorCol += insertText.length;
  }
  ensureCursorVisible();
  render();
};

// Handle resize
writer.onresize = (newCols: number, newRows: number) => {
  cols = newCols;
  rows = newRows;
  screen.resize(cols, rows);
  ensureCursorVisible();
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
