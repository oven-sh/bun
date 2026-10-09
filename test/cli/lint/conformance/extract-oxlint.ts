// Turns the tests of the rules that oxlint has in its own plugins (`crates/oxc_linter/src/rules/<plugin>/<rule>.rs`) into
// `<out>/<plugin>/<rule>.json`, in the format of README.md, with what the **binary of oxlint** reports for each case. What the
// tests expect is not used.
//
//   export ESLINT_DIR=<eslint, installed>      # for `globals`, which says what an `env` of a case declares
//   bun extract-oxlint.ts --oxc <oxc checkout> --oxlint <oxlint> --out <dir> [--more <dir>] [--jobs <n>] [<plugin>/<rule>..]
//
// A plugin is called what oxlint calls it in `--rules`, with `-` for `_`. Without names: every rule that is not in `eslint` or
// `typescript`.
//
// - Some tests build their cases with functions and macros, which the scanner of `extract-oxc.ts` cannot read. These cases were
//   written out: `--more <dir>` adds the cases of `<dir>/<plugin>/<rule>.json`, a fixture, to those of the source. `oxlint/` of the
//   bundle, extracted, is such a directory.
// - A message is where the first label of the diagnostic is, which is where oxlint prints it. It has no id.
// - oxlint does not print its fixes. `output` is the code after `--fix`, `outputWithSuggestions` after `--fix --fix-suggestions`,
//   and `outputDangerously` after these and `--fix-dangerously`, each `null` if it is the code before it in this list.
// - The file of a case is called what oxlint's `Tester` calls it. The cases of `import` are files of `<out>/import-project`.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { casesOfFile, type Case } from "./extract-oxc.ts";
import { MAX_CODE_LENGTH, writeJson } from "./shared.ts";

let oxc = "";
let oxlint = "";
let out = "";
let more = "";
let jobs = Math.min(16, availableParallelism());
const wanted: string[] = [];
for (let argv = process.argv.slice(2), i = 0; i < argv.length; i++) {
  if (argv[i] === "--oxc") oxc = resolve(argv[++i]);
  else if (argv[i] === "--oxlint") oxlint = resolve(argv[++i]);
  else if (argv[i] === "--out") out = resolve(argv[++i]);
  else if (argv[i] === "--more") more = resolve(argv[++i]);
  else if (argv[i] === "--jobs") jobs = Number(argv[++i]);
  else wanted.push(argv[i]);
}
if (!oxc || !oxlint || !out) {
  console.error("usage: bun extract-oxlint.ts --oxc <oxc checkout> --oxlint <oxlint> --out <dir> [--jobs <n>] [<plugin>/<rule>..]");
  process.exit(2);
}
const environments: Record<string, Record<string, unknown>> = process.env.ESLINT_DIR
  ? createRequire(join(resolve(process.env.ESLINT_DIR), "package.json"))("globals")
  : {};
const rulesRoot = join(oxc, "crates/oxc_linter/src/rules");
/** Where the `Tester` is: the files that the cases of `import` are next to. */
const importProject = join(oxc, "crates/oxc_linter/fixtures/import");

interface Listed {
  scope: string;
  value: string;
  category: string;
  fix: string;
}
const listed: Listed[] = JSON.parse(spawnSync(oxlint, ["--rules", "-f", "json"], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout);

function rustFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap(name => rustFiles(join(path, name)))
    .filter(file => file.endsWith(".rs"));
}

/** What the `Tester` of the test function around a case is told. */
interface Harness {
  /** Lines of the source. */
  from: number;
  to: number;
  path?: string;
  extension?: string;
  plugins: string[];
}

