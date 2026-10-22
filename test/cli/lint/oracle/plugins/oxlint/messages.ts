// `bun lint` ports the rules that oxlint shares with ESLint and typescript-eslint from the originals. With an oxlint
// config, their messages use oxlint's text.
//
//   OXLINT_TSGOLINT_PATH=<tsgolint 7.0.2003> bun messages.ts <oxlint 1.87>
//
// For each message id whose text is replaced, messages.json has a short input for which oxlint reports the problem that
// `bun lint` reports with that id, plus oxlint's text and `help`. That problem is the only one reported for the input,
// or the last one if the entry has an `index`. This script records the text and `help` from oxlint again.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type Entry = {
  /** oxlint's name for the rule. */
  rule: string;
  /** The message id in the original rule. */
  id: string;
  file: string;
  code: string;
  /** The other files in its directory, which it imports. */
  files?: Record<string, string>;
  options: unknown[];
  /** Overrides the shared `tsconfig.json`. */
  tsconfig?: object;
  /** The number of problems reported before it. */
  index?: number;
  message: string;
  /** The help text oxlint prints under it, if any. */
  help?: string;
};

const path = join(import.meta.dir, "messages.json");
export const entries: Entry[] = JSON.parse(readFileSync(path, "utf8"));

/** Returns an entry's directory. */
export const directoryOf = (index: number) => String(index);

/** Puts every entry in a directory with its own config, so one `--type-aware` run lints them all. */
export function filesOf(all: Entry[]): Record<string, string> {
  const files: Record<string, string> = {
    ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" } }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, target: "esnext", module: "esnext", lib: ["esnext", "dom"], jsx: "preserve" },
    }),
  };
  all.forEach((it, index) => {
    const plugin = it.rule.split("/")[0];
    files[`${directoryOf(index)}/.oxlintrc.json`] = JSON.stringify({
      plugins: plugin === "eslint" ? [] : [plugin],
      categories: { correctness: "off" },
      rules: { [it.rule]: ["error", ...it.options] },
    });
    files[`${directoryOf(index)}/${it.file}`] = it.code;
    for (const [file, code] of Object.entries(it.files ?? {})) files[`${directoryOf(index)}/${file}`] = code;
    if (it.tsconfig) files[`${directoryOf(index)}/tsconfig.json`] = JSON.stringify(it.tsconfig);
  });
  return files;
}

/** Parses `-f json` output. Returns the reports in each entry's file, in source order. */
function reportsOf(stdout: string, all: Entry[]) {
  const found: { offset: number; message: string; help?: string }[][] = all.map(() => []);
  for (const it of JSON.parse(stdout).diagnostics) {
    const offset = it.labels[0]?.span.offset ?? 0;
    const [directory, ...file] = it.filename.split("/");
    if (file.join("/") !== all[Number(directory)].file) continue;
    found[Number(directory)].push({ offset, message: it.message, help: it.help });
  }
  return found.map(it => it.sort((a, b) => a.offset - b.offset));
}

/** Returns the message text of the reports in each entry's file. */
export const messagesOf = (stdout: string, all: Entry[]) => reportsOf(stdout, all).map(it => it.map(it => it.message));

/** Returns the `help` of each entry's own report. */
export const helpsOf = (stdout: string, all: Entry[]) =>
  reportsOf(stdout, all).map((it, index) => it[all[index].index ?? 0]?.help);

if (import.meta.main) {
  const oxlint = process.argv[2];
  if (!oxlint) throw new Error("usage: bun messages.ts <oxlint>");
  const cwd = mkdtempSync(join(tmpdir(), "oxlint-messages-"));
  try {
    for (const [file, text] of Object.entries(filesOf(entries))) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), text);
    }
    const { stdout, stderr } = spawnSync(oxlint, ["--type-aware", "-f", "json", "."], {
      cwd,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    if (!stdout.startsWith("{")) throw new Error(stderr || stdout);
    let changed = 0;
    messagesOf(stdout, entries).forEach((messages, index) => {
      const it = entries[index];
      const at = it.index ?? 0;
      if (messages.length !== at + 1)
        throw new Error(`${it.rule} ${it.id}: oxlint reports ${messages.length} problems: ${JSON.stringify(it.code)}`);
      const help = helpsOf(stdout, entries)[index];
      if (it.message !== messages[at] || it.help !== help) changed++;
      it.message = messages[at];
      delete it.help;
      if (help !== undefined) it.help = help;
    });
    writeFileSync(path, JSON.stringify(entries, null, 1) + "\n");
    console.log(`${entries.length} messages, ${changed} changed`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
