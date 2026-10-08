// Inserts one comment into a snippet of real code and compares Prettier's output with ours. The differences are written as
// JSON lines, each with a key that says where Prettier attaches the comment: `comment-fuzz-report.ts` groups them by it.
//
//   bun comment-fuzz.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --out=<file.jsonl> --tmp=<directory>
//     [--oxfmt=<path of oxfmt's dist/index.js>: compare with oxfmt, in its flavor] [--shard=i/n] [--max-snippets=n] [--min-lines=n] [--per-file=n] [--options=json] [--kinds=eol,own,..] [--mark=prettier-ignore: the text of the comment] <files and directories..>
//
// A snippet is a statement at the top of a file, of 3 to 45 lines, that both format the same without the comment.
// Kinds: `eol` (` // c` at the end of each line), `eolns` (without the space), `eolblock`, `eolblockns`, `own` (on a line of its
// own before each line), `ownblock`, `startblock` (a block comment at the start of each line), `inline` (after a space in the
// line), `anyblock` and `anyline` (at every token boundary).
import { readdirSync, statSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const flags = new Map<string, string>();
const roots: string[] = [];
for (const arg of process.argv.slice(2)) {
  const match = /^--([\w-]+)=(.*)$/s.exec(arg);
  if (match) flags.set(match[1], match[2]);
  else roots.push(arg);
}
const bin = flags.get("bin")!;
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
const [shard, shards] = (flags.get("shard") ?? "0/1").split("/").map(Number);
const out = flags.get("out")!;
const maxSnippets = Number(flags.get("max-snippets") ?? 200);
const kinds = (flags.get("kinds") ?? "eol,own").split(",");
const options: Record<string, unknown> = JSON.parse(flags.get("options") ?? "{}");
const oxfmt = flags.has("oxfmt") ? await import(flags.get("oxfmt")!) : undefined;
const tmp = flags.get("tmp")!;

const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
function* walk(path: string): Generator<string> {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name));
    }
  } else if (extensions.has(extname(path)) && !path.endsWith(".d.ts") && !path.includes(".min.")) {
    yield path;
  }
}

const server = Bun.spawn({ cmd: [bin, "format", "serve", ...(oxfmt ? ["--flavor=oxfmt"] : []), ...Object.entries(options).map(([name, value]) => `--${name}=${value}`)], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const reader = server.stdout.getReader();
let buffered = new Uint8Array(0);
async function fill() {
  const { value, done } = await reader.read();
  if (done) throw new Error("bun-lint has exited");
  const joined = new Uint8Array(buffered.length + value.length);
  joined.set(buffered);
  joined.set(value, buffered.length);
  buffered = joined;
}
async function readLine() {
  let end: number;
  while ((end = buffered.indexOf(10)) < 0) await fill();
  const line = new TextDecoder().decode(buffered.subarray(0, end));
  buffered = buffered.subarray(end + 1);
  return line;
}
async function readBytes(length: number) {
  while (buffered.length < length) await fill();
  const bytes = buffered.subarray(0, length);
  buffered = buffered.subarray(length);
  return new TextDecoder().decode(bytes);
}
async function ours(text: string, ext: string): Promise<string | undefined> {
  const path = `${tmp}/s${shard}${ext}`;
  writeFileSync(path, text);
  server.stdin.write(path + "\n");
  server.stdin.flush();
  const line = await readLine();
  if (line.startsWith("ok ")) return await readBytes(Number(line.slice(3)));
  return undefined;
}

const MARK = flags.get("mark") ?? "c0mment";
function find(ast: any): { key: string } | undefined {
  // The node that the comment is attached to, and its parent.
  const stack: [any, any, string][] = [[ast, undefined, ""]];
  const seen = new Set();
  while (stack.length) {
    const [node, parent, prop] = stack.pop()!;
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) stack.push([child, parent, prop]);
      continue;
    }
    if (typeof node.type !== "string") continue;
    if (Array.isArray(node.comments)) {
      for (const comment of node.comments) {
        if (typeof comment.value === "string" && comment.value.includes(MARK)) {
          const how = comment.leading ? "leading" : comment.trailing ? "trailing" : "dangling";
          return { key: `${comment.placement} ${how} ${parent?.type ?? "-"}.${prop} > ${node.type}` };
        }
      }
    }
    for (const name in node) {
      if (name === "comments" || name === "tokens" || name === "loc" || name === "range" || name === "parent") continue;
      stack.push([node[name], node, name]);
    }
  }
}

let files = [...roots.flatMap(root => [...walk(root)])];
// A fixed shuffle.
let seed = 12345;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = files.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [files[i], files[j]] = [files[j], files[i]];
}
files = files.filter((_, index) => index % shards === shard);

