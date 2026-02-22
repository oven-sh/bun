/**
 * demo-chart.ts — Terminal Charts & Sparklines
 *
 * Live-updating bar charts, sparklines, and a horizontal histogram
 * with simulated real-time data feeds.
 *
 * Demonstrates: setInterval animation, dynamic data, fill, setText,
 * style (fg/bg/bold), drawBox, mathematical layout, TUITerminalWriter,
 * TUIKeyReader, alt screen, resize handling.
 *
 * Run: bun run test/js/bun/tui/demos/demo-chart.ts
 * Controls: 1-3 to switch views, Space to pause, R to reset, Q / Ctrl+C to quit
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
  header: screen.style({ fg: 0x61afef, bold: true }),
  label: screen.style({ fg: 0xabb2bf }),
  value: screen.style({ fg: 0xe5c07b, bold: true }),
  dim: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  border: screen.style({ fg: 0x5c6370 }),
  axis: screen.style({ fg: 0x5c6370 }),
  barGreen: screen.style({ bg: 0x98c379 }),
  barBlue: screen.style({ bg: 0x61afef }),
  barYellow: screen.style({ bg: 0xe5c07b }),
  barRed: screen.style({ bg: 0xe06c75 }),
  barCyan: screen.style({ bg: 0x56b6c2 }),
  barMagenta: screen.style({ bg: 0xc678dd }),
  sparkHigh: screen.style({ fg: 0x98c379 }),
  sparkMid: screen.style({ fg: 0xe5c07b }),
  sparkLow: screen.style({ fg: 0xe06c75 }),
  tabActive: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  tabInactive: screen.style({ fg: 0xabb2bf, bg: 0x2c313a }),
};

const barColors = [st.barGreen, st.barBlue, st.barYellow, st.barRed, st.barCyan, st.barMagenta];

// --- Sparkline characters (Unicode block elements, 8 levels) ---
const SPARK = [" ", "\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

// --- Data ---
const MAX_HISTORY = 120;
const series: { name: string; data: number[]; color: number }[] = [
  { name: "CPU", data: [], color: 0 },
  { name: "Memory", data: [], color: 1 },
  { name: "Network", data: [], color: 2 },
  { name: "Disk I/O", data: [], color: 3 },
  { name: "Requests", data: [], color: 4 },
  { name: "Latency", data: [], color: 5 },
];

// Simulated data generators
function genCPU(prev: number): number {
  return Math.max(0, Math.min(100, prev + (Math.random() - 0.48) * 15));
}
function genMemory(prev: number): number {
  return Math.max(20, Math.min(95, prev + (Math.random() - 0.5) * 3));
}
function genNetwork(prev: number): number {
  return Math.max(0, Math.min(100, prev + (Math.random() - 0.45) * 20));
}
function genDiskIO(prev: number): number {
  return Math.max(0, Math.min(100, prev + (Math.random() - 0.5) * 8));
}
function genRequests(prev: number): number {
  return Math.max(0, Math.min(100, prev + (Math.random() - 0.47) * 25));
}
function genLatency(prev: number): number {
  return Math.max(5, Math.min(100, prev + (Math.random() - 0.5) * 12));
}

const generators = [genCPU, genMemory, genNetwork, genDiskIO, genRequests, genLatency];

// --- State ---
let paused = false;
let activeView = 0; // 0=sparklines, 1=bar chart, 2=histogram
let tickCount = 0;

function addDataPoint() {
  for (let i = 0; i < series.length; i++) {
    const prev = series[i].data.length > 0 ? series[i].data[series[i].data.length - 1] : 50;
    series[i].data.push(generators[i](prev));
    if (series[i].data.length > MAX_HISTORY) series[i].data.shift();
  }
}

function resetData() {
  for (const s of series) s.data = [];
  tickCount = 0;
}

// Initialize with some data
for (let i = 0; i < 60; i++) addDataPoint();

// --- Render helpers ---

function drawSparkline(x: number, y: number, width: number, data: number[], min: number, max: number) {
  const range = max - min || 1;
  const start = Math.max(0, data.length - width);
  for (let i = 0; i < width; i++) {
    const di = start + i;
    if (di >= data.length) break;
    const normalized = (data[di] - min) / range;
    const level = Math.round(normalized * 8);
    const ch = SPARK[Math.max(0, Math.min(8, level))];
    const style = normalized > 0.7 ? st.sparkHigh : normalized > 0.3 ? st.sparkMid : st.sparkLow;
    screen.setText(x + i, y, ch, style);
  }
}

function drawBarChart(x: number, y: number, width: number, height: number) {
  const barW = Math.max(1, Math.floor((width - 2) / series.length) - 1);
  const gap = 1;

  // Y-axis
  for (let row = 0; row < height; row++) {
    const val = Math.round(100 - (row / (height - 1)) * 100);
    if (row === 0 || row === height - 1 || row === Math.floor(height / 2)) {
      const label = String(val).padStart(3);
      screen.setText(x, y + row, label, st.axis);
    }
    screen.setText(x + 4, y + row, "\u2502", st.axis); // │
  }

  // X-axis
  for (let i = 0; i < width - 5; i++) {
    screen.setText(x + 5 + i, y + height, "\u2500", st.axis); // ─
  }
  screen.setText(x + 4, y + height, "\u2514", st.axis); // └

  // Bars
  for (let si = 0; si < series.length; si++) {
    const s = series[si];
    const val = s.data.length > 0 ? s.data[s.data.length - 1] : 0;
    const barH = Math.round((val / 100) * (height - 1));
    const bx = x + 5 + si * (barW + gap);

    // Fill bar from bottom
    for (let row = 0; row < barH; row++) {
      const by = y + height - 1 - row;
      screen.fill(bx, by, barW, 1, " ", barColors[si % barColors.length]);
    }

    // Label below
    const label = s.name.slice(0, barW + gap);
    screen.setText(bx, y + height + 1, label, st.label);

    // Value on top
    const valStr = Math.round(val).toString();
    screen.setText(bx, y + Math.max(0, height - 1 - barH - 1), valStr, st.value);
  }
}

function drawHistogram(x: number, y: number, width: number, height: number) {
  const barMaxW = width - 14; // leave room for labels and values

  for (let si = 0; si < series.length && si < height; si++) {
    const s = series[si];
    const val = s.data.length > 0 ? s.data[s.data.length - 1] : 0;
    const barW = Math.round((val / 100) * barMaxW);
    const by = y + si * 2;

    // Label
    screen.setText(x, by, s.name.padEnd(10).slice(0, 10), st.label);

    // Bar
    if (barW > 0) {
      screen.fill(x + 10, by, barW, 1, " ", barColors[si % barColors.length]);
    }

    // Value
    const valStr = `${Math.round(val)}%`;
    screen.setText(x + 10 + barMaxW + 1, by, valStr.padStart(4), st.value);
  }
}

// --- Main render ---
function render() {
  screen.clear();

  // Title
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  const title = " System Monitor ";
  screen.setText(Math.max(0, Math.floor((cols - title.length) / 2)), 0, title, st.titleBar);

  // Tabs
  const tabs = ["Sparklines", "Bar Chart", "Histogram"];
  let tx = 2;
  for (let i = 0; i < tabs.length; i++) {
    const label = ` ${i + 1}:${tabs[i]} `;
    const style = i === activeView ? st.tabActive : st.tabInactive;
    screen.setText(tx, 1, label, style);
    tx += label.length + 1;
  }

  // Status
  const statusText = paused ? "PAUSED" : `Tick: ${tickCount}`;
  screen.setText(cols - statusText.length - 2, 1, statusText, paused ? st.sparkLow : st.dim);

  const contentY = 3;
  const contentH = rows - contentY - 2;
  const contentW = cols - 4;

  if (activeView === 0) {
    // --- Sparklines view ---
    const sparkW = Math.min(contentW - 16, MAX_HISTORY);
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      const sy = contentY + si * 4;
      if (sy + 2 >= rows - 2) break;

      // Label and current value
      const val = s.data.length > 0 ? s.data[s.data.length - 1] : 0;
      screen.setText(2, sy, s.name.padEnd(10), st.label);
      screen.setText(12, sy, `${Math.round(val)}%`, st.value);

      // Min/max
      if (s.data.length > 0) {
        const min = Math.round(Math.min(...s.data));
        const max = Math.round(Math.max(...s.data));
        const avg = Math.round(s.data.reduce((a, b) => a + b, 0) / s.data.length);
        screen.setText(18, sy, `min:${min} avg:${avg} max:${max}`, st.dim);
      }

      // Sparkline
      drawSparkline(2, sy + 1, sparkW, s.data, 0, 100);

      // Separator
      if (si < series.length - 1) {
        for (let i = 0; i < sparkW + 2; i++) {
          screen.setText(1 + i, sy + 2, "\u2500", st.dim);
        }
      }
    }
  } else if (activeView === 1) {
    // --- Bar chart view ---
    screen.setText(2, contentY, "Current Values", st.header);
    drawBarChart(2, contentY + 1, contentW, Math.min(contentH - 4, 20));
  } else {
    // --- Histogram view ---
    screen.setText(2, contentY, "Horizontal Bars", st.header);
    drawHistogram(2, contentY + 1, contentW, Math.min(contentH - 2, series.length * 2));

    // Add a mini sparkline section below
    const histH = series.length * 2 + 2;
    if (contentY + histH + 6 < rows - 2) {
      screen.setText(2, contentY + histH, "Trend (last 60s)", st.header);
      for (let si = 0; si < Math.min(series.length, 3); si++) {
        const s = series[si];
        const sy = contentY + histH + 1 + si * 2;
        screen.setText(2, sy, s.name.padEnd(10), st.label);
        drawSparkline(12, sy, Math.min(contentW - 14, 60), s.data, 0, 100);
      }
    }
  }

  // Footer
  const footerY = rows - 1;
  const footerText = " 1-3: Switch view | Space: Pause | R: Reset | Q: Quit ";
  screen.setText(0, footerY, footerText.slice(0, cols), st.footer);

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
    case "1":
      activeView = 0;
      break;
    case "2":
      activeView = 1;
      break;
    case "3":
      activeView = 2;
      break;
    case " ":
      paused = !paused;
      break;
    case "r":
      resetData();
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

// --- Animation ---
const timer = setInterval(() => {
  if (!paused) {
    addDataPoint();
    tickCount++;
  }
  render();
}, 200); // 5 fps

render();
