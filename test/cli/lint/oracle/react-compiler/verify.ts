// What a command that does what ESLint's `Linter.verify` does reports with the rules `react-hooks/*` of the React Compiler, as the
// records of eslint.ts, for compare-eslint.ts.
//
//   bun verify.ts <directory> <out.jsonl> --tool="<path> <arguments>" [--files-of=<jsonl>]
//
// The command gets the path of a file with an array of {code, filename, config, options} as its last argument and prints an array of
// {messages, suppressedMessages}. The configuration says what that of eslint.ts says: the same rules are errors, `.ts` and `.tsx` are
// TypeScript, the rest is JavaScript with JSX. The names of the files are absolute, since messages quote them; in the records they
// are relative to <directory>, as in those of eslint.ts.
//
// All inputs of <directory>, or with `--files-of` the files that the lines of that file name with "path", relative to <directory>.
// The files are only read.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type EslintRecord, type Message, plain } from "./eslint.ts";
import { ESLINT_ONLY, inputsByDirectory, jsonDocuments, JsonlWriter, options, RULES, table } from "./shared.ts";

const { flags, rest } = options(process.argv.slice(2));
if (rest.length !== 2 || !flags.has("tool")) {
  throw new Error('usage: bun verify.ts <directory> <out.jsonl> --tool="<path> <arguments>" [--files-of=<jsonl>]');
}
const directory = resolve(rest[0]);
const out = resolve(rest[1]);
const tool = flags.get("tool")!.split(" ");

const names = [...RULES.map(([rule]) => rule), ...ESLINT_ONLY.map(([rule]) => rule), "component-hook-factories"];
const configOf = (path: string) => ({
  plugins: { "react-hooks": "eslint-plugin-react-hooks" },
  rules: Object.fromEntries(names.map(rule => [`react-hooks/${rule}`, "error"])),
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
    ...(/\.tsx?$/.test(path) ? { parser: "typescript" } : {}),
  },
  linterOptions: { reportUnusedDisableDirectives: "off" },
});

let paths: string[];
if (flags.has("files-of")) {
  paths = [];
  for (const document of jsonDocuments(readFileSync(flags.get("files-of")!, "utf8"))) {
    const { path } = document as { path?: string };
    if (path !== undefined) paths.push(path);
  }
} else {
  paths = [...inputsByDirectory(directory).values()].flat();
}

type Result = { messages?: (Message & { fatal?: boolean })[]; suppressedMessages?: Message[]; error?: string } | null;

const cases = `${out}.cases.json`;
const writer = new JsonlWriter(out);
const counts = { files: 0, refused: 0, failed: 0, withMessages: 0, messages: 0 };
let batch: { path: string; code: string }[] = [];
let bytes = 0;

function flush() {
  if (batch.length === 0) return;
  const given = batch.map(({ path, code }) => ({
    code,
    filename: join(directory, path),
    config: configOf(path),
    options: {},
  }));
  writeFileSync(cases, JSON.stringify(given));
  const result = Bun.spawnSync({ cmd: [...tool, cases], stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout.toString();
  if (!stdout.startsWith("[")) {
    throw new Error(
      `${batch[0].path} ..: exit ${result.exitCode ?? result.signalCode}: ${result.stderr.toString().slice(-1500)}`,
    );
  }
  (JSON.parse(stdout) as Result[]).forEach((found, i) => {
    const { path } = batch[i];
    counts.files++;
    if (found === null || found.messages === undefined) {
      counts.failed++;
      console.log(`${path}: ${found?.error ?? "not linted"}`);
      return;
    }
    const isRefused = found.messages.some(message => message.fatal);
    if (isRefused) counts.refused++;
    else {
      counts.messages += found.messages.length;
      if (found.messages.length > 0) counts.withMessages++;
    }
    writer.write({
      path,
      parse: isRefused ? "error" : "ok",
      messages: found.messages.map(message => plain(message, directory)),
      suppressed: (found.suppressedMessages ?? []).map(message => plain(message, directory)),
    } satisfies EslintRecord);
  });
  batch = [];
  bytes = 0;
}

for (const path of paths) {
  const code = readFileSync(join(directory, path), "utf8");
  batch.push({ path, code });
  bytes += code.length;
  if (batch.length === 500 || bytes > 8_000_000) flush();
}
flush();
writer.close();
rmSync(cases, { force: true });
console.log(
  table(
    ["Files", "Refused by the parser", "Not linted", "With messages", "Messages"],
    [[counts.files, counts.refused, counts.failed, counts.withMessages, counts.messages]],
  ),
);
