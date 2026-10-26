import type { Case } from "./cases";

/** Returns the name and text of a case's config file. */
export function configOf(it: Case): [string, string] {
  const unused = it.reportsUnusedDirectives ? { reportUnusedDisableDirectives: "error" } : {};
  if (it.eslint) {
    const config = {
      files: ["**/*.{js,ts}"],
      // Only the names are needed, because typescript-eslint's rules and parser are built in.
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

/** oxlint's plugin name -> ESLint's rule prefix, where the two differ. */
const prefixes: Record<string, string> = { eslint: "", typescript: "@typescript-eslint/", node: "n/" };

/**
 * Counts the `unix` format lines per rule, under ESLint's name for the rule. A line is
 * `a.js:1:1: Message. [Error/eqeqeq]`, or with an oxlint config `[Error/eslint(eqeqeq)]`.
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
