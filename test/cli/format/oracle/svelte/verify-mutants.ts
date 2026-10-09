// Damages formatted components and asks the check that `bun format` makes before it writes a file (`src/format/svelte/verify.rs`) whether it
// notices.
//
//   bun verify-mutants.ts <bun-lint> <directory with .svelte files> [<seed>]
//
// `<bun-lint>`: the harness, for `format file` and `format verify-pairs`. Each component is formatted, what is printed is damaged in each of
// the ways below, and compared with the component. A mutant that no longer parses is noticed by that alone.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [bin, directory] = process.argv.slice(2, 4).map(it => resolve(it));
let seed = Number(process.argv[4] ?? 1);
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T>(all: T[]): T | undefined => all[Math.floor(random() * all.length)];
const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)];
/** `text` with `replacement` in the place of group `group` of `match`. */
function put(
  text: string,
  match: RegExpMatchArray | undefined,
  replacement: (match: RegExpMatchArray) => string,
  group = 0,
) {
  if (!match) return null;
  const start = match.index! + match[0].indexOf(match[group]);
  return text.slice(0, start) + replacement(match) + text.slice(start + match[group].length);
}
const word = /(?<=>)[^<>{}]*?\b([A-Za-z]{3,})\b/g;
const attribute = / ([a-z][a-z-]*)="[^"{}<>]*"/g;
const tag = /(?<=>)\{[a-zA-Z_.]+\}/g;
const inline = /<(span|b|i|em|strong|a|code)>([^<>{}]*)<\/\1>/g;
const damages: Record<string, (text: string) => string | null> = {
  "a word is lost": text => put(text, pick(all(text, word)), () => "", 1),
  "a word is there twice": text => put(text, pick(all(text, word)), it => `${it[1]} ${it[1]}`, 1),
  "an attribute is lost": text => put(text, pick(all(text, attribute)), () => ""),
  "an attribute has another name": text => put(text, pick(all(text, attribute)), it => `x${it[1]}`, 1),
  "a tag is lost": text => put(text, pick(all(text, tag)), () => ""),
  "a tag is there twice": text => put(text, pick(all(text, tag)), it => it[0] + it[0]),
  "an empty element is lost": text => put(text, pick(all(text, /<([a-z]+)( \/|><\/\1)>/g)), () => ""),
  "an element is unwrapped": text => put(text, pick(all(text, inline)), it => it[2]),
  "an element has another name": text => put(text, pick(all(text, inline)), it => `<u>${it[2]}</u>`),
  "a directive is of another kind": text =>
    put(text, pick(all(text, / (on|bind|class|use):[a-zA-Z]+/g)), it => (it[1] === "on" ? "use" : "on"), 1),
  "an {:else} is lost": text => put(text, pick(all(text, /\{:else\}/g)), () => ""),
  "a word of a comment in a script is lost": text =>
    put(text, pick(all(text, /(?<=<script[^>]*>[^]*)\/\/ ([a-zA-Z]{3,})(?=[^]*<\/script>)/g)), () => "", 1),
  "a comment is lost": text => put(text, pick(all(text, /<!--[^>]*?[a-z][^>]*?-->/g)), () => ""),
};

const server = Bun.spawn({
  cmd: [bin, "format", "verify-pairs", "--parser=svelte"],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "ignore",
});
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
let [formatted, refused] = [0, 0];
for (const name of readdirSync(directory, { recursive: true, encoding: "utf8" }).filter(it => it.endsWith(".svelte"))) {
  const file = join(directory, name);
  const before = readFileSync(file);
  // With the check. What it refuses is what the plugin damages.
  const result = Bun.spawnSync([bin, "format", "file", file, "--parser=svelte"], { timeout: 10_000 });
  const after = result.stdout.toString();
  if (result.exitCode !== 0 || /^\w+(?:Error)?$/.test(after.trim())) {
    refused++;
    continue;
  }
  formatted++;
  for (const [kind, damage] of Object.entries(damages)) {
    const damaged = damage(after);
    if (damaged === null || damaged === after) continue;
    const count = (counts[kind] ??= [0, 0]);
    count[1]++;
    if (await isSame(file, before, damaged)) console.log(`NOT NOTICED: ${kind}: ${name}`);
    else count[0]++;
  }
}
server.stdin.end();
console.log(`${formatted} components, ${refused} are not formatted`);
for (const [kind, [noticed, total]] of Object.entries(counts)) console.log(`${noticed}/${total} ${kind}`);
