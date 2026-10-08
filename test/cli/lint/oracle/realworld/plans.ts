// What is enabled in a pass over real code. A plan is JSON, so that ESLint and `bun lint` are configured from the same data.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Plan {
  name: string;
  /** With `parserOptions.projectService`. */
  typed: boolean;
  /**
   * `false`: `.js`, `.mjs`, `.cjs` and `.jsx` are parsed by espree, and only the core rules run on them: some rules of
   * typescript-eslint throw without its parser. `true`: only those files are linted, with the parser of typescript-eslint and
   * all rules.
   */
  javascriptAsTypescript: boolean;
  /** By the id that a configuration file uses: `eqeqeq`, `@typescript-eslint/no-explicit-any`. */
  rules: Record<string, unknown[]>;
}

/** Starts a line of a worker's output that is a result. A parser or a rule can print, too. */
export const RESULT_MARKER = "\x1eresult ";

/** The ids under which what is not from a rule is counted. */
export const PARSE_ERROR = "(parse error)";
export const LINTER = "(linter)";

export const EXTENSIONS = ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"];
export const ALL_FILES = `**/*.{${EXTENSIONS.join(",")}}`;
export const TYPESCRIPT_FILES = "**/*.{ts,mts,cts,tsx}";

interface Fixture {
  plugin: "eslint" | "typescript-eslint";
  rule: string;
  meta: { requiresTypeChecking: boolean };
  cases: { options: unknown[]; skip: string | null }[];
}

/**
 * - `default`: every rule that needs no types, without options.
 * - `options-1` .. `options-<n>`: the same rules, each with the options that its upstream tests use most often, second most
 *   often, and so on. A rule that has no more options is left out.
 * - `typed`, `typed-options-1` ..: the same for the rules that need types.
 * - `default-js-as-ts`, `options-1-js-as-ts` ..: the JavaScript files once more, with the parser of typescript-eslint.
 *
 * `implemented`: the ids of the rules that `bun lint` has.
 */
export function buildPlans(fixtures: string, implemented: Set<string>, optionSets: number): Plan[] {
  const plans = new Map<string, Plan>();
  const plan = (name: string, typed: boolean) => {
    if (!plans.has(name)) plans.set(name, { name, typed, javascriptAsTypescript: false, rules: {} });
    return plans.get(name)!;
  };
  for (const plugin of ["eslint", "typescript-eslint"] as const) {
    for (const file of readdirSync(join(fixtures, plugin)).sort()) {
      const fixture: Fixture = JSON.parse(readFileSync(join(fixtures, plugin, file), "utf8"));
      const id = plugin === "eslint" ? fixture.rule : `@typescript-eslint/${fixture.rule}`;
      if (!implemented.has(id)) continue;
      const typed = fixture.meta.requiresTypeChecking;
      const prefix = typed ? "typed" : "";
      plan(prefix || "default", typed).rules[id] = ["error"];
      const counts = new Map<string, number>();
      for (const { options, skip } of fixture.cases) {
        if (skip || options.length === 0) continue;
        const key = JSON.stringify(options);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const common = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, optionSets);
      common.forEach(([options], i) => {
        plan(`${prefix}${prefix && "-"}options-${i + 1}`, typed).rules[id] = ["error", ...JSON.parse(options)];
      });
    }
  }
  const all = [...plans.values()];
  for (const it of all.filter(it => !it.typed)) {
    all.push({ ...it, name: `${it.name}-js-as-ts`, javascriptAsTypescript: true });
  }
  return all;
}

/**
 * The text of an `eslint.config.mjs` for `plan`. The plugin and the parser are only names: that is all `bun lint` wants to know
 * of them.
 */
export function configModule(plan: Plan): string {
  return `const plugin = { meta: { name: "@typescript-eslint/eslint-plugin" } };
const parser = { meta: { name: "typescript-eslint/parser" } };
export default ${JSON.stringify(configObjects(plan, "$plugin", "$parser"), null, 1)
    .replaceAll('"$plugin"', "plugin")
    .replaceAll('"$parser"', "parser")};
`;
}

/** The configuration objects for `plan`, the same for both linters. */
export function configObjects(plan: Plan, plugin: unknown, parser: unknown): Record<string, unknown>[] {
  const isCore = ([id]: [string, unknown]) => !id.includes("/");
  const rules = Object.entries(plan.rules);
  const typescript = plan.javascriptAsTypescript ? ALL_FILES : TYPESCRIPT_FILES;
  return [
    { files: [ALL_FILES], rules: Object.fromEntries(rules.filter(isCore)) },
    {
      files: [typescript],
      plugins: { "@typescript-eslint": plugin },
      languageOptions: { parser, ...(plan.typed ? { parserOptions: { projectService: true } } : {}) },
      rules: Object.fromEntries(rules.filter(it => !isCore(it))),
    },
    { files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
  ];
}
