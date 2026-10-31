// Writes `comment-owners.txt`: the node that Prettier attaches each comment in the `cases` inputs to.
//
//   bun test/cli/format/own/comment-owners.ts <directory with node_modules/prettier>
//
// `../conformance.test.ts` compares it with `bun fmt --debug-comments`. After a line with the name of an input, there is one line
// per comment:
//
//   <start> <end> <L, T or D> <type of the node> <start> <end> <marker, or -> [unignore]
//
// L, T and D are leading, trailing and dangling. The offsets are bytes. Those of the node are Prettier's `locStart` and `locEnd`.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collect } from "../bundle.ts";

const [prettierRoot] = process.argv.slice(2);
if (!prettierRoot) {
  console.error("usage: bun comment-owners.ts <directory with node_modules/prettier>");
  process.exit(1);
}
const prettier = await import(resolve(prettierRoot, "node_modules/prettier/index.mjs"));

type Node = { type: string; [key: string]: any };
const rangeStart = (node: Node): number => node.range?.[0] ?? node.start;
const rangeEnd = (node: Node): number => node.range?.[1] ?? node.end;

// `src/language-js/loc.js`
function locStart(node: Node): number {
  const decorator = (node.declaration?.decorators ?? node.decorators)?.[0];
  return decorator ? Math.min(locStart(decorator), rangeStart(node)) : rangeStart(node);
}
const endsAtBody = ["ForInStatement", "ForOfStatement", "ForStatement", "LabeledStatement", "WithStatement", "WhileStatement"];
const endsBeforeSemicolon = [
  "ExpressionStatement",
  "Directive",
  "ImportDeclaration",
  "ExportDefaultDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "ReturnStatement",
  "ThrowStatement",
  "DoWhileStatement",
];
function locEnd(node: Node): number {
  if (node.type === "IfStatement") return locEnd(node.alternate ?? node.consequent);
  if (endsAtBody.includes(node.type)) return locEnd(node.body);
  if (node.type === "BreakStatement") return node.label ? locEnd(node.label) : locStart(node) + "break".length;
  if (node.type === "ContinueStatement") return node.label ? locEnd(node.label) : locStart(node) + "continue".length;
  if (node.type === "DebuggerStatement") return locStart(node) + "debugger".length;
  if (node.type === "VariableDeclaration") return locEnd(node.declarations.at(-1));
  return (endsBeforeSemicolon.includes(node.type) ? node.__contentEnd : undefined) ?? rangeEnd(node);
}

const files = new Map<string, Uint8Array>();
collect(import.meta.dir, "cases", files, name => !name.endsWith(".input"));
let output = "";
for (const [path, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const name = path.slice("cases/".length, -".input".length);
  // A Flow case sets its parser in its `options.json`.
  if (!/\.[cm]?[jt]sx?$/.test(name) || name.startsWith("flow/")) continue;
  const text = Buffer.from(bytes).toString();
  const byteOffset = (index: number) => Buffer.byteLength(text.slice(0, index));
  let ast: Node;
  try {
    ({ ast } = await prettier.__debug.parse(text, { filepath: name }));
    // Attaches the comments.
    await prettier.__debug.formatAST(ast, { filepath: name, originalText: text });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.error(`${name}: Prettier does not parse it`);
    continue;
  }
  const lines: [number, string][] = [];
  const seen = new Set<object>();
  (function visit(value: any) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value.type === "string" && rangeStart(value) !== undefined) {
      for (const comment of value.comments ?? []) {
        const placement = comment.leading ? "L" : comment.trailing ? "T" : "D";
        const [start, end] = [byteOffset(rangeStart(comment)), byteOffset(rangeEnd(comment))];
        const owner = `${value.type} ${byteOffset(locStart(value))} ${byteOffset(locEnd(value))}`;
        const unignore = comment.unignore ? " unignore" : "";
        lines.push([start, `${start} ${end} ${placement} ${owner} ${comment.marker ?? "-"}${unignore}`]);
      }
    }
    for (const key in value) if (!["comments", "tokens", "loc", "extra", "errors"].includes(key)) visit(value[key]);
  })(ast);
  if (lines.length === 0) continue;
  lines.sort(([a], [b]) => a - b);
  output += `${name}\n${lines.map(([, line]) => line + "\n").join("")}`;
}
writeFileSync(join(import.meta.dir, "comment-owners.txt"), output);
