// The rules that oxlint shares with ESLint and typescript-eslint are ports of the originals here. With a configuration of oxlint their
// messages have the texts of oxlint.
//
// messages.json has, for each message id whose text is replaced, a short input for which oxlint reports what `bun lint` reports with
// that id, the text of oxlint and its `help`. It is all that is reported for the input, or with `index` the last.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Entry = {
  /** As oxlint calls it. */
  rule: string;
  /** The message id of the original. */
  id: string;
  file: string;
  code: string;
  /** The other files of its directory: what it imports. */
  files?: Record<string, string>;
  options: unknown[];
  /** If not that of all. */
  tsconfig?: object;
  /** How many problems are reported before it. */
  index?: number;
  message: string;
  /** What oxlint prints under it, if anything. */
  help?: string;
};

export const entries: Entry[] = JSON.parse(readFileSync(join(import.meta.dir, "messages.json"), "utf8"));

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
    for (const [file, code] of Object.entries(it.files ?? {})) files[`${directoryOf(index)}/${file}`] = code;
    if (it.tsconfig) files[`${directoryOf(index)}/tsconfig.json`] = JSON.stringify(it.tsconfig);
  });
  return files;
}

/** What is reported in the file of each entry, in the order of the file, from the output of `-f json`. */
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

/** Their texts. */
export const messagesOf = (stdout: string, all: Entry[]) => reportsOf(stdout, all).map(it => it.map(it => it.message));

/** The `help` of the report that each entry is about. */
export const helpsOf = (stdout: string, all: Entry[]) =>
  reportsOf(stdout, all).map((it, index) => it[all[index].index ?? 0]?.help);
