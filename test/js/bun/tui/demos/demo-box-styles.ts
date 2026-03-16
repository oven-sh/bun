/**
 * demo-box-styles.ts — Shows all 5 box drawing styles (single, double, rounded, heavy, ascii)
 * side by side with labels inside each box.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 78);
const height = 12;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });

const boxStyles: { name: string; style: "single" | "double" | "rounded" | "heavy" | "ascii"; color: number }[] = [
  { name: "single", style: "single", color: 0x61afef },
  { name: "double", style: "double", color: 0x98c379 },
  { name: "rounded", style: "rounded", color: 0xe5c07b },
  { name: "heavy", style: "heavy", color: 0xe06c75 },
  { name: "ascii", style: "ascii", color: 0xc678dd },
];

screen.setText(2, 0, "Box Drawing Styles", titleStyle);
screen.setText(2, 1, "\u2500".repeat(width - 4), dimStyle);

const boxWidth = 14;
const boxHeight = 7;
const gap = 1;
const startY = 3;

// Calculate start X to center the boxes
const totalWidth = boxStyles.length * boxWidth + (boxStyles.length - 1) * gap;
const startX = Math.max(1, Math.floor((width - totalWidth) / 2));

for (let i = 0; i < boxStyles.length; i++) {
  const bs = boxStyles[i];
  const x = startX + i * (boxWidth + gap);
  const borderStyle = screen.style({ fg: bs.color });
  const labelStyle2 = screen.style({ fg: bs.color, bold: true });

  screen.drawBox(x, startY, boxWidth, boxHeight, {
    style: bs.style,
    styleId: borderStyle,
    fill: true,
    fillChar: " ",
  });

  // Label centered inside the box
  const labelX = x + Math.floor((boxWidth - bs.name.length) / 2);
  screen.setText(labelX, startY + 2, bs.name, labelStyle2);

  // Show a sample character
  const sampleStyle = screen.style({ fg: bs.color, faint: true });
  screen.setText(x + 2, startY + 4, "Hello!", sampleStyle);
}

// Footer note
screen.setText(2, startY + boxHeight + 1, "Each box uses a different border drawing style", dimStyle);

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
