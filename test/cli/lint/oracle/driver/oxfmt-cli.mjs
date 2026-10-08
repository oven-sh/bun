// Runs the command line of real oxfmt and `bun format` on generated projects that have an `.oxfmtrc.json`, and compares which
// files `--list-different` names, the exit code, and the files after writing.
//
//   bun oxfmt-cli.mjs --oxfmt=<path of oxfmt> --scratch=<directory> --bin="<bun-lint> cli @format" [--only=substring]
//
// Only JavaScript and TypeScript are compared: `bun format` leaves the rest alone.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const scratch = path.resolve(flag("scratch"));
const oxfmt = [path.resolve(flag("oxfmt"))];
const bin = flag("bin").split(" ");
const only = flag("only");

const ugly = `const a = {b:1,  c:"two"}\nfunction f(x){return [x,\n'y']}\n`;
const wide = `const value = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, four);\n`;
const project = {
  ".oxfmtrc.json": "{}",
  "a.js": ugly,
  "b.js": "const a = 1;\n",
  "src/c.ts": ugly,
  "src/d.tsx": "export const d = <div   className='x'>hi</div>\n",
  "src/e.mjs": ugly,
  "src/f.cjs": ugly,
  "src/deep/er/g.jsx": ugly,
  "src/.hidden/h.js": ugly,
  "src/.dot.js": ugly,
  "src/B.js": ugly,
  "src/a-b.js": ugly,
  "src/[id].js": ugly,
  "lib/unknown.xyz": "???\n",
  "node_modules/pkg/i.js": ugly,
  "vendor/node_modules/pkg/j.js": ugly,
};
const configured = (config, more = {}) => ({ "a.js": ugly + wide, "src/b.ts": ugly + wide, ".oxfmtrc.json": JSON.stringify(config), ...more });
const git = { ".git/HEAD": "ref: refs/heads/main\n" };

