// Inserts one comment at every token boundary of every seed statement and compares Prettier's output with ours.
//   bun comments-in-types.ts --bin=<bun-lint> --prettier=<dir> --ts=<dir of typescript> --seeds=<file> --out=<file> [--kinds=inline,eol,own,ownblock]
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = /^--([\w-]+)=(.*)$/s.exec(arg);
  if (m) flags.set(m[1], m[2]);
}
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
const ts = (await import(resolve(flags.get("ts")!, "lib/typescript.js"))).default;
const kinds = (flags.get("kinds") ?? "inline,eol,own,ownblock").split(",");
const tmp = flags.get("tmp")!;
const options = JSON.parse(flags.get("options") ?? "{}");
const server = Bun.spawn({ cmd: [flags.get("bin")!, "format", "serve", ...Object.entries(options).map(([k, v]) => `--${k}=${v}`)], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const reader = server.stdout.getReader();
let buffered = new Uint8Array(0);
async function fill() {
  const { value, done } = await reader.read();
  if (done) throw new Error("bun-lint has exited");
  const joined = new Uint8Array(buffered.length + value.length);
  joined.set(buffered); joined.set(value, buffered.length); buffered = joined;
}
async function readLine() {
  let end: number;
  while ((end = buffered.indexOf(10)) < 0) await fill();
  const line = new TextDecoder().decode(buffered.subarray(0, end));
  buffered = buffered.subarray(end + 1);
  return line;
}
async function readBytes(n: number) {
  while (buffered.length < n) await fill();
  const b = buffered.subarray(0, n); buffered = buffered.subarray(n);
  return new TextDecoder().decode(b);
}
async function ours(text: string) {
  const path = `${tmp}/s.ts`;
  writeFileSync(path, text);
  server.stdin.write(path + "\n"); server.stdin.flush();
  const line = await readLine();
  if (line.startsWith("ok ")) return await readBytes(Number(line.slice(3)));
  return `<<${line}>>`;
}
const seeds = readFileSync(flags.get("seeds")!, "utf8").split(/\n(?:\n)+/).map(s => s.trim()).filter(Boolean);
const insert: Record<string, string> = { inline: " /* c */ ", eol: " // c\n", own: "\n// c\n", ownblock: "\n/* c */\n" };
let total = 0, failed = 0;
const lines: string[] = [];
for (const seed of seeds) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, seed);
  const positions: number[] = [];
  // Template literals and `>` tokens are rescanned wrongly by a plain scan: skip boundaries inside backticks.
  let depth = 0;
  for (let t = scanner.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = scanner.scan()) {
    if (t === ts.SyntaxKind.TemplateHead || t === ts.SyntaxKind.NoSubstitutionTemplateLiteral) { if (t === ts.SyntaxKind.TemplateHead) depth = 1; }
    positions.push(scanner.getTokenStart());
  }
  positions.push(seed.length);
  if (seed.includes("`")) continue;
  for (const pos of positions) {
    for (const kind of kinds) {
      const text = seed.slice(0, pos) + insert[kind] + seed.slice(pos) + "\n";
      let expected: string;
      try { expected = await prettier.format(text, { parser: "typescript", ...options }); } catch { continue; }
      total++;
      const actual = await ours(text);
      if (actual !== expected) {
        failed++;
        lines.push(`#### ${kind} @${pos}\n--- input\n${text}--- expected\n${expected}--- actual\n${actual}`);
      }
    }
  }
}
writeFileSync(flags.get("out")!, lines.join("\n"));
console.log(`${total - failed}/${total} the same, ${failed} differ`);
server.stdin.end();
