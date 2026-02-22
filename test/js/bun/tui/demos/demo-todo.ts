/**
 * demo-todo.ts — Todo List Manager
 *
 * A fully interactive todo app with checkboxes, priorities, categories,
 * inline editing, and persistence to a temp file.
 *
 * Demonstrates: checkbox toggling, inline text editing, priority styling,
 * category filtering, setText, fill, style (fg/bg/bold/italic/strikethrough),
 * drawBox, TUITerminalWriter, TUIKeyReader, alt screen, resize, onpaste.
 *
 * Run: bun run test/js/bun/tui/demos/demo-todo.ts
 * Controls: j/k navigate, Space toggle, a add, e edit, d delete, 1-4 priority,
 *           Tab cycle filter, Q/Ctrl+C quit
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0xc678dd, bold: true }),
  header: screen.style({ fg: 0xc678dd, bold: true }),
  label: screen.style({ fg: 0xabb2bf }),
  dim: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  border: screen.style({ fg: 0x5c6370 }),
  selected: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  selectedDone: screen.style({ fg: 0x000000, bg: 0x61afef, strikethrough: true }),
  done: screen.style({ fg: 0x5c6370, strikethrough: true }),
  checkOn: screen.style({ fg: 0x98c379, bold: true }),
  checkOff: screen.style({ fg: 0x5c6370 }),
  checkOnSel: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  checkOffSel: screen.style({ fg: 0x000000, bg: 0x61afef }),
  priHigh: screen.style({ fg: 0xe06c75, bold: true }),
  priMed: screen.style({ fg: 0xe5c07b, bold: true }),
  priLow: screen.style({ fg: 0x56b6c2 }),
  priNone: screen.style({ fg: 0x5c6370 }),
  priHighSel: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  catWork: screen.style({ fg: 0x61afef, italic: true }),
  catPersonal: screen.style({ fg: 0xc678dd, italic: true }),
  catHealth: screen.style({ fg: 0x98c379, italic: true }),
  catOther: screen.style({ fg: 0xe5c07b, italic: true }),
  statsLabel: screen.style({ fg: 0xabb2bf }),
  statsValue: screen.style({ fg: 0xe5c07b, bold: true }),
  inputBg: screen.style({ fg: 0xffffff, bg: 0x2c313a }),
  inputLabel: screen.style({ fg: 0xe5c07b, bold: true }),
  filterActive: screen.style({ fg: 0x000000, bg: 0xc678dd, bold: true }),
  filterInactive: screen.style({ fg: 0xabb2bf, bg: 0x2c313a }),
};

// --- Data ---
type Priority = "high" | "medium" | "low" | "none";
type Category = "work" | "personal" | "health" | "other";

interface Todo {
  text: string;
  done: boolean;
  priority: Priority;
  category: Category;
  createdAt: Date;
}

const todos: Todo[] = [
  { text: "Ship the TUI library", done: false, priority: "high", category: "work", createdAt: new Date() },
  { text: "Write documentation", done: false, priority: "medium", category: "work", createdAt: new Date() },
  { text: "Add more demo apps", done: true, priority: "medium", category: "work", createdAt: new Date() },
  { text: "Review pull requests", done: false, priority: "high", category: "work", createdAt: new Date() },
  { text: "Buy groceries", done: false, priority: "low", category: "personal", createdAt: new Date() },
  { text: "Go for a run", done: true, priority: "medium", category: "health", createdAt: new Date() },
  { text: "Read a book", done: false, priority: "low", category: "personal", createdAt: new Date() },
  { text: "Meditate", done: false, priority: "medium", category: "health", createdAt: new Date() },
  { text: "Clean the kitchen", done: false, priority: "low", category: "personal", createdAt: new Date() },
  { text: "Benchmark TUI rendering", done: false, priority: "high", category: "work", createdAt: new Date() },
];

// --- State ---
let selectedIndex = 0;
let scrollOffset = 0;
let editMode = false;
let editText = "";
let editCursor = 0;
let addMode = false;
let filterCategory: Category | "all" = "all";
const categories: (Category | "all")[] = ["all", "work", "personal", "health", "other"];

function getFilteredTodos(): Todo[] {
  if (filterCategory === "all") return todos;
  return todos.filter(t => t.category === filterCategory);
}

// --- Priority helpers ---
function priLabel(p: Priority): string {
  switch (p) {
    case "high":
      return "!!!";
    case "medium":
      return "!! ";
    case "low":
      return "!  ";
    default:
      return "   ";
  }
}
function priStyle(p: Priority, sel: boolean): number {
  if (sel) return st.priHighSel;
  switch (p) {
    case "high":
      return st.priHigh;
    case "medium":
      return st.priMed;
    case "low":
      return st.priLow;
    default:
      return st.priNone;
  }
}

function catStyle(c: Category): number {
  switch (c) {
    case "work":
      return st.catWork;
    case "personal":
      return st.catPersonal;
    case "health":
      return st.catHealth;
    default:
      return st.catOther;
  }
}

function cyclePriority(p: Priority): Priority {
  switch (p) {
    case "none":
      return "low";
    case "low":
      return "medium";
    case "medium":
      return "high";
    case "high":
      return "none";
  }
}

// --- Render ---
function render() {
  screen.clear();
  const filtered = getFilteredTodos();

  // Title
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Todo List ", st.titleBar);

  // Filter tabs
  let tx = 2;
  const tabY = 2;
  for (const cat of categories) {
    const label = ` ${cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)} `;
    const style = cat === filterCategory ? st.filterActive : st.filterInactive;
    screen.setText(tx, tabY, label, style);
    tx += label.length + 1;
  }

  // Stats
  const totalCount = filterCategory === "all" ? todos.length : filtered.length;
  const doneCount = filtered.filter(t => t.done).length;
  const statsText = `${doneCount}/${totalCount} done`;
  screen.setText(cols - statsText.length - 2, tabY, statsText, st.statsValue);

  // List
  const listY = 4;
  const listH = rows - listY - 2;

  // Ensure selected is visible
  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
  if (selectedIndex >= scrollOffset + listH) scrollOffset = selectedIndex - listH + 1;

  if (filtered.length === 0) {
    screen.setText(4, listY + 1, "No items. Press 'a' to add one.", st.dim);
  }

  const visibleCount = Math.min(listH, filtered.length - scrollOffset);
  for (let vi = 0; vi < visibleCount; vi++) {
    const idx = scrollOffset + vi;
    const todo = filtered[idx];
    const y = listY + vi;
    const isSel = idx === selectedIndex;
    const isEditing = isSel && editMode;

    // Selection highlight
    if (isSel) {
      screen.fill(1, y, cols - 2, 1, " ", st.selected);
    }

    // Checkbox
    const checkChar = todo.done ? "[\u2713]" : "[ ]";
    screen.setText(
      2,
      y,
      checkChar,
      isSel ? (todo.done ? st.checkOnSel : st.checkOffSel) : todo.done ? st.checkOn : st.checkOff,
    );

    // Priority
    screen.setText(6, y, priLabel(todo.priority), priStyle(todo.priority, isSel));

    // Text
    const textX = 10;
    const maxTextW = cols - textX - 16;
    if (isEditing) {
      // Edit mode: show editable text with cursor
      const displayText = editText.slice(0, maxTextW);
      screen.setText(textX, y, displayText, st.inputBg);
      // Fill remaining
      if (displayText.length < maxTextW) {
        screen.fill(textX + displayText.length, y, maxTextW - displayText.length, 1, " ", st.inputBg);
      }
    } else {
      const textStyle = isSel ? (todo.done ? st.selectedDone : st.selected) : todo.done ? st.done : st.label;
      const displayText = todo.text.slice(0, maxTextW);
      screen.setText(textX, y, displayText, textStyle);
    }

    // Category tag
    const tagX = cols - 12;
    screen.setText(tagX, y, todo.category.slice(0, 8), isSel ? st.selected : catStyle(todo.category));
  }

  // Scroll indicators
  if (scrollOffset > 0) {
    screen.setText(cols - 2, listY, "\u25b2", st.statsValue);
  }
  if (scrollOffset + listH < filtered.length) {
    screen.setText(cols - 2, listY + listH - 1, "\u25bc", st.statsValue);
  }

  // Add mode input
  if (addMode) {
    const addY = rows - 3;
    screen.fill(1, addY, cols - 2, 1, " ", st.inputBg);
    screen.setText(2, addY, "New: ", st.inputLabel);
    screen.setText(7, addY, editText + "_", st.inputBg);
  }

  // Footer
  const footerY = rows - 1;
  let footerText: string;
  if (editMode) {
    footerText = " Enter: Save | Esc: Cancel | Editing... ";
  } else if (addMode) {
    footerText = " Enter: Add | Esc: Cancel | Type your todo... ";
  } else {
    footerText = " j/k:\u2195 Space:\u2713 a:Add e:Edit d:Del p:Priority Tab:Filter q:Quit ";
  }
  screen.setText(0, footerY, footerText.slice(0, cols), st.footer);

  writer.render(screen, {
    cursorVisible: editMode || addMode,
    cursorX: editMode ? 10 + editCursor : addMode ? 7 + editCursor : 0,
    cursorY: editMode ? listY + (selectedIndex - scrollOffset) : addMode ? rows - 3 : 0,
    cursorStyle: "line",
  });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean; alt: boolean }) => {
  const { name, ctrl, alt } = event;

  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  const filtered = getFilteredTodos();

  if (editMode) {
    switch (name) {
      case "enter":
        if (editText.trim().length > 0) {
          filtered[selectedIndex].text = editText.trim();
        }
        editMode = false;
        break;
      case "escape":
        editMode = false;
        break;
      case "backspace":
        if (editCursor > 0) {
          editText = editText.slice(0, editCursor - 1) + editText.slice(editCursor);
          editCursor--;
        }
        break;
      case "left":
        if (editCursor > 0) editCursor--;
        break;
      case "right":
        if (editCursor < editText.length) editCursor++;
        break;
      case "home":
        editCursor = 0;
        break;
      case "end":
        editCursor = editText.length;
        break;
      default:
        if (!ctrl && !alt && name.length === 1) {
          editText = editText.slice(0, editCursor) + name + editText.slice(editCursor);
          editCursor++;
        }
        break;
    }
    render();
    return;
  }

  if (addMode) {
    switch (name) {
      case "enter":
        if (editText.trim().length > 0) {
          todos.push({
            text: editText.trim(),
            done: false,
            priority: "none",
            category: filterCategory === "all" ? "other" : filterCategory,
            createdAt: new Date(),
          });
          selectedIndex = getFilteredTodos().length - 1;
        }
        addMode = false;
        editText = "";
        break;
      case "escape":
        addMode = false;
        editText = "";
        break;
      case "backspace":
        if (editCursor > 0) {
          editText = editText.slice(0, editCursor - 1) + editText.slice(editCursor);
          editCursor--;
        }
        break;
      case "left":
        if (editCursor > 0) editCursor--;
        break;
      case "right":
        if (editCursor < editText.length) editCursor++;
        break;
      default:
        if (!ctrl && !alt && name.length === 1) {
          editText = editText.slice(0, editCursor) + name + editText.slice(editCursor);
          editCursor++;
        }
        break;
    }
    render();
    return;
  }

  // Normal mode
  if (name === "q") {
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
      if (selectedIndex < filtered.length - 1) selectedIndex++;
      break;
    case " ":
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].done = !filtered[selectedIndex].done;
      }
      break;
    case "a":
      addMode = true;
      editText = "";
      editCursor = 0;
      break;
    case "e":
      if (filtered[selectedIndex]) {
        editMode = true;
        editText = filtered[selectedIndex].text;
        editCursor = editText.length;
      }
      break;
    case "d":
      if (filtered[selectedIndex]) {
        const realIdx = todos.indexOf(filtered[selectedIndex]);
        if (realIdx >= 0) todos.splice(realIdx, 1);
        if (selectedIndex >= getFilteredTodos().length) {
          selectedIndex = Math.max(0, getFilteredTodos().length - 1);
        }
      }
      break;
    case "p":
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].priority = cyclePriority(filtered[selectedIndex].priority);
      }
      break;
    case "tab": {
      const ci = categories.indexOf(filterCategory);
      filterCategory = categories[(ci + 1) % categories.length];
      selectedIndex = 0;
      scrollOffset = 0;
      break;
    }
    case "home":
      selectedIndex = 0;
      break;
    case "end":
      selectedIndex = Math.max(0, filtered.length - 1);
      break;
  }

  render();
};

// --- Paste ---
reader.onpaste = (text: string) => {
  if (editMode || addMode) {
    const firstLine = text.split("\n")[0];
    editText = editText.slice(0, editCursor) + firstLine + editText.slice(editCursor);
    editCursor += firstLine.length;
    render();
  }
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