const cases = [
  // ───────────── which files ─────────────
  { name: "no arguments", files: project, args: [] },
  { name: "dot", files: project, args: ["."] },
  { name: "a file", files: project, args: ["a.js"] },
  { name: "a formatted file", files: project, args: ["b.js"] },
  { name: "dot slash", files: project, args: ["./a.js", ".//src/c.ts"] },
  { name: "the same file twice", files: project, args: ["a.js", "./a.js"] },
  { name: "a directory", files: project, args: ["src"] },
  { name: "a directory and a file in it", files: project, args: ["src/c.ts", "src"] },
  { name: "two directories", files: project, args: ["src/deep", "src"] },
  { name: "glob", files: project, args: ["src/*.js"] },
  { name: "glob without a slash", files: project, args: ["*.ts"] },
  { name: "globstar", files: project, args: ["**/*.{js,ts}"] },
  { name: "glob and a file", files: project, args: ["src/*.mjs", "a.js"] },
  { name: "glob and a directory", files: project, args: ["*.mjs", "src/deep"] },
  { name: "a file that looks like a glob", files: project, args: ["src/[id].js"] },
  { name: "glob that matches nothing", files: project, args: ["nothing/*.js"] },
  { name: "glob that matches nothing, tolerated", files: project, args: ["--no-error-on-unmatched-pattern", "nothing/*.js"] },
  { name: "a file that does not exist", files: project, args: ["nothing.js", "a.js"] },
  { name: "only a file that does not exist", files: project, args: ["nothing.js"] },
  { name: "exclude", files: project, args: ["src", "!src/deep", "!*.ts"] },
  { name: "exclude only", files: project, args: ["!src"] },
  { name: "exclude a file that is named", files: project, args: ["a.js", "!a.js"] },
  { name: "exclude with a slash in front", files: project, args: [".", "!/a.js", "!/c.ts"] },
  { name: "node_modules", files: project, args: ["node_modules/pkg/i.js", "a.js"] },
  { name: "with-node-modules", files: project, args: ["--with-node-modules"] },
  { name: "an unknown file", files: project, args: ["lib/unknown.xyz", "a.js"] },
  { name: "only an unknown file", files: project, args: ["lib/unknown.xyz"] },
  { name: "from a subdirectory", files: project, cwd: "src", args: [] },
  { name: "a link to a file", files: { ...project, "src/link.js": { link: "../a.js" } }, args: ["src"] },
  { name: "a link to a file, named", files: { ...project, "link.js": { link: "a.js" } }, args: ["link.js"] },
  { name: "a link to a directory", files: { ...project, linked: { link: "src" } }, args: [] },
  { name: "syntax error", files: { ".oxfmtrc.json": "{}", "a.js": "const = 1;\n", "b.js": ugly }, args: [] },

  // ───────────── ignoring ─────────────
  { name: "prettierignore", files: { ...project, ".prettierignore": "src/deep\n*.mjs\n/a.js\n" }, args: [] },
  { name: "prettierignore, the file is named", files: { ...project, ".prettierignore": "a.js\nsrc/deep\n" }, args: ["a.js", "src/c.ts", "src/deep/er/g.jsx"] },
  { name: "prettierignore, the directory is named", files: { ...project, ".prettierignore": "src/deep\n" }, args: ["src/deep/er", "a.js"] },
  { name: "prettierignore negation", files: { ...project, ".prettierignore": "src/*\n!src/c.ts\n" }, args: [] },
  { name: "prettierignore of the working directory only", files: { ...project, ".prettierignore": "c.ts\n", "src/deep/.prettierignore": "g.jsx\n" }, cwd: "src", args: [] },
  { name: "gitignore", files: { ...project, ...git, ".gitignore": "src/deep/\n*.cjs\n" }, args: [] },
  { name: "gitignore without a repository", files: { ...project, ".gitignore": "src/deep/\n*.cjs\n" }, args: [] },
  { name: "nested gitignore", files: { ...project, ...git, "src/.gitignore": "c.ts\n/deep\n!e.mjs\n", ".gitignore": "e.mjs\n" }, args: [] },
  { name: "gitignore above the working directory", files: { ...project, ...git, ".gitignore": "c.ts\n" }, cwd: "src", args: [] },
  { name: "gitignore, the file is named", files: { ...project, ...git, ".gitignore": "a.js\n" }, args: ["a.js"] },
  { name: "git info exclude", files: { ...project, ...git, ".git/info/exclude": "a.js\n" }, args: [] },
  { name: "gitignore and prettierignore", files: { ...project, ...git, ".gitignore": "a.js\n", ".prettierignore": "!a.js\nsrc\n" }, args: [] },
  { name: "ignore-path", files: { ...project, ".prettierignore": "a.js\n", "other.ignore": "src\n" }, args: ["--ignore-path", "other.ignore"] },
  { name: "ignore-path twice", files: { ...project, "one.ignore": "a.js\n", "two.ignore": "src/deep\n" }, args: ["--ignore-path", "one.ignore", "--ignore-path", "two.ignore"] },
  { name: "ignore-path in a directory", files: { ...project, "src/x.ignore": "c.ts\n" }, args: ["--ignore-path", "src/x.ignore"] },
  { name: "ignore-path that does not exist", files: project, args: ["--ignore-path", "nothing.ignore"], ignoresStatus: true },
  { name: "ignorePatterns", files: { ...project, ".oxfmtrc.json": JSON.stringify({ ignorePatterns: ["src/deep", "*.mjs", "/a.js"] }) }, args: [] },
  { name: "ignorePatterns, the file is named", files: { ...project, ".oxfmtrc.json": JSON.stringify({ ignorePatterns: ["a.js", "src/deep"] }) }, args: ["a.js", "src/c.ts", "src/deep/er/g.jsx"] },
  { name: "ignorePatterns negation", files: { ...project, ".oxfmtrc.json": JSON.stringify({ ignorePatterns: ["src/*", "!src/c.ts"] }) }, args: [] },
  { name: "ignorePatterns from a subdirectory", files: { ...project, ".oxfmtrc.json": JSON.stringify({ ignorePatterns: ["src/c.ts", "/e.mjs"] }) }, cwd: "src", args: [] },

  // ───────────── configuration ─────────────
  { name: "defaults: 100 columns", files: configured({}), write: true },
  { name: "options", files: configured({ semi: false, singleQuote: true, tabWidth: 4, printWidth: 60, trailingComma: "none", arrowParens: "avoid" }), write: true },
  { name: "useTabs", files: configured({ useTabs: true, bracketSpacing: false, quoteProps: "consistent" }), write: true },
  { name: "endOfLine", files: configured({ endOfLine: "crlf" }), write: true },
  { name: "insertFinalNewline", files: configured({ insertFinalNewline: false }), write: true },
  { name: "insertFinalNewline crlf", files: configured({ insertFinalNewline: false, endOfLine: "crlf" }), write: true },
  { name: "jsonc", files: { ...configured({}), ".oxfmtrc.json": undefined, ".oxfmtrc.jsonc": `{ // comment\n "semi": false, }` }, write: true },
  { name: "comments in .oxfmtrc.json", files: { ...configured({}), ".oxfmtrc.json": `{ /* c */ "semi": false }` }, write: true },
  { name: "oxfmt.config.ts", files: { ...configured({}), ".oxfmtrc.json": undefined, "oxfmt.config.ts": `export default { semi: false as boolean };` }, write: true, args: ["a.js", "src"] },
  { name: "configuration above the working directory", files: configured({ semi: false }), cwd: "src", write: true },
  { name: "nested configuration", files: configured({ semi: false }, { "src/.oxfmtrc.json": `{"singleQuote": true}` }), write: true },
  { name: "nested configuration, disabled", files: configured({ semi: false }, { "src/.oxfmtrc.json": `{"singleQuote": true}` }), args: ["--disable-nested-config"], write: true },
  { name: "nested configuration, a file is named", files: configured({ semi: false }, { "src/.oxfmtrc.json": `{"singleQuote": true}` }), args: ["src/b.ts"], write: true },
  { name: "nested configuration with ignorePatterns", files: configured({ semi: false }, { "src/.oxfmtrc.json": `{"ignorePatterns": ["b.ts"]}`, "src/c.ts": ugly }), args: [] },
  { name: ".prettierrc is not read", files: configured({ semi: false }, { "src/.prettierrc": `{"singleQuote": true}`, ".prettierrc": `{"tabWidth": 8}` }), write: true },
  { name: "-c", files: configured({ semi: false }, { "other.json": `{"singleQuote": true}`, "src/.oxfmtrc.json": `{"tabWidth": 8}` }), args: ["-c=other.json"], write: true, ignoresFlavor: true },
  { name: "--config", files: configured({ semi: false }, { "configs/.oxfmtrc.json": `{"singleQuote": true}` }), args: ["--config", "configs/.oxfmtrc.json"], write: true },
  { name: "overrides", files: configured({ semi: false, overrides: [{ files: ["*.ts"], options: { semi: true, singleQuote: true } }] }), write: true },
  { name: "overrides with a path", files: configured({ overrides: [{ files: ["src/**/*.ts", "nothing/*"], options: { semi: false } }] }), write: true },
  { name: "overrides with dot slash", files: configured({ overrides: [{ files: ["./a.js", "./b.ts"], options: { semi: false } }] }), write: true },
  { name: "overrides excludeFiles", files: configured({ overrides: [{ files: ["*.{js,ts}"], excludeFiles: ["b.ts"], options: { semi: false } }] }), write: true },
  { name: "overrides excludeFiles with a path", files: configured({ overrides: [{ files: ["*.{js,ts}"], excludeFiles: ["src/*.ts"], options: { semi: false } }] }), write: true },
  { name: "overrides with a path, excludeFiles without", files: configured({ overrides: [{ files: ["src/*.ts"], excludeFiles: ["b.ts"], options: { semi: false } }] }), write: true },
  { name: "overrides in order", files: configured({ overrides: [{ files: ["*.ts"], options: { semi: false } }, { files: ["b.*"], options: { semi: true, tabWidth: 8 } }] }), write: true },
  { name: "overrides of a nested configuration", files: configured({}, { "src/.oxfmtrc.json": JSON.stringify({ overrides: [{ files: ["b.ts"], options: { semi: false } }, { files: ["src/b.ts"], options: { singleQuote: true } }] }) }), write: true },

  // ───────────── .editorconfig ─────────────
  { name: "editorconfig", files: configured({}, { ".editorconfig": "root = true\n[*]\nindent_style = tab\nmax_line_length = 40\nend_of_line = crlf\n" }), write: true },
  { name: "editorconfig indent_size", files: configured({}, { ".editorconfig": "[*]\nindent_style = space\nindent_size = 4\n" }), write: true },
  { name: "editorconfig tab_width", files: configured({}, { ".editorconfig": "[*]\ntab_width = 8\n" }), write: true },
  { name: "editorconfig sections", files: configured({}, { ".editorconfig": "[*.js]\nindent_size = 4\nindent_style = space\n[*.ts]\nindent_size = 8\nindent_style = space\n[src/**]\nmax_line_length = 40\n" }), write: true },
  { name: "editorconfig max_line_length off", files: configured({}, { ".editorconfig": "[*]\nmax_line_length = off\n" }), write: true },
  { name: "editorconfig quote_type", files: configured({}, { ".editorconfig": "[*]\nquote_type = single\n" }), write: true },
  { name: "editorconfig insert_final_newline", files: configured({}, { ".editorconfig": "[*]\ninsert_final_newline = false\n" }), write: true },
  { name: "editorconfig nested is not read", files: configured({}, { ".editorconfig": "[*]\nindent_style = space\nindent_size = 4\n", "src/.editorconfig": "[*]\nindent_size = 8\n" }), write: true },
  { name: "editorconfig above the working directory", files: configured({}, { ".editorconfig": "[*]\nindent_style = space\nindent_size = 4\n" }), cwd: "src", write: true },
  { name: "editorconfig and the configuration", files: configured({ tabWidth: 3 }, { ".editorconfig": "[*]\nindent_style = space\nindent_size = 8\nmax_line_length = 40\n" }), write: true },

  // ───────────── stdin ─────────────
  { name: "stdin", files: project, args: ["--stdin-filepath", "x.js"], stdin: ugly },
  { name: "stdin with a configuration", files: configured({ semi: false }), args: ["--stdin-filepath=src/x.ts"], stdin: ugly },
  { name: "stdin with a nested configuration", files: configured({}, { "src/.oxfmtrc.json": `{"semi": false}` }), args: ["--stdin-filepath", "src/x.ts"], stdin: ugly },
];

