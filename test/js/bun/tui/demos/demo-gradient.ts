/**
 * demo-gradient.ts — Renders multiple color gradient strips (rainbow, warm, cool, grayscale)
 * using true color. Each strip is one row of colored block characters.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 72);
const height = 16;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const labelStyle = screen.style({ fg: 0xabb2bf });
const dimStyle = screen.style({ fg: 0x5c6370 });

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function rgbToHex(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

interface GradientDef {
  name: string;
  fn: (t: number) => number; // t: 0..1 -> rgb hex
}

const gradients: GradientDef[] = [
  {
    name: "Rainbow",
    fn: t => {
      const [r, g, b] = hslToRgb(t * 360, 1.0, 0.5);
      return rgbToHex(r, g, b);
    },
  },
  {
    name: "Warm",
    fn: t => {
      const r = lerp(255, 255, t);
      const g = lerp(50, 200, t);
      const b = lerp(0, 50, t);
      return rgbToHex(r, g, b);
    },
  },
  {
    name: "Cool",
    fn: t => {
      const r = lerp(0, 100, t);
      const g = lerp(100, 200, t);
      const b = lerp(200, 255, t);
      return rgbToHex(r, g, b);
    },
  },
  {
    name: "Ocean",
    fn: t => {
      const r = lerp(0, 20, t);
      const g = lerp(30, 180, t);
      const b = lerp(80, 255, t);
      return rgbToHex(r, g, b);
    },
  },
  {
    name: "Forest",
    fn: t => {
      const r = lerp(10, 80, t);
      const g = lerp(40, 200, t);
      const b = lerp(10, 60, t);
      return rgbToHex(r, g, b);
    },
  },
  {
    name: "Sunset",
    fn: t => {
      if (t < 0.5) {
        const t2 = t * 2;
        return rgbToHex(lerp(255, 255, t2), lerp(60, 150, t2), lerp(0, 50, t2));
      }
      const t2 = (t - 0.5) * 2;
      return rgbToHex(lerp(255, 100, t2), lerp(150, 50, t2), lerp(50, 150, t2));
    },
  },
  {
    name: "Grayscale",
    fn: t => {
      const v = Math.round(t * 255);
      return rgbToHex(v, v, v);
    },
  },
];

// Title
screen.setText(2, 0, "True Color Gradients", titleStyle);
screen.setText(2, 1, "\u2500".repeat(width - 4), dimStyle);

const stripStart = 13;
const stripWidth = width - stripStart - 2;
let y = 3;

for (const grad of gradients) {
  screen.setText(2, y, grad.name.padEnd(10), labelStyle);
  for (let x = 0; x < stripWidth; x++) {
    const t = x / (stripWidth - 1);
    const color = grad.fn(t);
    const s = screen.style({ fg: color });
    screen.setText(stripStart + x, y, "\u2588", s);
  }
  y += 2;
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
