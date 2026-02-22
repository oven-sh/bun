/**
 * demo-periodic.ts — A section of the periodic table rendered with colored boxes
 * per element group. Shows elements 1-18 with symbol, atomic number, colored by group.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 78);
const height = 18;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });

// Element groups with colors
const groups = {
  nonmetal: { color: 0x98c379, name: "Nonmetal" },
  noble: { color: 0xc678dd, name: "Noble Gas" },
  alkali: { color: 0xe06c75, name: "Alkali Metal" },
  alkaline: { color: 0xe5c07b, name: "Alkaline Earth" },
  metalloid: { color: 0x56b6c2, name: "Metalloid" },
  post: { color: 0x61afef, name: "Post-Trans. Metal" },
  halogen: { color: 0xd19a66, name: "Halogen" },
};

interface Element {
  num: number;
  sym: string;
  group: keyof typeof groups;
  col: number; // 0-indexed column in periodic table
  row: number; // 0-indexed row (period - 1)
}

const elements: Element[] = [
  // Period 1
  { num: 1, sym: "H", group: "nonmetal", col: 0, row: 0 },
  { num: 2, sym: "He", group: "noble", col: 17, row: 0 },
  // Period 2
  { num: 3, sym: "Li", group: "alkali", col: 0, row: 1 },
  { num: 4, sym: "Be", group: "alkaline", col: 1, row: 1 },
  { num: 5, sym: "B", group: "metalloid", col: 12, row: 1 },
  { num: 6, sym: "C", group: "nonmetal", col: 13, row: 1 },
  { num: 7, sym: "N", group: "nonmetal", col: 14, row: 1 },
  { num: 8, sym: "O", group: "nonmetal", col: 15, row: 1 },
  { num: 9, sym: "F", group: "halogen", col: 16, row: 1 },
  { num: 10, sym: "Ne", group: "noble", col: 17, row: 1 },
  // Period 3
  { num: 11, sym: "Na", group: "alkali", col: 0, row: 2 },
  { num: 12, sym: "Mg", group: "alkaline", col: 1, row: 2 },
  { num: 13, sym: "Al", group: "post", col: 12, row: 2 },
  { num: 14, sym: "Si", group: "metalloid", col: 13, row: 2 },
  { num: 15, sym: "P", group: "nonmetal", col: 14, row: 2 },
  { num: 16, sym: "S", group: "nonmetal", col: 15, row: 2 },
  { num: 17, sym: "Cl", group: "halogen", col: 16, row: 2 },
  { num: 18, sym: "Ar", group: "noble", col: 17, row: 2 },
];

// Each element cell is 4 chars wide, 3 rows tall
const cellW = 4;
const cellH = 3;
const gridX = 1;
const gridY = 3;

// Title
screen.setText(2, 0, "Periodic Table (Elements 1-18)", titleStyle);
screen.setText(2, 1, "\u2500".repeat(width - 4), dimStyle);

// Render elements
for (const el of elements) {
  const grp = groups[el.group];
  const x = gridX + el.col * cellW;
  const y = gridY + el.row * cellH;

  // Only render if it fits
  if (x + cellW > width) continue;

  const borderS = screen.style({ fg: grp.color });
  const numS = screen.style({ fg: grp.color, faint: true });
  const symS = screen.style({ fg: grp.color, bold: true });

  // Draw mini box
  screen.drawBox(x, y, cellW, cellH, { style: "single", styleId: borderS });

  // Atomic number (top-left inside)
  const numStr = String(el.num);
  screen.setText(x + 1, y, numStr, numS);

  // Symbol (center)
  screen.setText(x + 1, y + 1, el.sym, symS);
}

// Legend
const legendY = gridY + 3 * cellH + 1;
let lx = 2;
for (const [key, grp] of Object.entries(groups)) {
  const s = screen.style({ fg: grp.color });
  screen.setText(lx, legendY, "\u2588", s);
  screen.setText(lx + 2, legendY, grp.name, screen.style({ fg: grp.color, faint: true }));
  lx += grp.name.length + 4;
  if (lx > width - 15) {
    // Wrap to next line if needed
    break;
  }
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
