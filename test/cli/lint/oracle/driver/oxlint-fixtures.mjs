// Runs every command line of oxlint's own CLI tests (its snapshots name the arguments and the working directory) with real oxlint
// and with `bun lint`, on a copy of its fixtures, and compares by (file, line, column, rule) for the rules that both have, the
// number of files that are linted, and whether the exit code is 0.
//
//   bun oxlint-fixtures.mjs --oxc=<checkout of oxc> --oxlint=<path of oxlint> --scratch=<directory> --bin="<bun-lint> cli" [--only=substring] [--show]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const app = path.join(path.resolve(flag("oxc")), "apps/oxlint");
const scratch = path.join(path.resolve(flag("scratch")), "oxlint-app");
const only = flag("only");
const show = process.argv.includes("--show");

fs.rmSync(scratch, { recursive: true, force: true });
fs.cpSync(path.join(app, "fixtures"), path.join(scratch, "fixtures"), { recursive: true, verbatimSymlinks: true });
// Without a configuration file `bun lint` has its own defaults. An empty one has oxlint's.
fs.writeFileSync(path.join(scratch, ".oxlintrc.json"), "{}");

const cases = new Map();
for (const name of fs.readdirSync(path.join(app, "src/snapshots"))) {
  const text = fs.readFileSync(path.join(app, "src/snapshots", name), "utf8");
  for (const match of text.matchAll(/^arguments: (.*)\nworking directory: (.*)$/gm)) {
    cases.set(`${match[2]} $ ${match[1]}`, { cwd: match[2].trim(), args: match[1].split(/\s+/).filter(Boolean) });
  }
}

// Not about linting, or they write.
const skipped = /^(--fix|--print-config|--debug|--init|--rules|--lsp|--type-check-only|--suppress|--output-file)|\.(vue|astro|svelte)$|^fixtures\/cli\/(vue|astro|svelte)/;
let passed = 0;
const failed = [];
let left = 0;
for (const [name, test] of [...cases].sort()) {
  if (only && !name.includes(only)) continue;
  if (test.args.some(it => skipped.test(it))) {
    left++;
    continue;
  }
  // The format is the script's.
  const args = test.args.filter((it, at) => !/^(--format|-f)(=|$)/.test(it) && !/^(--format|-f)$/.test(test.args[at - 1] ?? ""));
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "oxlint-differential.mjs"), `--project=${path.join(scratch, test.cwd)}`, `--oxlint=${flag("oxlint")}`, `--bin=${flag("bin")}`, "--show", "--status", "--", ...args],
    { encoding: "utf8" },
  );
  if (result.status === 0) passed++;
  else {
    failed.push(name);
    const lines = (result.stdout + result.stderr).split("\n").filter(line => /^[-+!] |^(oxlint|bun lint): |not JSON/.test(line));
    console.log(`FAIL ${name}${show ? `\n${lines.slice(0, 14).join("\n")}` : ""}`);
  }
}
console.log(`${passed} passed, ${failed.length} failed, ${left} left out`);
process.exit(failed.length ? 1 : 0);
