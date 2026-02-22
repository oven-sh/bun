/**
 * demo-progress.ts — Progress Bars and Spinners
 *
 * Multiple animated progress bars with different visual styles,
 * a spinner, status text, and a task queue simulation.
 * Demonstrates: setInterval animation loop, style (fg/bg/bold),
 * setText, fill, drawBox, TUITerminalWriter, TUIKeyReader, alt screen.
 *
 * Run: bun run test/js/bun/tui/demos/demo-progress.ts
 * Exit: Press 'q' or Ctrl+C
 */

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const styles = {
  titleBar: screen.style({ fg: 0x000000, bg: 0x61afef, bold: true }),
  header: screen.style({ fg: 0x61afef, bold: true }),
  label: screen.style({ fg: 0xabb2bf }),
  labelBold: screen.style({ fg: 0xabb2bf, bold: true }),
  dim: screen.style({ fg: 0x5c6370 }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  success: screen.style({ fg: 0x98c379, bold: true }),
  error: screen.style({ fg: 0xe06c75, bold: true }),
  warning: screen.style({ fg: 0xe5c07b, bold: true }),
  info: screen.style({ fg: 0x61afef }),
  border: screen.style({ fg: 0x5c6370 }),
  // Progress bar styles
  barGreen: screen.style({ bg: 0x98c379 }),
  barBlue: screen.style({ bg: 0x61afef }),
  barYellow: screen.style({ bg: 0xe5c07b }),
  barRed: screen.style({ bg: 0xe06c75 }),
  barCyan: screen.style({ bg: 0x56b6c2 }),
  barMagenta: screen.style({ bg: 0xc678dd }),
  barEmpty: screen.style({ fg: 0x3e4451 }),
  barEmptyBg: screen.style({ bg: 0x2c313a }),
  // Percent text
  pctHigh: screen.style({ fg: 0x98c379, bold: true }),
  pctMid: screen.style({ fg: 0xe5c07b, bold: true }),
  pctLow: screen.style({ fg: 0xe06c75, bold: true }),
  // Spinner
  spinnerStyle: screen.style({ fg: 0xc678dd, bold: true }),
};

// --- Spinner frames ---
const spinnerFrames = [
  "\u280b",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283c",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280f",
];
// Alternative: ["\\", "|", "/", "-"]
let spinnerIdx = 0;

// --- Task simulation state ---
interface Task {
  name: string;
  progress: number; // 0.0 - 1.0
  speed: number; // progress increment per tick
  barStyle: number; // style ID for filled portion
  status: "pending" | "running" | "complete" | "error";
  statusText: string;
}

const tasks: Task[] = [
  {
    name: "Installing dependencies",
    progress: 0,
    speed: 0.008 + Math.random() * 0.005,
    barStyle: styles.barGreen,
    status: "running",
    statusText: "Resolving packages...",
  },
  {
    name: "Compiling TypeScript",
    progress: 0,
    speed: 0.012 + Math.random() * 0.005,
    barStyle: styles.barBlue,
    status: "pending",
    statusText: "Waiting...",
  },
  {
    name: "Running tests",
    progress: 0,
    speed: 0.006 + Math.random() * 0.003,
    barStyle: styles.barCyan,
    status: "pending",
    statusText: "Waiting...",
  },
  {
    name: "Building bundle",
    progress: 0,
    speed: 0.015 + Math.random() * 0.008,
    barStyle: styles.barYellow,
    status: "pending",
    statusText: "Waiting...",
  },
  {
    name: "Optimizing assets",
    progress: 0,
    speed: 0.005 + Math.random() * 0.003,
    barStyle: styles.barMagenta,
    status: "pending",
    statusText: "Waiting...",
  },
  {
    name: "Deploying to production",
    progress: 0,
    speed: 0.01 + Math.random() * 0.005,
    barStyle: styles.barRed,
    status: "pending",
    statusText: "Waiting...",
  },
];

// Status messages for each task (cycled during progress)
const statusMessages: Record<string, string[]> = {
  "Installing dependencies": [
    "Resolving packages...",
    "Downloading modules...",
    "Linking dependencies...",
    "Verifying tree...",
  ],
  "Compiling TypeScript": [
    "Parsing source files...",
    "Type checking...",
    "Emitting declarations...",
    "Generating output...",
  ],
  "Running tests": ["test/unit/core...", "test/unit/api...", "test/integration...", "test/e2e..."],
  "Building bundle": ["Scanning entry points...", "Tree shaking...", "Minifying...", "Writing output..."],
  "Optimizing assets": ["Compressing images...", "Inlining CSS...", "Hashing filenames...", "Generating manifest..."],
  "Deploying to production": [
    "Uploading artifacts...",
    "Updating DNS...",
    "Invalidating cache...",
    "Health checking...",
  ],
};

// Overall stats
let completedCount = 0;
let totalTicks = 0;
let paused = false;
let allDone = false;

// --- Animation tick ---
function tick() {
  if (paused || allDone) return;

  totalTicks++;
  spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;

  // Process tasks sequentially: start next when current is at a threshold
  let activeFound = false;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    if (task.status === "complete" || task.status === "error") continue;

    if (task.status === "pending") {
      // Start this task if the previous one is at least 30% done or complete
      if (i === 0 || tasks[i - 1].progress >= 0.3 || tasks[i - 1].status === "complete") {
        task.status = "running";
      } else {
        continue;
      }
    }

    if (task.status === "running") {
      activeFound = true;
      task.progress += task.speed * (0.8 + Math.random() * 0.4);

      // Update status text based on progress
      const msgs = statusMessages[task.name];
      if (msgs) {
        const msgIdx = Math.min(Math.floor(task.progress * msgs.length), msgs.length - 1);
        task.statusText = msgs[msgIdx];
      }

      if (task.progress >= 1.0) {
        task.progress = 1.0;
        task.status = "complete";
        task.statusText = "Done!";
        completedCount++;
      }
    }
  }

  if (!activeFound && completedCount === tasks.length) {
    allDone = true;
  }
}

