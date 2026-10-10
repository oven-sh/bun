// Puts the cursor at every `step`-th offset of each file: which nodes Prettier finds around it (`getCursorLocation`) and where
// `formatWithCursor` says it ends up, against `bun-lint format cursor`. Files with `\r` or with anything that is not ASCII are passed over:
// the two count offsets in different units.
//
//   bun cursor.ts <bun-lint> <directory with node_modules/prettier> <step> <files and directories..>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
const [bin, prettierRoot, step] = process.argv.slice(2);
const root = resolve(prettierRoot, "node_modules/prettier");
const prettier = await import(join(root, "index.mjs"));
const { getVisitorKeys } = (await import(join(root, "plugins/estree.mjs"))).printers.estree;
const parsers = { ...(await import(join(root, "plugins/typescript.mjs"))).parsers, ...(await import(join(root, "plugins/babel.mjs"))).parsers };

type Node = Record<string, unknown>;
const isObject = (value: unknown): value is Node => value !== null && typeof value === "object";
function* children(node: Node, filter: (node: Node) => boolean = () => true): Generator<Node> {
  for (const key of getVisitorKeys(node)) {
    for (const child of [node[key]].flat()) if (isObject(child) && filter(child)) yield child;
  }
}

/** Prettier's `getCursorLocation` */
function locate(ast: Node, offset: number, start: (node: Node) => number, end: (node: Node) => number) {
  const contains = (node: Node) => start(node) <= offset && end(node) >= offset;
  const containing = [ast];
  for (let i = 0; i < containing.length; i++) containing.push(...children(containing[i], contains));
  let node = containing.at(-1)!;
  if (children(node).next().done) return `node ${start(node)} ${end(node)}`;
  let before: Node | undefined, after: Node | undefined;
  while (containing.length > 0 && (before === undefined || after === undefined)) {
    node = containing.pop()!;
    const [hasBefore, hasAfter] = [before !== undefined, after !== undefined];
    for (const child of children(node)) {
      if (!hasBefore && end(child) <= offset && end(child) > (before ? end(before) : -1)) before = child;
      if (!hasAfter && start(child) >= offset && start(child) < (after ? start(after) : Infinity)) after = child;
    }
  }
  const show = (node?: Node) => (node ? `${start(node)}-${end(node)}` : "-");
  return `between ${show(before)} ${show(after)}`;
}

function* walk(path: string): Generator<string> {
  if (statSync(path).isDirectory()) { for (const name of readdirSync(path).sort()) if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name)); }
  else if (/\.[cm]?[jt]sx?$/.test(path)) yield path;
}

let [offsets, differ, files] = [0, 0, 0];
for (const path of process.argv.slice(5).flatMap(it => [...walk(it)])) {
  const text = readFileSync(path, "utf8");
  if (/[^\x00-\x7f]|\r|<\|>/.test(text)) continue;
  const { locStart, locEnd } = parsers[/\.[cm]?tsx?$/.test(path) ? "typescript" : "babel"];
  const expected: string[] = [];
  try {
    const { ast } = await prettier.__debug.parse(text, { filepath: path });
    for (let offset = 0; offset <= text.length; offset += Number(step)) {
      const { cursorOffset } = await prettier.formatWithCursor(text, { filepath: path, cursorOffset: offset });
      expected.push(`${offset} ${locate(ast, offset, locStart, locEnd)} -> ${cursorOffset}`);
    }
  } catch {
    continue;
  }
  const actual = Bun.spawnSync([bin, "format", "cursor", path, `--step=${step}`]).stdout.toString().trimEnd().split("\n");
  const wrong = expected.flatMap((line, index) => (line === actual[index] ? [] : [`  Prettier: ${line}\n  ours:     ${actual[index]}`]));
  files++;
  offsets += expected.length;
  differ += wrong.length;
  if (wrong.length) console.log(`${path}: ${wrong.length} of ${expected.length}\n${wrong.slice(0, 3).join("\n")}`);
}
console.log(`${files} files, ${offsets} offsets, ${differ} differ`);