function harnessesOf(source: string): Harness[] {
  const starts = [...source.matchAll(/#\[test\]/g)].map(it => it.index);
  return starts.map((start, i) => {
    const text = source.slice(start, starts[i + 1]);
    const lineOf = (offset: number) => source.slice(0, offset).split("\n").length;
    return {
      from: lineOf(start),
      to: lineOf(starts[i + 1] ?? source.length),
      path: /\.change_rule_path\("([^"]+)"\)/.exec(text)?.[1],
      extension: /\.change_rule_path_extension\("([\w.]+)"\)/.exec(text)?.[1],
      plugins: [...text.matchAll(/\.with_(\w+)_plugin\(true\)/g)].map(it => it[1]),
    };
  });
}

interface Raw extends Case {
  valid: boolean;
  filename: string;
  plugins: string[];
  inImportProject: boolean;
}

function rawCasesOf(rule: Listed): { cases: Raw[]; unparsed: number } {
  const base = join(rulesRoot, rule.scope, rule.value.replaceAll(/[-/]/g, "_"));
  const path = existsSync(`${base}.rs`) ? `${base}.rs` : base;
  const stats = { parsed: 0, unparsed: 0, upstream: 0, duplicates: 0, kept: 0 };
  const cases: Raw[] = [];
  for (const file of rustFiles(path)) {
    const source = readFileSync(file, "utf8");
    const harnesses = harnessesOf(source);
    for (const it of casesOfFile(source, relative(rulesRoot, file), environments, stats, /\/tests?[/.]/.test(file))) {
      const line = Number(/:(\d+) \w+$/.exec(it.name)![1]);
      const harness = harnesses.find(h => h.from <= line && line < h.to);
      const plugins = harness?.plugins ?? [];
      const stem = rule.value.replaceAll("-", "_").replaceAll("/", "_");
      const isTest = plugins.includes("jest") || plugins.includes("vitest");
      // `Tester::run`
      let filename = harness?.path ?? `${stem}.${harness?.extension ?? "tsx"}`;
      if (plugins.includes("import")) filename = harness?.path ?? filename;
      else if (it.path !== undefined) filename = it.path;
      else if (isTest) filename = filename.replace(/\.\w+$/, ".test.tsx");
      cases.push({ ...it, valid: / pass$/.test(it.name), filename, plugins, inImportProject: plugins.includes("import") || rule.scope === "import" });
    }
  }
  const written = join(more, dash(rule.scope), `${rule.value}.json`);
  if (more && existsSync(written)) {
    for (const it of JSON.parse(readFileSync(written, "utf8")).cases) {
      const oxlintrc = it.oxlintrc ?? (it.settings && Object.keys(it.settings).length > 0 ? { settings: it.settings } : undefined);
      const { valid, name, code, filename, settings } = it;
      const options = it.options.length > 0 ? it.options : undefined;
      cases.push({ valid, name, code, options, filename, settings, oxlintrc, plugins: it.plugins ?? [], inImportProject: rule.scope === "import" });
    }
  }
  const seen = new Set<string>();
  const unique = cases.filter(it => {
    const key = JSON.stringify([it.code, it.options ?? [], it.filename, it.oxlintrc ?? {}, it.plugins]);
    return it.code.length <= MAX_CODE_LENGTH && !seen.has(key) && seen.add(key);
  });
  return { cases: unique, unparsed: stats.unparsed };
}

const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "extract-oxlint-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

interface Diagnostic {
  message: string;
  code?: string;
  help?: string;
  filename: string;
  labels: { label?: string; span: { offset: number; length: number } }[];
}

function run(cwd: string, args: string[]): Diagnostic[] {
  const result = spawnSync(oxlint, ["-c", "oxlintrc.json", "--disable-nested-config", "-f", "json", ...args, "."], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  try {
    return JSON.parse(result.stdout).diagnostics;
  } catch {
    throw new Error(`${cwd}: ${result.stdout.slice(0, 400)}${result.stderr.slice(0, 400)}`);
  }
}

const dash = (plugin: string) => plugin.replaceAll("_", "-");

function record(rule: Listed) {
  const { cases, unparsed } = rawCasesOf(rule);
  const id = `${dash(rule.scope)}/${rule.value}`;
  const hasFixes = rule.fix !== "none" && rule.fix !== "pending";
  // One run of oxlint for all cases with the same configuration.
  const groups = new Map<string, number[]>();
  cases.forEach((it, index) => {
    const key = JSON.stringify([it.options ?? [], it.oxlintrc ?? {}, it.plugins]);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(index);
  });
  const recorded: unknown[] = new Array(cases.length);
  let group = 0;
  for (const indices of groups.values()) {
    const first = cases[indices[0]];
    const directory = join(scratch, id.replaceAll("/", "_"), String(group++));
    const fileOf = (root: string, index: number) => join(root, `c${index}`, cases[index].filename);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "oxlintrc.json"),
      JSON.stringify({
        ...first.oxlintrc,
        plugins: [...new Set([dash(rule.scope), ...first.plugins])],
        categories: { correctness: "off" },
        rules: { [id]: ["error", ...(first.options ?? [])] },
      }),
    );
    for (const index of indices) {
      if (cases[index].inImportProject) cpSync(importProject, join(directory, `c${index}`), { recursive: true });
      mkdirSync(dirname(fileOf(directory, index)), { recursive: true });
      writeFileSync(fileOf(directory, index), cases[index].code);
    }
    const fixed = (flags: string[]) => {
      const copy = `${directory}-fixed`;
      cpSync(directory, copy, { recursive: true });
      run(copy, flags);
      const texts = new Map(indices.map(index => [index, readFileSync(fileOf(copy, index), "utf8")]));
      rmSync(copy, { recursive: true, force: true });
      return texts;
    };
    const diagnostics = run(directory, []);
    const outputs = hasFixes
      ? [fixed(["--fix"]), fixed(["--fix", "--fix-suggestions"]), fixed(["--fix", "--fix-suggestions", "--fix-dangerously"])]
      : [];
    for (const index of indices) {
      const raw = cases[index];
      const path = relative(directory, fileOf(directory, index));
      const bytes = Buffer.from(raw.code);
      const position = (offset: number) => {
        const lines = bytes.subarray(0, offset).toString("utf8").split(/\r\n|[\r\n\u2028\u2029]/);
        return { line: lines.length, column: lines.at(-1)!.length + 1 };
      };
      const own = diagnostics.filter(it => it.filename === path);
      const isOfRule = (it: Diagnostic) => it.code?.endsWith(`(${rule.value})`);
      const fatal = own.find(it => !isOfRule(it));
      const messages = own
        .filter(isOfRule)
        .map(it => {
          const labels = it.labels.map(label => {
            const [start, end] = [position(label.span.offset), position(label.span.offset + label.span.length)];
            return { line: start.line, column: start.column, endLine: end.line, endColumn: end.column, label: label.label ?? null };
          });
          const { label: _, ...at } = labels[0] ?? { line: 1, column: 1, endLine: null, endColumn: null, label: null };
          return { messageId: "", message: it.message, ...at, fix: null, suggestions: [], oxlint: { labels, help: it.help ?? null } };
        })
        .sort((a, b) => a.line - b.line || a.column - b.column);
      let before = raw.code;
      const [output, outputWithSuggestions, outputDangerously] = [0, 1, 2].map(i => {
        const text = outputs[i]?.get(index) ?? before;
        const changed = text === before ? null : text;
        before = text;
        return changed;
      });
      const isTypeScript = /\.[cm]?tsx?$/.test(raw.filename);
      recorded[index] = {
        valid: raw.valid,
        name: raw.name,
        code: raw.code,
        filename: raw.filename,
        options: raw.options ?? [],
        languageOptions: {
          parser: isTypeScript ? "typescript" : "espree",
          ecmaVersion: "latest",
          sourceType: /\.c[jt]s$/.test(raw.filename) ? "commonjs" : "module",
          globals: (raw.languageOptions?.globals as Record<string, unknown>) ?? null,
          parserOptions: /\.(?:[jt]sx|[cm]?js)$/.test(raw.filename) ? { ecmaFeatures: { jsx: true } } : null,
        },
        settings: raw.settings ?? null,
        // What else is in the `.oxlintrc.json`.
        oxlintrc: raw.oxlintrc,
        plugins: raw.plugins.length > 0 ? raw.plugins : undefined,
        typeAware: false,
        tsconfig: null,
        skip: /^[A-Za-z]:\\/.test(raw.filename) ? "a path of Windows" : fatal ? `fatal: ${fatal.message}` : null,
        messages,
        output,
        outputWithSuggestions,
        outputDangerously,
      };
    }
    rmSync(directory, { recursive: true, force: true });
  }
  const file = join(out, dash(rule.scope), `${rule.value}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, { plugin: dash(rule.scope), rule: rule.value, judge: "oxlint", meta: { category: rule.category, fix: rule.fix }, cases: recorded });
  return { id, cases: cases.length, unparsed, disagreements: recorded.filter((it: any) => !it.skip && it.valid !== (it.messages.length === 0)).length };
}

const rules = listed.filter(it =>
  wanted.length > 0 ? wanted.includes(`${dash(it.scope)}/${it.value}`) : it.scope !== "eslint" && it.scope !== "typescript",
);
if (rules.some(it => it.scope === "import") && !process.env.EXTRACT_OXLINT_WORKER) {
  rmSync(join(out, "import-project"), { recursive: true, force: true });
  cpSync(importProject, join(out, "import-project"), { recursive: true });
}
if (process.env.EXTRACT_OXLINT_WORKER) {
  for (const rule of rules) console.log(JSON.stringify(record(rule)));
} else {
  // A process for each share of the rules.
  const shares: string[][] = Array.from({ length: Math.max(1, Math.min(jobs, rules.length)) }, () => []);
  rules.forEach((rule, i) => shares[i % shares.length].push(`${dash(rule.scope)}/${rule.value}`));
  const flags = ["--oxc", oxc, "--oxlint", oxlint, "--out", out, ...(more ? ["--more", more] : [])];
  const workers = shares.map(share =>
    Bun.spawn(["bun", import.meta.path, ...flags, ...share], {
      env: { ...process.env, EXTRACT_OXLINT_WORKER: "1" },
      stdout: "pipe",
      stderr: "inherit",
    }),
  );
  const lines = (await Promise.all(workers.map(it => new Response(it.stdout).text()))).join("").split("\n").filter(Boolean);
  const all: ReturnType<typeof record>[] = lines.map(it => JSON.parse(it)).sort((a, b) => a.id.localeCompare(b.id));
  writeJson(join(out, "stats.json"), all);
  const total = (key: "cases" | "unparsed" | "disagreements") => all.reduce((sum, it) => sum + it[key], 0);
  console.log(
    `${all.length} of ${rules.length} rules: ${total("cases")} cases, ${total("unparsed")} cannot be read, ` +
      `${total("disagreements")} where oxlint does not do what its test says`,
  );
}
