/**
 * demo-dashboard.ts — System Dashboard
 *
 * A full-screen dashboard showing system information in styled panels.
 * Demonstrates: drawBox, setText, style (fg/bg/bold/italic), fill, alt screen,
 * TUITerminalWriter, TUIKeyReader, and resize handling.
 *
 * Run: bun run test/js/bun/tui/demos/demo-dashboard.ts
 * Exit: Press 'q' or Ctrl+C
 */

import { arch, cpus, freemem, homedir, hostname, platform, tmpdir, totalmem, uptime } from "os";

// --- Setup writer and key reader ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Style palette ---
const styles = {
  // Title bar
  titleBar: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  // Section headers
  header: screen.style({ fg: 0x61afef, bold: true }),
  // Labels (left column in panels)
  label: screen.style({ fg: 0xabb2bf }),
  // Values (right column in panels)
  value: screen.style({ fg: 0xe5c07b }),
  // Highlighted values
  valueHigh: screen.style({ fg: 0x98c379, bold: true }),
  valueLow: screen.style({ fg: 0xe06c75, bold: true }),
  // Box borders
  border: screen.style({ fg: 0x5c6370 }),
  borderAccent: screen.style({ fg: 0x61afef }),
  // Footer / help text
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  // Separator
  dim: screen.style({ fg: 0x3e4451 }),
  // Progress bar fill
  barFill: screen.style({ fg: 0x000000, bg: 0x98c379 }),
  barEmpty: screen.style({ fg: 0x3e4451 }),
  // Warning
  warning: screen.style({ fg: 0xe06c75, bold: true }),
};

// --- Helper functions ---

/** Format bytes into a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format seconds into a human-readable uptime string. */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

/** Draw a labeled key-value pair inside a panel. */
function drawKV(x: number, y: number, maxWidth: number, label: string, value: string, valueStyle?: number) {
  screen.setText(x, y, label, styles.label);
  const valX = x + label.length;
  const remaining = maxWidth - label.length;
  if (remaining > 0) {
    screen.setText(valX, y, value.slice(0, remaining), valueStyle ?? styles.value);
  }
}

/** Draw a horizontal progress bar. */
function drawProgressBar(x: number, y: number, width: number, ratio: number, label: string) {
  screen.setText(x, y, label, styles.label);
  const barX = x + label.length + 1;
  const barWidth = width - label.length - 1 - 7; // leave room for percentage
  if (barWidth < 3) return;
  const filledCount = Math.round(ratio * barWidth);
  screen.fill(barX, y, filledCount, 1, " ", styles.barFill);
  if (barWidth - filledCount > 0) {
    screen.fill(barX + filledCount, y, barWidth - filledCount, 1, " ", styles.barEmpty);
  }
  const pct = `${Math.round(ratio * 100)}%`;
  screen.setText(barX + barWidth + 1, y, pct.padStart(4), ratio > 0.85 ? styles.valueLow : styles.valueHigh);
}

// --- Main render function ---

