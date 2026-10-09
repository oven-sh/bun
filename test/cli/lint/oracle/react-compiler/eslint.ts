// What eslint-plugin-react-hooks reports with its rules of the React Compiler for every input of a directory.
//
//   bun eslint.ts <directory> <out.jsonl> --modules=<node_modules> [--again]
//
// <node_modules> has eslint, eslint-plugin-react-hooks and @typescript-eslint/parser. All rules of the plugin are errors, but for
// `rules-of-hooks` and `exhaustive-deps`, which are not the compiler's. `.ts` and `.tsx` are parsed by typescript-eslint, the rest
// by espree with JSX.
//
// One line for each file, in the order of the paths: {"path", "parse", "messages": [..], "suppressed": [..]}. A message has
// ESLint's own fields: ruleId, severity, message, line, column, endLine, endColumn, suggestions (desc, fix). `parse` is "error" if
// ESLint's parser refuses the file: no rule runs then, and `messages` has what the parser says. Where a message names the file, which
// it does above the code frames of a `.ts` or `.tsx` file, the name is relative to <directory>.
//
//   --again      a second run: is every line the same?

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { inputsByDirectory, JsonlWriter, options, table } from "./shared.ts";

export type Suggestion = { desc: string; fix: { range: [number, number]; text: string } };
export type Message = {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  suggestions?: Suggestion[];
};
export type EslintRecord = { path: string; parse: "ok" | "error"; messages: Message[]; suppressed: Message[] };

type RawMessage = Message & { fatal?: boolean; suggestions?: (Suggestion & { messageId?: string })[] };
type Linter = {
  verify(text: string, config: object[], options: { filename: string }): RawMessage[];
  getSuppressedMessages(): RawMessage[];
};

/** The rules of the plugin that report what the compiler finds, with the prefix. */
export function compilerRules(plugin: { rules: Record<string, unknown> }): string[] {
  const own = new Set(["rules-of-hooks", "exhaustive-deps"]);
  return Object.keys(plugin.rules)
    .filter(rule => !own.has(rule))
    .map(rule => `react-hooks/${rule}`);
}

/** The configuration, from the packages in `modules`. */
export function configOf(modules: string, isOn = true): { config: object[]; rules: string[] } {
  const require = createRequire(join(resolve(modules), "x.js"));
  const plugin = require("eslint-plugin-react-hooks");
  const rules = compilerRules(plugin);
  const config = [
    {
      files: ["**/*.{js,jsx,mjs,ts,tsx}"],
      plugins: { "react-hooks": plugin },
      rules: Object.fromEntries(rules.map(rule => [rule, isOn ? "error" : "off"])),
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      linterOptions: { reportUnusedDisableDirectives: "off" },
    },
    { files: ["**/*.{ts,tsx}"], languageOptions: { parser: require("@typescript-eslint/parser") } },
  ];
  return { config, rules };
}

const plain = (raw: RawMessage, directory: string): Message => ({
  ruleId: raw.ruleId,
  severity: raw.severity,
  message: raw.message.replaceAll(`${directory}/`, ""),
  line: raw.line,
  column: raw.column,
  endLine: raw.endLine,
  endColumn: raw.endColumn,
  suggestions: raw.suggestions?.map(({ desc, fix }) => ({ desc, fix: { range: fix.range, text: fix.text } })),
});

if (import.meta.main) {
  const { flags, rest } = options(process.argv.slice(2));
  if (rest.length !== 2 || !flags.has("modules")) {
    throw new Error("usage: bun eslint.ts <directory> <out.jsonl> --modules=<node_modules>");
  }
  const directory = resolve(rest[0]);
  const modules = resolve(flags.get("modules")!);
  const { Linter } = createRequire(join(modules, "x.js"))("eslint") as { Linter: new (options: object) => Linter };
  const { config, rules } = configOf(modules);
  const linter = new Linter({ configType: "flat", cwd: directory });

  function* all(): Generator<EslintRecord> {
    for (const files of inputsByDirectory(directory).values()) {
      for (const path of files) {
        const found = linter.verify(readFileSync(join(directory, path), "utf8"), config, {
          filename: join(directory, path),
        });
        yield {
          path,
          parse: found.some(message => message.fatal) ? "error" : "ok",
          messages: found.map(message => plain(message, directory)),
          suppressed: linter.getSuppressedMessages().map(message => plain(message, directory)),
        };
      }
    }
  }

  const counts = { files: 0, ok: 0, error: 0, withMessages: 0, messages: 0, suppressed: 0, suggestions: 0 };
  const byRule = new Map(rules.map(rule => [rule, { files: 0, messages: 0 }]));
  const lines = new Map<string, string>();
  const writer = new JsonlWriter(resolve(rest[1]));
  for (const file of all()) {
    writer.write(file);
    lines.set(file.path, Bun.hash(JSON.stringify(file)).toString(36));
    counts.files++;
    counts[file.parse]++;
    counts.suppressed += file.suppressed.length;
    if (file.parse === "error") continue;
    if (file.messages.length > 0) counts.withMessages++;
    counts.messages += file.messages.length;
    const seen = new Set<string>();
    for (const message of file.messages) {
      counts.suggestions += message.suggestions?.length ?? 0;
      const entry = byRule.get(message.ruleId ?? "");
      if (entry === undefined) continue;
      entry.messages++;
      if (!seen.has(message.ruleId!)) entry.files++;
      seen.add(message.ruleId!);
    }
  }
  writer.close();
  console.log(
    table(
      [
        "Files",
        "Parsed",
        "Refused by the parser",
        "With messages",
        "Messages",
        "Suggestions",
        "Suppressed by comments",
      ],
      [
        [
          counts.files,
          counts.ok,
          counts.error,
          counts.withMessages,
          counts.messages,
          counts.suggestions,
          counts.suppressed,
        ],
      ],
    ),
  );
  console.log();
  console.log(
    table(
      ["Rule", "Files", "Messages"],
      [...byRule].map(([rule, entry]) => [rule, entry.files, entry.messages]),
    ),
  );
  if (flags.has("again")) {
    let different = 0;
    for (const file of all()) if (lines.get(file.path) !== Bun.hash(JSON.stringify(file)).toString(36)) different++;
    console.log();
    console.log(table(["Run again", "Files", "Different"], [["", counts.files, different]]));
  }
}