let snippets = 0, variants = 0, different = 0;
for (const path of files) {
  if (snippets >= maxSnippets) break;
  const ext = extname(path);
  const text = readFileSync(path, "utf8");
  if (text.length > 400_000) continue;
  let parsed: any;
  const parser = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts" ? "typescript" : "babel";
  try {
    parsed = await prettier.__debug.parse(text, { filepath: path, parser });
  } catch {
    continue;
  }
  const body = parsed.ast.program?.body ?? parsed.ast.body;
  if (!Array.isArray(body)) continue;
  const candidates = body.filter((s: any) => {
    const [start, end] = s.range ?? [s.start, s.end];
    const lines = text.slice(start, end).split("\n").length;
    return lines >= Number(flags.get("min-lines") ?? 3) && lines <= 45;
  });
  // At most three per file.
  for (let n = 0; n < Number(flags.get("per-file") ?? 3) && candidates.length > 0 && snippets < maxSnippets; n++) {
    const [statement] = candidates.splice(Math.floor(random() * candidates.length), 1);
    const [start, end] = statement.range ?? [statement.start, statement.end];
    const snippet = text.slice(start, end) + "\n";
    let expectedBase: string;
    try {
      expectedBase = oxfmt ? (await oxfmt.format(path, snippet, options)).code : await prettier.format(snippet, { ...options, filepath: path, parser });
    } catch {
      continue;
    }
    if ((await ours(snippet, ext)) !== expectedBase) continue;
    snippets++;
    const lines = snippet.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const expanded: [string, number][] = [];
      for (const kind of kinds) {
        if (kind === "anyblock" || kind === "anyline") {
          for (let at = 1; at < lines[i].length; at++) {
            const [a, b] = [lines[i][at - 1], lines[i][at]];
            if (/[\w$]/.test(a) && /[\w$]/.test(b)) continue;
            if (/\s/.test(a) && /\s/.test(b)) continue;
            expanded.push([kind, at]);
          }
        } else expanded.push([kind, 0]);
      }
      for (const [kind, column] of expanded) {
        const copy = lines.slice();
        if (kind === "anyblock") copy[i] = copy[i].slice(0, column) + `/* ${MARK} */` + copy[i].slice(column);
        if (kind === "anyline") copy[i] = copy[i].slice(0, column) + `// ${MARK}\n` + copy[i].slice(column);
        if (kind === "eolns") copy[i] = copy[i] + `// ${MARK}`;
        else if (kind === "eolblockns") copy[i] = copy[i] + `/* ${MARK} */`;
        else if (kind === "eol") copy[i] = copy[i] + ` // ${MARK}`;
        else if (kind === "own") copy.splice(i, 0, `// ${MARK}`);
        else if (kind === "ownblock") copy.splice(i, 0, `/* ${MARK} */`);
        else if (kind === "eolblock") copy[i] = copy[i] + ` /* ${MARK} */`;
        else if (kind === "inline") {
          // After one of the spaces in the line.
          const spaces = [...copy[i].matchAll(/\S( )\S/g)].map(m => m.index! + 1);
          if (spaces.length === 0) continue;
          const at = spaces[Math.floor(random() * spaces.length)];
          copy[i] = copy[i].slice(0, at) + ` /* ${MARK} */` + copy[i].slice(at);
        } else if (kind === "startblock") copy[i] = copy[i].replace(/^(\s*)/, `$1/* ${MARK} */ `);
        const variant = copy.join("\n");
        let expected: string, ast: any;
        try {
          const p = await prettier.__debug.parse(variant, { filepath: path, parser });
          ast = p.ast;
          const comments = ast.comments ?? [];
          if (!comments.some((c: any) => c.value.trim() === MARK)) continue;
          expected = (await prettier.__debug.formatAST(ast, { ...options, filepath: path, parser, originalText: variant })).formatted;
          if (oxfmt) {
            const result = await oxfmt.format(path, variant, options);
            if (result.errors.length > 0) continue;
            expected = result.code;
          }
        } catch {
          continue;
        }
        variants++;
        const actual = await ours(variant, ext);
        if (actual === expected) continue;
        different++;
        const where = find(ast);
        appendFileSync(out, JSON.stringify({ key: `${kind}: ${where?.key ?? "?"}`, path, start, line: i, kind, variant, expected, actual: actual ?? "ERROR" }) + "\n");
      }
    }
  }
}
console.log(`shard ${shard}: ${snippets} snippets, ${variants} variants, ${different} different`);
server.stdin.end();
