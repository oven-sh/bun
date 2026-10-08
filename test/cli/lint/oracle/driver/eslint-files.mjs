// Compares the files that real ESLint lints in a project with those of `bun lint --list-files`.
//
//   bun eslint-files.mjs --eslint=<directory of the eslint package> --project=<directory> --bin="<bun-lint> cli" [--show] [-- <patterns>]
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const dashes = process.argv.indexOf("--");
const own = process.argv.slice(2, dashes < 0 ? undefined : dashes);
const patterns = dashes < 0 ? ["."] : process.argv.slice(dashes + 1);
const flag = name => own.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const eslint = path.resolve(flag("eslint"));
const project = path.resolve(flag("project"));
const bin = flag("bin").split(" ");

const require = createRequire(import.meta.url);
const { findFiles } = require(path.join(eslint, "lib/eslint/eslint-helpers.js"));
const { ConfigLoader } = require(path.join(eslint, "lib/config/config-loader.js"));

process.chdir(project);
const started = performance.now();
const configLoader = new ConfigLoader({ cwd: project, ignoreEnabled: true });
const found = await findFiles({ patterns, globInputPaths: true, cwd: project, configLoader, errorOnUnmatchedPattern: true });
// A file that is named and has no configuration is in the list too.
const expected = new Set(found.filter(file => configLoader.getCachedConfigArrayForFile(file).getConfig(file)));
const theirs = performance.now() - started;

const before = performance.now();
const result = spawnSync(bin[0], [...bin.slice(1), "--list-files", ...patterns], { cwd: project, encoding: "utf8", maxBuffer: 1 << 28 });
const ours = performance.now() - before;
const actual = new Set(result.stdout.split("\n").filter(Boolean));

const onlyEslint = [...expected].filter(it => !actual.has(it));
const onlyBun = [...actual].filter(it => !expected.has(it));
console.log(`ESLint: ${expected.size} files in ${theirs.toFixed(0)} ms. bun lint: ${actual.size} files in ${ours.toFixed(0)} ms. Only ESLint: ${onlyEslint.length}. Only bun lint: ${onlyBun.length}.`);
if (own.includes("--show")) {
  for (const file of onlyEslint.slice(0, 40)) console.log(`- ${path.relative(project, file)}`);
  for (const file of onlyBun.slice(0, 40)) console.log(`+ ${path.relative(project, file)}`);
  if (result.status !== 0) console.log(result.stderr.slice(0, 2000));
}
process.exit(onlyEslint.length + onlyBun.length ? 1 : 0);
