// `.oxlintrc.json` as oxlint itself applies it (`categories`, `rules`, `overrides`, `ignorePatterns`, `extends`)
// against `Config::from_rc_json`: generated projects are linted by both, and
// which rule reports with which severity on which line of which file is compared. And once more through the command line: all
// that `-f json` of the two has about a report, of all rules that the categories turn on.
//
//   OXLINT=<the oxlint executable> node oxlintrc.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { bunLint, bunLintPrints, random, report, reportsOfOxlint, runBunLint, strictly } from "./shared.mjs";

const oxlint = resolve(process.env.OXLINT ?? "oxlint");
const implemented = new Set(JSON.parse(execFileSync(bunLint, ["linter", "rules", "--oxlint"]).toString()));

// A line for each rule, and one that `eqeqeq` reports unless it has the option "smart".
const probes = { "no-debugger": "debugger;", eqeqeq: "a == b;\na == null;", "no-cond-assign": "if (a = b) {}", "@typescript-eslint/no-this-alias": "const self = this;", "no-array-constructor": "new Array(1, 2);" };
for (const id of Object.keys(probes)) if (!implemented.has(id)) delete probes[id];
const code = `${Object.values(probes).join("\n")}\n`;
// After them, what oxlint parses and ESLint's default parser refuses: a file is not refused because of it.
const typescript = "declare const i: any;\ninterface I { a: 1 }\nabstract class A { abstract m(): void; private b?: number }\nenum E { a }\nlet c = i as I;\n";
const tails = { ".ts": typescript, ".tsx": `${typescript}<a b={1} />;\n`, ".jsx": "<a b={1} />;\n", ".js": "<a b={1} />;\n@d class B {}\n", ".mjs": "@d class B {}\n", ".cjs": "@d class B {}\n", ".cts": typescript };
// TypeScript in a JavaScript file, which oxlint refuses, apart from the last one. It says nothing about such a file with `@flow`.
const inJavaScript = [
  "let t: number = 1;", "function g(a?: string) {}", "let u = b as c;", "enum F { a }", "interface J {}", "type T = 1;", 'import type { K } from "k";', "let v = b!;",
  "class P { m(): void {} }", "class P { private a = 1 }",
];
// What only a module can have. oxlint refuses it in a file that is CommonJS by its name, in `.cts` only the last three.
const ofModules = ['import n from "n";', "export const q = 1;", "export default 1;", 'export * from "n";', "foo(import.meta.url);", "await foo();", "for await (const r of s);", 'import("n");'];
const other = random(17);
const codeOf = name => {
  const extension = name.slice(name.lastIndexOf("."));
  const isMixed = !extension.startsWith(".ts") && other.int(6) === 0;
  const isCommonJs = extension === ".cjs" || extension === ".cts";
  return (
    (isMixed && other.int(3) === 0 ? "// @flow\n" : "") + code + tails[extension] + (isMixed ? `${other.pick(inJavaScript)}\n` : "") +
    (isCommonJs && other.int(2) ? `${other.pick(ofModules)}\n` : "")
  );
};
const ids = Object.keys(probes);

const rng = random(11);
// For what was added later, so that the rest of a project stays what it was.
const later = random(29);
const list = (make, max) => Array.from({ length: 1 + rng.int(max) }, make);
const dirs = ["src", "lib", "test", "dist", "a", "b", ".hidden", "build"];
const names = ["index.js", "a.js", "b.mjs", "d.ts", "e.tsx", "f.test.js", "j.jsx", "k.min.js", "l.cjs", "m.cts"];
const path = () => [...Array.from({ length: rng.int(3) }, () => rng.pick(dirs)), rng.pick(names)].join("/");
const glob = () => rng.pick(["*.js", "*.ts", "*.{js,ts}", "**/*.js", "src/**", "src/**/*.js", "src/*.js", "test/**/*.js", "*.test.js", "**/a/**", "./src/a.js", "lib/*", "*.d.ts", "index.js", "a/b/*.js", "**/*.{ts,tsx}"]);
const ignorePattern = () => rng.pick(["dist", "dist/", "/dist", "build/**", "*.test.js", "**/a/*.js", "!dist/a.js", "/src/a.js", "lib/*.js", ".hidden", "a", "*.d.ts", "/a/", "**/build/**"]);
const severity = () => rng.pick([0, 1, 2, "off", "warn", "error", "allow", "deny"]);
const alias = id => {
  const [, name] = /^@typescript-eslint\/(.*)$/.exec(id) ?? [];
  return name ? rng.pick([id, `typescript/${name}`, `typescript/${name}`, `typescript-eslint/${name}`]) : rng.pick([id, id, `eslint/${id}`]);
};
const ruleValue = id => rng.pick([severity(), severity(), [severity()], ...(id === "eqeqeq" ? [[severity(), "smart"], [severity(), "always"]] : [])]);
// A rule is named once: which of two names for it counts is an accident in oxlint.
const rules = () => Object.fromEntries([...new Set(list(() => rng.pick(ids), 3))].map(id => [alias(id), ruleValue(id)]));
const categories = () => Object.fromEntries(list(() => [rng.pick(["correctness", "pedantic", "style", "suspicious"]), rng.pick(["off", "warn", "error", "allow", "deny"])], 2));
const file = canExtend => ({
  ...(rng.int(2) ? { categories: categories() } : {}),
  ...(rng.int(4) ? { rules: rules() } : {}),
  ...(rng.int(3) === 0 ? { ignorePatterns: list(ignorePattern, 3) } : {}),
  ...(rng.int(3) === 0 ? { plugins: rng.pick([[], ["typescript"], ["unicorn"], ["eslint-plugin-typescript", "react_hooks"], ...(rng.int(6) ? [] : [["n"], ["./a.js"]])]) } : {}),
  overrides: Array.from({ length: rng.int(4) }, () => ({
    files: list(glob, 2),
    ...(rng.int(3) === 0 ? { excludeFiles: list(glob, 2) } : {}),
    ...(later.int(3) === 0 ? { plugins: later.pick([["typescript"], ["typescript"], ["unicorn"], []]) } : {}),
    rules: rules(),
  })),
  ...(canExtend && rng.int(3) === 0 ? { extends: rng.pick([["./base.json"], ["./base.json", "./other.json"], ["./config/base.json"]]) } : {}),
});

