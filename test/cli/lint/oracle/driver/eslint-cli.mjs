// Runs the command line of real ESLint and `bun lint` on generated projects, and compares standard output byte for byte, the
// exit code, and the files after `--fix`.
//
//   bun eslint-cli.mjs --deps=<directory with node_modules/eslint> --scratch=<directory> --bin="<bun-lint> cli" [--only=substring] [--verbose]
//
// `--bin` is the command that stands for `bun lint`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cases } from "./eslint-cli-cases.mjs";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const deps = path.resolve(flag("deps"));
const scratch = path.resolve(flag("scratch"));
const bin = flag("bin").split(" ");
const only = flag("only");
const verbose = process.argv.includes("--verbose");
const eslint = path.join(deps, "node_modules/eslint/bin/eslint.js");

function write(root, files) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(path.join(deps, "node_modules"), path.join(root, "node_modules"));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (typeof text === "object") fs.symlinkSync(text.link, file);
    else fs.writeFileSync(file, text);
  }
}

function snapshot(root, files) {
  const out = {};
  for (const name of Object.keys(files)) {
    try {
      out[name] = fs.readFileSync(path.join(root, name), "utf8");
    } catch {}
  }
  return out;
}

function run(command, root, test) {
  write(root, test.files);
  const env = {
    ...process.env,
    NO_COLOR: undefined,
    FORCE_COLOR: undefined,
    AGENT: "0",
    CLAUDECODE: undefined,
    ...test.env,
  };
  const result = spawnSync(command[0], [...command.slice(1), ...test.args], {
    cwd: path.join(root, test.cwd ?? "."),
    input: test.stdin ?? "",
    env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const extra = {};
  for (const name of test.reads ?? []) {
    try {
      extra[name] = fs.readFileSync(path.join(root, name), "utf8");
    } catch {}
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    files: snapshot(root, test.files),
    extra,
  };
}

let passed = 0;
const failed = [];
// Both run in the same directory, one after the other: paths are part of the output.
const root = path.join(scratch, "project");
for (const test of cases) {
  if (only && !test.name.includes(only)) continue;
  const expected = run(["node", eslint], root, test);
  const actual = run(bin, root, test);
  const problems = [];
  if (expected.status !== actual.status) problems.push(`exit code: expected ${expected.status}, got ${actual.status}`);
  if (expected.stdout !== actual.stdout) {
    problems.push(
      `stdout differs\n--- expected\n${JSON.stringify(expected.stdout)}\n--- actual\n${JSON.stringify(actual.stdout)}`,
    );
  }
  if (JSON.stringify(expected.files) !== JSON.stringify(actual.files)) {
    problems.push(
      `files differ\n--- expected\n${JSON.stringify(expected.files)}\n--- actual\n${JSON.stringify(actual.files)}`,
    );
  }
  if (JSON.stringify(expected.extra) !== JSON.stringify(actual.extra)) {
    problems.push(
      `written files differ\n--- expected\n${JSON.stringify(expected.extra)}\n--- actual\n${JSON.stringify(actual.extra)}`,
    );
  }
  if (problems.length === 0) {
    passed++;
    if (verbose) console.log(`ok   ${test.name}`);
  } else {
    failed.push(test.name);
    console.log(`FAIL ${test.name}: eslint ${test.args.join(" ")}\n${problems.join("\n")}`);
    console.log(`--- stderr of ESLint\n${expected.stderr}\n--- stderr of bun lint\n${actual.stderr}\n`);
  }
}
console.log(`${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
