// Turns the line breaks of each file that both format the same into `\r\n` and into `\r`, and compares again, with
// `endOfLine: "auto"`.
//
//   bun line-endings.ts <bun-lint> <directory with node_modules/prettier> <directory for temporary files> <files and directories..>
import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
const [bin, prettierRoot, tmp] = process.argv.slice(2);
const prettier = await import(resolve(prettierRoot, "node_modules/prettier/index.mjs"));
function* walk(path: string): Generator<string> {
  if (statSync(path).isDirectory()) { for (const n of readdirSync(path).sort()) if (n !== "node_modules" && n !== ".git") yield* walk(join(path, n)); }
  else if (/\.[cm]?[jt]sx?$/.test(path)) yield path;
}
let n = 0, bad = 0;
for (const root of process.argv.slice(5)) for (const path of walk(root)) {
  const original = readFileSync(path, "utf8");
  if (original.length > 200000 || original.includes("\r")) continue;
  const ext = extname(path);
  let lf: string;
  try { lf = await prettier.format(original, { filepath: path }); } catch { continue; }
  writeFileSync(join(tmp, "in" + ext), original);
  if (Bun.spawnSync([bin, "format", "file", join(tmp, "in" + ext)]).stdout.toString() !== lf) continue;
  for (const [name, eol] of [["crlf", "\r\n"], ["cr", "\r"]] as const) {
    const text = original.replace(/\n/g, eol);
    let expected: string;
    try { expected = await prettier.format(text, { filepath: path, endOfLine: "auto" }); } catch { continue; }
    writeFileSync(join(tmp, "in" + ext), text);
    const actual = Bun.spawnSync([bin, "format", "file", join(tmp, "in" + ext), "--endOfLine=auto"]).stdout.toString();
    n++;
    if (actual !== expected) {
      if (bad++ < 14) {
        let i = 0; while (i < actual.length && actual[i] === expected[i]) i++;
        console.log("=====", name, path); console.log(JSON.stringify(expected.slice(Math.max(0, i - 60), i + 60))); console.log(JSON.stringify(actual.slice(Math.max(0, i - 60), i + 60)));
      }
    }
  }
}
console.log(n, "checked", bad, "differ");
