// Runs every case of oxfmt's own CLI tests (apps/oxfmt/test/cli/*/options.json) with real oxfmt and with `bun format`, on a copy of
// the fixtures, and compares the exit code, the files afterwards, and which files `--check` and `--list-different` name.
//
//   bun oxfmt-fixtures.mjs --oxc=<checkout of oxc> --oxfmt=<path of oxfmt> --scratch=<directory> --bin="<bun-lint> cli @format" [--only=substring] [--show]
//
// `--record=<file>` writes the fixtures and what oxfmt does with them, for `test/cli/format/oxfmt-cli/oxfmt-cli.test.ts`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const tests = path.join(path.resolve(flag("oxc")), "apps/oxfmt/test/cli");
// Without a configuration file `bun format` is like Prettier. An empty one above the fixtures makes it like oxfmt.
const above = path.join(path.resolve(flag("scratch")), "oxfmt-app");
const scratch = path.join(above, "fixtures");
const oxfmt = [path.resolve(flag("oxfmt"))];
const bin = flag("bin").split(" ");
const only = flag("only");
const show = process.argv.includes("--show");

// Commands that `bun format` does not have, and languages that it leaves alone.
const leftOut = /^(init|migrate_|external_formatter|svelte|stdin_svelte|toml|vite_|error_reports)/;
const compared = /\.([cm]?[jt]sx?|jsonc?|json5|css|scss|less|graphql|gql|ya?ml|md|markdown)$/;

function readAll(root) {
  const files = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (compared.test(entry.name)) files[path.relative(root, file)] = fs.readFileSync(file, "utf8");
  }
  return files;
}

function run(command, fixtures, test) {
  fs.rmSync(above, { recursive: true, force: true });
  fs.mkdirSync(above, { recursive: true });
  fs.writeFileSync(path.join(above, ".oxfmtrc.json"), "{}\n");
  fs.cpSync(fixtures, scratch, { recursive: true, verbatimSymlinks: true });
  for (const [name, text] of Object.entries(test.gitignore ?? {})) fs.writeFileSync(path.join(scratch, name), text);
  const result = spawnSync(command[0], [...command.slice(1), ...test.args], {
    cwd: path.join(scratch, test.cwd ?? "."),
    input: test.stdin ? fs.readFileSync(path.join(fixtures, test.stdin)) : "",
    env: { ...process.env, ...test.env, NO_COLOR: "1", AGENT: "0", CLAUDECODE: undefined, CI: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, files: readAll(scratch) };
}

const listed = text => [...new Set(text.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map(line => line.replace(/^\[warn\] /, "").replace(/ \(\d+ms\)$/, "")).filter(line => compared.test(line) && !line.includes(" ")))].sort().join("\n");

// Every file of a directory of fixtures. A link is `{ link }`.
function fixturesOf(root) {
  const files = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isSymbolicLink()) files[path.relative(root, file)] = { link: fs.readlinkSync(file) };
    else if (entry.isFile()) files[path.relative(root, file)] = fs.readFileSync(file, "utf8");
  }
  // What is listed through a link to a directory.
  const links = Object.keys(files).filter(name => typeof files[name] !== "string");
  for (const name of Object.keys(files)) if (links.some(link => name.startsWith(`${link}/`))) delete files[name];
  return files;
}
const record = { fixtures: {}, cases: [] };

let [passed, skipped] = [0, 0];
const failed = [];
for (const name of fs.readdirSync(tests).sort()) {
  const options = path.join(tests, name, "options.json");
  if (!fs.existsSync(options)) continue;
  for (const [index, test] of JSON.parse(fs.readFileSync(options, "utf8")).entries()) {
    const title = `${name}/${index} ${test.cwd ? `(${test.cwd}) ` : ""}${test.args.join(" ")}`;
    if (only && !title.includes(only)) continue;
    if (leftOut.test(name)) {
      skipped++;
      continue;
    }
    const fixtures = path.join(tests, name, "fixtures");
    const expected = run(oxfmt, fixtures, test);
    const actual = run(bin, fixtures, test);
    const before = readAll(fixtures);
    record.fixtures[name] ??= fixturesOf(fixtures);
    record.cases.push({
      name,
      index,
      args: test.args,
      cwd: test.cwd,
      env: test.env,
      gitignore: test.gitignore,
      stdin: test.stdin,
      exitCode: expected.status,
      changed: Object.fromEntries(Object.entries(expected.files).filter(([file, text]) => before[file] !== text && !test.gitignore?.[file])),
      listed: test.args.some(it => it === "--check" || it === "--list-different") ? listed(expected.stdout).split("\n").filter(Boolean) : undefined,
      stdout: test.stdin ? expected.stdout : undefined,
    });
    const problems = [];
    if (expected.status !== actual.status) problems.push(`exit code: expected ${expected.status}, got ${actual.status}`);
    for (const file of new Set([...Object.keys(expected.files), ...Object.keys(actual.files)])) {
      if (expected.files[file] !== actual.files[file]) problems.push(`${file} differs\n--- expected\n${JSON.stringify(expected.files[file])}\n--- actual\n${JSON.stringify(actual.files[file])}`);
    }
    const looks = test.args.some(it => it === "--check" || it === "--list-different");
    if (test.stdin ? expected.stdout !== actual.stdout : looks && listed(expected.stdout) !== listed(actual.stdout + actual.stderr)) {
      problems.push(`what is printed differs\n--- expected\n${JSON.stringify(expected.stdout)}\n--- actual\n${JSON.stringify(actual.stdout)}`);
    }
    if (problems.length === 0) passed++;
    else {
      failed.push(title);
      console.log(`FAIL ${title}`);
      if (show) console.log(`${problems.join("\n")}\n--- stderr of oxfmt\n${expected.stderr}\n--- stderr of bun format\n${actual.stderr}\n`);
    }
  }
}
if (flag("record")) fs.writeFileSync(flag("record"), JSON.stringify(record, null, 1) + "\n");
console.log(`${passed} passed, ${failed.length} failed, ${skipped} left out`);
process.exit(failed.length ? 1 : 0);
