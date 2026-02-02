/**
 * demo-logs.ts — Real-time Log Viewer
 *
 * Simulated real-time log stream with color-coded log levels, timestamp
 * formatting, level filtering, search, follow mode, and log count stats.
 *
 * Demonstrates: auto-scrolling append-only list, color-coded categories,
 * level-based filtering, search highlighting, setText, fill, style
 * (fg/bg/bold/italic/faint), TUITerminalWriter, TUIKeyReader, alt screen, resize.
 *
 * Run: bun run test/js/bun/tui/demos/demo-logs.ts
 * Controls: j/k scroll, F follow, 1-5 filter level, / search, C clear, Q quit
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
  timestamp: screen.style({ fg: 0x5c6370 }),
  debug: screen.style({ fg: 0x5c6370 }),
  debugLabel: screen.style({ fg: 0x5c6370, bold: true }),
  info: screen.style({ fg: 0x61afef }),
  infoLabel: screen.style({ fg: 0x61afef, bold: true }),
  warn: screen.style({ fg: 0xe5c07b }),
  warnLabel: screen.style({ fg: 0xe5c07b, bold: true }),
  error: screen.style({ fg: 0xe06c75 }),
  errorLabel: screen.style({ fg: 0xe06c75, bold: true }),
  fatal: screen.style({ fg: 0xffffff, bg: 0xe06c75, bold: true }),
  fatalLabel: screen.style({ fg: 0xffffff, bg: 0xe06c75, bold: true }),
  statusBar: screen.style({ fg: 0x000000, bg: 0x3e4451 }),
  statusLabel: screen.style({ fg: 0xabb2bf, bg: 0x3e4451 }),
  statusValue: screen.style({ fg: 0xe5c07b, bg: 0x3e4451, bold: true }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  filterActive: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  filterInactive: screen.style({ fg: 0xabb2bf, bg: 0x2c313a }),
  follow: screen.style({ fg: 0x98c379, bold: true }),
  paused: screen.style({ fg: 0xe06c75, bold: true }),
  searchBar: screen.style({ fg: 0xffffff, bg: 0x2c313a }),
  searchLabel: screen.style({ fg: 0xe5c07b, bg: 0x2c313a, bold: true }),
  highlight: screen.style({ fg: 0x000000, bg: 0xe5c07b, bold: true }),
  source: screen.style({ fg: 0xc678dd }),
  dim: screen.style({ fg: 0x3e4451 }),
};

// --- Log levels ---
type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
const LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

interface LogEntry {
  time: Date;
  level: LogLevel;
  source: string;
  message: string;
}

// --- State ---
const logs: LogEntry[] = [];
const MAX_LOGS = 5000;
let scrollOffset = 0;
let following = true;
let minLevel: LogLevel = "DEBUG";
let searchMode = false;
let searchText = "";
let paused = false;

// --- Log sources and message templates ---
const sources = ["http", "db", "auth", "cache", "worker", "scheduler", "api", "ws"];

const templates: Record<LogLevel, string[]> = {
  DEBUG: [
    "Connection pool size: {n} active, {n} idle",
    "Cache hit for key: user:{n}",
    "Query executed in {n}ms",
    "Middleware chain: {n} handlers",
    "GC pause: {n}ms",
    "Event loop latency: {n}ms",
  ],
  INFO: [
    "Request completed: GET /api/users - 200 ({n}ms)",
    "Request completed: POST /api/data - 201 ({n}ms)",
    "User authenticated: user_{n}@example.com",
    "WebSocket client connected from 10.0.{n}.{n}",
    "Background job completed: sync_data_{n}",
    "Server listening on port {n}",
    "Database migration applied: v{n}",
  ],
  WARN: [
    "Slow query detected: SELECT * FROM users ({n}ms)",
    "Rate limit approaching: {n}/1000 requests",
    "Memory usage high: {n}% of allocated",
    "Connection pool exhausted, queuing request",
    "Deprecated API called: /v1/legacy/users",
    "Certificate expires in {n} days",
  ],
  ERROR: [
    "Database connection failed: ETIMEDOUT after {n}ms",
    "Request failed: GET /api/data - 500 Internal Server Error",
    "Unhandled promise rejection in worker #{n}",
    "Failed to parse JSON payload: Unexpected token at position {n}",
    "Redis connection lost, reconnecting in {n}s",
  ],
  FATAL: [
    "Out of memory: heap limit reached ({n} MB)",
    "Database cluster unreachable, all replicas down",
    "CRITICAL: Data corruption detected in shard {n}",
  ],
};

function randomLog(): LogEntry {
  // Weight towards lower severity
  const r = Math.random();
  let level: LogLevel;
  if (r < 0.3) level = "DEBUG";
  else if (r < 0.7) level = "INFO";
  else if (r < 0.88) level = "WARN";
  else if (r < 0.97) level = "ERROR";
  else level = "FATAL";

  const msgs = templates[level];
  let msg = msgs[Math.floor(Math.random() * msgs.length)];
  msg = msg.replace(/\{n\}/g, () => String(Math.floor(Math.random() * 999) + 1));

  return {
    time: new Date(),
    level,
    source: sources[Math.floor(Math.random() * sources.length)],
    message: msg,
  };
}

// Seed with some initial logs
for (let i = 0; i < 30; i++) {
  const entry = randomLog();
  entry.time = new Date(Date.now() - (30 - i) * 1000);
  logs.push(entry);
}

// --- Filtering ---
function levelIndex(l: LogLevel): number {
  return LEVELS.indexOf(l);
}

function getFilteredLogs(): LogEntry[] {
  let filtered = logs.filter(l => levelIndex(l.level) >= levelIndex(minLevel));
  if (searchText.length > 0) {
    const q = searchText.toLowerCase();
    filtered = filtered.filter(l => l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q));
  }
  return filtered;
}

// --- Style helpers ---
function levelStyle(level: LogLevel): number {
  switch (level) {
    case "DEBUG":
      return st.debug;
    case "INFO":
      return st.info;
    case "WARN":
      return st.warn;
    case "ERROR":
      return st.error;
    case "FATAL":
      return st.fatal;
  }
}

function levelLabelStyle(level: LogLevel): number {
  switch (level) {
    case "DEBUG":
      return st.debugLabel;
    case "INFO":
      return st.infoLabel;
    case "WARN":
      return st.warnLabel;
    case "ERROR":
      return st.errorLabel;
    case "FATAL":
      return st.fatalLabel;
  }
}

function formatTs(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

// --- Render ---
function render() {
  screen.clear();
  const filtered = getFilteredLogs();

  // Title bar
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Log Viewer ", st.titleBar);
  const modeText = following ? " FOLLOW " : paused ? " PAUSED " : "";
  if (modeText) {
    screen.setText(cols - modeText.length - 2, 0, modeText, following ? st.follow : st.paused);
  }

  // Level filter tabs
  let tx = 1;
  for (const level of LEVELS) {
    const count = logs.filter(l => l.level === level).length;
    const label = ` ${level}(${count}) `;
    const isActive = levelIndex(level) >= levelIndex(minLevel);
    screen.setText(tx, 1, label, isActive ? st.filterActive : st.filterInactive);
    tx += label.length + 1;
  }

  // Search bar
  if (searchMode) {
    screen.setText(1, 2, "/ ", st.searchLabel);
    screen.setText(3, 2, searchText + "_", st.searchBar);
  } else if (searchText.length > 0) {
    screen.setText(1, 2, `Search: "${searchText}" (${filtered.length} matches)`, st.searchBar);
  }

  // Log area
  const logY = 3;
  const logH = rows - logY - 2;

  // Auto-scroll when following
  if (following) {
    scrollOffset = Math.max(0, filtered.length - logH);
  }

  // Clamp scroll
  scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, filtered.length - logH)));

  const visibleCount = Math.min(logH, filtered.length - scrollOffset);
  const tsW = 12; // HH:MM:SS.mmm
  const levelW = 6; // [XXXXX]
  const srcW = 10;

  for (let vi = 0; vi < visibleCount; vi++) {
    const entry = filtered[scrollOffset + vi];
    const y = logY + vi;
    let x = 1;

    // Timestamp
    screen.setText(x, y, formatTs(entry.time), st.timestamp);
    x += tsW + 1;

    // Level badge
    const lvl = entry.level.padEnd(5);
    screen.setText(x, y, lvl, levelLabelStyle(entry.level));
    x += levelW;

    // Source
    screen.setText(x, y, entry.source.padEnd(srcW).slice(0, srcW), st.source);
    x += srcW;

    // Separator
    screen.setText(x, y, "\u2502", st.dim);
    x += 2;

    // Message
    const msgW = cols - x - 1;
    const msg = entry.message.slice(0, msgW);
    screen.setText(x, y, msg, levelStyle(entry.level));
  }

  // Scroll position indicator
  if (filtered.length > logH) {
    const barH = Math.max(1, Math.floor((logH * logH) / filtered.length));
    const barPos = Math.floor((scrollOffset / Math.max(1, filtered.length - logH)) * (logH - barH));
    for (let i = 0; i < logH; i++) {
      const ch = i >= barPos && i < barPos + barH ? "\u2588" : "\u2502";
      const style = i >= barPos && i < barPos + barH ? st.infoLabel : st.dim;
      screen.setText(cols - 1, logY + i, ch, style);
    }
  }

  // Status bar
  const statusY = rows - 2;
  screen.fill(0, statusY, cols, 1, " ", st.statusBar);
  screen.setText(1, statusY, `Total: `, st.statusLabel);
  screen.setText(8, statusY, `${logs.length}`, st.statusValue);
  screen.setText(14, statusY, ` Showing: `, st.statusLabel);
  screen.setText(24, statusY, `${filtered.length}`, st.statusValue);
  screen.setText(30, statusY, ` Level: `, st.statusLabel);
  screen.setText(38, statusY, `>=${minLevel}`, st.statusValue);

  // Footer
  const footerY = rows - 1;
  const footerText = " j/k:Scroll F:Follow 1-5:Level /:Search C:Clear Space:Pause q:Quit ";
  screen.setText(0, footerY, footerText.slice(0, cols), st.footer);

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean; alt: boolean }) => {
  const { name, ctrl, alt } = event;

  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  if (searchMode) {
    switch (name) {
      case "enter":
      case "escape":
        searchMode = false;
        if (name === "escape") searchText = "";
        break;
      case "backspace":
        if (searchText.length > 0) searchText = searchText.slice(0, -1);
        else searchMode = false;
        break;
      default:
        if (!ctrl && !alt && name.length === 1) searchText += name;
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
      following = false;
      scrollOffset = Math.max(0, scrollOffset - 1);
      break;
    case "down":
    case "j":
      scrollOffset++;
      break;
    case "pageup":
      following = false;
      scrollOffset = Math.max(0, scrollOffset - (rows - 6));
      break;
    case "pagedown":
      scrollOffset += rows - 6;
      break;
    case "home":
      following = false;
      scrollOffset = 0;
      break;
    case "end":
    case "f":
      following = true;
      break;
    case "1":
      minLevel = "DEBUG";
      break;
    case "2":
      minLevel = "INFO";
      break;
    case "3":
      minLevel = "WARN";
      break;
    case "4":
      minLevel = "ERROR";
      break;
    case "5":
      minLevel = "FATAL";
      break;
    case "/":
      searchMode = true;
      searchText = "";
      break;
    case "c":
      logs.length = 0;
      scrollOffset = 0;
      break;
    case " ":
      paused = !paused;
      following = !paused && following;
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
  clearInterval(timer);
  reader.close();
  writer.exitAltScreen();
  writer.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// --- Log generation loop ---
const timer = setInterval(() => {
  if (!paused) {
    // Add 1-3 log entries per tick
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      logs.push(randomLog());
      if (logs.length > MAX_LOGS) logs.shift();
    }
  }
  render();
}, 300);

render();
