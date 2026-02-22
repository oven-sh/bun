/**
 * demo-changelog.ts — Styled changelog output with version headers,
 * categorized entries (Added, Fixed, Changed, Removed) with colored bullets.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 68);
const height = 36;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const versionStyle = screen.style({ fg: 0x61afef, bold: true });
const dateStyle = screen.style({ fg: 0x5c6370 });
const dimStyle = screen.style({ fg: 0x3e4452 });
const addedTag = screen.style({ fg: 0x282c34, bg: 0x98c379, bold: true });
const addedBullet = screen.style({ fg: 0x98c379 });
const fixedTag = screen.style({ fg: 0x282c34, bg: 0x61afef, bold: true });
const fixedBullet = screen.style({ fg: 0x61afef });
const changedTag = screen.style({ fg: 0x282c34, bg: 0xe5c07b, bold: true });
const changedBullet = screen.style({ fg: 0xe5c07b });
const removedTag = screen.style({ fg: 0x282c34, bg: 0xe06c75, bold: true });
const removedBullet = screen.style({ fg: 0xe06c75 });
const textStyle = screen.style({ fg: 0xabb2bf });

interface ChangeEntry {
  category: "Added" | "Fixed" | "Changed" | "Removed";
  text: string;
}

interface VersionEntry {
  version: string;
  date: string;
  changes: ChangeEntry[];
}

const changelog: VersionEntry[] = [
  {
    version: "v1.2.0",
    date: "2025-01-15",
    changes: [
      { category: "Added", text: "TUI screen rendering API" },
      { category: "Added", text: "True color support in terminal writer" },
      { category: "Fixed", text: "Wide character handling in fill()" },
      { category: "Changed", text: "Style capacity increased to 4096" },
    ],
  },
  {
    version: "v1.1.5",
    date: "2024-12-20",
    changes: [
      { category: "Fixed", text: "ZWJ emoji clustering in setText()" },
      { category: "Fixed", text: "BufferedWriter double-free on close" },
      { category: "Removed", text: "Deprecated Screen.render() method" },
    ],
  },
  {
    version: "v1.1.0",
    date: "2024-11-30",
    changes: [
      { category: "Added", text: "Box drawing with 5 border styles" },
      { category: "Added", text: "Clipping rectangle stack" },
      { category: "Changed", text: "Renamed Bun.Screen to Bun.TUIScreen" },
      { category: "Fixed", text: "Resize preserves existing content" },
    ],
  },
];

const tagStyles: Record<string, { tag: number; bullet: number }> = {
  Added: { tag: addedTag, bullet: addedBullet },
  Fixed: { tag: fixedTag, bullet: fixedBullet },
  Changed: { tag: changedTag, bullet: changedBullet },
  Removed: { tag: removedTag, bullet: removedBullet },
};

// Title
screen.setText(2, 0, "CHANGELOG", titleStyle);
screen.setText(2, 1, "\u2550".repeat(width - 4), dimStyle);

let y = 3;

for (const ver of changelog) {
  // Version header
  screen.setText(2, y, ver.version, versionStyle);
  screen.setText(2 + ver.version.length + 1, y, `(${ver.date})`, dateStyle);
  y++;
  screen.setText(2, y, "\u2500".repeat(width - 4), dimStyle);
  y++;

  for (const change of ver.changes) {
    const styles = tagStyles[change.category];

    // Category tag
    const tag = ` ${change.category} `;
    screen.setText(4, y, tag, styles.tag);

    // Bullet and text
    const textX = 4 + tag.length + 1;
    screen.setText(textX, y, "\u2022", styles.bullet);
    screen.setText(textX + 2, y, change.text, textStyle);
    y++;
  }
  y++; // gap between versions
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