// --- Render helpers ---

function percentStyle(ratio: number): number {
  if (ratio >= 0.8) return styles.pctHigh;
  if (ratio >= 0.4) return styles.pctMid;
  return styles.pctLow;
}

function statusIcon(status: string): { icon: string; style: number } {
  switch (status) {
    case "complete":
      return { icon: "\u2714", style: styles.success }; // checkmark
    case "error":
      return { icon: "\u2718", style: styles.error }; // cross
    case "running":
      return { icon: spinnerFrames[spinnerIdx], style: styles.spinnerStyle };
    default:
      return { icon: "\u25cb", style: styles.dim }; // empty circle
  }
}

/** Draw a progress bar with filled/empty sections. */
function drawProgressBar(x: number, y: number, width: number, ratio: number, fillStyle: number) {
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  if (filled > 0) {
    screen.fill(x, y, filled, 1, " ", fillStyle);
  }
  if (empty > 0) {
    screen.fill(x + filled, y, empty, 1, " ", styles.barEmptyBg);
  }

  // Overlay percentage text centered in the bar
  const pctText = `${Math.round(ratio * 100)}%`;
  const pctX = x + Math.floor((width - pctText.length) / 2);
  const pctStyle =
    ratio > 0.5
      ? screen.style({
          fg: 0x000000,
          bg: ratio >= 1.0 ? 0x98c379 : fillStyle === styles.barGreen ? 0x98c379 : 0x61afef,
          bold: true,
        })
      : screen.style({ fg: 0xffffff, bg: 0x2c313a, bold: true });
  // Just write the percentage without styling to keep it simple
  screen.setText(pctX, y, pctText, percentStyle(ratio));
}

/** Draw a block-character progress bar (alternative style). */
function drawBlockBar(x: number, y: number, width: number, ratio: number) {
  const blocks = [" ", "\u258f", "\u258e", "\u258d", "\u258c", "\u258b", "\u258a", "\u2589", "\u2588"];
  const totalUnits = width * 8;
  const filledUnits = Math.round(ratio * totalUnits);
  const fullBlocks = Math.floor(filledUnits / 8);
  const partialBlock = filledUnits % 8;

  const barColor = screen.style({ fg: 0x61afef });
  for (let i = 0; i < width; i++) {
    if (i < fullBlocks) {
      screen.setText(x + i, y, "\u2588", barColor);
    } else if (i === fullBlocks && partialBlock > 0) {
      screen.setText(x + i, y, blocks[partialBlock], barColor);
    } else {
      screen.setText(x + i, y, "\u2500", styles.barEmpty);
    }
  }
}

