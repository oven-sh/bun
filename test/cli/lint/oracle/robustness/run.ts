// What robustness.test.ts and check.ts have in common.
import type { Case } from "./cases";

/** The name and the text of the configuration file of a case. */
export function configOf(it: Case): [string, string] {
  const unused = it.reportsUnusedDirectives ? { reportUnusedDisableDirectives: "error" } : {};
  if (it.eslint) {
    const config = {
      files: ["**/*.{js,ts}"],
      // By their names: the rules and the parser of typescript-eslint are built in.
      plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
      languageOptions: it.file.endsWith(".ts") ? { parser: { meta: { name: "typescript-eslint/parser" } } } : {},
      rules: it.rules,
      linterOptions: unused,
    };
    return ["eslint.config.js", `export default [${JSON.stringify(config)}];\n`];
  }
  const plugins = ["typescript", "node", "react", "import", "oxc"];
  return [
    ".oxlintrc.json",
    JSON.stringify({ plugins, categories: { correctness: "off" }, rules: it.rules, options: unused }),
  ];
}

/** The plugins that oxlint calls otherwise than the names of their rules begin for ESLint. */
const prefixes: Record<string, string> = { eslint: "", typescript: "@typescript-eslint/", node: "n/" };

/**
 * How many lines of the `unix` format end in each rule, as ESLint calls it: `a.js:1:1: Message. [Error/eqeqeq]`, and with a
 * configuration of oxlint `[Error/eslint(eqeqeq)]`.
 */
export function countByRule(stdout: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [, written] of stdout.matchAll(/ \[(?:Error|Warning)\/([^\]\n]+)\]$/gm)) {
    const [, plugin, name] = /^(.+)\((.+)\)$/.exec(written) ?? [];
    const rule = plugin === undefined ? written : (prefixes[plugin] ?? `${plugin}/`) + name;
    counts[rule] = (counts[rule] ?? 0) + 1;
  }
  return counts;
}

/** What is wrong with the outcome of a case, or `null`. */
export function verdict(
  it: Case,
  stdout: string,
  exitCode: number | null,
  signal: string | null,
  /** The file when the command has run. */
  text: string,
): string | null {
  if (signal !== null || exitCode === null) return `ended by ${signal ?? "the time limit"}`;
  if (it.keeps) {
    const count = text.match(it.keeps[0])?.length ?? 0;
    if (count !== it.keeps[1]) return `the file matches ${it.keeps[0]} ${count} times, not ${it.keeps[1]}`;
  }
  if (it.length !== undefined) {
    const [found, wanted] = [
      Buffer.byteLength(text),
      it.length === "as before" ? Buffer.byteLength(it.text()) : it.length,
    ];
    if (found !== wanted) return `the file has ${found} bytes, not ${wanted}`;
    if (it.length === "as before" && text !== it.text()) return "the file has changed";
  }
  if (it.lacks?.test(stdout))
    return `the output matches ${it.lacks} (${stdout.match(new RegExp(it.lacks, "g"))?.length} times)`;
  if (it.reports) {
    const sorted = (counts: Record<string, number>) => JSON.stringify(Object.entries(counts).sort());
    const [found, wanted] = [sorted(countByRule(stdout)), sorted(it.reports)];
    if (found !== wanted) return `reported ${found}, not ${wanted} (exit code ${exitCode})`;
  }
  if (it.matches && !it.matches.test(stdout)) return `the output does not match ${it.matches} (exit code ${exitCode})`;
  return [it.exitCode].flat().includes(exitCode) ? null : `exit code ${exitCode}, not ${it.exitCode}`;
}
