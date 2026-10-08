// `.oxlintrc.json` as oxlint itself applies it (`categories`, `rules`, `overrides`, `ignorePatterns`, `extends`)
// against `Config::from_rc_json` with `RcFlavor::Oxlint`: generated projects are linted by both, and
// which rule reports with which severity on which line of which file is compared.
//
//   OXLINT=<the oxlint executable> node oxlintrc.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { bunLint, random, report, runBunLint } from "./shared.mjs";

const oxlint = resolve(process.env.OXLINT ?? "oxlint");
const implemented = new Set(JSON.parse(execFileSync(bunLint, ["linter", "rules"]).toString()));

// A line for each rule, and one that `eqeqeq` reports unless it has the option "smart".
const probes = { "no-debugger": "debugger;", eqeqeq: "a == b;\na == null;", "no-cond-assign": "if (a = b) {}" };
for (const id of Object.keys(probes)) if (!implemented.has(id)) delete probes[id];
const code = `${Object.values(probes).join("\n")}\n`;
// After them, what oxlint parses and ESLint's default parser refuses: a file is not refused because of it.
const typescript = "declare const i: any;\ninterface I { a: 1 }\nabstract class A { abstract m(): void; private b?: number }\nenum E { a }\nlet c = i as I;\n";
const tails = { ".ts": typescript, ".tsx": `${typescript}<a b={1} />;\n`, ".jsx": "<a b={1} />;\n", ".js": "<a b={1} />;\n@d class B {}\n", ".mjs": "@d class B {}\n" };
const codeOf = name => code + tails[name.slice(name.lastIndexOf("."))];
const ids = Object.keys(probes);

const rng = random(11);
const list = (make, max) => Array.from({ length: 1 + rng.int(max) }, make);
const dirs = ["src", "lib", "test", "dist", "a", "b", ".hidden", "build"];
const names = ["index.js", "a.js", "b.mjs", "d.ts", "e.tsx", "f.test.js", "j.jsx", "k.min.js"];
const path = () => [...Array.from({ length: rng.int(3) }, () => rng.pick(dirs)), rng.pick(names)].join("/");
const glob = () => rng.pick(["*.js", "*.ts", "*.{js,ts}", "**/*.js", "src/**", "src/**/*.js", "src/*.js", "test/**/*.js", "*.test.js", "**/a/**", "./src/a.js", "lib/*", "*.d.ts", "index.js", "a/b/*.js", "**/*.{ts,tsx}"]);
const ignorePattern = () => rng.pick(["dist", "dist/", "/dist", "build/**", "*.test.js", "**/a/*.js", "!dist/a.js", "/src/a.js", "lib/*.js", ".hidden", "a", "*.d.ts", "/a/", "**/build/**"]);
const severity = () => rng.pick([0, 1, 2, "off", "warn", "error", "allow", "deny"]);
const alias = id => rng.pick([id, id, `eslint/${id}`]);
const ruleValue = id => rng.pick([severity(), severity(), [severity()], ...(id === "eqeqeq" ? [[severity(), "smart"], [severity(), "always"]] : [])]);
// A rule is named once: which of two names for it counts is an accident in oxlint.
const rules = () => Object.fromEntries([...new Set(list(() => rng.pick(ids), 3))].map(id => [alias(id), ruleValue(id)]));
const categories = () => Object.fromEntries(list(() => [rng.pick(["correctness", "pedantic", "style", "suspicious"]), rng.pick(["off", "warn", "error", "allow", "deny"])], 2));
const file = canExtend => ({
  ...(rng.int(2) ? { categories: categories() } : {}),
  ...(rng.int(4) ? { rules: rules() } : {}),
  ...(rng.int(3) === 0 ? { ignorePatterns: list(ignorePattern, 3) } : {}),
  ...(rng.int(5) === 0 ? { plugins: rng.pick([[], ["typescript"], ["unicorn"]]) } : {}),
  overrides: Array.from({ length: rng.int(4) }, () => ({
    files: list(glob, 2),
    ...(rng.int(3) === 0 ? { excludeFiles: list(glob, 2) } : {}),
    rules: rules(),
  })),
  ...(canExtend && rng.int(3) === 0 ? { extends: rng.pick([["./base.json"], ["./base.json", "./other.json"], ["./config/base.json"]]) } : {}),
});

const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bun-lint-oxlintrc-"));
const cases = [], expected = [];
try {
  for (let i = 0; i < 400; i++) {
    const basePath = join(root, String(i));
    const config = file(true);
    const extended = Object.fromEntries((config.extends ?? []).map(name => [name, file(false)]));
    const sources = Object.fromEntries(list(path, 10).map(it => [join(basePath, it), codeOf(it)]));
    for (const [name, text] of [[".oxlintrc.json", JSON.stringify(config)], ...Object.entries(extended).map(([name, it]) => [name, JSON.stringify(it)])]) {
      mkdirSync(dirname(join(basePath, name)), { recursive: true });
      writeFileSync(join(basePath, name), text);
    }
    for (const [name, text] of Object.entries(sources)) {
      mkdirSync(dirname(name), { recursive: true });
      writeFileSync(name, text);
    }
    const { stdout } = spawnSync(oxlint, ["--format", "json", "--threads", "1", "."], { cwd: basePath, maxBuffer: 1 << 26 });
    let answer;
    try {
      answer = JSON.parse(stdout.toString());
    } catch {
      continue; // oxlint refuses the configuration.
    }
    const byFile = Object.fromEntries(Object.keys(sources).map(name => [name, []]));
    for (const { code, severity, filename, labels } of answer.diagnostics) {
      const id = /^eslint\((.*)\)$/.exec(code)?.[1];
      if (ids.includes(id)) byFile[join(basePath, filename)].push([id, severity === "error" ? 2 : 1, labels[0].span.line]);
    }
    cases.push({ basePath, flavor: "oxlint", config, extended, sources });
    expected.push(byFile);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

const sorted = messages => (messages ?? []).filter(([id]) => ids.includes(id)).sort((a, b) => a[2] - b[2] || (a[0] < b[0] ? -1 : 1));
const actual = runBunLint("project", cases);
// One case for each file. A file that is not linted and one about which nothing is reported look the same in what oxlint prints.
const flat = { cases: [], expected: [], actual: [] };
cases.forEach(({ basePath, config, extended, sources }, i) => Object.keys(sources).forEach(name => {
  flat.cases.push({ file: name.slice(basePath.length + 1), config, extended });
  flat.expected.push(sorted(expected[i][name]));
  flat.actual.push(actual[i].error ?? sorted(actual[i][name]));
}));
report("oxlintrc", flat.cases, flat.expected, flat.actual, 6);
