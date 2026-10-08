// Damages formatted HTML and Vue and asks the check that `bun format` makes before it writes such a file (`bun_format::html::has_same_content`)
// whether it notices.
//
//   bun content-mutants.ts <bun-lint> [-seed=1] [-per-file=20] [-limit=500] [-show=10] <files and directories..>
//
// Each file is formatted. First the formatted text is compared with the file: that has to be the same. Then it is damaged in one place, in one of
// the ways below, and compared again. Nothing is written anywhere.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
const [bin, ...args] = process.argv.slice(2);
const flag = (name: string, otherwise: string) =>
  (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
const [perFile, limit, show] = [+flag("per-file", "20"), +flag("limit", "500"), +flag("show", "10")];
let seed = +flag("seed", "1");
const random = (below: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8) % below;
const pick = <T>(from: T[]) => from[random(from.length)];

const files: string[] = [];
function walk(path: string) {
  if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name));
  else if ([".html", ".vue"].includes(extname(path))) files.push(path);
}
args.filter(it => !it.startsWith("-")).forEach(walk);

const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)];
const cut = (text: string, match: RegExpMatchArray | undefined, put = "") =>
  match && text.slice(0, match.index) + put + text.slice(match.index! + match[0].length);
// Each returns the damaged text, or `undefined` if there is nothing to damage that way.
const damages: Record<string, (text: string) => string | undefined> = {
  "a word is lost": text => cut(text, pick(all(text, /\b[a-zA-Z]{2,}\b/g))),
  "a word is there twice": text => {
    const word = pick(all(text, /\b[a-zA-Z]{2,}\b/g));
    return cut(text, word, word && `${word[0]} ${word[0]}`);
  },
  "a letter is lost": text => cut(text, pick(all(text, /[a-zA-Z]/g))),
  "a letter is another": text => {
    const letter = pick(all(text, /[a-df-zA-DF-Z]/g));
    return cut(text, letter, letter && (letter[0].toLowerCase() === "x" ? "y" : "x"));
  },
  "a line is lost": text => cut(text, pick(all(text, /^.*[a-zA-Z].*\n/gm))),
  "a line is there twice": text => {
    const line = pick(all(text, /^.*[a-zA-Z].*\n/gm));
    return cut(text, line, line && line[0] + line[0]);
  },
  "an attribute is lost": text => cut(text, pick(all(text, /\s[a-zA-Z:@#-]+="[^"<>]*"/g))),
  "an attribute without a value is lost": text =>
    cut(text, pick(all(text, /(?<=<[a-z][^<>]*)\s[a-z]+(?=[\s>])(?![^<>]*=)/g))),
  "a value is lost": text => cut(text, pick(all(text, /(?<==")[^"<>]*[a-zA-Z][^"<>]*(?=")/g))),
  "an empty element is lost": text => cut(text, pick(all(text, /<([a-z]+)><\/\1>/g))),
  "a void element is lost": text => cut(text, pick(all(text, /<(?:br|hr|wbr) \/>/g))),
  "a void element is there twice": text => {
    const element = pick(all(text, /<(?:br|hr|wbr) \/>/g));
    return cut(text, element, element && element[0] + element[0]);
  },
  "a comment is lost": text => cut(text, pick(all(text, /<!--[^]*?-->/g))),
  "an element is unwrapped": text => {
    const element = pick(all(text, /<(b|i|em|span|a|p|div)>([^<>]*)<\/\1>/g));
    return cut(text, element, element && element[2]);
  },
  "two siblings change places": text => {
    const pair = pick(all(text, /(<(?:br|hr) \/>)(\s*)(<(?:img|input)\b[^<>]*\/>)/g));
    return cut(text, pair, pair && pair[3] + pair[2] + pair[1]);
  },
  "an element has another name": text => {
    const element = pick(all(text, /<(b|i|em|span|p|div)>([^<>]*)<\/\1>/g));
    return cut(text, element, element && `<u>${element[2]}</u>`);
  },
  "an attribute has another name": text => {
    const name = pick(all(text, /(?<=\s)(?:id|class|href|src|name)(?==")/g));
    return cut(text, name, "title");
  },
};

const server = Bun.spawn({ cmd: [bin, "format", "verify-pairs"], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const reader = server.stdout.getReader();
let buffered = "";
async function isSame(name: string, before: Uint8Array, after: string) {
  const bytes = new TextEncoder().encode(after);
  server.stdin.write(`${before.length} ${bytes.length} ${name}\n`);
  server.stdin.write(before);
  server.stdin.write(bytes);
  server.stdin.flush();
  while (!buffered.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("the process has gone");
    buffered += new TextDecoder().decode(value);
  }
  const line = buffered.slice(0, buffered.indexOf("\n"));
  buffered = buffered.slice(line.length + 1);
  return line === "same";
}

const counts: Record<string, [noticed: number, total: number]> = {};
let [formatted, falseAlarms, shown] = [0, 0, 0];
for (const file of files.slice(0, limit)) {
  const result = Bun.spawnSync([bin, "format", "file", file], { timeout: 10_000 });
  const before = readFileSync(file);
  // What is damaged is a string.
  if (!Buffer.from(before.toString()).equals(before)) continue;
  const after = result.stdout.toString();
  if (result.exitCode !== 0 || !after.includes("<") || /^\w+Error$/.test(after.trim())) continue;
  formatted++;
  if (!(await isSame(file, before, after))) {
    falseAlarms++;
    console.log(`FALSE ALARM ${file}`);
    continue;
  }
  for (let i = 0; i < perFile; i++) {
    const [name, damage] = pick(Object.entries(damages));
    const damaged = damage(after);
    if (damaged === undefined || damaged === after) continue;
    const count = (counts[name] ??= [0, 0]);
    count[1]++;
    if (!(await isSame(file, before, damaged))) count[0]++;
    else if (shown++ < show) {
      const at = [...after].findIndex((it, index) => it !== damaged[index]);
      console.log(
        `not noticed: ${name}: ${file}: ${JSON.stringify(after.slice(Math.max(0, at - 30), at + 40))} -> ${JSON.stringify(damaged.slice(Math.max(0, at - 30), at + 40))}`,
      );
    }
  }
}
server.kill();
console.log(`${formatted} files, ${falseAlarms} false alarms`);
for (const [name, [noticed, total]] of Object.entries(counts).sort()) console.log(`${noticed}/${total} ${name}`);
