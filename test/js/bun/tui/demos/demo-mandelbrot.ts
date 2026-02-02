/**
 * demo-mandelbrot.ts — Render a section of the Mandelbrot set using Unicode
 * half-block characters and true color for double vertical resolution.
 * Computes the fractal mathematically.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const cols = Math.min(writer.columns || 80, 72);
const pixelRows = 40; // Pixel rows (doubled via half-blocks)
const screenRows = Math.ceil(pixelRows / 2) + 3;
const screen = new Bun.TUIScreen(cols, screenRows);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });

// Mandelbrot viewport
const xMin = -2.2;
const xMax = 0.8;
const yMin = -1.2;
const yMax = 1.2;

const maxIter = 80;

function mandelbrot(cx: number, cy: number): number {
  let zx = 0;
  let zy = 0;
  let i = 0;
  while (i < maxIter && zx * zx + zy * zy < 4) {
    const tmp = zx * zx - zy * zy + cx;
    zy = 2 * zx * zy + cy;
    zx = tmp;
    i++;
  }
  return i;
}

// Color palette based on iteration count
function iterToColor(iter: number): number {
  if (iter === maxIter) return 0x000000; // Inside the set: black

  // Smooth coloring using sinusoidal palette
  const t = iter / maxIter;
  const r = Math.round(9 * (1 - t) * t * t * t * 255);
  const g = Math.round(15 * (1 - t) * (1 - t) * t * t * 255);
  const b = Math.round(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

// Compute the fractal
const pixels: number[][] = []; // [row][col] = color
for (let py = 0; py < pixelRows; py++) {
  const row: number[] = [];
  const cy = yMin + (py / (pixelRows - 1)) * (yMax - yMin);
  for (let px = 0; px < cols; px++) {
    const cx = xMin + (px / (cols - 1)) * (xMax - xMin);
    const iter = mandelbrot(cx, cy);
    row.push(iterToColor(iter));
  }
  pixels.push(row);
}

// Title
screen.setText(2, 0, "Mandelbrot Set", titleStyle);

// Render using half-blocks for double vertical resolution
const renderY = 2;
for (let py = 0; py < pixelRows; py += 2) {
  for (let px = 0; px < cols; px++) {
    const topColor = pixels[py][px];
    const bottomColor = py + 1 < pixelRows ? pixels[py + 1][px] : 0x000000;

    const y = renderY + Math.floor(py / 2);

    if (topColor === bottomColor) {
      // Both same color: use full block with fg
      const s = screen.style({ fg: topColor });
      screen.setText(px, y, "\u2588", s);
    } else {
      // Upper half block: fg = top color, bg = bottom color
      const s = screen.style({ fg: topColor, bg: bottomColor });
      screen.setText(px, y, "\u2580", s);
    }
  }
}

// Info line
const infoY = renderY + Math.ceil(pixelRows / 2);
const info = `${cols}x${pixelRows}px  x:[${xMin}, ${xMax}]  y:[${yMin}, ${yMax}]  max_iter:${maxIter}`;
screen.setText(2, infoY, info, dimStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
