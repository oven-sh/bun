/**
 * demo-report.ts — Test report summary with header box, pass/fail counts,
 * mini bar chart of test durations, and a footer.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 72);
const height = 22;
const screen = new Bun.TUIScreen(width, height);

// Styles
const headerBg = screen.style({ fg: 0x000000, bg: 0x61afef, bold: true });
const passStyle = screen.style({ fg: 0x98c379, bold: true });
const failStyle = screen.style({ fg: 0xe06c75, bold: true });
const skipStyle = screen.style({ fg: 0xe5c07b });
const dimStyle = screen.style({ fg: 0x5c6370 });
const labelStyle = screen.style({ fg: 0xabb2bf });
const barPass = screen.style({ fg: 0x98c379 });
const barFail = screen.style({ fg: 0xe06c75 });
const borderStyle = screen.style({ fg: 0x3e4452 });
const totalStyle = screen.style({ fg: 0xffffff, bold: true });

// Header
screen.drawBox(0, 0, width, 3, { style: "rounded", styleId: borderStyle, fill: true, fillChar: " " });
screen.fill(1, 1, width - 2, 1, " ", headerBg);
const title = " Test Report \u2014 my-project ";
screen.setText(Math.floor((width - title.length) / 2), 1, title, headerBg);

// Summary counts
const passed = 142;
const failed = 3;
const skipped = 7;
const total = passed + failed + skipped;

let y = 4;
screen.setText(2, y, "Results:", totalStyle);
y++;
screen.setText(4, y, `\u2714 Passed:  ${passed}`, passStyle);
y++;
screen.setText(4, y, `\u2718 Failed:  ${failed}`, failStyle);
y++;
screen.setText(4, y, `\u25CB Skipped: ${skipped}`, skipStyle);
y++;
screen.setText(4, y, `  Total:   ${total}`, dimStyle);

// Summary bar
y += 2;
screen.setText(2, y, "Pass Rate:", labelStyle);
const barWidth = width - 16;
const passWidth = Math.round((passed / total) * barWidth);
const failWidth = Math.round((failed / total) * barWidth);
const skipWidth = barWidth - passWidth - failWidth;
let bx = 14;
screen.fill(bx, y, passWidth, 1, "\u2588", barPass);
bx += passWidth;
screen.fill(bx, y, failWidth, 1, "\u2588", barFail);
bx += failWidth;
screen.fill(bx, y, skipWidth, 1, "\u2591", skipStyle);
const pct = ((passed / total) * 100).toFixed(1);
screen.setText(bx + skipWidth + 1, y, `${pct}%`, passStyle);

// Test duration chart
y += 2;
screen.setText(2, y, "Test Durations (ms):", labelStyle);
y++;

const suites = [
  { name: "http/serve.test.ts", time: 1240, pass: true },
  { name: "crypto/hash.test.ts", time: 890, pass: true },
  { name: "fs/readFile.test.ts", time: 650, pass: true },
  { name: "shell/exec.test.ts", time: 2100, pass: false },
  { name: "fetch/client.test.ts", time: 430, pass: true },
  { name: "sqlite/query.test.ts", time: 780, pass: true },
];

const maxTime = Math.max(...suites.map(s => s.time));
const nameCol = 4;
const chartStart = 28;
const chartWidth = width - chartStart - 8;

for (const suite of suites) {
  const nameStyle = suite.pass ? labelStyle : failStyle;
  const shortName = suite.name.length > 22 ? suite.name.slice(0, 20) + ".." : suite.name;
  screen.setText(nameCol, y, shortName, nameStyle);

  const barLen = Math.max(1, Math.round((suite.time / maxTime) * chartWidth));
  const bStyle = suite.pass ? barPass : barFail;
  screen.fill(chartStart, y, barLen, 1, "\u2588", bStyle);
  screen.setText(chartStart + barLen + 1, y, `${suite.time}`, dimStyle);
  y++;
}

// Footer
y++;
screen.drawBox(0, y, width, 3, { style: "rounded", styleId: borderStyle, fill: true, fillChar: " " });
const footer = `Completed in 6.09s \u2022 ${new Date().toLocaleTimeString()}`;
screen.setText(Math.floor((width - footer.length) / 2), y + 1, footer, dimStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
