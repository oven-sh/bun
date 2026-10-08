// oxfmt's fixtures, judged by Prettier and by oxfmt's own snapshots. See ../oxfmt-fixtures/README.md.
//
//   bun oxfmt-fixtures.ts record --prettier=<directory with node_modules/prettier>
//   bun oxfmt-fixtures.ts run --bin=<bun-lint> [--list] [--filter=text]

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const [mode, ...rest] = process.argv.slice(2);
const flags = new Map(rest.map(arg => /^--([\w-]+)(?:=(.*))?$/s.exec(arg)).map(match => [match![1], match![2] ?? "true"]));
const root = resolve(import.meta.dir, "../oxfmt-fixtures/formatter");
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

type Options = Record<string, unknown>;

function* walk(directory: string): Generator<string> {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (extensions.has(extname(path))) yield path;
  }
}

/** The sets of options that a fixture is formatted with, like `generate_snapshot` of oxc's harness. */
function rowsOf(file: string): Options[] {
  let sets: Options[] = [{}];
  for (let directory = dirname(file); directory.startsWith(root); directory = dirname(directory)) {
    const path = join(directory, "options.json");
    if (existsSync(path)) {
      sets = JSON.parse(readFileSync(path, "utf8"));
      break;
    }
  }
  return sets.flatMap(set => {
    const pinned = set.printWidth;
    const rows = typeof pinned === "number" && pinned !== 80 && pinned !== 100 ? [set] : [];
    return [...rows, { ...set, printWidth: 80 }, { ...set, printWidth: 100 }];
  });
}

const display = (options: Options) =>
  `{ ${Object.entries(options)
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .sort()
    .join(", ")} }`;

function render(outputs: [Options, string][]) {
  let text = "";
  for (const [options, output] of outputs) {
    const line = display(options);
    text += `${"-".repeat(line.length)}\n${line}\n${"-".repeat(line.length)}\n${output}\n`;
  }
  return text + "===================== End =====================\n";
}

/** The outputs in a snapshot, by what `display` gives for their options. */
function parse(text: string) {
  const outputs = new Map<string, string>();
  const start = text.lastIndexOf("==================== Output ====================\n");
  const body = text.slice(start < 0 ? 0 : start + 49).replace(/===================== End =====================\n$/, "");
  const header = /^(-+)\n(\{.*\})\n\1\n/gm;
  const headers = [...body.matchAll(header)];
  headers.forEach((match, i) => {
    const end = i + 1 < headers.length ? headers[i + 1].index : body.length;
    outputs.set(match[2], body.slice(match.index + match[0].length, end - 1));
  });
  return outputs;
}

if (mode === "record") {
  const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    const outputs: [Options, string][] = [];
    for (const options of rowsOf(file)) {
      // Not an option of Prettier.
      const { jsdoc, ...known } = options;
      let output: string;
      try {
        output = await prettier.format(source, { ...known, filepath: file });
      } catch (error) {
        output = `<${(error as Error).name}>`;
      }
      outputs.push([options, output]);
    }
    writeFileSync(`${file}.prettier.snap`, render(outputs));
  }
} else if (mode === "run") {
  const bin = flags.get("bin")!;
  const filter = flags.get("filter");
  const tally = { prettier: [0, 0], oxfmt: [0, 0], same: 0 };
  for (const file of walk(root)) {
    const name = relative(root, file);
    if (filter && !name.includes(filter)) continue;
    const expected = {
      prettier: parse(readFileSync(`${file}.prettier.snap`, "utf8")),
      oxfmt: parse(readFileSync(`${file}.snap`, "utf8")),
    };
    for (const options of rowsOf(file)) {
      const key = display(options);
      if (expected.prettier.get(key) === expected.oxfmt.get(key)) tally.same++;
      for (const flavor of ["prettier", "oxfmt"] as const) {
        const args = Object.entries(options).filter(([, value]) => typeof value !== "object");
        const { stdout } = Bun.spawnSync({
          cmd: [bin, "format", "file", file, `--flavor=${flavor}`, ...args.map(([name, value]) => `--${name}=${value}`)],
        });
        const passed = stdout.toString() === expected[flavor].get(key);
        tally[flavor][0] += Number(passed);
        tally[flavor][1]++;
        if (!passed && flags.has("list")) console.log(`${flavor}: ${name} ${key}`);
      }
    }
  }
  console.log(`as Prettier prints them: ${tally.prettier.join("/")}`);
  console.log(`as oxfmt prints them, with its flavor: ${tally.oxfmt.join("/")}`);
  console.log(`Prettier and oxfmt agree on ${tally.same} of ${tally.prettier[1]}`);
} else {
  console.error("usage: bun oxfmt-fixtures.ts record --prettier=<dir> | run --bin=<bun-lint> [--list] [--filter=text]");
  process.exit(1);
}
