/**
 * demo-deps.ts — Dependency audit report showing packages with version,
 * latest version, severity indicators, and a summary.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 76);
const height = 24;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });
const headerStyle = screen.style({ fg: 0xe5c07b, bold: true });
const pkgStyle = screen.style({ fg: 0xabb2bf });
const versionStyle = screen.style({ fg: 0x61afef });
const okStyle = screen.style({ fg: 0x98c379, bold: true });
const warnStyle = screen.style({ fg: 0xe5c07b, bold: true });
const critStyle = screen.style({ fg: 0xe06c75, bold: true });
const borderStyle = screen.style({ fg: 0x3e4452 });
const summaryLabel = screen.style({ fg: 0xabb2bf });

interface Dep {
  name: string;
  current: string;
  latest: string;
  severity: "ok" | "warn" | "critical";
}

const deps: Dep[] = [
  { name: "typescript", current: "5.3.3", latest: "5.3.3", severity: "ok" },
  { name: "esbuild", current: "0.19.8", latest: "0.19.11", severity: "warn" },
  { name: "react", current: "18.2.0", latest: "18.2.0", severity: "ok" },
  { name: "next", current: "14.0.1", latest: "14.0.4", severity: "warn" },
  { name: "lodash", current: "4.17.19", latest: "4.17.21", severity: "critical" },
  { name: "express", current: "4.18.2", latest: "4.18.2", severity: "ok" },
  { name: "axios", current: "1.4.0", latest: "1.6.2", severity: "warn" },
  { name: "zod", current: "3.22.4", latest: "3.22.4", severity: "ok" },
  { name: "prisma", current: "5.5.0", latest: "5.7.1", severity: "warn" },
  { name: "jsonwebtoken", current: "8.5.1", latest: "9.0.2", severity: "critical" },
  { name: "ws", current: "8.14.2", latest: "8.16.0", severity: "warn" },
  { name: "dotenv", current: "16.3.1", latest: "16.3.1", severity: "ok" },
];

const severityIcons: Record<string, { icon: string; style: number }> = {
  ok: { icon: "\u2714 OK", style: okStyle },
  warn: { icon: "\u26A0 Update", style: warnStyle },
  critical: { icon: "\u2718 Critical", style: critStyle },
};

// Title box
screen.drawBox(0, 0, width, 3, { style: "rounded", styleId: borderStyle, fill: true, fillChar: " " });
const title = "Dependency Audit Report";
screen.setText(Math.floor((width - title.length) / 2), 1, title, titleStyle);

// Column headers
const nameCol = 2;
const curCol = 22;
const latCol = 34;
const sevCol = 46;

let y = 4;
screen.setText(nameCol, y, "Package", headerStyle);
screen.setText(curCol, y, "Current", headerStyle);
screen.setText(latCol, y, "Latest", headerStyle);
screen.setText(sevCol, y, "Status", headerStyle);
y++;
screen.setText(1, y, "\u2500".repeat(width - 2), dimStyle);
y++;

for (const dep of deps) {
  screen.setText(nameCol, y, dep.name, pkgStyle);
  screen.setText(curCol, y, dep.current, versionStyle);
  screen.setText(latCol, y, dep.latest, versionStyle);
  const sev = severityIcons[dep.severity];
  screen.setText(sevCol, y, sev.icon, sev.style);
  y++;
}

// Summary
y++;
screen.setText(1, y, "\u2500".repeat(width - 2), dimStyle);
y++;

const okCount = deps.filter(d => d.severity === "ok").length;
const warnCount = deps.filter(d => d.severity === "warn").length;
const critCount = deps.filter(d => d.severity === "critical").length;

screen.setText(2, y, `${deps.length} packages scanned`, summaryLabel);
y++;
screen.setText(4, y, `\u2714 ${okCount} up to date`, okStyle);
screen.setText(22, y, `\u26A0 ${warnCount} updates available`, warnStyle);
screen.setText(48, y, `\u2718 ${critCount} critical`, critStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
