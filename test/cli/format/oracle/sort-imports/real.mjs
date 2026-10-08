// Compares import sorting on real code with the real plugins. Nothing is written anywhere.
//
//   node real.mjs --bin=<bun-lint> --modules=<dir> --plugin=trivago|ianvs --options='{"importOrder":["^[./]"]}' [--whole] [--quiet] [--jobs=8] <directories..>
//
// Of each file, what is compared is its start, up to the end of the first statement after the last import
// (`--whole`: all of it). Counted are the files
// - `sorted`: for which bun-lint formats the file to what it formats the text to that the plugin hands to Prettier,
//   and, if it makes a text of its own, that text is the plugin's, byte for byte;
// - `identical`: for which the result is what Prettier prints.
// `--quiet`: only numbers, no names of files.
import { fork, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flags, load } from "./oracle.mjs";

const { named, positional } = flags(process.argv.slice(2));
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

function files(directories) {
  const found = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) entry.name === "node_modules" || entry.name.startsWith(".") || visit(full);
      else if (EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) found.push(full);
    }
  };
  directories.forEach(visit);
  return found.sort();
}

if (!named.shard) {
  const jobs = Number(named.jobs ?? 8);
  const total = {};
  await Promise.all(
    Array.from({ length: jobs }, (_, index) =>
      new Promise(resolve => {
        const child = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), `--shard=${index}/${jobs}`]);
        child.on("message", counts => Object.entries(counts).forEach(([key, value]) => (total[key] = (total[key] ?? 0) + value)));
        child.on("exit", resolve);
      }),
    ),
  );
  console.log(JSON.stringify(total));
  process.exit(0);
}

class Server {
  constructor(args) {
    this.process = spawn(named.bin, ["format", "sort-imports", "serve", ...args], { stdio: ["pipe", "pipe", "inherit"] });
    this.buffer = Buffer.alloc(0);
    this.waiting = null;
    this.process.stdout.on("data", chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.waiting?.();
    });
  }
  async read() {
    for (;;) {
      const end = this.buffer.indexOf(10);
      if (end >= 0) {
        const length = Number(this.buffer.subarray(0, end).toString());
        if (length < 0) {
          this.buffer = this.buffer.subarray(end + 1);
          return null;
        }
        if (this.buffer.length >= end + 1 + length) {
          const text = this.buffer.subarray(end + 1, end + 1 + length).toString();
          this.buffer = this.buffer.subarray(end + 1 + length);
          return text;
        }
      }
      await new Promise(resolve => (this.waiting = resolve));
    }
  }
  async format(name, text) {
    const bytes = Buffer.from(text);
    this.process.stdin.write(`${name}\t${bytes.length}\n`);
    this.process.stdin.write(bytes);
    return { text: await this.read(), output: await this.read() };
  }
}

const [shard, shards] = named.shard.split("/").map(Number);
const { expected } = await load(named.modules);
const { parse } = createRequire(path.resolve(named.modules, "index.js"))("@babel/parser");
const options = JSON.parse(named.options ?? "{}");
const asFlag = ([name, value]) => `--${name}=${typeof value === "string" ? value : JSON.stringify(value)}`;
const isAboutImports = ([name]) => name.startsWith("importOrder");
const sorting = new Server([`--plugins=["@${named.plugin}/prettier-plugin-sort-imports"]`, ...Object.entries(options).map(asFlag)]);
const plain = new Server(Object.entries(options).filter(it => !isAboutImports(it)).map(asFlag));

const counts = { files: 0, withoutImports: 0, pluginFails: 0, compared: 0, sorted: 0, identical: 0, unchanged: 0 };
for (const [index, file] of files(positional).entries()) {
  if (index % shards !== shard) continue;
  counts.files++;
  let input = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  if (!/^\s*import\b/m.test(input)) {
    counts.withoutImports++;
    continue;
  }
  if (!named.whole) {
    try {
      const plugins = ["typescript", "decorators-legacy", ...(file.endsWith(".ts") ? [] : ["jsx"])];
      const body = parse(input, { sourceType: "module", errorRecovery: true, plugins }).program.body;
      const last = body.findLastIndex(it => it.type === "ImportDeclaration");
      if (last < 0) {
        counts.withoutImports++;
        continue;
      }
      if (body[last + 1]) input = input.slice(0, body[last + 1].end) + "\n";
    } catch {
      counts.pluginFails++;
      continue;
    }
  }
  const theirs = await expected(named.plugin, input, options, file);
  if (theirs.error || theirs.text === undefined) {
    counts.pluginFails++;
    continue;
  }
  counts.compared++;
  const ours = await sorting.format(file, input);
  const reference = await plain.format(file, theirs.text);
  const isSorted = ours.output !== null && ours.output === reference.output && (ours.text === "" || ours.text === theirs.text);
  counts.sorted += isSorted;
  counts.identical += ours.output === theirs.output;
  counts.unchanged += ours.text === "";
  if (!named.quiet && !isSorted) console.log(`not sorted alike: ${file}`);
  if (!named.quiet && named.verbose && isSorted && ours.output !== theirs.output) console.log(`not formatted alike: ${file}`);
}
process.send(counts);
process.exit(0);
