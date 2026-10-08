// Runs the command line of real Prettier and `bun format` on generated projects, and compares the files afterwards, the exit
// code, and what `--check` and `--list-different` print.
//
//   bun prettier-cli.mjs --deps=<directory with node_modules/prettier> --scratch=<directory> --bin="<bun-lint> cli @format" [--only=substring] [--verbose]
//
// `bun format` writes unless told otherwise, so Prettier is given `--write` where the case has neither `--check` nor `-l`, and
// what the two print then is not compared. Only JavaScript, TypeScript and JSON are compared: `bun format` leaves the rest alone.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cases } from "./prettier-cli-cases.mjs";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const deps = path.resolve(flag("deps"));
const scratch = path.resolve(flag("scratch"));
const bin = flag("bin").split(" ");
const only = flag("only");
const verbose = process.argv.includes("--verbose");
const prettier = path.join(deps, "node_modules/prettier/bin/prettier.cjs");

function write(root, files) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (typeof text === "object") fs.symlinkSync(text.link, file);
    else fs.writeFileSync(file, text);
  }
}

function run(command, root, test, args) {
  write(root, test.files);
  const result = spawnSync(command[0], [...command.slice(1), ...args], {
    cwd: path.join(root, test.cwd ?? "."),
    input: test.stdin ?? "",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: undefined, AGENT: "0", CLAUDECODE: undefined, CI: "1" },
    encoding: "utf8",
  });
  const files = {};
  for (const name of Object.keys(test.files)) {
    if (!/\.([cm]?[jt]sx?|jsonc?|json5|css|scss|less|graphql|gql|ya?ml)$/.test(name)) continue;
    try {
      files[name] = fs.readFileSync(path.join(root, name), "utf8");
    } catch {}
  }
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, files };
}

// What the two word differently on purpose, or only one of them says.
const normalize = text =>
  text
    .split("\n")
    .filter(line => !/does not support yet|^Formatted \d+ files?/.test(line))
    // A file in another language.
    .filter(line => !/^(\[warn\] )?\S+\.(md|html)$/.test(line))
    .join("\n")
    .replace("Run Prettier with --write to fix.", "Run bun format to fix.");

let passed = 0;
const failed = [];
const root = path.join(scratch, "format-project");
for (const test of cases) {
  if (only && !test.name.includes(only)) continue;
  const looks = test.args.some(it => ["--check", "-c", "-l", "--list-different", "--find-config-path"].includes(it)) || test.args.some(it => it.startsWith("--stdin-filepath"));
  const expected = run(["node", prettier], root, test, looks ? test.args : ["--write", ...test.args]);
  const actual = run(bin, root, test, test.args);
  const problems = [];
  if (expected.status !== actual.status) problems.push(`exit code: expected ${expected.status}, got ${actual.status}`);
  if (JSON.stringify(expected.files) !== JSON.stringify(actual.files)) {
    problems.push(`files differ\n--- expected\n${JSON.stringify(expected.files)}\n--- actual\n${JSON.stringify(actual.files)}`);
  }
  if (looks) {
    for (const stream of ["stdout", "stderr"]) {
      if (test.ignores?.includes(stream)) continue;
      if (normalize(expected[stream]) !== normalize(actual[stream])) {
        problems.push(`${stream} differs\n--- expected\n${JSON.stringify(expected[stream])}\n--- actual\n${JSON.stringify(actual[stream])}`);
      }
    }
  }
  if (problems.length === 0) {
    passed++;
    if (verbose) console.log(`ok   ${test.name}`);
  } else {
    failed.push(test.name);
    console.log(`FAIL ${test.name}: prettier ${test.args.join(" ")}\n${problems.join("\n")}`);
    console.log(`--- stderr of Prettier\n${expected.stderr}\n--- stderr of bun format\n${actual.stderr}\n`);
  }
}
console.log(`${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
