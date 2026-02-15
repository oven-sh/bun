/**
 * demo-heatmap.ts — GitHub-style contribution heatmap grid using block chars
 * with green shading. Shows 52 weeks x 7 days with random data and month labels.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const weeks = 52;
const days = 7;
const width = Math.max(weeks + 8, 64);
const height = days + 6;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });

// Green contribution levels
const levels = [
  screen.style({ fg: 0x161b22 }), // 0: no contributions
  screen.style({ fg: 0x0e4429 }), // 1: light
  screen.style({ fg: 0x006d32 }), // 2: medium
  screen.style({ fg: 0x26a641 }), // 3: good
  screen.style({ fg: 0x39d353 }), // 4: max
];

const blockChar = "\u2588";

// Seeded pseudo-random
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// Generate contribution data
const data: number[][] = [];
for (let w = 0; w < weeks; w++) {
  const week: number[] = [];
  for (let d = 0; d < days; d++) {
    const r = rand();
    // Weight towards lower values
    if (r < 0.3) week.push(0);
    else if (r < 0.55) week.push(1);
    else if (r < 0.75) week.push(2);
    else if (r < 0.9) week.push(3);
    else week.push(4);
  }
  data.push(week);
}

// Title
screen.setText(2, 0, "Contribution Activity", titleStyle);

// Count total
let totalContribs = 0;
for (const week of data) for (const d of week) totalContribs += d;
screen.setText(2, 1, `${totalContribs} contributions in the last year`, dimStyle);

// Day labels
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const gridX = 6;
const gridY = 3;

for (let d = 0; d < days; d++) {
  if (d % 2 === 0) {
    screen.setText(1, gridY + d, dayLabels[d], dimStyle);
  }
}

// Month labels (approximate positions)
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
for (let m = 0; m < 12; m++) {
  const weekPos = Math.floor((m / 12) * weeks);
  screen.setText(gridX + weekPos, gridY - 1, months[m], dimStyle);
}

// Draw heatmap grid
for (let w = 0; w < weeks; w++) {
  for (let d = 0; d < days; d++) {
    const level = data[w][d];
    screen.setText(gridX + w, gridY + d, blockChar, levels[level]);
  }
}

// Legend
const legendY = gridY + days + 1;
screen.setText(2, legendY, "Less", dimStyle);
let lx = 7;
for (let i = 0; i < levels.length; i++) {
  screen.setText(lx, legendY, blockChar, levels[i]);
  lx += 2;
}
screen.setText(lx, legendY, "More", dimStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
