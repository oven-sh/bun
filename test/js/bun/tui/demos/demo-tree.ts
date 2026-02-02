/**
 * demo-tree.ts — Renders a directory tree structure with icons.
 * Uses box-drawing characters with file-type coloring.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = writer.columns || 80;

interface TreeEntry {
  name: string;
  type: "dir" | "ts" | "json" | "md" | "zig" | "file" | "lock";
  children?: TreeEntry[];
}

const tree: TreeEntry = {
  name: "my-project/",
  type: "dir",
  children: [
    {
      name: "src/",
      type: "dir",
      children: [
        { name: "index.ts", type: "ts" },
        { name: "server.ts", type: "ts" },
        {
          name: "utils/",
          type: "dir",
          children: [
            { name: "helpers.ts", type: "ts" },
            { name: "constants.ts", type: "ts" },
          ],
        },
        {
          name: "routes/",
          type: "dir",
          children: [
            { name: "api.ts", type: "ts" },
            { name: "auth.ts", type: "ts" },
          ],
        },
      ],
    },
    {
      name: "test/",
      type: "dir",
      children: [
        { name: "server.test.ts", type: "ts" },
        { name: "helpers.test.ts", type: "ts" },
      ],
    },
    {
      name: "lib/",
      type: "dir",
      children: [{ name: "native.zig", type: "zig" }],
    },
    { name: "package.json", type: "json" },
    { name: "tsconfig.json", type: "json" },
    { name: "bun.lock", type: "lock" },
    { name: "README.md", type: "md" },
  ],
};

// Collect all lines
const lines: { indent: string; name: string; type: string }[] = [];

function walk(node: TreeEntry, prefix: string, isLast: boolean, isRoot: boolean) {
  const connector = isRoot ? "" : isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
  lines.push({ indent: prefix + connector, name: node.name, type: node.type });
  if (node.children) {
    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "\u2502   ");
    node.children.forEach((child, i) => {
      walk(child, childPrefix, i === node.children!.length - 1, false);
    });
  }
}
walk(tree, "", true, true);

const height = lines.length + 3;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const treeChars = screen.style({ fg: 0x555555 });
const dirStyle = screen.style({ fg: 0x61afef, bold: true });
const tsStyle = screen.style({ fg: 0x98c379 });
const jsonStyle = screen.style({ fg: 0xe5c07b });
const mdStyle = screen.style({ fg: 0xc678dd });
const zigStyle = screen.style({ fg: 0xf0a030 });
const fileStyle = screen.style({ fg: 0xabb2bf });

const typeIcons: Record<string, string> = {
  dir: "\uD83D\uDCC1 ",
  ts: "\uD83D\uDCC4 ",
  json: "\u2699\uFE0F  ",
  md: "\uD83D\uDCD6 ",
  zig: "\u26A1 ",
  file: "\uD83D\uDCC4 ",
  lock: "\uD83D\uDD12 ",
};

const typeStyles: Record<string, number> = {
  dir: dirStyle,
  ts: tsStyle,
  json: jsonStyle,
  md: mdStyle,
  zig: zigStyle,
  file: fileStyle,
  lock: fileStyle,
};

// Title
screen.setText(1, 0, "Project Structure", titleStyle);
const sep = "\u2500".repeat(Math.min(40, width - 2));
screen.setText(1, 1, sep, screen.style({ fg: 0x444444 }));

// Render tree lines
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const y = i + 2;
  let x = 1;
  // Draw tree connector chars
  x += screen.setText(x, y, line.indent, treeChars);
  // Draw name with type coloring
  screen.setText(x, y, line.name, typeStyles[line.type] ?? fileStyle);
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
