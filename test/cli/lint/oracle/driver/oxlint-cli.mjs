// Runs oxlint-differential.mjs on generated projects: which files are linted with which configuration where an `.oxlintrc.json`
// is in charge.
//
//   bun oxlint-cli.mjs --oxlint=<path of oxlint> --scratch=<directory> --bin="<bun-lint> cli" [--only=substring]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const scratch = path.resolve(flag("scratch"));
const only = flag("only");

const off = { categories: { correctness: "off" } };
const rc = (more = {}) => JSON.stringify({ ...off, rules: { "no-debugger": "error" }, ...more });
const code = "debugger;\nif (a == b) {}\n";
const project = {
  ".oxlintrc.json": rc(),
  "a.js": code,
  "src/b.ts": code,
  "src/c.tsx": code,
  "src/d.mjs": code,
  "src/e.cjs": code,
  "src/f.min.js": code,
  "src/.hidden/g.js": code,
  "src/deep/h.jsx": code,
  "src/i.d.ts": "declare const i: any;\n",
  "notes.md": code,
  // Not `node_modules`: oxlint only skips it if `.gitignore` says so, `bun lint` always.
};

const cases = [
  { name: "no arguments", files: project },
  { name: "a directory", files: project, args: ["src"] },
  { name: "files", files: project, args: ["a.js", "src/b.ts", "notes.md"] },
  { name: "from a subdirectory", files: project, cwd: "src" },
  { name: "default categories", files: { ...project, ".oxlintrc.json": "{}" } },
  { name: "no configuration file of oxlint, rules from flags", files: { ...project, ".oxlintrc.json": JSON.stringify(off) }, args: ["-D", "eqeqeq"] },
  { name: "-A after the file", files: project, args: ["-A", "no-debugger", "-W", "eqeqeq"] },
  { name: "-D then -A", files: project, args: ["-D", "eqeqeq", "-A", "eqeqeq"] },
  { name: "ignorePatterns", files: { ...project, ".oxlintrc.json": rc({ ignorePatterns: ["src/deep", "*.mjs", "/a.js"] }) } },
  { name: "ignorePatterns, a file is named", files: { ...project, ".oxlintrc.json": rc({ ignorePatterns: ["a.js"] }) }, args: ["a.js", "src/b.ts"] },
  { name: "ignore-pattern", files: project, args: ["--ignore-pattern", "src/deep/**", "--ignore-pattern", "*.ts"] },
  { name: "gitignore", files: { ...project, ".git/HEAD": "ref: x", ".gitignore": "src/deep\n*.cjs\n" } },
  { name: "gitignore without a repository", files: { ...project, ".gitignore": "src/deep\n*.cjs\n" } },
  { name: "nested gitignore", files: { ...project, ".git/HEAD": "ref: x", "src/.gitignore": "b.ts\n/deep\n!c.tsx\n", ".gitignore": "c.tsx\n" } },
  { name: "gitignore negation", files: { ...project, ".git/HEAD": "ref: x", ".gitignore": "src/*\n!src/b.ts\n" } },
  { name: "gitignore above the working directory", files: { ...project, ".git/HEAD": "ref: x", ".gitignore": "b.ts\n" }, cwd: "src" },
  { name: "gitignore, a file is named", files: { ...project, ".git/HEAD": "ref: x", ".gitignore": "a.js\n" }, args: ["a.js"] },
  { name: "eslintignore", files: { ...project, ".eslintignore": "src/deep\na.js\n" } },
  { name: "no-ignore", files: { ...project, ".git/HEAD": "ref: x", ".gitignore": "a.js\n", ".oxlintrc.json": rc({ ignorePatterns: ["src/deep"] }) }, args: ["--no-ignore"] },
  { name: "overrides", files: { ...project, ".oxlintrc.json": rc({ overrides: [{ files: ["*.ts", "src/deep/**"], rules: { "no-debugger": "off", eqeqeq: "warn" } }] }) } },
  { name: "overrides excludeFiles", files: { ...project, ".oxlintrc.json": rc({ overrides: [{ files: ["src/**"], excludeFiles: ["**/*.tsx"], rules: { eqeqeq: "error" } }] }) } },
  { name: "overrides in order", files: { ...project, ".oxlintrc.json": rc({ overrides: [{ files: ["**/*.ts"], rules: { eqeqeq: "error" } }, { files: ["src/b.ts"], rules: { eqeqeq: "off" } }] }) } },
  { name: "nested configuration", files: { ...project, "src/.oxlintrc.json": JSON.stringify({ ...off, rules: { eqeqeq: "error" } }) } },
  { name: "nested configuration, disabled", files: { ...project, "src/.oxlintrc.json": JSON.stringify({ ...off, rules: { eqeqeq: "error" } }) }, args: ["--disable-nested-config"] },
  { name: "nested configuration with ignorePatterns", files: { ...project, "src/.oxlintrc.json": JSON.stringify({ ...off, rules: { eqeqeq: "error" }, ignorePatterns: ["deep", "b.ts"] }) } },
  { name: "-c", files: { ...project, "other.json": JSON.stringify({ ...off, rules: { eqeqeq: "error" } }), "src/.oxlintrc.json": rc() }, args: ["-c", "other.json"] },
  { name: "-c in a directory", files: { ...project, "configs/other.json": JSON.stringify({ ...off, rules: { eqeqeq: "error" } }) }, args: ["-c", "configs/other.json"] },
  { name: "extends", files: { ...project, ".oxlintrc.json": JSON.stringify({ ...off, extends: ["./configs/base.json"], rules: { eqeqeq: "warn" } }), "configs/base.json": rc() } },
  { name: "extends of extends", files: { ...project, ".oxlintrc.json": JSON.stringify({ ...off, extends: ["./configs/base.json"] }), "configs/base.json": JSON.stringify({ extends: ["./more/deep.json"] }), "configs/more/deep.json": rc() } },
  { name: "jsonc", files: { ...project, ".oxlintrc.json": undefined, ".oxlintrc.jsonc": `{ // comment\n "categories": { "correctness": "off" }, "rules": { "eqeqeq": "error", }, }` } },
  { name: "a link to a directory", files: { ...project, linked: { link: "src/deep" } } },
  { name: "a link to a file", files: { ...project, "link.js": { link: "a.js" } } },
  { name: "typescript rules by their names", files: { ...project, ".oxlintrc.json": JSON.stringify({ ...off, rules: { "typescript/no-explicit-any": "error", "@typescript-eslint/no-non-null-assertion": "warn" } }), "src/k.ts": "export const k: any = a!;\n" } },
  { name: "disable comments", files: { ...project, "a.js": "// eslint-disable-next-line no-debugger\ndebugger;\n// oxlint-disable-next-line no-debugger\ndebugger;\ndebugger; // eslint-disable-line\n" } },
];

let passed = 0;
const failed = [];
const root = path.join(scratch, "oxlint-project");
for (const test of cases) {
  if (only && !test.name.includes(only)) continue;
  fs.rmSync(root, { recursive: true, force: true });
  for (const [name, text] of Object.entries(test.files)) {
    if (text === undefined) continue;
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (typeof text === "object") fs.symlinkSync(text.link, file);
    else fs.writeFileSync(file, text);
  }
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "oxlint-differential.mjs"), `--project=${path.join(root, test.cwd ?? ".")}`, `--oxlint=${flag("oxlint")}`, `--bin=${flag("bin")}`, "--show", "--", ...(test.args ?? [])],
    { encoding: "utf8" },
  );
  if (result.status === 0) passed++;
  else {
    failed.push(test.name);
    console.log(`FAIL ${test.name}: oxlint ${(test.args ?? []).join(" ")}\n${result.stdout}${result.stderr}`);
  }
}
console.log(`${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
