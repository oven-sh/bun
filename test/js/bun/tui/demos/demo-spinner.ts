/**
 * demo-spinner.ts — Inline Spinner & Status (No Alt Screen)
 *
 * A CLI-style spinner that renders inline without alt screen, updating
 * in place. Shows a sequence of tasks with spinners that complete one
 * by one — like npm install or a build tool output.
 *
 * Demonstrates: inline rendering without alt screen, in-place updates via
 * diff rendering, small fixed-height screens, sequential task simulation,
 * setText, fill, style (fg/bold), TUITerminalWriter, TUIScreen.
 *
 * Run: bun run test/js/bun/tui/demos/demo-spinner.ts
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);

const SPIN = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

interface Task {
  name: string;
  duration: number; // ms
  status: "pending" | "running" | "done" | "error";
  detail: string;
}

const tasks: Task[] = [
  { name: "Resolving dependencies", duration: 800, status: "pending", detail: "package.json" },
  { name: "Downloading packages", duration: 1200, status: "pending", detail: "48 packages" },
  { name: "Linking modules", duration: 600, status: "pending", detail: "node_modules" },
  { name: "Compiling TypeScript", duration: 1500, status: "pending", detail: "src/**/*.ts" },
  { name: "Running tests", duration: 2000, status: "pending", detail: "257 tests" },
  { name: "Building bundle", duration: 1000, status: "pending", detail: "dist/index.js" },
  { name: "Generating types", duration: 700, status: "pending", detail: "dist/index.d.ts" },
];

// Render height: 1 line per task + 1 summary line
const SCREEN_H = tasks.length + 2;
const SCREEN_W = 70;
const screen = new Bun.TUIScreen(SCREEN_W, SCREEN_H);

// Styles
const stSpin = screen.style({ fg: 0xc678dd, bold: true });
const stName = screen.style({ fg: 0xabb2bf });
const stNameDone = screen.style({ fg: 0x5c6370 });
const stDetail = screen.style({ fg: 0x5c6370 });
const stDone = screen.style({ fg: 0x98c379, bold: true });
const stError = screen.style({ fg: 0xe06c75, bold: true });
const stPending = screen.style({ fg: 0x3e4451 });
const stSummary = screen.style({ fg: 0x61afef, bold: true });
const stTime = screen.style({ fg: 0xe5c07b });

let currentTask = 0;
let spinFrame = 0;
let taskStartTime = Date.now();
let totalStartTime = Date.now();
let done = false;

function renderTasks() {
  screen.clear();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const y = i;

    switch (task.status) {
      case "pending":
        screen.setText(0, y, "  \u25CB", stPending); // ○
        screen.setText(4, y, task.name, stPending);
        break;
      case "running": {
        const ch = SPIN[spinFrame % SPIN.length];
        screen.setText(0, y, `  ${ch}`, stSpin);
        screen.setText(4, y, task.name, stName);
        screen.setText(4 + task.name.length + 1, y, task.detail, stDetail);
        const elapsed = ((Date.now() - taskStartTime) / 1000).toFixed(1);
        screen.setText(SCREEN_W - 6, y, `${elapsed}s`, stTime);
        break;
      }
      case "done":
        screen.setText(0, y, "  \u2714", stDone); // ✔
        screen.setText(4, y, task.name, stNameDone);
        break;
      case "error":
        screen.setText(0, y, "  \u2718", stError); // ✘
        screen.setText(4, y, task.name, stError);
        break;
    }
  }

  // Summary line
  const summaryY = tasks.length + 1;
  if (done) {
    const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(1);
    screen.setText(0, summaryY, `\u2728 All tasks completed in ${totalTime}s`, stSummary);
  } else {
    const completed = tasks.filter(t => t.status === "done").length;
    screen.setText(0, summaryY, `  ${completed}/${tasks.length} tasks complete`, stDetail);
  }

  writer.render(screen);
}

// Run tasks sequentially
function startNextTask() {
  if (currentTask >= tasks.length) {
    done = true;
    renderTasks();
    clearInterval(spinTimer);
    // Final newlines to push content into scrollback
    setTimeout(() => {
      writer.write("\r\n");
      writer.close();
      process.exit(0);
    }, 100);
    return;
  }

  tasks[currentTask].status = "running";
  taskStartTime = Date.now();

  setTimeout(() => {
    tasks[currentTask].status = "done";
    currentTask++;
    startNextTask();
  }, tasks[currentTask].duration);
}

// Spinner animation
const spinTimer = setInterval(() => {
  spinFrame++;
  renderTasks();
}, 80);

// Start
renderTasks();
startNextTask();
