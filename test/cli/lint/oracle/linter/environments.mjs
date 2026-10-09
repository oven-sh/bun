// `env` of an `.oxlintrc.json` and of an `.eslintrc.json`: which names each environment defines, and which of them can be written,
// as the real oxlint and the real ESLint 8 show it by `no-undef` and `no-global-assign`, against `bun lint`.
//
//   OXLINT=<the oxlint executable> ESLINT8_DIR=<node_modules/eslint of 8.57.1> node environments.mjs
//
// The names are those of all tables that `bun-lint linter environments [eslint8 | oxlint]` prints. `MORE=<a .json file: [name, ..]>` adds some.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bunLint } from "./shared.mjs";

const tablesOf = (...tool) => {
  const run = spawnSync(bunLint, ["linter", "environments", ...tool], { maxBuffer: 1 << 28 });
  return run.status === 0 ? JSON.parse(run.stdout.toString()) : {};
};
const tables = [tablesOf(), tablesOf("eslint8"), tablesOf("oxlint")];
const more = process.env.MORE ? JSON.parse(readFileSync(process.env.MORE, "utf8")) : [];
const names = [...new Set([...tables.flatMap(it => Object.values(it).flatMap(Object.keys)), ...more])].filter(it => /^[A-Za-z_$][\w$]*$/.test(it)).sort();
const environments = [...new Set(tables.flatMap(Object.keys))].sort();

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bun-lint-oracle-"));
writeFileSync(join(dir, "read.js"), names.map(it => `${it};\n`).join(""));
writeFileSync(join(dir, "write.js"), names.map(it => `${it} = 0;\n`).join(""));
const env = { ...process.env, AGENT: "0", NO_COLOR: "1", ESLINT_USE_FLAT_CONFIG: "false" };
const run = (command, ...args) => spawnSync(command, [...args, "-f", "json", "read.js", "write.js"], { cwd: dir, env, maxBuffer: 1 << 28 }).stdout.toString();
/** The second of two that are the same is another one than the first. */
function counted(reports) {
  const seen = new Map();
  return new Set(reports.map(it => `${it} #${seen.set(it, (seen.get(it) ?? 0) + 1).get(it)}`));
}
/** Of each report the file, the rule, the name, the place with its end, the severity and the text. `null`: the tool refuses the configuration. */
const ofOxlint = out => {
  try {
    return counted(
      JSON.parse(out).diagnostics.map(({ filename, code, severity, message, labels: [{ span }] }) =>
        [filename, code, names[span.line - 1], `${span.column}+${span.length}`, severity, message].join(":"),
      ),
    );
  } catch {
    return null;
  }
};
const ofEslint = out => {
  try {
    return counted(
      JSON.parse(out).flatMap(file =>
        file.messages.map(it =>
          [file.filePath.slice(dir.length + 1), it.ruleId, names[it.line - 1], `${it.column}-${it.endLine}:${it.endColumn}`, it.severity, it.messageId, it.message].join(":"),
        ),
      ),
    );
  } catch {
    return null;
  }
};

const rules = { "no-undef": "error", "no-global-assign": "error" };
const tools = [
  {
    name: "oxlint",
    file: ".oxlintrc.json",
    config: environment => ({ plugins: [], categories: { correctness: "off" }, rules, env: { [environment]: true } }),
    real: process.env.OXLINT && (() => ofOxlint(run(resolve(process.env.OXLINT)))),
    ours: () => ofOxlint(run(bunLint, "cli")),
  },
  {
    name: "eslint 8",
    file: ".eslintrc.json",
    config: environment => ({ root: true, rules, env: { [environment]: true } }),
    real: process.env.ESLINT8_DIR && (() => ofEslint(run(process.execPath, join(resolve(process.env.ESLINT8_DIR), "bin/eslint.js")))),
    ours: () => ofEslint(run(bunLint, "cli")),
  },
];
try {
  for (const { name, file, config, real, ours } of tools) {
    if (!real) continue;
    let [pairs, differ] = [0, 0];
    for (const environment of environments) {
      writeFileSync(join(dir, file), JSON.stringify(config(environment)));
      const [expected, actual] = [real(), ours()];
      if (expected === null || actual === null) {
        if ((expected === null) !== (actual === null)) {
          differ++;
          console.log(`${name}: ${environment}: ${expected === null ? "only the real tool refuses it" : "only bun lint refuses it"}`);
        }
        pairs++;
        continue;
      }
      pairs += names.length * 2;
      const [onlyReal, onlyOurs] = [[...expected].filter(it => !actual.has(it)), [...actual].filter(it => !expected.has(it))];
      differ += onlyReal.length + onlyOurs.length;
      const some = list => `${list.length}${list.length ? `: ${list.slice(0, 6).join(" ")}` : ""}`;
      if (onlyReal.length + onlyOurs.length) console.log(`${name}: ${environment}: only the real tool reports ${some(onlyReal)}; only bun lint reports ${some(onlyOurs)}`);
    }
    rmSync(join(dir, file));
    console.log(`${name}: ${pairs - differ} of ${pairs} agree`);
    if (differ) process.exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
