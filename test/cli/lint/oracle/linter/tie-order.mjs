// The order of the messages of several rules at one line and column: ESLint against `bun lint -f json`.
//
//   ESLINT_DIR=<checkout of eslint with node_modules> BUN_LINT=<bun-lint> node tie-order.mjs <directories of CommonJS ..> [--show <n>]
//
// ESLint sorts by line and column, and its sort is stable: what is at one place stays in the order in which the rules have
// reported it while the tree was walked. So a rule that listens for `Property` comes before one that listens for the
// `FunctionExpression` in it, that before one that listens for `FunctionExpression:exit`, that before `onCodePathEnd`, and
// `Program:exit` is last. Rules that are called with one node at one time are in the order of the configuration.
//
// All core rules are on (`js.configs.all`). Only places count at which both have the same messages.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { bunLint, requireFromEslint } from "./shared.mjs";

const { Linter } = requireFromEslint("./lib/api.js");
const { rules } = requireFromEslint("./packages/js").configs.all;

const args = process.argv.slice(2);
const flag = args.indexOf("--show");
const show = flag < 0 ? 10 : Number(args.splice(flag, 2)[1]);

function* filesOf(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesOf(path);
    else if (extname(entry.name) === ".js") yield path;
  }
}

/** The rules of the messages at each place, in the order of the messages. */
function byPlace(messages) {
  const places = new Map();
  for (const { ruleId, line, column } of messages) {
    if (ruleId === null) continue;
    const place = `${line}:${column}`;
    if (!places.has(place)) places.set(place, []);
    places.get(place).push(ruleId);
  }
  return places;
}

const config = { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" }, rules };
const temporary = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bun-lint-oracle-"));
const totals = { files: 0, ofEslint: 0, here: 0, places: 0, comparable: 0, same: 0 };
const pairs = new Map();
let shown = 0;
try {
  const configFile = join(temporary, "eslint.config.mjs");
  writeFileSync(configFile, `export default [${JSON.stringify(config)}];\n`);
  for (const directory of args.map(it => resolve(it))) {
    const paths = [...filesOf(directory)];
    const run = spawnSync(bunLint, ["cli", "-c", configFile, "-f", "json", "--no-inline-config", ...paths], {
      cwd: directory,
      maxBuffer: 1 << 30,
    });
    const here = new Map(JSON.parse(run.stdout.toString()).map(it => [it.filePath, it.messages]));
    const linter = new Linter({ configType: "flat", cwd: directory });
    for (const path of paths) {
      const expected = linter.verify(readFileSync(path, "utf8"), [config], {
        filename: path,
        allowInlineConfig: false,
      });
      const actual = here.get(path);
      if (actual === undefined || expected.some(it => it.fatal)) continue;
      totals.files++;
      totals.ofEslint += expected.length;
      totals.here += actual.length;
      const places = byPlace(actual);
      for (const [place, inOrder] of byPlace(expected)) {
        if (new Set(inOrder).size < 2) continue;
        totals.places++;
        const ours = places.get(place) ?? [];
        if (ours.toSorted().join() !== inOrder.toSorted().join()) continue;
        totals.comparable++;
        if (ours.join() === inOrder.join()) {
          totals.same++;
          continue;
        }
        const first = inOrder.findIndex((it, i) => it !== ours[i]);
        const pair = `${inOrder[first]} before ${ours[first]}`;
        pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
        if (shown++ < show)
          console.log(`${path}:${place}\n    ESLint: ${inOrder.join(", ")}\n    here:   ${ours.join(", ")}`);
      }
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

// An empty run agrees with everything.
console.log(`${totals.files} files; messages: ESLint ${totals.ofEslint}, here ${totals.here}`);
console.log(
  `places with messages of several rules: ${totals.places}, ${totals.comparable} of them with the same messages here`,
);
for (const [pair, count] of [...pairs].sort((a, b) => b[1] - a[1]).slice(0, show))
  console.log(`${count} times: ${pair}`);
console.log(`order of ties: ${totals.same} of ${totals.comparable} agree`);
if (totals.same < totals.comparable || totals.comparable === 0) process.exitCode = 1;
