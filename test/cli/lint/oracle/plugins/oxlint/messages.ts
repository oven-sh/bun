// The rules that oxlint shares with ESLint and typescript-eslint are ports of the originals here. With a configuration of oxlint their
// messages have the texts of oxlint.
//
//   OXLINT_TSGOLINT_PATH=<tsgolint 7.0.2003> bun messages.ts <oxlint 1.87>
//
// messages.json has, for each message id whose text is replaced, a short input for which oxlint reports what `bun lint` reports with
// that id, the text of oxlint and its `help`. It is all that is reported for the input, or with `index` the last. This asks oxlint for
// the texts again.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type Entry = {
  /** As oxlint calls it. */
  rule: string;
  /** The message id of the original. */
  id: string;
  file: string;
  code: string;
  options: unknown[];
  /** The rule needs types. */
  typed?: true;
  /** If not that of all. */
  tsconfig?: object;
  /** How many problems are reported before it. */
  index?: number;
  message: string;
  /** What oxlint prints under it, if anything. */
  help?: string;
};

const path = join(import.meta.dir, "messages.json");
export const entries: Entry[] = JSON.parse(readFileSync(path, "utf8"));

/** The directory of an entry. */
export const directoryOf = (index: number) => String(index);

/** Every entry in a directory with a configuration of its own: one run with `--type-aware` lints them all. */
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
    if (it.tsconfig) files[`${directoryOf(index)}/tsconfig.json`] = JSON.stringify(it.tsconfig);
  });
  return files;
}

/** What is reported in the directory of each entry, in the order of the file, from the output of `-f json`. */
function reportsOf(stdout: string, all: Entry[]) {
  const found: { offset: number; message: string; help?: string }[][] = all.map(() => []);
  for (const it of JSON.parse(stdout).diagnostics) {
    const offset = it.labels[0]?.span.offset ?? 0;
    found[Number(it.filename.split("/")[0])].push({ offset, message: it.message, help: it.help });
  }
  return found.map(it => it.sort((a, b) => a.offset - b.offset));
}

/** Their texts. */
export const messagesOf = (stdout: string, all: Entry[]) => reportsOf(stdout, all).map(it => it.map(it => it.message));

/** The `help` of the report that each entry is about. */
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
