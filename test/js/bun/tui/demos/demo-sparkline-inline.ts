/**
 * demo-sparkline-inline.ts — Renders several inline sparklines with labels
 * showing CPU, Memory, Network, and Disk time series data.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 72);
const height = 14;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });
const labelStyle = screen.style({ fg: 0xabb2bf });
const valueStyle = screen.style({ fg: 0xe5c07b, bold: true });

const sparkColors = {
  cpu: screen.style({ fg: 0xe06c75 }),
  mem: screen.style({ fg: 0x61afef }),
  net: screen.style({ fg: 0x98c379 }),
  disk: screen.style({ fg: 0xc678dd }),
  latency: screen.style({ fg: 0xe5c07b }),
};

const sparkChars = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

// Seeded pseudo-random for reproducibility
let seed = 1337;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function generateSeries(len: number, min: number, max: number, smooth = true): number[] {
  const data: number[] = [];
  let val = min + rand() * (max - min);
  for (let i = 0; i < len; i++) {
    if (smooth) {
      val += (rand() - 0.5) * (max - min) * 0.3;
      val = Math.max(min, Math.min(max, val));
    } else {
      val = min + rand() * (max - min);
    }
    data.push(val);
  }
  return data;
}

function sparkline(data: number[], min: number, max: number): string {
  return data
    .map(v => {
      const idx = Math.round(((v - min) / (max - min)) * (sparkChars.length - 1));
      return sparkChars[Math.max(0, Math.min(sparkChars.length - 1, idx))];
    })
    .join("");
}

const sparkWidth = width - 30;

interface MetricDef {
  label: string;
  unit: string;
  min: number;
  max: number;
  color: number;
  key: keyof typeof sparkColors;
}

const metrics: MetricDef[] = [
  { label: "CPU Usage", unit: "%", min: 0, max: 100, color: 0xe06c75, key: "cpu" },
  { label: "Memory", unit: "GB", min: 2, max: 16, color: 0x61afef, key: "mem" },
  { label: "Network I/O", unit: "MB/s", min: 0, max: 500, color: 0x98c379, key: "net" },
  { label: "Disk I/O", unit: "MB/s", min: 0, max: 200, color: 0xc678dd, key: "disk" },
  { label: "Latency", unit: "ms", min: 1, max: 50, color: 0xe5c07b, key: "latency" },
];

// Title
screen.setText(2, 0, "System Metrics (last 60s)", titleStyle);
screen.setText(2, 1, "\u2500".repeat(width - 4), dimStyle);

let y = 3;
for (const metric of metrics) {
  const data = generateSeries(sparkWidth, metric.min, metric.max);
  const lastVal = data[data.length - 1];
  const spark = sparkline(data, metric.min, metric.max);

  screen.setText(2, y, metric.label.padEnd(12), labelStyle);

  // Draw sparkline chars individually with color
  const sparkStr = spark;
  screen.setText(15, y, sparkStr, sparkColors[metric.key]);

  // Current value
  const valStr = `${lastVal.toFixed(1)} ${metric.unit}`;
  screen.setText(15 + sparkWidth + 1, y, valStr, valueStyle);

  y += 2;
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
