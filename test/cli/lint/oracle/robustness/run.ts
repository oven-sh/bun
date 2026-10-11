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
