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
  return [".oxlintrc.json", JSON.stringify({ plugins, categories: { correctness: "off" }, rules: it.rules, options: unused })];
}

/** How many lines of the `unix` format end in each rule: `a.js:1:1: Message. [Error/eqeqeq]`. */
export function countByRule(stdout: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [, rule] of stdout.matchAll(/ \[(?:Error|Warning)\/([^\]\n]+)\]$/gm))
    counts[rule] = (counts[rule] ?? 0) + 1;
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
    const [found, wanted] = [Buffer.byteLength(text), it.length === "as before" ? Buffer.byteLength(it.text()) : it.length];
    if (found !== wanted) return `the file has ${found} bytes, not ${wanted}`;
    if (it.length === "as before" && text !== it.text()) return "the file has changed";
  }
  if (it.lacks?.test(stdout)) return `the output matches ${it.lacks} (${stdout.match(new RegExp(it.lacks, "g"))?.length} times)`;
  if (it.reports) {
    const sorted = (counts: Record<string, number>) => JSON.stringify(Object.entries(counts).sort());
    const [found, wanted] = [sorted(countByRule(stdout)), sorted(it.reports)];
    if (found !== wanted) return `reported ${found}, not ${wanted} (exit code ${exitCode})`;
  }
  if (it.matches && !it.matches.test(stdout)) return `the output does not match ${it.matches} (exit code ${exitCode})`;
  return exitCode === it.exitCode ? null : `exit code ${exitCode}, not ${it.exitCode}`;
}
