/**
 * demo-htop.ts — Process Viewer (htop-style)
 *
 * A real-time process viewer showing system processes with CPU/memory bars,
 * sortable columns, process tree, and auto-refresh.
 *
 * Demonstrates: real system data (Bun.spawn + ps), dense tabular layout,
 * progress bars inside table cells, auto-refresh, sort state, setText, fill,
 * style (fg/bg/bold), TUITerminalWriter, TUIKeyReader, alt screen, resize.
 *
 * Run: bun run test/js/bun/tui/demos/demo-htop.ts
 * Controls: j/k navigate, P sort by CPU, M sort by memory, N sort by name,
 *           / filter, Space pause, Q/Ctrl+C quit
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  headerBg: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  meterLabel: screen.style({ fg: 0xabb2bf, bold: true }),
  meterBar: screen.style({ bg: 0x98c379 }),
  meterBarMed: screen.style({ bg: 0xe5c07b }),
  meterBarHigh: screen.style({ bg: 0xe06c75 }),
  meterEmpty: screen.style({ bg: 0x2c313a }),
  meterText: screen.style({ fg: 0xabb2bf }),
  colHeader: screen.style({ fg: 0x000000, bg: 0x98c379, bold: true }),
  colHeaderSort: screen.style({ fg: 0x000000, bg: 0xe5c07b, bold: true }),
  row: screen.style({ fg: 0xabb2bf }),
  rowAlt: screen.style({ fg: 0xabb2bf, bg: 0x21252b }),
  rowSel: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  pid: screen.style({ fg: 0x56b6c2 }),
  pidAlt: screen.style({ fg: 0x56b6c2, bg: 0x21252b }),
  pidSel: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  cpuHigh: screen.style({ fg: 0xe06c75, bold: true }),
  cpuMed: screen.style({ fg: 0xe5c07b }),
  cpuLow: screen.style({ fg: 0x98c379 }),
  cpuSel: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  memHigh: screen.style({ fg: 0xe06c75 }),
  memLow: screen.style({ fg: 0xabb2bf }),
  memSel: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  footer: screen.style({ fg: 0x000000, bg: 0x3e4451, bold: true }),
  footerKey: screen.style({ fg: 0x000000, bg: 0x56b6c2, bold: true }),
  footerLabel: screen.style({ fg: 0xabb2bf, bg: 0x3e4451 }),
  filterBar: screen.style({ fg: 0xffffff, bg: 0x2c313a }),
  filterLabel: screen.style({ fg: 0xe5c07b, bg: 0x2c313a, bold: true }),
  paused: screen.style({ fg: 0xe06c75, bold: true }),
  uptime: screen.style({ fg: 0x98c379 }),
  count: screen.style({ fg: 0xe5c07b, bold: true }),
};

// --- Process data ---
interface Process {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  command: string;
}

let processes: Process[] = [];
let selectedIndex = 0;
let scrollOffset = 0;
let sortBy: "cpu" | "mem" | "pid" | "name" = "cpu";
let sortAsc = false;
let paused = false;
let filterMode = false;
let filterText = "";
let totalCpu = 0;
let totalMem = 0;
let processCount = 0;

async function refreshProcesses() {
  try {
    await using proc = Bun.spawn({
      cmd: ["ps", "aux"],
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await proc.stdout.text();
    const lines = output.split("\n").slice(1); // skip header

    processes = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;
      const pid = parseInt(parts[1]);
      if (isNaN(pid)) continue;
      processes.push({
        pid,
        user: parts[0],
        cpu: parseFloat(parts[2]) || 0,
        mem: parseFloat(parts[3]) || 0,
        vsz: parseInt(parts[4]) || 0,
        rss: parseInt(parts[5]) || 0,
        command: parts.slice(10).join(" "),
      });
    }

    totalCpu = processes.reduce((s, p) => s + p.cpu, 0);
    totalMem = processes.reduce((s, p) => s + p.mem, 0);
    processCount = processes.length;
    sortProcesses();
  } catch {
    // silently ignore errors
  }
}

function sortProcesses() {
  processes.sort((a, b) => {
    let cmp: number;
    switch (sortBy) {
      case "cpu":
        cmp = a.cpu - b.cpu;
        break;
      case "mem":
        cmp = a.mem - b.mem;
        break;
      case "pid":
        cmp = a.pid - b.pid;
        break;
      case "name":
        cmp = a.command.localeCompare(b.command);
        break;
    }
    return sortAsc ? cmp : -cmp;
  });
}

function getFilteredProcesses(): Process[] {
  if (filterText.length === 0) return processes;
  const q = filterText.toLowerCase();
  return processes.filter(
    p => p.command.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) || String(p.pid).includes(q),
  );
}

// --- Meter drawing ---
function drawMeter(x: number, y: number, width: number, value: number, max: number, label: string) {
  screen.setText(x, y, label.padEnd(5), st.meterLabel);
  const barX = x + 5;
  const barW = width - 5 - 6;
  const ratio = Math.min(value / max, 1);
  const filled = Math.round(ratio * barW);

  screen.setText(barX, y, "[", st.meterText);
  for (let i = 0; i < barW; i++) {
    if (i < filled) {
      const barStyle = ratio > 0.8 ? st.meterBarHigh : ratio > 0.5 ? st.meterBarMed : st.meterBar;
      screen.fill(barX + 1 + i, y, 1, 1, " ", barStyle);
    } else {
      screen.fill(barX + 1 + i, y, 1, 1, " ", st.meterEmpty);
    }
  }
  screen.setText(barX + barW + 1, y, "]", st.meterText);
  const pctText = `${value.toFixed(1)}%`;
  screen.setText(barX + barW + 2, y, pctText, st.meterText);
}

// --- Render ---
function render() {
  screen.clear();
  const filtered = getFilteredProcesses();

  // --- Top meters ---
  const halfW = Math.floor((cols - 2) / 2);
  drawMeter(1, 0, halfW, Math.min(totalCpu, 100), 100, "CPU:");
  drawMeter(1 + halfW, 0, halfW, Math.min(totalMem, 100), 100, "MEM:");

  // Process count and uptime
  screen.setText(1, 1, `Tasks: `, st.meterLabel);
  screen.setText(8, 1, `${processCount}`, st.count);
  if (paused) {
    screen.setText(8 + String(processCount).length + 2, 1, "PAUSED", st.paused);
  }

  // Filter bar
  if (filterMode) {
    screen.setText(1, 2, "Filter: ", st.filterLabel);
    screen.setText(9, 2, filterText + "_", st.filterBar);
  } else if (filterText.length > 0) {
    screen.setText(1, 2, `Filter: ${filterText} (${filtered.length}/${processCount})`, st.meterText);
  }

  // --- Column headers ---
  const tableY = 3;
  screen.fill(0, tableY, cols, 1, " ", st.colHeader);

  const colDefs = [
    { label: "PID", width: 7, key: "pid" as const },
    { label: "USER", width: 10, key: "name" as const },
    { label: "%CPU", width: 7, key: "cpu" as const },
    { label: "%MEM", width: 7, key: "mem" as const },
    { label: "RSS", width: 10, key: "mem" as const },
    { label: "COMMAND", width: 0, key: "name" as const }, // fill remaining
  ];

  let cx = 0;
  for (const col of colDefs) {
    const w = col.width === 0 ? cols - cx : col.width;
    const isSorted =
      sortBy === col.key &&
      (col.label === "%CPU" || col.label === "%MEM" || col.label === "PID" || col.label === "COMMAND");
    const style = isSorted ? st.colHeaderSort : st.colHeader;
    const arrow = isSorted ? (sortAsc ? "\u25b2" : "\u25bc") : "";
    screen.setText(cx, tableY, ` ${col.label}${arrow}`.padEnd(w).slice(0, w), style);
    cx += w;
  }

  // --- Process rows ---
  const listY = tableY + 1;
  const listH = rows - listY - 1;

  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
  if (selectedIndex >= scrollOffset + listH) scrollOffset = selectedIndex - listH + 1;

  const visibleCount = Math.min(listH, filtered.length - scrollOffset);
  for (let vi = 0; vi < visibleCount; vi++) {
    const idx = scrollOffset + vi;
    const proc = filtered[idx];
    const y = listY + vi;
    const isSel = idx === selectedIndex;
    const isAlt = vi % 2 === 1;

    const rowStyle = isSel ? st.rowSel : isAlt ? st.rowAlt : st.row;
    const pidStyle = isSel ? st.pidSel : isAlt ? st.pidAlt : st.pid;
    const memStyle = isSel ? st.memSel : proc.mem > 5 ? st.memHigh : st.memLow;
    const cpuStyle = isSel ? st.cpuSel : proc.cpu > 50 ? st.cpuHigh : proc.cpu > 10 ? st.cpuMed : st.cpuLow;

    if (isSel || isAlt) {
      screen.fill(0, y, cols, 1, " ", rowStyle);
    }

    let rx = 0;
    // PID
    screen.setText(rx, y, String(proc.pid).padStart(6), pidStyle);
    rx += 7;
    // USER
    screen.setText(rx, y, proc.user.slice(0, 9).padEnd(10), rowStyle);
    rx += 10;
    // %CPU
    screen.setText(rx, y, proc.cpu.toFixed(1).padStart(6), cpuStyle);
    rx += 7;
    // %MEM
    screen.setText(rx, y, proc.mem.toFixed(1).padStart(6), memStyle);
    rx += 7;
    // RSS (in MB)
    const rssMB = (proc.rss / 1024).toFixed(0);
    screen.setText(rx, y, `${rssMB} MB`.padStart(9), rowStyle);
    rx += 10;
    // COMMAND
    const cmdW = cols - rx - 1;
    if (cmdW > 0) {
      let cmd = proc.command;
      if (cmd.length > cmdW) cmd = cmd.slice(0, cmdW - 1) + "\u2026";
      screen.setText(rx, y, cmd, rowStyle);
    }
  }

  // --- Footer ---
  const footerY = rows - 1;
  screen.fill(0, footerY, cols, 1, " ", st.footer);
  const keys = [
    ["P", "CPU"],
    ["M", "Mem"],
    ["N", "Name"],
    ["/", "Filter"],
    ["Space", "Pause"],
    ["q", "Quit"],
  ];
  let fx = 0;
  for (const [key, label] of keys) {
    screen.setText(fx, footerY, key, st.footerKey);
    fx += key.length;
    screen.setText(fx, footerY, label + " ", st.footerLabel);
    fx += label.length + 1;
  }

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean; alt: boolean }) => {
  const { name, ctrl, alt } = event;

  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  if (filterMode) {
    switch (name) {
      case "enter":
      case "escape":
        filterMode = false;
        if (name === "escape") filterText = "";
        break;
      case "backspace":
        if (filterText.length > 0) filterText = filterText.slice(0, -1);
        else filterMode = false;
        break;
      default:
        if (!ctrl && !alt && name.length === 1) filterText += name;
        break;
    }
    selectedIndex = 0;
    scrollOffset = 0;
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
      if (selectedIndex < getFilteredProcesses().length - 1) selectedIndex++;
      break;
    case "pageup":
      selectedIndex = Math.max(0, selectedIndex - (rows - 6));
      break;
    case "pagedown":
      selectedIndex = Math.min(getFilteredProcesses().length - 1, selectedIndex + (rows - 6));
      break;
    case "home":
      selectedIndex = 0;
      break;
    case "end":
      selectedIndex = getFilteredProcesses().length - 1;
      break;
    case "p":
      sortBy = "cpu";
      sortAsc = false;
      sortProcesses();
      break;
    case "m":
      sortBy = "mem";
      sortAsc = false;
      sortProcesses();
      break;
    case "n":
      sortBy = "name";
      sortAsc = true;
      sortProcesses();
      break;
    case "/":
      filterMode = true;
      filterText = "";
      break;
    case " ":
      paused = !paused;
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

// --- Start ---
await refreshProcesses();
render();

const timer = setInterval(async () => {
  if (!paused) {
    await refreshProcesses();
  }
  render();
}, 2000);
