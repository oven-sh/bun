// Runs the command lines of Prettier's own integration tests (`runCli("cli/..", [..])` in tests/integration/__tests__/*.js) with real
// Prettier and with `bun format`, on a copy of tests/integration/cli, and compares the exit code, the files afterwards, which files
// `--check` and `--list-different` name, and what is printed for standard input.
//
//   bun prettier-fixtures.mjs --prettier=<checkout of prettier> --deps=<directory with node_modules/prettier> --scratch=<directory> --bin="<bun-lint> cli @format" [--only=substring] [--show]
//
// `bun format` writes unless told otherwise, so Prettier is given `--write` where the command line only prints.
// `--record=<file>` writes the fixtures and what Prettier does with them, for `test/cli/format/prettier-cli/prettier-cli.test.ts`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const integration = path.join(path.resolve(flag("prettier")), "tests/integration");
const scratch = path.join(path.resolve(flag("scratch")), "prettier-app");
const prettier = ["node", path.join(path.resolve(flag("deps")), "node_modules/prettier/bin/prettier.cjs")];
const bin = flag("bin").split(" ");
const only = flag("only");
const show = process.argv.includes("--show");

const compared = /\.([cm]?[jt]sx?|jsonc?|json5|css|scss|less|graphql|gql|ya?ml|md|markdown|hbs|handlebars|html?|vue|mjml)$/;
// The languages that `bun format` leaves alone.
const notCompared = /\.mdx$/;
// What `bun format` does not have, or has on purpose in another way.
const leftOut = /^--(cache|debug-|file-info|support-info|plugin|help|version|experimental-cli|no-plugin-search|log-level=?debug|find-config-path|(no-)?unknown)|^-[hva]$/;
// Plugins do not load.
const leftOutDirectories = /infer-plugins|config\/plugins/;
// The flags that take a value. Without a file, a directory or a pattern Prettier formats standard input and `bun format` the directory.
const takesValue = /^--(config|parser|config-precedence|log-level|end-of-line|ignore-path|stdin-filepath|tab-width|print-width|trailing-comma|range-start|range-end|cursor-offset)$/;
const hasPattern = args => args.some((arg, index) => !arg.startsWith("-") && !takesValue.test(args[index - 1] ?? ""));

function commandLines() {
  const found = [];
  for (const name of fs.readdirSync(path.join(integration, "__tests__")).filter(it => it.endsWith(".js")).sort()) {
    const text = fs.readFileSync(path.join(integration, "__tests__", name), "utf8");
    for (const [, directory, args, options] of text.matchAll(/runCli\(\s*"([^"]*)",\s*(\[[^\]]*\])\s*(?:,\s*(\{[^}]*\}))?,?\s*\)/g)) {
      try {
        found.push({ test: name, directory, args: new Function(`return ${args}`)(), options: options ? new Function(`return ${options}`)() : {} });
      } catch {}
    }
  }
  return found;
}

function readAll(root) {
  const files = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isFile() && !notCompared.test(entry.name)) files[path.relative(root, file)] = fs.readFileSync(file, "utf8");
  }
  return files;
}

function run(command, it, args) {
  const top = it.directory.split("/").slice(0, 2).join("/");
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.cpSync(path.join(integration, top), path.join(scratch, top), { recursive: true, verbatimSymlinks: true });
  const result = spawnSync(command[0], [...command.slice(1), ...args], {
    cwd: path.join(scratch, it.directory),
    input: it.options.input ?? "",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: undefined, AGENT: "0", CLAUDECODE: undefined, CI: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, files: readAll(scratch) };
}

const listed = text => [...new Set(text.split("\n").map(line => line.replace(/^\[warn\] /, "")).filter(line => compared.test(line) && !line.includes(" ")))].sort().join("\n");

// Every file of a directory of fixtures. A link is `{ link }`.
function fixturesOf(root) {
  const files = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isSymbolicLink()) files[path.relative(root, file)] = { link: fs.readlinkSync(file) };
    else if (entry.isFile()) files[path.relative(root, file)] = fs.readFileSync(file, "utf8");
  }
  const links = Object.keys(files).filter(name => typeof files[name] !== "string");
  for (const name of Object.keys(files)) if (links.some(link => name.startsWith(`${link}/`))) delete files[name];
  return files;
}
const record = { fixtures: {}, cases: [] };

let [passed, skipped] = [0, 0];
const failed = [];
const seen = new Set();
for (const it of commandLines()) {
  const title = `${it.test}: ${it.directory} $ ${it.args.join(" ")}`;
  if (seen.has(title) || (only && !title.includes(only))) continue;
  seen.add(title);
  if (!it.directory.startsWith("cli/") || !fs.existsSync(path.join(integration, it.directory)) || it.args.some(arg => typeof arg !== "string" || leftOut.test(arg)) || leftOutDirectories.test(it.directory)) {
    skipped++;
    continue;
  }
  const isStdin = it.args.some(arg => arg.startsWith("--stdin-filepath"));
  if (!isStdin && !hasPattern(it.args)) {
    skipped++;
    continue;
  }
  const looks = it.args.some(arg => ["--check", "-c", "-l", "--list-different"].includes(arg));
  const expected = run(prettier, it, looks || isStdin || it.args.includes("--write") ? it.args : ["--write", ...it.args]);
  const actual = run(bin, it, it.args);
  const top = it.directory.split("/").slice(0, 2).join("/");
  record.fixtures[top] ??= fixturesOf(path.join(integration, top));
  record.cases.push({
    test: it.test,
    directory: it.directory,
    args: it.args,
    input: it.options.input,
    exitCode: expected.status,
    changed: Object.fromEntries(Object.entries(expected.files).filter(([file, text]) => record.fixtures[top][path.relative(top, file)] !== text)),
    listed: looks && !isStdin ? listed(expected.stdout + expected.stderr).split("\n").filter(Boolean) : undefined,
    stdout: isStdin ? expected.stdout : undefined,
  });
  const problems = [];
  if (expected.status !== actual.status) problems.push(`exit code: expected ${expected.status}, got ${actual.status}`);
  for (const file of new Set([...Object.keys(expected.files), ...Object.keys(actual.files)])) {
    if (expected.files[file] !== actual.files[file]) problems.push(`${file} differs\n--- expected\n${JSON.stringify(expected.files[file])}\n--- actual\n${JSON.stringify(actual.files[file])}`);
  }
  if (isStdin ? expected.stdout !== actual.stdout : looks && listed(expected.stdout + expected.stderr) !== listed(actual.stdout + actual.stderr)) {
    problems.push(`what is printed differs\n--- expected\n${JSON.stringify(expected.stdout)}\n--- actual\n${JSON.stringify(actual.stdout)}`);
  }
  if (problems.length === 0) passed++;
  else {
    failed.push(title);
    console.log(`FAIL ${title}`);
    if (show) console.log(`${problems.join("\n")}\n--- stderr of Prettier\n${expected.stderr}\n--- stderr of bun format\n${actual.stderr}\n`);
  }
}
if (flag("record")) fs.writeFileSync(flag("record"), JSON.stringify(record, null, 1) + "\n");
console.log(`${passed} passed, ${failed.length} failed, ${skipped} left out`);
process.exit(failed.length ? 1 : 0);