function render() {
  screen.clear();

  // Title bar — full width
  screen.fill(0, 0, cols, 1, " ", styles.titleBar);
  const title = " Bun TUI Dashboard ";
  const titleX = Math.max(0, Math.floor((cols - title.length) / 2));
  screen.setText(titleX, 0, title, styles.titleBar);

  // Timestamp on right
  const now = new Date().toLocaleTimeString();
  if (cols > now.length + 2) {
    screen.setText(cols - now.length - 1, 0, now, styles.titleBar);
  }

  // Calculate panel layout
  const contentY = 2;
  const panelHeight = Math.min(10, rows - contentY - 3);
  if (panelHeight < 4) {
    screen.setText(0, 2, "Terminal too small!", styles.warning);
    writer.render(screen, { cursorVisible: false });
    return;
  }

  const halfWidth = Math.floor((cols - 3) / 2);
  const leftX = 1;
  const rightX = leftX + halfWidth + 1;

  // --- Panel 1: System Info (top-left) ---
  screen.drawBox(leftX, contentY, halfWidth, panelHeight, {
    style: "rounded",
    styleId: styles.borderAccent,
    fill: true,
  });
  screen.setText(leftX + 2, contentY, " System Info ", styles.header);

  const infoX = leftX + 2;
  const infoW = halfWidth - 4;
  let infoY = contentY + 1;
  drawKV(infoX, infoY++, infoW, "Hostname:  ", hostname());
  drawKV(infoX, infoY++, infoW, "Platform:  ", `${platform()} (${arch()})`);
  drawKV(infoX, infoY++, infoW, "Bun:       ", Bun.version, styles.valueHigh);
  drawKV(infoX, infoY++, infoW, "Home:      ", homedir());
  drawKV(infoX, infoY++, infoW, "Uptime:    ", formatUptime(uptime()));
  drawKV(infoX, infoY++, infoW, "Terminal:  ", `${cols}x${rows}`);

  // --- Panel 2: CPU Info (top-right) ---
  screen.drawBox(rightX, contentY, halfWidth, panelHeight, {
    style: "rounded",
    styleId: styles.borderAccent,
    fill: true,
  });
  screen.setText(rightX + 2, contentY, " CPU Info ", styles.header);

  const cpuInfo = cpus();
  const cpuX = rightX + 2;
  const cpuW = halfWidth - 4;
  let cpuY = contentY + 1;
  drawKV(cpuX, cpuY++, cpuW, "Model:     ", cpuInfo.length > 0 ? cpuInfo[0].model : "Unknown");
  drawKV(cpuX, cpuY++, cpuW, "Cores:     ", `${cpuInfo.length}`);
  if (cpuInfo.length > 0) {
    drawKV(cpuX, cpuY++, cpuW, "Speed:     ", `${cpuInfo[0].speed} MHz`);
  }

  // Show per-core load as mini bars
  const maxCoresToShow = Math.min(cpuInfo.length, panelHeight - 5);
  for (let i = 0; i < maxCoresToShow; i++) {
    const core = cpuInfo[i];
    const total = core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq;
    const busy = total > 0 ? 1 - core.times.idle / total : 0;
    drawProgressBar(cpuX, cpuY++, cpuW, busy, `Core ${i}: `);
  }

  // --- Panel 3: Memory (bottom-left) ---
  const memY = contentY + panelHeight + 1;
  const memHeight = Math.min(6, rows - memY - 2);
  if (memHeight >= 4) {
    screen.drawBox(leftX, memY, halfWidth, memHeight, {
      style: "rounded",
      styleId: styles.border,
      fill: true,
    });
    screen.setText(leftX + 2, memY, " Memory ", styles.header);

    const total = totalmem();
    const free = freemem();
    const used = total - free;
    const ratio = total > 0 ? used / total : 0;

    const memX = leftX + 2;
    const memW = halfWidth - 4;
    let my = memY + 1;
    drawKV(memX, my++, memW, "Total:     ", formatBytes(total));
    drawKV(memX, my++, memW, "Used:      ", formatBytes(used), ratio > 0.85 ? styles.valueLow : styles.value);
    drawKV(memX, my++, memW, "Free:      ", formatBytes(free), styles.valueHigh);
    if (my < memY + memHeight - 1) {
      drawProgressBar(memX, my++, memW, ratio, "Usage: ");
    }
  }

  // --- Panel 4: Bun Runtime Info (bottom-right) ---
  if (memHeight >= 4) {
    screen.drawBox(rightX, memY, halfWidth, memHeight, {
      style: "rounded",
      styleId: styles.border,
      fill: true,
    });
    screen.setText(rightX + 2, memY, " Bun Runtime ", styles.header);

    const bunX = rightX + 2;
    const bunW = halfWidth - 4;
    let by = memY + 1;
    drawKV(bunX, by++, bunW, "Version:   ", Bun.version);
    drawKV(bunX, by++, bunW, "Revision:  ", Bun.revision.slice(0, 8));
    drawKV(bunX, by++, bunW, "Main:      ", Bun.main.split("/").pop() ?? Bun.main);
    if (by < memY + memHeight - 1) {
      drawKV(bunX, by++, bunW, "Tmp Dir:   ", tmpdir());
    }
  }

  // --- Footer ---
  const footerY = rows - 1;
  screen.fill(0, footerY, cols, 1, " ", styles.dim);
  const footerText = " Press 'q' or Ctrl+C to exit | Auto-refreshes every second ";
  screen.setText(Math.max(0, Math.floor((cols - footerText.length) / 2)), footerY, footerText, styles.footer);

  // Render to terminal
  writer.render(screen, { cursorVisible: false });
}

// --- Handle resize ---
writer.onresize = (newCols: number, newRows: number) => {
  cols = newCols;
  rows = newRows;
  screen.resize(cols, rows);
  render();
};

// --- Handle input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  if (event.name === "q" || (event.name === "c" && event.ctrl)) {
    cleanup();
  }
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

// --- Initial render and refresh loop ---
render();
const timer = setInterval(render, 1000);
