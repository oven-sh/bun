// What `comment-fuzz.ts` has found.
//
//   bun comment-fuzz-report.ts <files.jsonl..>                      the number of differences for each key
//   bun comment-fuzz-report.ts --key=<part of a key> [--count=n] <files.jsonl..>   the differences themselves
//   --alone=1: only snippets that have no other comment
import { readFileSync } from "node:fs";

const flags = new Map<string, string>();
const files: string[] = [];
for (const arg of process.argv.slice(2)) {
  const match = /^--([\w-]+)=(.*)$/s.exec(arg);
  if (match) flags.set(match[1], match[2]);
  else files.push(arg);
}
const key = flags.get("key");
let left = Number(flags.get("count") ?? 3);
const counts = new Map<string, number>();

function diff(expected: string, actual: string) {
  const [a, b] = [expected.split("\n"), actual.split("\n")];
  let start = 0;
  while (start < a.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [
    ...a.slice(Math.max(0, start - 2), start).map(line => "  " + line),
    ...a.slice(start, a.length - end).map(line => "- " + line),
    ...b.slice(start, b.length - end).map(line => "+ " + line),
    ...a.slice(a.length - end, a.length - end + 2).map(line => "  " + line),
  ].join("\n");
}

for (const file of files) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const it = JSON.parse(line);
    if (flags.has("alone")) {
      const others = it.variant.replace(/(\/\/|\/\*) c0mment( \*\/)?/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "");
      if (/\/\/|\/\*/.test(others)) continue;
    }
    counts.set(it.key, (counts.get(it.key) ?? 0) + 1);
    if (key !== undefined && it.key.includes(key) && left-- > 0) {
      const lines = it.variant.split("\n");
      console.log(`===== ${it.key}  ${it.path}`);
      console.log(lines.slice(Math.max(0, it.line - 2), it.line + 3).join("\n"));
      console.log("----- Prettier (-), ours (+)");
      console.log(diff(it.expected, it.actual));
    }
  }
}
if (key === undefined) {
  for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(count, name);
}
