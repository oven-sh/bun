/**
 * demo-barh.ts — Horizontal bar chart comparing JS runtimes (Bun, Node, Deno)
 * on different benchmarks. Colored bars with labels and values.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 76);
const height = 24;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });
const bunStyle = screen.style({ fg: 0xfbf0df, bg: 0xfbf0df });
const bunLabel = screen.style({ fg: 0xfbf0df, bold: true });
const nodeStyle = screen.style({ fg: 0x68a063, bg: 0x68a063 });
const nodeLabel = screen.style({ fg: 0x68a063 });
const denoStyle = screen.style({ fg: 0x70ffaf, bg: 0x70ffaf });
const denoLabel = screen.style({ fg: 0x70ffaf });
const valStyle = screen.style({ fg: 0xabb2bf });
const unitStyle = screen.style({ fg: 0x5c6370 });
const headerStyle = screen.style({ fg: 0xe5c07b, bold: true });

const benchmarks = [
  {
    name: "HTTP req/s",
    unit: "req/s",
    results: [
      { runtime: "Bun", value: 112400, style: bunStyle, label: bunLabel },
      { runtime: "Node", value: 47200, style: nodeStyle, label: nodeLabel },
      { runtime: "Deno", value: 68300, style: denoStyle, label: denoLabel },
    ],
  },
  {
    name: "FFI calls/s",
    unit: "calls/s",
    results: [
      { runtime: "Bun", value: 320000, style: bunStyle, label: bunLabel },
      { runtime: "Node", value: 89000, style: nodeStyle, label: nodeLabel },
      { runtime: "Deno", value: 142000, style: denoStyle, label: denoLabel },
    ],
  },
  {
    name: "File read MB/s",
    unit: "MB/s",
    results: [
      { runtime: "Bun", value: 3800, style: bunStyle, label: bunLabel },
      { runtime: "Node", value: 1200, style: nodeStyle, label: nodeLabel },
      { runtime: "Deno", value: 1900, style: denoStyle, label: denoLabel },
    ],
  },
  {
    name: "Startup (ms)",
    unit: "ms",
    results: [
      { runtime: "Bun", value: 7, style: bunStyle, label: bunLabel },
      { runtime: "Node", value: 35, style: nodeStyle, label: nodeLabel },
      { runtime: "Deno", value: 24, style: denoStyle, label: denoLabel },
    ],
  },
];

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

// Title
screen.drawBox(0, 0, width, 3, { style: "rounded", styleId: dimStyle, fill: true, fillChar: " " });
const title = "JavaScript Runtime Benchmarks";
screen.setText(Math.floor((width - title.length) / 2), 1, title, titleStyle);

// Legend
let ly = 3;
screen.setText(4, ly, "\u2588 Bun", bunLabel);
screen.setText(16, ly, "\u2588 Node.js", nodeLabel);
screen.setText(30, ly, "\u2588 Deno", denoLabel);

const labelCol = 2;
const barStart = 20;
const maxBarWidth = width - barStart - 12;

let y = 5;
for (const bench of benchmarks) {
  screen.setText(labelCol, y, bench.name, headerStyle);
  y++;

  const maxVal = Math.max(...bench.results.map(r => r.value));

  for (const result of bench.results) {
    const barLen = Math.max(1, Math.round((result.value / maxVal) * maxBarWidth));
    screen.setText(labelCol + 2, y, result.runtime.padEnd(6), result.label);
    screen.fill(barStart, y, barLen, 1, "\u2588", result.style);
    const valStr = ` ${formatNum(result.value)}`;
    screen.setText(barStart + barLen, y, valStr, valStyle);
    screen.setText(barStart + barLen + valStr.length, y, ` ${bench.unit}`, unitStyle);
    y++;
  }
  y++; // gap between benchmarks
}

// Footer note
screen.setText(2, y, "* Lower is better for Startup", dimStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