const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bun-lint-oxlintrc-"));
const cases = [], expected = [];
// What one of the two refuses to parse has oracles of its own.
const strict = strictly("oxlintrc, by the command line", { withoutRefused: true });
try {
  for (let i = 0; i < 400; i++) {
    // In one of four the configuration is in a directory of its own, and most files are outside of that.
    const project = join(root, String(i));
    const basePath = i % 4 === 3 ? join(project, "src") : project;
    const config = file(true);
    const extended = Object.fromEntries((config.extends ?? []).map(name => [name, file(false)]));
    const sources = Object.fromEntries(list(path, 10).map(it => [join(project, it), codeOf(it)]));
    for (const [name, text] of [[".oxlintrc.json", JSON.stringify(config)], ...Object.entries(extended).map(([name, it]) => [name, JSON.stringify(it)])]) {
      mkdirSync(dirname(join(basePath, name)), { recursive: true });
      writeFileSync(join(basePath, name), text);
    }
    for (const [name, text] of Object.entries(sources)) {
      mkdirSync(dirname(name), { recursive: true });
      writeFileSync(name, text);
    }
    const where = basePath === project ? [] : ["-c", join(basePath, ".oxlintrc.json")];
    const args = [...where, "--format", "json", "--threads", "1", "."];
    const { stdout } = spawnSync(oxlint, args, { cwd: project, maxBuffer: 1 << 26 });
    strict.add(JSON.stringify(config), reportsOfOxlint(stdout.toString()), reportsOfOxlint(bunLintPrints(["--allow-unsupported", ...args], project)));
    let answer;
    try {
      answer = JSON.parse(stdout.toString());
    } catch {
      // oxlint refuses the configuration. Why is compared for a plugin that it does not know.
      const [, why] = /^\s+x (.*Unknown plugin.*)$/m.exec(stdout.toString()) ?? [];
      if (why === undefined) continue;
      cases.push({ basePath, flavor: "oxlint", config, extended, sources });
      expected.push({ error: why });
      continue;
    }
    const byFile = Object.fromEntries(Object.keys(sources).map(name => [name, []]));
    for (const { code, severity, filename, labels } of answer.diagnostics) {
      const [, plugin, name] = /^(.*)\((.*)\)$/.exec(code ?? "") ?? [];
      const id = plugin === "typescript" ? `@typescript-eslint/${name}` : plugin === "eslint" ? name : undefined;
      if (ids.includes(id)) byFile[join(project, filename)].push([id, severity === "error" ? 2 : 1, labels[0].span.line]);
    }
    cases.push({ basePath, flavor: "oxlint", config, extended, sources });
    expected.push(byFile);
  }
  // The `plugins` of overrides. `categories` turn on the rules of the plugins that they add only if one of the overrides that apply
  // to the file names other plugins than all that are on for it. A file that extends or is extended and has no `plugins` adds
  // typescript, unicorn and oxc. A line for a rule of `correctness` of each plugin.
  const ofPlugins = 'debugger;\nit("a", () => { if (x) { expect(1).toBe(1); } });\nnew Array(1);\nx!!.y;\nfunction f() { new Error("a"); }\n';
  const [t, u, o, j, v] = ["typescript", "unicorn", "oxc", "jest", "vitest"];
  const override = (plugins, more = {}) => ({ files: ["__tests__/**"], ...(plugins ? { plugins } : {}), rules: { "no-empty": "off" }, ...more });
  const correctness = { categories: { correctness: "error" } };
  const projects = [];
  for (const layout of ["one file", "extends all", "extends the overrides", "extends the rest"]) {
    for (const ofFile of [undefined, [], [t], [t, u, o], [j], [u]]) {
      for (const first of [undefined, [], [j], [t, j], [t, u, o, j], [t, j, v], [u, j]]) {
        const isWide = (ofFile === undefined || ofFile.length === 1) && !layout.endsWith("l") && !layout.endsWith("t");
        for (const second of isWide ? [null, undefined, [v], [t, v], [t, j, v]] : [null]) {
          const rest = { ...correctness, ...(ofFile ? { plugins: ofFile } : {}) };
          const overrides = [override(first), ...(second === null ? [] : [override(second)])];
          projects.push(
            layout === "one file" ? { ".oxlintrc.json": { ...rest, overrides } }
            : layout === "extends all" ? { ".oxlintrc.json": { extends: ["./all.json"] }, "all.json": { ...rest, overrides } }
            : layout === "extends the overrides" ? { ".oxlintrc.json": { ...rest, extends: ["./overrides.json"] }, "overrides.json": { overrides } }
            : { ".oxlintrc.json": { extends: ["./rest.json"], overrides }, "rest.json": rest },
          );
        }
      }
    }
  }
  const off = { rules: { "jest/no-conditional-expect": "off" } }, warn = { rules: { "jest/no-conditional-expect": "warn" } };
  for (const config of [
    // One that does not apply does not count.
    { ...correctness, plugins: [t], overrides: [override([t, j]), override([t, v], { files: ["src/**"] })] },
    { ...correctness, plugins: [t, u], overrides: [override([t, u, j]), override([v], { files: ["src/**"] })] },
    { ...correctness, plugins: [t], overrides: [override([t, j]), override([t, v], { excludeFiles: ["**/*.spec.ts"] })] },
    { ...correctness, plugins: [t], overrides: [override([t, j]), override([t, j]), override([j, t])] },
    { ...correctness, plugins: [t], overrides: [override([t, j]), override([t, j]), override([])] },
    { ...correctness, plugins: [], overrides: [override([j]), override([v])] },
    { ...correctness, plugins: [], overrides: [override([j, v])] },
    // `eslint` is no plugin, and a plugin has several names.
    { ...correctness, plugins: ["eslint", t], overrides: [override([t, j])] },
    { ...correctness, plugins: [t], overrides: [override(["eslint", t, j])] },
    { ...correctness, plugins: ["@typescript-eslint"], overrides: [override(["typescript-eslint", j])] },
    { ...correctness, plugins: ["react"], overrides: [override(["react-hooks", j])] },
    // What `rules` say.
    { ...correctness, plugins: [t], overrides: [override([t, j], warn)] },
    { ...correctness, plugins: [t], ...warn, overrides: [override([t, j])] },
    { ...correctness, plugins: [t], overrides: [override([j], off)] },
    { ...correctness, plugins: [t], ...off, overrides: [override([j])] },
    { ...correctness, plugins: [t], overrides: [override(undefined, off), override([j])] },
    { ...correctness, plugins: [t], overrides: [override([t, j], off), override([v])] },
    { plugins: [t], overrides: [override([t, j])] },
    { plugins: [t], overrides: [override([j])] },
    { categories: { correctness: "off", suspicious: "error" }, plugins: [t], overrides: [override([j])] },
  ]) projects.push({ ".oxlintrc.json": config });
  projects.forEach((files, i) => {
    const project = join(root, `plugins-${i}`);
    mkdirSync(join(project, "__tests__"), { recursive: true });
    writeFileSync(join(project, "__tests__", "a.spec.ts"), ofPlugins);
    for (const [name, config] of Object.entries(files)) writeFileSync(join(project, name), JSON.stringify(config));
    const args = ["--format", "json", "--threads", "1", "."];
    const { stdout } = spawnSync(oxlint, args, { cwd: project, maxBuffer: 1 << 26 });
    strict.add(JSON.stringify(files), reportsOfOxlint(stdout.toString()), reportsOfOxlint(bunLintPrints(["--allow-unsupported", ...args], project)));
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

const sorted = messages => (messages ?? []).filter(([id]) => ids.includes(id)).sort((a, b) => a[2] - b[2] || (a[0] < b[0] ? -1 : 1));
const actual = runBunLint("project", cases);
// One case for each file. A file that is not linted and one about which nothing is reported look the same in what oxlint prints.
const flat = { cases: [], expected: [], actual: [] };
cases.forEach(({ basePath, config, extended, sources }, i) => Object.keys(sources).forEach(name => {
  flat.cases.push({ file: relative(basePath, name), config, extended });
  flat.expected.push(expected[i].error ?? sorted(expected[i][name]));
  flat.actual.push(actual[i].error ?? sorted(actual[i][name]));
}));
report("oxlintrc", flat.cases, flat.expected, flat.actual, 6);
strict.report();
