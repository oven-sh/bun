/**
 * demo-network.ts — Simulated network request waterfall.
 * Shows GET/POST requests with status codes, timing bars, and response sizes.
 * Color-coded by status (green 200, yellow 3xx, red 4xx/5xx).
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 78);
const height = 20;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });
const headerStyle = screen.style({ fg: 0xe5c07b, bold: true });
const getStyle = screen.style({ fg: 0x61afef, bold: true });
const postStyle = screen.style({ fg: 0xc678dd, bold: true });
const s200 = screen.style({ fg: 0x98c379 });
const s200bar = screen.style({ fg: 0x98c379, bg: 0x2d4a2d });
const s301 = screen.style({ fg: 0xe5c07b });
const s301bar = screen.style({ fg: 0xe5c07b, bg: 0x4a3d1a });
const s404 = screen.style({ fg: 0xe06c75 });
const s404bar = screen.style({ fg: 0xe06c75, bg: 0x4a2025 });
const s500 = screen.style({ fg: 0xe06c75, bold: true });
const s500bar = screen.style({ fg: 0xe06c75, bg: 0x4a2025 });
const sizeStyle = screen.style({ fg: 0xabb2bf });
const urlStyle = screen.style({ fg: 0xabb2bf });

interface Request {
  method: string;
  url: string;
  status: number;
  startMs: number;
  durationMs: number;
  size: string;
}

const requests: Request[] = [
  { method: "GET", url: "/", status: 200, startMs: 0, durationMs: 45, size: "4.2K" },
  { method: "GET", url: "/api/users", status: 200, startMs: 50, durationMs: 120, size: "12.8K" },
  { method: "GET", url: "/styles.css", status: 200, startMs: 55, durationMs: 30, size: "8.1K" },
  { method: "GET", url: "/app.js", status: 200, startMs: 60, durationMs: 85, size: "42.5K" },
  { method: "POST", url: "/api/auth", status: 200, startMs: 180, durationMs: 200, size: "0.3K" },
  { method: "GET", url: "/old-page", status: 301, startMs: 200, durationMs: 15, size: "0.1K" },
  { method: "GET", url: "/api/data", status: 200, startMs: 390, durationMs: 340, size: "98.4K" },
  { method: "GET", url: "/missing.png", status: 404, startMs: 400, durationMs: 25, size: "0.2K" },
  { method: "POST", url: "/api/submit", status: 500, startMs: 420, durationMs: 150, size: "0.5K" },
  { method: "GET", url: "/api/config", status: 200, startMs: 440, durationMs: 55, size: "1.1K" },
];

function statusStyle(s: number) {
  if (s >= 500) return s500;
  if (s >= 400) return s404;
  if (s >= 300) return s301;
  return s200;
}

function barStyle(s: number) {
  if (s >= 500) return s500bar;
  if (s >= 400) return s404bar;
  if (s >= 300) return s301bar;
  return s200bar;
}

// Title
screen.setText(1, 0, "Network Waterfall", titleStyle);
screen.setText(1, 1, "\u2500".repeat(width - 2), dimStyle);

// Column headers
const methodCol = 1;
const statusCol = 7;
const urlCol = 12;
const waterfallCol = 36;
const sizeCol = width - 8;

let y = 2;
screen.setText(methodCol, y, "Meth", headerStyle);
screen.setText(statusCol, y, "Code", headerStyle);
screen.setText(urlCol, y, "URL", headerStyle);
screen.setText(waterfallCol, y, "Timeline", headerStyle);
screen.setText(sizeCol, y, "Size", headerStyle);
y++;

// Compute waterfall scale
const maxEnd = Math.max(...requests.map(r => r.startMs + r.durationMs));
const waterfallWidth = sizeCol - waterfallCol - 2;

for (const req of requests) {
  const ms = screen.style({ fg: req.method === "POST" ? 0xc678dd : 0x61afef, bold: true });
  screen.setText(methodCol, y, req.method.padEnd(5), ms);
  screen.setText(statusCol, y, String(req.status), statusStyle(req.status));

  const shortUrl = req.url.length > 22 ? req.url.slice(0, 20) + ".." : req.url;
  screen.setText(urlCol, y, shortUrl, urlStyle);

  // Waterfall bar
  const barOffset = Math.round((req.startMs / maxEnd) * waterfallWidth);
  const barLen = Math.max(1, Math.round((req.durationMs / maxEnd) * waterfallWidth));
  // Light background track
  screen.fill(waterfallCol, y, waterfallWidth, 1, "\u2500", dimStyle);
  // Active bar
  screen.fill(waterfallCol + barOffset, y, barLen, 1, "\u2588", barStyle(req.status));

  // Duration label
  const durStr = `${req.durationMs}ms`;
  if (barOffset + barLen + durStr.length + 1 < waterfallWidth) {
    screen.setText(waterfallCol + barOffset + barLen + 1, y, durStr, dimStyle);
  }

  screen.setText(sizeCol, y, req.size.padStart(6), sizeStyle);
  y++;
}

// Summary
y++;
const total200 = requests.filter(r => r.status < 300).length;
const total3xx = requests.filter(r => r.status >= 300 && r.status < 400).length;
const totalErr = requests.filter(r => r.status >= 400).length;
screen.setText(1, y, `${requests.length} requests`, dimStyle);
screen.setText(16, y, `\u2714 ${total200} OK`, s200);
screen.setText(24, y, `\u2192 ${total3xx} redirect`, s301);
screen.setText(38, y, `\u2718 ${totalErr} errors`, s404);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
