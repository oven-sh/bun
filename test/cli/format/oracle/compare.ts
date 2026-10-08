// Formats real code with Prettier and with `bun-lint format`, and compares.
//
//   bun compare.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> \
//     [--options='{"semi":false}'] [--extensions=.json,.css] [--report=<directory>] [--limit=n] <files and directories..>
//
// Nothing of the files is written anywhere unless `--report` is given: then the expected and the
// actual output of each file that differs are written there.

import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const flags = new Map<string, string>();
const roots: string[] = [];
for (const arg of process.argv.slice(2)) {
  const match = /^--([\w-]+)=(.*)$/s.exec(arg);
  if (match) flags.set(match[1], match[2]);
  else roots.push(arg);
}
const bin = flags.get("bin");
const prettierRoot = flags.get("prettier");
if (!bin || !prettierRoot || roots.length === 0) {
  console.error("usage: bun compare.ts --bin=<bun-lint> --prettier=<dir> [--options=json] [--report=dir] <paths..>");
  process.exit(1);
}
const options: Record<string, unknown> = JSON.parse(flags.get("options") ?? "{}");
const report = flags.get("report");
const limit = Number(flags.get("limit") ?? Infinity);
const prettier = await import(resolve(prettierRoot, "node_modules/prettier/index.mjs"));

const extensions = new Set((flags.get("extensions") ?? ".js,.jsx,.mjs,.cjs,.ts,.tsx,.mts,.cts").split(","));
function* walk(path: string): Generator<string> {
  // A link to nothing is skipped.
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return;
  if (stats.isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name));
    }
  } else if (extensions.has(extname(path))) {
    yield path;
  }
}

const server = Bun.spawn({
  cmd: [bin, "format", "serve", ...Object.entries(options).map(([name, value]) => `--${name}=${value}`)],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});
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
  const line = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffered.subarray(0, end));
  buffered = buffered.subarray(end + 1);
  return line;
}
async function readBytes(length: number) {
  while (buffered.length < length) await fill();
  const bytes = buffered.subarray(0, length);
  buffered = buffered.subarray(length);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}
async function format(path: string): Promise<{ output?: string; error?: string }> {
  server.stdin.write(path + "\n");
  server.stdin.flush();
  const line = await readLine();
  if (line.startsWith("ok ")) return { output: await readBytes(Number(line.slice(3))) };
  return { error: line.slice("error ".length) };
}

/// How many lines differ, roughly: those that are not in the other file.
function differingLines(a: string, b: string) {
  const count = new Map<string, number>();
  for (const line of a.split("\n")) count.set(line, (count.get(line) ?? 0) + 1);
  let differing = 0;
  for (const line of b.split("\n")) {
    const left = count.get(line) ?? 0;
    if (left > 0) count.set(line, left - 1);
    else differing++;
  }
  return differing;
}

for (const root of roots) {
  let same = 0, different = 0, errors = 0, skipped = 0, lines = 0, differing = 0;
  const worst: [number, string][] = [];
  for (const path of walk(root)) {
    if (same + different + errors >= limit) break;
    let expected: string;
    try {
      expected = await prettier.format(readFileSync(path, "utf8"), { ...options, filepath: path });
    } catch {
      skipped++;
      continue;
    }
    const { output, error } = await format(path);
    lines += expected.split("\n").length;
    if (output === undefined) {
      errors++;
      console.log(`${error}: ${path}`);
    } else if (output === expected) {
      same++;
    } else {
      different++;
      const count = differingLines(expected, output);
      differing += count;
      worst.push([count, path]);
      if (report) {
        mkdirSync(report, { recursive: true });
        const name = path.replaceAll("/", "_");
        writeFileSync(join(report, name + ".expected"), expected);
        writeFileSync(join(report, name + ".actual"), output);
      }
    }
  }
  const total = same + different + errors;
  console.log(
    `${root}: ${same}/${total} files the same (${((100 * same) / Math.max(total, 1)).toFixed(1)}%), ` +
      `${errors} not formatted, ${skipped} that Prettier rejects, ` +
      `${differing} of ${lines} lines differ (${((100 * differing) / Math.max(lines, 1)).toFixed(2)}%)`,
  );
  if (flags.has("list")) {
    for (const [count, path] of worst.sort((a, b) => a[0] - b[0])) console.log(`  ${count}\t${path}`);
  }
}
server.stdin.end();