// --- Main render ---
function render() {
  screen.clear();

  // Title bar
  screen.fill(0, 0, cols, 1, " ", styles.titleBar);
  const title = " Progress Bars & Spinners ";
  screen.setText(Math.max(0, Math.floor((cols - title.length) / 2)), 0, title, styles.titleBar);

  let y = 2;
  const leftMargin = 2;
  const contentWidth = Math.min(cols - 4, 90);

  // --- Overall progress ---
  const overallProgress = tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length;
  screen.setText(leftMargin, y, "Overall Progress", styles.header);
  y++;

  const overallBarWidth = Math.min(contentWidth - 10, 60);
  drawBlockBar(leftMargin, y, overallBarWidth, overallProgress);
  const overallPct = `${Math.round(overallProgress * 100)}%`;
  screen.setText(leftMargin + overallBarWidth + 2, y, overallPct, percentStyle(overallProgress));
  screen.setText(leftMargin + overallBarWidth + 8, y, `${completedCount}/${tasks.length} tasks`, styles.label);
  y += 2;

  // Separator
  for (let i = 0; i < contentWidth; i++) {
    screen.setText(leftMargin + i, y, "\u2500", styles.dim);
  }
  y++;

  // --- Individual tasks ---
  screen.setText(leftMargin, y, "Task Queue", styles.header);
  y++;

  const barWidth = Math.min(contentWidth - 40, 40);
  const taskNameWidth = 26;

  for (const task of tasks) {
    if (y >= rows - 4) break;

    // Status icon
    const { icon, style: iconStyle } = statusIcon(task.status);
    screen.setText(leftMargin, y, icon, iconStyle);

    // Task name
    const nameStyle =
      task.status === "complete" ? styles.success : task.status === "running" ? styles.labelBold : styles.dim;
    screen.setText(leftMargin + 2, y, task.name.padEnd(taskNameWidth).slice(0, taskNameWidth), nameStyle);

    // Progress bar
    const barX = leftMargin + 2 + taskNameWidth + 1;
    if (task.status === "running" || task.status === "complete") {
      drawProgressBar(barX, y, barWidth, task.progress, task.barStyle);
    } else {
      // Show empty bar for pending
      screen.fill(barX, y, barWidth, 1, " ", styles.barEmptyBg);
    }

    // Status text
    const statusX = barX + barWidth + 2;
    const statusWidth = cols - statusX - 2;
    if (statusWidth > 0) {
      const st = task.statusText.slice(0, statusWidth);
      const stStyle = task.status === "complete" ? styles.success : task.status === "error" ? styles.error : styles.dim;
      screen.setText(statusX, y, st, stStyle);
    }

    y += 2; // spacing between tasks
  }

  // --- Spinner showcase ---
  y = Math.max(y, rows - 8);
  if (y < rows - 4) {
    screen.setText(leftMargin, y, "Spinner Styles", styles.header);
    y++;

    const spinnerTypes = [
      {
        frames: ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"],
        label: "Dots",
      },
      { frames: ["|", "/", "-", "\\"], label: "Line" },
      { frames: ["\u25dc", "\u25dd", "\u25de", "\u25df"], label: "Arc" },
      { frames: ["\u2596", "\u2598", "\u259d", "\u2597"], label: "Block" },
      { frames: ["\u25a0", "\u25a1"], label: "Square" },
    ];

    for (let i = 0; i < spinnerTypes.length; i++) {
      const sp = spinnerTypes[i];
      const frame = sp.frames[spinnerIdx % sp.frames.length];
      const spX = leftMargin + i * 14;
      if (spX + 12 < cols) {
        screen.setText(spX, y, frame, styles.spinnerStyle);
        screen.setText(spX + 2, y, sp.label, styles.label);
      }
    }
    y += 2;
  }

  // --- Completion message ---
  if (allDone) {
    const doneMsg = " All tasks completed successfully! ";
    const doneX = Math.max(leftMargin, Math.floor((cols - doneMsg.length) / 2));
    const doneY = Math.min(y, rows - 3);
    screen.setText(doneX, doneY, doneMsg, styles.success);
  }

  // --- Footer ---
  const footerY = rows - 1;
  const footerParts: string[] = [];
  if (paused) {
    footerParts.push("PAUSED");
  }
  footerParts.push("p: Pause/Resume");
  footerParts.push("r: Restart");
  footerParts.push("q: Quit");
  const footerText = " " + footerParts.join("  |  ") + " ";
  screen.setText(0, footerY, footerText.slice(0, cols), paused ? styles.warning : styles.footer);

  writer.render(screen, { cursorVisible: false });
}

// --- Reset tasks ---
function resetTasks() {
  for (const task of tasks) {
    task.progress = 0;
    task.speed = 0.005 + Math.random() * 0.01;
    task.status = "pending";
    task.statusText = "Waiting...";
  }
  tasks[0].status = "running";
  tasks[0].statusText = statusMessages[tasks[0].name]?.[0] ?? "Starting...";
  completedCount = 0;
  totalTicks = 0;
  allDone = false;
  paused = false;
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  switch (name) {
    case "p":
      paused = !paused;
      break;
    case "r":
      resetTasks();
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

// --- Animation loop ---
const timer = setInterval(() => {
  tick();
  render();
}, 80); // ~12.5 fps

// --- Initial render ---
render();
