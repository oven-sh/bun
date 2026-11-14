// Writes a program again with blanks, comments and empty lines sown between its tokens. The program means the same: only where its text stands has changed.
//
//   bun test/aot/tools/sow-blanks-and-comments.ts [--kinds=<kind>,..] [--every=<n>] [--in=<path suffix>] [--places=<n>,..] [--list-places] <file or folder>..      rewrites the files in place
//
//   blanks      a  =   b            one to four blanks in front of a token
//   comments    a /* sown */ = b    a comment that holds no line break
//   lines       a whole line `// sown`, or an empty one, in front of a token that begins its line
//
// `--every=<n>` sows in front of one token in n (default 3). What is sown where follows from the text alone, so the same text is always rewritten alike.
//
// Left as written:
//   - the inside of a token: strings, templates, regular expressions, comments
//   - the children of a JSX element, where a blank is text, and `<`, `</`, `/>` and `>` of a tag
//   - a line break is sown only where one stands already, so no statement ends earlier than it did
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import ts from "typescript";

export const kinds = ["blanks", "comments", "lines"] as const;
export type Kind = (typeof kinds)[number];
export type Choice = { kinds?: ReadonlySet<Kind>; every?: number; places?: ReadonlySet<number>; found?: number[] };

function scriptKindOf(path: string) {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

const isBracketOfTag = (node: ts.Node) =>
  node.kind === ts.SyntaxKind.LessThanToken ||
  node.kind === ts.SyntaxKind.LessThanSlashToken ||
  node.kind === ts.SyntaxKind.SlashToken ||
  node.kind === ts.SyntaxKind.GreaterThanToken;
const isTag = (node: ts.Node) =>
  ts.isJsxOpeningLikeElement(node) ||
  ts.isJsxClosingElement(node) ||
  ts.isJsxOpeningFragment(node) ||
  ts.isJsxClosingFragment(node);

/** The start of every token in front of which something may be sown, in order. */
function startsOfTokens(file: ts.SourceFile): number[] {
  const starts: number[] = [];
  function visit(node: ts.Node, isChildOfElement: boolean) {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(file);
    if (children.length === 0) {
      const isLeft = isChildOfElement || node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.EndOfFileToken || (isBracketOfTag(node) && isTag(node.parent)); // prettier-ignore
      if (!isLeft && node.getWidth(file) > 0) starts.push(node.getStart(file));
      return;
    }
    const holdsText = ts.isJsxElement(node) || ts.isJsxFragment(node);
    let isFirst = true;
    for (const child of children) {
      // A list of syntax stands for its parent: the children of an element are in one.
      const inText = holdsText || (node.kind === ts.SyntaxKind.SyntaxList && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))); // prettier-ignore
      visit(child, inText ? true : isChildOfElement && isFirst);
      if (child.getWidth(file) > 0) isFirst = false;
    }
  }
  visit(file, false);
  // A statement beside a top-level `await` can be listed twice.
  return [...new Set(starts)].sort((a, b) => a - b);
}

export function sow(text: string, path: string, choice: Choice = {}): string {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));
  const asked = kinds.filter(kind => !choice.kinds || choice.kinds.has(kind));
  const every = choice.every ?? 3;
  let state = 2166136261;
  for (let i = 0; i < text.length; i += 7) state = Math.imul(state ^ text.charCodeAt(i), 16777619) >>> 0;
  const next = (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % below;
  };
  let result = "";
  let at = 0;
  let place = 0;
  for (const start of startsOfTokens(file)) {
    const [isChosen, kind, count] = [next(every) === 0, asked[next(asked.length)], 1 + next(4)];
    if (!isChosen) continue;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const indentation = text.slice(lineStart, start);
    const beginsItsLine = lineStart > 0 && /^[ \t]*$/.test(indentation);
    // `// @ts-expect-error` speaks of the line below it.
    const lineAbove = text.slice(text.lastIndexOf("\n", lineStart - 2) + 1, lineStart);
    if (kind === "lines" && (!beginsItsLine || lineAbove.includes("@ts-"))) continue;
    const index = place++;
    choice.found?.push(start);
    if (choice.places && !choice.places.has(index)) continue;
    const sown =
      kind === "blanks"
        ? " ".repeat(count)
        : kind === "comments"
          ? ` /* ${"sown ".repeat(count)}*/ `
          : (count % 2 ? "// sown" : "") + "\n" + indentation;
    result += text.slice(at, start) + sown;
    at = start;
  }
  return result + text.slice(at);
}

const isProgramText = (name: string) => /\.([cm]?[jt]s|[jt]sx)$/.test(name) && !/\.d\.[cm]?ts$/.test(name);

export function sowFiles(path: string, choice: Choice = {}): number {
  if (statSync(path).isDirectory())
    return readdirSync(path).reduce((count, name) => count + sowFiles(join(path, name), choice), 0);
  if (!isProgramText(path)) return 0;
  const before = readFileSync(path, "utf8");
  const after = sow(before, path, choice);
  if (after !== before) writeFileSync(path, after);
  return 1;
}

if (import.meta.main) {
  const rest = process.argv.slice(2);
  const within = rest.find(argument => argument.startsWith("--in="))?.slice(5);
  const paths = rest.filter(
    argument => !argument.startsWith("--") && (within === undefined || argument.endsWith(within)),
  );
  if (within !== undefined && paths.length === 0) process.exit(0);
  const listed = (flag: string) =>
    rest.filter(argument => argument.startsWith(flag)).flatMap(argument => argument.slice(flag.length).split(","));
  const asked = listed("--kinds=") as Kind[];
  const places = listed("--places=").map(Number);
  const every = Number(listed("--every=")[0] ?? 3);
  if (paths.length === 0 || asked.some(kind => !kinds.includes(kind)) || !(every >= 1)) {
    console.error(
      `usage: sow-blanks-and-comments.ts [--kinds=<${kinds.join(" | ")}>,..] [--every=<n>] <file or folder>..`,
    );
    process.exit(2);
  }
  const choice: Choice = { kinds: asked.length ? new Set(asked) : undefined, every };
  if (rest.includes("--list-places")) {
    for (const path of paths) {
      const found: number[] = [];
      const text = readFileSync(path, "utf8");
      sow(text, path, { ...choice, places: new Set(), found });
      for (const [index, at] of found.entries())
        console.log(`${path}\t${index}\t${text.slice(0, at).split("\n").length}`);
    }
    process.exit(0);
  }
  let count = 0;
  for (const path of paths) count += sowFiles(path, { ...choice, places: places.length ? new Set(places) : undefined });
  console.log(`${count} files`);
}