function write(root, files) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    if (text === undefined) continue;
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
    if (!/\.([cm]?[jt]sx?|jsonc?|json5|css|scss|less|graphql|gql|ya?ml)$/.test(name) || /config\.ts$/.test(name)) continue;
    try {
      files[name] = fs.readFileSync(path.join(root, name), "utf8");
    } catch {}
  }
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, files };
}

let passed = 0;
const failed = [];
const root = path.join(scratch, "oxfmt-project");
for (const test of cases) {
  if (only && !test.name.includes(only)) continue;
  const args = test.stdin !== undefined || test.write ? (test.args ?? []) : ["--list-different", ...test.args];
  const expected = run(oxfmt, root, test, args);
  const actual = run(bin, root, test, args);
  const problems = [];
  if (!test.ignoresStatus && expected.status !== actual.status) problems.push(`exit code: expected ${expected.status}, got ${actual.status}`);
  if (test.ignoresStatus && (expected.status === 0) !== (actual.status === 0)) problems.push(`exit code: expected ${expected.status}, got ${actual.status}`);
  if (JSON.stringify(expected.files) !== JSON.stringify(actual.files)) {
    problems.push(`files differ\n--- expected\n${JSON.stringify(expected.files)}\n--- actual\n${JSON.stringify(actual.files)}`);
  }
  // Without the files in other languages, what oxfmt says about itself, and what it lists twice.
  const listed = text => [...new Set(text.split("\n").filter(line => line && !/^Finished in |\.(md|html|toml)$/.test(line)))].join("\n");
  if (test.stdin !== undefined ? expected.stdout !== actual.stdout : !test.write && listed(expected.stdout) !== listed(actual.stdout)) {
    problems.push(`stdout differs\n--- expected\n${JSON.stringify(expected.stdout)}\n--- actual\n${JSON.stringify(actual.stdout)}`);
  }
  if (problems.length === 0) passed++;
  else {
    failed.push(test.name);
    console.log(`FAIL ${test.name}: oxfmt ${args.join(" ")}\n${problems.join("\n")}`);
    console.log(`--- stderr of oxfmt\n${expected.stderr}\n--- stderr of bun format\n${actual.stderr}\n`);
  }
}
console.log(`${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
