// The rows of eslintrc-cli.mjs. They follow the tests of @eslint/eslintrc 2.1.4 (config-array-factory.js,
// cascading-config-array-factory.js, config-array/*.js) and of ESLint 8.57.1 (cli-engine/*.js, cli.js) that are about files on disk.
//
// A row: `topic`, `name`, `files` (path -> text; `{ link }` is a symbolic link, `null` a directory; `<dir>` in a text is the
// directory of the project), `args` (default: a.js; `<dir>` as in the texts), and
//   cwd    the working directory, relative to the project
//   home   the home directory, relative to the project. Default: an empty directory beside the project
//   env    more environment variables
//   stdin  standard input
//   lines  of the error of ESLint only the first so many lines are compared: the others are words of V8, Node.js or js-yaml
//   detail the messages are compared with their fixes and suggestions
//   posix  not on Windows

/**
 * @typedef {{ topic: string, name: string, files: Record<string, string | null | undefined | { link: string }>, args?: string[], cwd?: string,
 *   home?: string, env?: Record<string, string>, stdin?: string, lines?: number, detail?: boolean, posix?: boolean }} Row
 */

/** What a row is about. eslintrc-cli.mjs counts by these. */
export const topics = {
  "programs": "configuration files that are programs: .eslintrc.js, .eslintrc.cjs, `extends` of a .js",
  "packages": "`extends` of packages",
  "plugins": "plugins: their names, where they are looked for, their configurations, rules in JavaScript",
  "environments": "environments and processors of plugins",
  "parser": "`parser`",
  "language": "the language: ecmaVersion is 5 and sourceType is script unless something says otherwise",
  "unknown-rule": "a rule that does not exist is a message",
  "noInlineConfig": "`noInlineConfig`",
  "no-configuration": "no configuration at all",
  "rulesdir": "`--rulesdir`",
  "presets": "eslint:recommended, eslint:all and the rules of 8.57.1",
  "command-line": "the personal configuration, and the flags that configure",
  "texts": "the names of configurations in errors",
  "validation": "what is refused in a configuration",
  "names": "the names and formats of the files",
  "cascade": "the files of all directories above a file",
  "extends": "`extends` of files",
  "merge": "how configurations are merged",
  "overrides": "`overrides`",
  "ignores": "`ignorePatterns`, .eslintignore, the flags that ignore",
  "files": "which files are linted",
  "system": "which of the two configuration systems is used",
  "print-config": "`--print-config`",
};

const of =
  topic =>
  (name, files, args, more = {}) => ({ topic, name: `${topic}: ${name}`, files, args, ...more });
const programs = of("programs");
const packages = of("packages");
const plugins = of("plugins");
const environments = of("environments");
const parser = of("parser");
const language = of("language");
const unknownRule = of("unknown-rule");
const noInlineConfig = of("noInlineConfig");
const noConfiguration = of("no-configuration");
const rulesdir = of("rulesdir");
const presets = of("presets");
const commandLine = of("command-line");
const texts = of("texts");
const validation = of("validation");
const names = of("names");
const cascade = of("cascade");
const extend = of("extends");
const merge = of("merge");
const overrides = of("overrides");
const ignores = of("ignores");
const which = of("files");
const system = of("system");
const printConfig = of("print-config");

// eqeqeq 2:7, no-debugger 2:13, no-var 1:1
const code = "var x = 1;\nif (x == 2) debugger;\n";
const json = JSON.stringify;
const rc = (config = {}) => json({ root: true, ...config });
const js = config => `module.exports = ${json(config)};\n`;
const on = (...rules) => ({ rules: Object.fromEntries(rules.map(it => [it, "error"])) });
const eqeqeq = on("eqeqeq");
const noVar = on("no-var");
const noDebugger = on("no-debugger");
const yaml = rule => `root: true\nrules:\n  ${rule}: error\n`;
/** A package. `text` is a configuration, or the text of the module. */
const pkg = (name, text, file = "index.js") => ({
  [`node_modules/${name}/${file}`]: typeof text === "string" ? text : js(text),
});
const under = (directory, files) =>
  Object.fromEntries(Object.entries(files).map(([name, text]) => [`${directory}/${name}`, text]));
const each = (paths, text = code) => Object.fromEntries(paths.map(it => [it, text]));

// Reports every identifier `x`.
const rule = (message = "no x") =>
  `{ create(context) { return { Identifier(node) { if (node.name === "x") context.report({ node, message: ${json(message)} }); } }; } }`;
const withRule = (message, more = "") => `module.exports = { rules: { "no-x": ${rule(message)} }, ${more} };\n`;

const BOM = "﻿";

const namesAndFormats = [
  names(".eslintrc.json", { ".eslintrc.json": rc(eqeqeq), "a.js": code }),
  names(".eslintrc.json with comments", {
    ".eslintrc.json": '// c\n{ /* c */ "root": true, "rules": { "eqeqeq": "error" } }',
    "a.js": code,
  }),
  names(
    ".eslintrc.json with a comma at the end",
    { ".eslintrc.json": '{ "root": true, "rules": { "eqeqeq": "error", }, }', "a.js": code },
    undefined,
    { lines: 1 },
  ),
  names(".eslintrc.json with a byte order mark", { ".eslintrc.json": BOM + rc(eqeqeq), "a.js": code }),
  names(".eslintrc.yml", { ".eslintrc.yml": yaml("eqeqeq"), "a.js": code }),
  names(".eslintrc.yaml", { ".eslintrc.yaml": yaml("eqeqeq"), "a.js": code }),
  names(".eslintrc.yml with a byte order mark", { ".eslintrc.yml": BOM + yaml("eqeqeq"), "a.js": code }),
  names(".eslintrc.yml: comments, lists in both styles, numbers, an anchor", {
    ".eslintrc.yml":
      "# c\nroot: true\nenv: { browser: true }\nrules:\n  eqeqeq: &on\n    - 2\n    - always\n  no-var: 1 # c\n  no-debugger: [error]\n  yoda: *on\n",
    "a.js": code,
  }),
  names(".eslintrc.yml: a document marker and quoted keys", {
    ".eslintrc.yml": '---\n"root": true\n\'rules\':\n  "eqeqeq": "error"\n',
    "a.js": code,
  }),
  names(".eslintrc (JSON)", { ".eslintrc": rc(eqeqeq), "a.js": code }),
  names(".eslintrc (JSON with comments)", { ".eslintrc": `// c\n${rc(eqeqeq)} /* c */`, "a.js": code }),
  names(".eslintrc (YAML)", { ".eslintrc": yaml("eqeqeq"), "a.js": code }),
  names(".eslintrc, empty", { ".eslintrc": "", "a.js": code }),
  names("package.json#eslintConfig", {
    "package.json": json({ name: "x", eslintConfig: { root: true, ...eqeqeq } }),
    "a.js": code,
  }),
  names("package.json#eslintConfig with a byte order mark", {
    "package.json": BOM + json({ name: "x", eslintConfig: { root: true, ...eqeqeq } }),
    "a.js": code,
  }),
  names(
    "package.json without eslintConfig, .eslintrc.json above",
    { ".eslintrc.json": rc(eqeqeq), "sub/package.json": '{"name":"x"}', "sub/a.js": code },
    ["sub/a.js"],
  ),
  names(".eslintrc.mjs is no name", {
    ".eslintrc.mjs": `export default ${rc(eqeqeq)};`,
    ".eslintrc.json": rc(noVar),
    "a.js": code,
  }),
  names(".eslintrc.jsonc, .eslintrc.json5, .eslintrc.ts are no names", {
    ".eslintrc.jsonc": rc(eqeqeq),
    ".eslintrc.json5": rc(eqeqeq),
    ".eslintrc.ts": `export default ${rc(eqeqeq)};`,
    ".eslintrc.yml": yaml("no-var"),
    "a.js": code,
  }),
  names("a directory with the name of a configuration file is passed over", {
    ".eslintrc.js": null,
    ".eslintrc.yaml": null,
    ".eslintrc.json": rc(eqeqeq),
    "a.js": code,
  }),
  names("yaml before yml", { ".eslintrc.yaml": yaml("eqeqeq"), ".eslintrc.yml": yaml("no-var"), "a.js": code }),
  names("yml before json", { ".eslintrc.yml": yaml("eqeqeq"), ".eslintrc.json": rc(noVar), "a.js": code }),
  names("json before .eslintrc", { ".eslintrc.json": rc(eqeqeq), ".eslintrc": rc(noVar), "a.js": code }),
  names(".eslintrc before package.json", {
    ".eslintrc": rc(eqeqeq),
    "package.json": json({ eslintConfig: { root: true, ...noVar } }),
    "a.js": code,
  }),
  names("the file that is passed over may be broken", { ".eslintrc.yml": yaml("eqeqeq"), ".eslintrc.json": "{", "a.js": code }),
  names("broken .eslintrc.json", { ".eslintrc.json": '{ "rules": ', "a.js": code }, undefined, { lines: 1 }),
  names("broken .eslintrc.yml", { ".eslintrc.yml": "rules:\n  - a: [\n", "a.js": code }, undefined, { lines: 1 }),
  names("broken .eslintrc", { ".eslintrc": "{ rules: ", "a.js": code }, undefined, { lines: 1 }),
  names("broken package.json", { "package.json": '{ "eslintConfig": ', "a.js": code }, undefined, { lines: 1 }),
  names("broken package.json without eslintConfig", { ".eslintrc.json": rc(eqeqeq), "sub/package.json": "{", "sub/a.js": code }, [
    "sub/a.js",
  ], { lines: 1 }),
  names("empty .eslintrc.yml", { ".eslintrc.yml": "", "a.js": code }),
  names("empty .eslintrc.json", { ".eslintrc.json": "", "a.js": code }, undefined, { lines: 1 }),
  names(".eslintrc.yml with a comment and nothing else", { ".eslintrc.yml": "# nothing\n", "a.js": code }),
  names(".eslintrc.json is a list", { ".eslintrc.json": "[]", "a.js": code }),
  names(".eslintrc.json is null", { ".eslintrc.json": "null", "a.js": code }),
  names(".eslintrc.json is a string", { ".eslintrc.json": '"eslint:recommended"', "a.js": code }),
  names(".eslintrc.yml is a list", { ".eslintrc.yml": "- root\n", "a.js": code }),
  names("package.json#eslintConfig is null", { "package.json": json({ eslintConfig: null }), "a.js": code }),
  names("package.json#eslintConfig is a string", { "package.json": json({ eslintConfig: "./base.json" }), "base.json": rc(eqeqeq), "a.js": code }),
];

const thatArePrograms = [
  programs(".eslintrc.js", { ".eslintrc.js": js({ root: true, ...eqeqeq }), "a.js": code }),
  programs(".eslintrc.cjs", { ".eslintrc.cjs": js({ root: true, ...eqeqeq }), "a.js": code }),
  programs("js before cjs", {
    ".eslintrc.js": js({ root: true, ...eqeqeq }),
    ".eslintrc.cjs": js({ root: true, ...noVar }),
    "a.js": code,
  }),
  programs("cjs before yaml", { ".eslintrc.cjs": js({ root: true, ...eqeqeq }), ".eslintrc.yaml": yaml("no-var"), "a.js": code }),
  programs(".eslintrc.cjs in a package of type module", {
    "package.json": json({ type: "module" }),
    ".eslintrc.cjs": js({ root: true, ...eqeqeq }),
    "a.js": code,
  }),
  programs("it requires a file beside it", {
    ".eslintrc.js": 'module.exports = { root: true, rules: require("./rules") };\n',
    "rules.js": 'module.exports = { eqeqeq: "error" };\n',
    "a.js": code,
  }),
  programs("it requires a .json beside it and a module of Node.js", {
    ".eslintrc.js":
      'const path = require("node:path");\nmodule.exports = { root: true, rules: require(path.join(__dirname, "rules.json")) };\n',
    "rules.json": json(eqeqeq.rules),
    "a.js": code,
  }),
  programs(
    "it reads the environment",
    { ".eslintrc.js": 'module.exports = { root: true, rules: { eqeqeq: process.env.STRICT ? "error" : "off" } };\n', "a.js": code },
    undefined,
    { env: { STRICT: "1" } },
  ),
  programs(
    "the working directory of the program is that of the run",
    {
      "sub/.eslintrc.js":
        'module.exports = { root: true, rules: { eqeqeq: require("path").basename(process.cwd()) === "sub" ? "off" : "error" } };\n',
      "sub/a.js": code,
    },
    ["sub/a.js"],
  ),
  programs("exports.x = ..", { ".eslintrc.js": 'exports.root = true;\nexports.rules = { eqeqeq: "error" };\n', "a.js": code }),
  programs("it exports a function", { ".eslintrc.js": "module.exports = () => ({ root: true });\n", "a.js": code }),
  programs("it exports a list", { ".eslintrc.js": `module.exports = [${rc(eqeqeq)}];\n`, "a.js": code }),
  programs("it exports nothing", { ".eslintrc.js": "", "a.js": code }),
  programs("it exports a promise", { ".eslintrc.js": `module.exports = Promise.resolve(${rc(eqeqeq)});\n`, "a.js": code }),
  programs("values that JSON does not have: undefined, a getter, a class instance", {
    ".eslintrc.js":
      'class Rules { constructor() { this.eqeqeq = "error"; } }\nmodule.exports = { root: true, env: undefined, get rules() { return new Rules(); } };\n',
    "a.js": code,
  }),
  programs("it throws", { ".eslintrc.js": "throw new Error('boom');\n", "a.js": code }, undefined, { lines: 2 }),
  programs("a syntax error in it", { ".eslintrc.js": "module.exports = {;\n", "a.js": code }, undefined, { lines: 0 }),
  programs("it requires what does not exist", { ".eslintrc.js": 'module.exports = require("./nope");\n', "a.js": code }, undefined, {
    lines: 2,
  }),
  programs(
    "below a .json",
    { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.js": js(noVar), "sub/a.js": code },
    ["sub/a.js"],
  ),
  programs(
    "one for each of two directories",
    { "one/.eslintrc.js": js({ root: true, ...eqeqeq }), "one/a.js": code, "two/.eslintrc.cjs": js({ root: true, ...noVar }), "two/a.js": code },
    ["one", "two"],
  ),
  programs("extends: ./base.js", { ".eslintrc.json": rc({ extends: "./base.js" }), "base.js": js(eqeqeq), "a.js": code }),
  programs("extends: ./base.cjs", { ".eslintrc.json": rc({ extends: "./base.cjs" }), "base.cjs": js(eqeqeq), "a.js": code }),
  programs("extends: ./base finds base.js", { ".eslintrc.json": rc({ extends: "./base" }), "base.js": js(eqeqeq), "a.js": code }),
  programs("extends: ./configs finds configs/index.js", {
    ".eslintrc.json": rc({ extends: "./configs" }),
    "configs/index.js": js(eqeqeq),
    "a.js": code,
  }),
  programs("a .js extends a .yml that extends a .js", {
    ".eslintrc.js": js({ root: true, extends: "./one.yml" }),
    "one.yml": "extends: ./configs/two.js\n",
    "configs/two.js": js(eqeqeq),
    "a.js": code,
  }),
  programs("extends: require.resolve(..)", {
    ".eslintrc.js": 'module.exports = { root: true, extends: [require.resolve("./configs/base")] };\n',
    "configs/base.js": js(eqeqeq),
    "a.js": code,
  }),
  programs("-c other.js", { "other.js": js(noVar), "a.js": code }, ["-c", "other.js", "a.js"]),
  programs("-c other.cjs beside .eslintrc.js", { ".eslintrc.js": js({ root: true, ...eqeqeq }), "other.cjs": js(noVar), "a.js": code }, [
    "-c",
    "other.cjs",
    "a.js",
  ]),
  programs("a directory finds the .eslintrc.js itself", { ".eslintrc.js": js({ root: true, ...on("no-undef") }), "a.js": code }, ["."]),
  programs("the .eslintrc.js itself, named", { ".eslintrc.js": js({ root: true, ...on("no-undef") }), "a.js": code }, [".eslintrc.js"]),
];

const tree = {
  ".eslintrc.json": rc(eqeqeq),
  ...each(["lib/one.js", "lib/two.js", "lib/nested/one.js", "lib/nested/two.js", "test/one.js", "test/two.js"]),
  "lib/nested/.eslintrc.yml": "rules:\n  no-var: error\n",
  "test/.eslintrc.yml": "rules:\n  no-debugger: error\n",
};

const theCascade = [
  cascade("the child adds to the parent", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json(noVar), "sub/a.js": code }, [
    "sub/a.js",
  ]),
  cascade(
    "the child overrides the parent",
    { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json({ rules: { eqeqeq: "off", "no-var": "error" } }), "sub/a.js": code },
    ["sub/a.js"],
  ),
  cascade(
    "child, parent and grandparent",
    {
      ".eslintrc.json": rc({ rules: { eqeqeq: "error", "no-var": "error", "no-debugger": "error" } }),
      "one/.eslintrc.json": json({ rules: { eqeqeq: "off", "no-var": "warn" } }),
      "one/two/.eslintrc.json": json({ rules: { eqeqeq: "warn" } }),
      "one/two/a.js": code,
      "one/a.js": code,
      "a.js": code,
    },
    ["."],
  ),
  cascade("root in the child stops it", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": rc(noVar), "sub/a.js": code }, [
    "sub/a.js",
  ]),
  cascade(
    "root in the middle",
    {
      ".eslintrc.json": rc(eqeqeq),
      "one/.eslintrc.json": rc(noVar),
      "one/two/.eslintrc.json": json(noDebugger),
      "one/two/a.js": code,
    },
    ["one/two/a.js"],
  ),
  cascade(
    "root: false in the child",
    { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json({ root: false, ...noVar }), "sub/a.js": code },
    ["sub/a.js"],
  ),
  cascade(
    "what is above a root may be broken",
    { ".eslintrc.json": "BROKEN", "sub/.eslintrc.json": rc(eqeqeq), "sub/a.js": code },
    ["."],
    { cwd: "sub" },
  ),
  cascade(
    "what is above is broken and there is no root",
    { ".eslintrc.json": "BROKEN", "sub/.eslintrc.json": json(eqeqeq), "sub/a.js": code },
    ["."],
    { cwd: "sub", lines: 1 },
  ),
  cascade(
    "severity alone keeps the options of the parent",
    {
      ".eslintrc.json": rc({ rules: { eqeqeq: ["error", "smart"] } }),
      "sub/.eslintrc.json": json({ rules: { eqeqeq: "warn" } }),
      "sub/a.js": "if (x == null) {}\nif (x == 1) {}\n",
    },
    ["sub/a.js"],
  ),
  cascade("yml below json", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.yml": "rules:\n  no-var: error\n", "sub/a.js": code }, [
    "sub/a.js",
  ]),
  cascade(
    "four formats in four directories",
    {
      "package.json": json({ eslintConfig: { root: true, ...eqeqeq } }),
      "one/.eslintrc": json(noVar),
      "one/two/.eslintrc.yaml": "rules:\n  no-debugger: error\n",
      "one/two/three/.eslintrc.json": json({ rules: { eqeqeq: "warn" } }),
      "one/two/three/a.js": code,
    },
    ["one/two/three/a.js"],
  ),
  cascade("package.json below package.json", {
    "package.json": json({ eslintConfig: { root: true, ...eqeqeq } }),
    "sub/package.json": json({ eslintConfig: { rules: { eqeqeq: "off", "no-var": "error" } } }),
    "sub/a.js": code,
  }, ["sub/a.js"]),
  cascade("lib/*.js", tree, ["lib/*.js"]),
  cascade("lib/**/*.js", tree, ["lib/**/*.js"]),
  cascade("lib/*.js test/*.js", tree, ["lib/*.js", "test/*.js"]),
  cascade("a directory", tree, ["."]),
  cascade("from a directory below the configuration", tree, ["."], { cwd: "lib/nested" }),
  cascade("a file beside the working directory", tree, ["../test/one.js", "one.js"], { cwd: "lib" }),
  cascade("an absolute path", tree, ["<dir>/lib/nested/one.js"]),
  cascade(
    "braces in the name of a directory",
    {
      "{lib}/client/.eslintrc.json": rc(eqeqeq),
      "{lib}/client/src/one.js": code,
      "{lib}/server/.eslintrc.json": rc(noVar),
      "{lib}/server/src/two.js": code,
    },
    ["src/"],
    { cwd: "{lib}/server" },
  ),
  cascade(
    "env of the levels add up, false takes away",
    {
      ".eslintrc.json": rc({ env: { browser: true, node: true }, ...on("no-undef") }),
      "sub/.eslintrc.json": json({ env: { node: false, mocha: true } }),
      "sub/a.js": "window; require; describe;\n",
      "a.js": "window; require; describe;\n",
    },
    ["."],
  ),
  cascade(
    "globals of the levels add up, off takes away",
    {
      ".eslintrc.json": rc({ globals: { a: "readonly", b: "readonly" }, ...on("no-undef") }),
      "sub/.eslintrc.json": json({ globals: { b: "off", c: "readonly" } }),
      "sub/a.js": "a; b; c;\n",
    },
    ["sub/a.js"],
  ),
  cascade(
    "env of the child does not take the parserOptions of the parent",
    {
      ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2017 } }),
      "sub/.eslintrc.json": json({ env: { es6: true } }),
      "sub/a.js": "async function f() {}\n",
    },
    ["sub/a.js"],
  ),
  cascade(
    "parserOptions are merged key by key",
    {
      ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2015, ecmaFeatures: { jsx: true } } }),
      "sub/.eslintrc.json": json({ parserOptions: { sourceType: "module", ecmaFeatures: { globalReturn: false } } }),
      "sub/a.js": "export const a = <b/>;\n",
    },
    ["sub/a.js"],
  ),
  cascade(
    "overrides of the parent come before the plain rules of the child",
    {
      ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], ...eqeqeq }] }),
      "sub/.eslintrc.json": json({ rules: { eqeqeq: "off" } }),
      "sub/a.js": code,
    },
    ["sub/a.js"],
  ),
  cascade(
    "patterns of the parent's overrides are relative to the parent",
    {
      ".eslintrc.json": rc({ overrides: [{ files: ["sub/*.js"], ...eqeqeq }, { files: ["a.js"], ...noVar }, { files: ["./a.js"], ...noDebugger }] }),
      "sub/.eslintrc.json": "{}",
      "sub/a.js": code,
    },
    ["sub/a.js"],
  ),
  cascade(
    "a link to a directory has the configuration of the place of the link",
    { ".eslintrc.json": rc(), "real/.eslintrc.json": json(eqeqeq), "real/a.js": code, "one/.eslintrc.json": json(noVar), "one/linked": { link: "../real" } },
    ["one/linked/a.js", "real/a.js"],
    { posix: true },
  ),
];

const extendsOfFiles = [
  extend("./base.json", { ".eslintrc.json": rc({ extends: "./base.json" }), "base.json": json(eqeqeq), "a.js": code }),
  extend("./base.yml", { ".eslintrc.json": rc({ extends: "./base.yml" }), "base.yml": "rules:\n  eqeqeq: error\n", "a.js": code }),
  extend("./base.yaml from a .yml", { ".eslintrc.yml": "root: true\nextends: ./base.yaml\n", "base.yaml": "rules:\n  eqeqeq: error\n", "a.js": code }),
  extend("./base finds base.json", { ".eslintrc.json": rc({ extends: "./base" }), "base.json": json(eqeqeq), "a.js": code }),
  extend("./base does not find base.yml", { ".eslintrc.json": rc({ extends: "./base" }), "base.yml": "rules:\n  eqeqeq: error\n", "a.js": code }),
  extend("a file without an extension is JSON or YAML", { ".eslintrc.json": rc({ extends: "./base" }), "base": "rules:\n  eqeqeq: error\n", "a.js": code }),
  extend(".base.json: a name that starts with a dot is a path", { ".eslintrc.json": rc({ extends: ".base.json" }), ".base.json": json(eqeqeq), "a.js": code }),
  extend("base.json without ./ is the name of a package", { ".eslintrc.json": rc({ extends: "base.json" }), "base.json": json(eqeqeq), "a.js": code }),
  extend("configs/base.json without ./ is the name of a package", { ".eslintrc.json": rc({ extends: "configs/base.json" }), "configs/base.json": json(eqeqeq), "a.js": code }),
  extend("../base.json", { "base.json": json(eqeqeq), "sub/.eslintrc.json": rc({ extends: "../base.json" }), "sub/a.js": code }, ["sub/a.js"]),
  extend("an absolute path", { ".eslintrc.json": rc({ extends: "<dir>/configs/base.json" }), "configs/base.json": json(eqeqeq), "a.js": code }),
  extend("the package.json of another directory", {
    ".eslintrc.json": rc({ extends: "./other/package.json" }),
    "other/package.json": json({ eslintConfig: eqeqeq }),
    "a.js": code,
  }),
  extend("a package.json without eslintConfig", { ".eslintrc.json": rc({ extends: "./other/package.json" }), "other/package.json": "{}", "a.js": code }),
  extend("the .eslintrc of another directory", { ".eslintrc.json": rc({ extends: "./other/.eslintrc" }), "other/.eslintrc": "rules:\n  eqeqeq: error\n", "a.js": code }),
  extend("a list: the later wins", {
    ".eslintrc.json": rc({ extends: ["./one.json", "./two.json"] }),
    "one.json": json(on("eqeqeq", "no-var")),
    "two.json": json({ rules: { eqeqeq: "off" } }),
    "a.js": code,
  }),
  extend("an empty list", { ".eslintrc.json": rc({ extends: [], ...eqeqeq }), "a.js": code }),
  extend("the file itself wins over what it extends", {
    ".eslintrc.json": rc({ extends: "./base.json", rules: { eqeqeq: "off" } }),
    "base.json": json(on("eqeqeq", "no-var")),
    "a.js": code,
  }),
  extend("the file itself wins over the overrides of what it extends", {
    ".eslintrc.json": rc({ extends: "./base.json", rules: { "no-console": "off" } }),
    "base.json": json({ overrides: [{ files: ["*.js"], ...on("no-console") }] }),
    "a.js": "console.log();\n",
  }),
  extend("a chain, each relative to the file that says it", {
    ".eslintrc.json": rc({ extends: "./one/one.json" }),
    "one/one.json": json({ extends: "./two/two.json", ...noVar }),
    "one/two/two.json": json({ extends: "../../three.yml" }),
    "three.yml": "rules:\n  eqeqeq: error\n",
    "a.js": code,
  }),
  extend("severity alone keeps the options of what is extended", {
    ".eslintrc.json": rc({ extends: "./base.json", rules: { eqeqeq: "warn" } }),
    "base.json": json({ rules: { eqeqeq: ["error", "smart"] } }),
    "a.js": "if (x == null) {}\nif (x == 1) {}\n",
  }),
  extend(
    "root in what is extended counts",
    { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json({ extends: "./base.json" }), "sub/base.json": rc(noVar), "sub/a.js": code },
    ["sub/a.js"],
  ),
  extend(
    "root: false of the file over root: true of what it extends",
    { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json({ root: false, extends: "./base.json" }), "sub/base.json": rc(noVar), "sub/a.js": code },
    ["sub/a.js"],
  ),
  extend(
    "patterns of overrides in what is extended are relative to the file that extends",
    {
      ".eslintrc.json": rc({ extends: "./configs/base.json" }),
      "configs/base.json": json({ overrides: [{ files: ["lib/*.js"], ...eqeqeq }] }),
      "lib/a.js": code,
      "configs/lib/a.js": code,
    },
    ["lib/a.js", "configs/lib/a.js"],
  ),
  extend(
    "ignorePatterns in what is extended are relative to the file that extends",
    {
      ".eslintrc.json": rc({ extends: "./configs/base.json", ...eqeqeq }),
      "configs/base.json": json({ ignorePatterns: ["/a.js"] }),
      "a.js": code,
      "configs/a.js": code,
    },
    ["."],
  ),
  extend("env, globals, parserOptions and settings come along", {
    ".eslintrc.json": rc({ extends: "./base.json", ...on("no-undef") }),
    "base.json": json({ env: { mocha: true }, globals: { zed: "readonly" }, parserOptions: { ecmaVersion: 2015 }, settings: { a: 1 } }),
    "a.js": "const a = () => describe(zed, nope); a();\n",
  }),
  extend("missing", { ".eslintrc.json": rc({ extends: "./nope.json" }), "a.js": code }),
  extend("missing, two levels down", { ".eslintrc.json": rc({ extends: "./configs/one.json" }), "configs/one.json": json({ extends: "./nope.json" }), "a.js": code }),
  extend("broken", { ".eslintrc.json": rc({ extends: "./base.json" }), "base.json": "{", "a.js": code }, undefined, { lines: 1 }),
  extend("a directory without an index", { ".eslintrc.json": rc({ extends: "./configs" }), "configs/base.json": json(eqeqeq), "a.js": code }),
  extend("a file that extends itself", { ".eslintrc.json": rc({ extends: "./.eslintrc.json" }), "a.js": code }, undefined, { lines: 0 }),
  extend("eslint:nope", { ".eslintrc.json": rc({ extends: "eslint:nope" }), "a.js": code }),
];

const howTheyAreMerged = [
  merge("options replace options, they are not merged", {
    ".eslintrc.json": rc({ extends: "./base.json", rules: { quotes: ["error", "single"] } }),
    "base.json": json({ rules: { quotes: ["error", "double", { avoidEscape: true }] } }),
    "a.js": "var a = \"it's\", b = 'c';\n",
  }),
  merge("a severity in a list without options keeps the options", {
    ".eslintrc.json": rc({ extends: "./base.json", rules: { quotes: ["warn"] } }),
    "base.json": json({ rules: { quotes: ["error", "single"] } }),
    "a.js": "var a = \"b\", c = 'd';\n",
  }),
  merge("off, then a severity alone: the options are still there", {
    ".eslintrc.json": rc({ extends: ["./one.json", "./two.json"], rules: { quotes: 2 } }),
    "one.json": json({ rules: { quotes: ["error", "single"] } }),
    "two.json": json({ rules: { quotes: "off" } }),
    "a.js": "var a = \"b\", c = 'd';\n",
  }),
  merge("severities as numbers and words, in any case of letters", {
    ".eslintrc.json": rc({ rules: { eqeqeq: 2, "no-var": "WARN", "no-debugger": ["Error"] } }),
    "a.js": code,
  }),
  merge("settings are merged deeply, lists in them index by index", {
    ".eslintrc.json": rc({ extends: "./base.json", plugins: ["show"], settings: { a: { c: 2 }, list: [3] }, rules: { "show/settings": "error" } }),
    "base.json": json({ settings: { a: { b: 1 }, list: [1, 2] } }),
    ...pkg(
      "eslint-plugin-show",
      'module.exports = { rules: { settings: { create(context) { return { Program(node) { context.report({ node, message: JSON.stringify(context.settings) }); } }; } } } };\n',
    ),
    "a.js": code,
  }),
  merge("ecmaFeatures are merged key by key", {
    ".eslintrc.json": rc({ extends: "./base.json", parserOptions: { ecmaFeatures: { globalReturn: true } } }),
    "base.json": json({ parserOptions: { ecmaFeatures: { jsx: true } } }),
    "a.js": "return <a/>;\n",
  }),
  merge("globals: the later wins", {
    ".eslintrc.json": rc({ extends: "./base.json", globals: { a: "writable" }, ...on("no-global-assign", "no-undef") }),
    "base.json": json({ globals: { a: "readonly", b: "readonly" } }),
    "a.js": "a = 1; b = 1;\n",
  }),
  merge("globals: readonly, writable, off", {
    ".eslintrc.json": rc({ env: { browser: true }, globals: { a: "readonly", b: "writable", window: "off" }, ...on("no-undef", "no-global-assign") }),
    "a.js": "a = 1; b = 1; window;\n",
  }),
  merge("globals: true, false, readable, writeable, the words true and false, null", {
    ".eslintrc.json": rc({ globals: { a: false, b: true, c: "readable", d: "writeable", e: "true", f: "false", g: null }, ...on("no-undef", "no-global-assign") }),
    "a.js": "a = 1; b = 1; c = 1; d = 1; e = 1; f = 1; g = 1;\n",
  }),
  merge("env: node", { ".eslintrc.json": rc({ env: { node: true }, ...on("no-undef") }), "a.js": "require('a'); window;\n" }),
  merge("env: browser", { ".eslintrc.json": rc({ env: { browser: true }, ...on("no-undef") }), "a.js": "require('a'); window;\n" }),
  merge("env: false", { ".eslintrc.json": rc({ env: { node: false }, ...on("no-undef") }), "a.js": "require('a');\n" }),
  merge("env: nashorn, webextensions, jest, jquery, worker, serviceworker, mongo, greasemonkey", {
    ".eslintrc.json": rc({
      env: { nashorn: true, webextensions: true, jest: true, jquery: true, worker: true, serviceworker: true, mongo: true, greasemonkey: true },
      ...on("no-undef"),
    }),
    "a.js": "Java; browser; chrome; jest; $; importScripts; clients; ObjectId; GM_info; nope;\n",
  }),
  merge("env in a comment", { ".eslintrc.json": rc(on("no-undef")), "a.js": "/* eslint-env mocha */\ndescribe(); nope();\n" }),
  merge("env in a comment: a list, and only block comments", {
    ".eslintrc.json": rc(on("no-undef")),
    "a.js": "/* eslint-env mocha, jquery */\n// eslint-env node\ndescribe(); $(); require();\n",
  }),
  merge("reportUnusedDisableDirectives", {
    ".eslintrc.json": rc({ reportUnusedDisableDirectives: true }),
    "a.js": "// eslint-disable-next-line eqeqeq\nvar x = 1;\n",
  }),
  merge("reportUnusedDisableDirectives: false in the child", {
    ".eslintrc.json": rc({ reportUnusedDisableDirectives: true }),
    "sub/.eslintrc.json": json({ reportUnusedDisableDirectives: false }),
    "sub/a.js": "/* eslint-disable eqeqeq */\n",
    "a.js": "/* eslint-disable eqeqeq */\n",
  }, ["."]),
  merge("reportUnusedDisableDirectives in overrides", {
    ".eslintrc.json": rc({ overrides: [{ files: ["a.js"], reportUnusedDisableDirectives: true }] }),
    "a.js": "/* eslint-disable eqeqeq */\n",
    "b.js": "/* eslint-disable eqeqeq */\n",
  }, ["a.js", "b.js"]),
  merge("ecmaFeatures at the top is allowed and does nothing", { ".eslintrc.json": rc({ ecmaFeatures: { jsx: true }, ...eqeqeq }), "a.js": code }),
  merge("$schema at the top is allowed", { ".eslintrc.json": rc({ $schema: "https://json.schemastore.org/eslintrc", ...eqeqeq }), "a.js": code }),
];

// `extends` -> the file that it has to find.
const resolution = [
  ["foo", "eslint-config-foo/index.js"],
  ["eslint-config-foo", "eslint-config-foo/index.js"],
  ["foo/bar", "eslint-config-foo/bar.js"],
  ["eslint-config-foo/bar", "eslint-config-foo/bar.js"],
  ["foo/bar.js", "eslint-config-foo/bar.js"],
  ["foo/deep/er", "eslint-config-foo/deep/er.json"],
  ["eslint-configfoo", "eslint-config-eslint-configfoo/index.js"],
  ["@foo", "@foo/eslint-config/index.js"],
  ["@foo/eslint-config", "@foo/eslint-config/index.js"],
  ["@foo/bar", "@foo/eslint-config-bar/index.js"],
  ["@foo/eslint-config-bar", "@foo/eslint-config-bar/index.js"],
  ["@foo/bar/baz", "@foo/eslint-config-bar/baz.js"],
  ["@foo/eslint-config/baz", "@foo/eslint-config/baz.js"],
];
const found = file => ({ [`node_modules/${file}`]: file.endsWith(".json") ? json(eqeqeq) : js(eqeqeq) });

const extendsOfPackages = [
  ...resolution.map(([name, file]) => packages(`${name} is ${file}`, { ".eslintrc.json": rc({ extends: name }), ...found(file), "a.js": code })),
  ...resolution
    .slice(0, 10)
    .filter((_, index) => index % 2 === 0)
    .map(([name, file]) =>
      packages(`${name} from a file two directories below the node_modules`, { "foo/bar/.eslintrc": rc({ extends: name }), ...found(file), "foo/bar/a.js": code }, [
        "foo/bar/a.js",
      ]),
    ),
  packages("main in package.json", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", json({ name: "eslint-config-foo", main: "lib/main.js" }), "package.json"),
    ...pkg("eslint-config-foo", eqeqeq, "lib/main.js"),
    ...pkg("eslint-config-foo", noVar),
    "a.js": code,
  }),
  packages("main is a .json", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", json({ main: "config.json" }), "package.json"),
    ...pkg("eslint-config-foo", json(eqeqeq), "config.json"),
    "a.js": code,
  }),
  packages("main is a .yml", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", json({ main: "config.yml" }), "package.json"),
    ...pkg("eslint-config-foo", "rules:\n  eqeqeq: error\n", "config.yml"),
    "a.js": code,
  }),
  packages("main is an .eslintrc", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", json({ main: ".eslintrc" }), "package.json"),
    ...pkg("eslint-config-foo", json(eqeqeq), ".eslintrc"),
    "a.js": code,
  }),
  packages("index.json", { ".eslintrc.json": rc({ extends: "foo" }), ...pkg("eslint-config-foo", json(eqeqeq), "index.json"), "a.js": code }),
  packages("exports in package.json", {
    ".eslintrc.json": rc({ extends: ["foo", "foo/strict"] }),
    ...pkg("eslint-config-foo", json({ exports: { ".": "./lib/main.js", "./strict": "./lib/strict.js" } }), "package.json"),
    ...pkg("eslint-config-foo", eqeqeq, "lib/main.js"),
    ...pkg("eslint-config-foo", noVar, "lib/strict.js"),
    "a.js": code,
  }),
  packages("exports in package.json hide the other files", {
    ".eslintrc.json": rc({ extends: "foo/lib/main.js" }),
    ...pkg("eslint-config-foo", json({ exports: { ".": "./lib/main.js" } }), "package.json"),
    ...pkg("eslint-config-foo", eqeqeq, "lib/main.js"),
    "a.js": code,
  }, undefined, { lines: 0 }),
  packages("exports with conditions: require, not import", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", json({ exports: { import: "./main.mjs", require: "./main.cjs" } }), "package.json"),
    ...pkg("eslint-config-foo", `export default ${json(noVar)};\n`, "main.mjs"),
    ...pkg("eslint-config-foo", eqeqeq, "main.cjs"),
    "a.js": code,
  }),
  packages("the nearest node_modules wins", {
    ".eslintrc.json": rc(),
    ...pkg("eslint-config-foo", eqeqeq),
    "sub/.eslintrc.json": json({ extends: "foo" }),
    ...under("sub", pkg("eslint-config-foo", noVar)),
    "sub/a.js": code,
  }, ["sub/a.js"]),
  packages("not relative to the working directory", {
    "sub/node_modules/eslint-config-foo/index.js": js(eqeqeq),
    ".eslintrc.json": rc({ extends: "foo" }),
    "sub/a.js": code,
  }, ["a.js"], { cwd: "sub" }),
  packages("a package that extends a file of its own", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", { extends: "./base.js" }),
    ...pkg("eslint-config-foo", eqeqeq, "base.js"),
    "a.js": code,
  }),
  packages("a package that extends a package beside it", {
    ".eslintrc.json": rc({ extends: "one" }),
    ...pkg("eslint-config-one", { extends: "two", ...noVar }),
    ...pkg("eslint-config-two", eqeqeq),
    "a.js": code,
  }),
  packages("a package that extends a package in its own node_modules", {
    ".eslintrc.json": rc({ extends: "one" }),
    ...pkg("eslint-config-one", { extends: "two" }),
    ...pkg("eslint-config-one/node_modules/eslint-config-two", eqeqeq),
    ...pkg("eslint-config-two", noVar),
    "a.js": code,
  }),
  packages("what is in the node_modules of a package is not found from the project", {
    ".eslintrc.json": rc({ extends: ["one", "two"] }),
    ...pkg("eslint-config-one", {}),
    ...pkg("eslint-config-one/node_modules/eslint-config-two", eqeqeq),
    "a.js": code,
  }),
  packages("a package that extends eslint:recommended", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", { extends: ["eslint:recommended"], rules: { "no-debugger": "warn" } }),
    "a.js": code,
  }),
  packages("a package that requires another package", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", 'module.exports = { rules: require("foo-rules") };\n'),
    ...pkg("foo-rules", 'module.exports = { eqeqeq: "error" };\n'),
    "a.js": code,
  }),
  packages("a package with overrides: the patterns are relative to the file of the project", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", { overrides: [{ files: ["lib/*.js"], ...eqeqeq }, { files: ["*.test.js"], ...noVar }] }),
    "lib/a.js": code,
    "src/lib/a.js": code,
    "src/a.test.js": code,
  }, ["lib", "src"]),
  packages("in overrides", {
    ".eslintrc.json": rc({ overrides: [{ files: ["a.js"], extends: "foo" }] }),
    ...pkg("eslint-config-foo", eqeqeq),
    "a.js": code,
    "b.js": code,
  }, ["a.js", "b.js"]),
  packages("in overrides, a package with overrides: both patterns have to match", {
    ".eslintrc.json": rc({ overrides: [{ files: ["lib/**"], extends: "foo" }] }),
    ...pkg("eslint-config-foo", { ...noVar, overrides: [{ files: ["*.test.js"], ...eqeqeq }] }),
    "lib/a.js": code,
    "lib/a.test.js": code,
    "a.test.js": code,
  }, ["lib", "a.test.js"]),
  packages("in overrides, root of the package does not count", {
    ".eslintrc.json": rc(eqeqeq),
    "sub/.eslintrc.json": json({ overrides: [{ files: ["*.js"], extends: "foo" }] }),
    ...pkg("eslint-config-foo", { root: true, ...noVar }),
    "sub/a.js": code,
  }, ["sub/a.js"]),
  packages("overrides that extend, three packages deep", {
    ".eslintrc.yml": "root: true\nextends: one\n",
    ...pkg("eslint-config-one", { overrides: [{ files: ["*test*"], extends: "two" }] }),
    ...pkg("eslint-config-two", { overrides: [{ files: ["*.js"], extends: "three" }] }),
    ...pkg("eslint-config-three", on("no-console")),
    "test.js": "console.log('hello')\n",
    "other.js": "console.log('hello')\n",
  }, ["test.js", "other.js"]),
  packages("root in a package counts", {
    ".eslintrc.json": rc(eqeqeq),
    "sub/.eslintrc.json": json({ extends: "foo" }),
    ...pkg("eslint-config-foo", { root: true, ...noVar }),
    "sub/a.js": code,
  }, ["sub/a.js"]),
  packages("from package.json#eslintConfig", { "package.json": json({ eslintConfig: { root: true, extends: "foo" } }), ...pkg("eslint-config-foo", eqeqeq), "a.js": code }),
  packages("from a .yml", { ".eslintrc.yml": "root: true\nextends:\n  - foo\n  - '@s/bar'\n", ...pkg("eslint-config-foo", eqeqeq), ...pkg("@s/eslint-config-bar", noVar), "a.js": code }),
  packages("from -c: relative to that file", {
    "configs/other.json": json({ extends: "foo" }),
    ...under("configs", pkg("eslint-config-foo", eqeqeq)),
    "a.js": code,
  }, ["--no-eslintrc", "-c", "configs/other.json", "a.js"]),
  packages("a link in node_modules", {
    ".eslintrc.json": rc({ extends: "foo" }),
    "packages/config/index.js": js({ extends: "./base" }),
    "packages/config/base.js": js(eqeqeq),
    "node_modules/eslint-config-foo": { link: "../packages/config" },
    "a.js": code,
  }, undefined, { posix: true }),
  packages("missing", { ".eslintrc.json": rc({ extends: "nope" }), "a.js": code }),
  packages("missing: a scope", { ".eslintrc.json": rc({ extends: "@nope" }), "a.js": code }),
  packages("missing: a file of a package that is there", { ".eslintrc.json": rc({ extends: "foo/nope" }), ...pkg("eslint-config-foo", eqeqeq), "a.js": code }),
  packages("missing, named by a package", { ".eslintrc.json": rc({ extends: "foo" }), ...pkg("eslint-config-foo", { extends: "nope" }), "a.js": code }),
  packages("missing, in overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["*.ts"], extends: "nope" }] }), "a.js": code }),
  packages("it throws", { ".eslintrc.json": rc({ extends: "foo" }), ...pkg("eslint-config-foo", "throw new Error('boom');\n"), "a.js": code }, undefined, { lines: 3 }),
  packages("it requires what does not exist", { ".eslintrc.json": rc({ extends: "foo" }), ...pkg("eslint-config-foo", 'require("nope");\n'), "a.js": code }, undefined, { lines: 2 }),
  packages("an empty name is passed over", { ".eslintrc.json": rc({ extends: "" }), "a.js": code }),
];

const noX = { rules: { "foo/no-x": "error" } };
const foo = pkg("eslint-plugin-foo", withRule());
// `plugins` -> the package, and the prefix of its rules.
const pluginNames = [
  ["foo", "eslint-plugin-foo", "foo"],
  ["eslint-plugin-foo", "eslint-plugin-foo", "foo"],
  ["@s/foo", "@s/eslint-plugin-foo", "@s/foo"],
  ["@s/eslint-plugin-foo", "@s/eslint-plugin-foo", "@s/foo"],
  ["@s", "@s/eslint-plugin", "@s"],
  ["@s/eslint-plugin", "@s/eslint-plugin", "@s"],
  ["eslint-pluginfoo", "eslint-plugin-eslint-pluginfoo", "eslint-pluginfoo"],
];
const empty = name => pkg(name, "");
const show = (name, expression) =>
  pkg(
    "eslint-plugin-show",
    `module.exports = { rules: { ${json(name)}: { create(context) { return { Program(node) { context.report({ node, message: String(${expression}) }); } }; } } } };\n`,
  );
const shown = (name, more = {}) => rc({ plugins: ["show"], rules: { [`show/${name}`]: "error" }, ...more });

const thePlugins = [
  ...pluginNames.map(([name, from, prefix]) =>
    plugins(`${name} is ${from}, its rules are ${prefix}/*`, {
      ".eslintrc.json": rc({ plugins: [name], rules: { [`${prefix}/no-x`]: "error" } }),
      ...pkg(from, withRule()),
      "a.js": code,
    }),
  ),
  plugins("the long name is no prefix of rules", { ".eslintrc.json": rc({ plugins: ["foo"], rules: { "eslint-plugin-foo/no-x": "error" } }), ...foo, "a.js": code }),
  plugins("the name without its scope is no prefix of rules", {
    ".eslintrc.json": rc({ plugins: ["@s/foo"], rules: { "foo/no-x": "error" } }),
    ...pkg("@s/eslint-plugin-foo", withRule()),
    "a.js": code,
  }),
  plugins("two plugins", {
    ".eslintrc.json": rc({ plugins: ["foo", "bar"], rules: { "foo/no-x": "error", "bar/no-x": "warn" } }),
    ...foo,
    ...pkg("eslint-plugin-bar", withRule("bar: no x")),
    "a.js": code,
  }),
  plugins("the same plugin by both names", { ".eslintrc.json": rc({ plugins: ["foo", "eslint-plugin-foo"], ...noX }), ...foo, "a.js": code }),
  plugins("a rule of a plugin that `plugins` does not name", { ".eslintrc.json": rc(noX), ...foo, "a.js": code }),
  plugins("a rule that the plugin does not have", { ".eslintrc.json": rc({ plugins: ["foo"], rules: { "foo/nope": "error" } }), ...foo, "a.js": code }),
  plugins("a plugin without rules", { ".eslintrc.json": rc({ plugins: ["foo"], ...eqeqeq }), ...empty("eslint-plugin-foo"), "a.js": code }),
  plugins("main in package.json", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...pkg("eslint-plugin-foo", json({ main: "lib/main.js" }), "package.json"),
    ...pkg("eslint-plugin-foo", withRule(), "lib/main.js"),
    "a.js": code,
  }),
  plugins("in a .yml", { ".eslintrc.yml": "root: true\nplugins:\n  - foo\nrules:\n  foo/no-x: 2\n", ...foo, "a.js": code }),
  plugins("in an .eslintrc.js", { ".eslintrc.js": js({ root: true, plugins: ["foo"], ...noX }), ...foo, "a.js": code }),
  plugins("in overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["a.js"], plugins: ["foo"], ...noX }] }), ...foo, "a.js": code, "b.js": code }, ["a.js", "b.js"]),
  plugins("named by the parent, its rule switched on by the child", {
    ".eslintrc.json": rc({ plugins: ["foo"] }),
    "sub/.eslintrc.json": json(noX),
    ...foo,
    "sub/a.js": code,
  }, ["sub/a.js"]),

  plugins("plugin:foo/rec", { ".eslintrc.json": rc({ extends: "plugin:foo/rec" }), ...pkg("eslint-plugin-foo", `module.exports = { configs: { rec: ${json(eqeqeq)} } };\n`), "a.js": code }),
  plugins("plugin:eslint-plugin-foo/rec", { ".eslintrc.json": rc({ extends: "plugin:eslint-plugin-foo/rec" }), ...pkg("eslint-plugin-foo", `module.exports = { configs: { rec: ${json(eqeqeq)} } };\n`), "a.js": code }),
  plugins("plugin:@s/rec is @s/eslint-plugin", { ".eslintrc.json": rc({ extends: "plugin:@s/rec" }), ...pkg("@s/eslint-plugin", `module.exports = { configs: { rec: ${json(eqeqeq)} } };\n`), "a.js": code }),
  plugins("plugin:@s/foo/rec is @s/eslint-plugin-foo", { ".eslintrc.json": rc({ extends: "plugin:@s/foo/rec" }), ...pkg("@s/eslint-plugin-foo", `module.exports = { configs: { rec: ${json(eqeqeq)} } };\n`), "a.js": code }),
  plugins("plugin:foo/rec does not make the rules of foo known", { ".eslintrc.json": rc({ extends: "plugin:foo/rec", ...noX }), ...pkg("eslint-plugin-foo", withRule("no x", "configs: { rec: {} }")), "a.js": code }),
  plugins("plugin:foo/rec that names its own plugin and rules", {
    ".eslintrc.json": rc({ extends: "plugin:foo/rec" }),
    ...pkg("eslint-plugin-foo", withRule("no x", `configs: { rec: ${json({ plugins: ["foo"], ...noX })} }`)),
    "a.js": code,
  }),
  plugins("two configurations of one plugin", {
    ".eslintrc.json": rc({ extends: ["plugin:foo/one", "plugin:foo/two"] }),
    ...pkg("eslint-plugin-foo", `module.exports = { configs: { one: ${json(eqeqeq)}, two: ${json(noVar)} } };\n`),
    "a.js": code,
  }),
  plugins("a configuration of a plugin extends another of the same plugin", {
    ".eslintrc.json": rc({ extends: "plugin:foo/strict" }),
    ...pkg("eslint-plugin-foo", `module.exports = { configs: { base: ${json(eqeqeq)}, strict: ${json({ extends: "plugin:foo/base", ...noVar })} } };\n`),
    "a.js": code,
  }),
  plugins("a configuration of a plugin extends a file: relative to the plugin", {
    ".eslintrc.json": rc({ extends: "plugin:foo/rec" }),
    ...pkg("eslint-plugin-foo", `module.exports = { configs: { rec: { extends: "./base.json" } } };\n`),
    ...pkg("eslint-plugin-foo", json(eqeqeq), "base.json"),
    "a.js": code,
  }),
  plugins("a configuration of a plugin extends a package: relative to the plugin", {
    ".eslintrc.json": rc({ extends: "plugin:foo/rec" }),
    ...pkg("eslint-plugin-foo", `module.exports = { configs: { rec: { extends: "bar" } } };\n`),
    ...pkg("eslint-plugin-foo/node_modules/eslint-config-bar", eqeqeq),
    "a.js": code,
  }),
  plugins("a configuration of a plugin with overrides", {
    ".eslintrc.json": rc({ extends: "plugin:foo/rec" }),
    ...pkg("eslint-plugin-foo", `module.exports = { configs: { rec: ${json({ overrides: [{ files: ["lib/*.js"], ...eqeqeq }] })} } };\n`),
    "lib/a.js": code,
    "a.js": code,
  }, ["lib/a.js", "a.js"]),
  plugins("a package extends plugin:foo/rec", {
    ".eslintrc.json": rc({ extends: "one" }),
    ...pkg("eslint-config-one", { extends: "plugin:foo/rec" }),
    ...pkg("eslint-plugin-foo", `module.exports = { configs: { rec: ${json(eqeqeq)} } };\n`),
    "a.js": code,
  }),
  plugins("plugin:foo/nope: no such configuration", { ".eslintrc.json": rc({ extends: "plugin:foo/nope" }), ...pkg("eslint-plugin-foo", "module.exports = { configs: {} };\n"), "a.js": code }),
  plugins("plugin:foo/rec of a plugin without configurations", { ".eslintrc.json": rc({ extends: "plugin:foo/rec" }), ...foo, "a.js": code }),
  plugins("plugin:nope/rec: no such plugin", { ".eslintrc.json": rc({ extends: "plugin:nope/rec" }), "a.js": code }),
  plugins("plugin:foo without a configuration", { ".eslintrc.json": rc({ extends: "plugin:foo" }), ...foo, "a.js": code }),
  plugins("plugin:./foo/rec: a path", { ".eslintrc.json": rc({ extends: "plugin:./foo/rec" }), "a.js": code }),
  plugins("a path in `plugins`", { ".eslintrc.json": rc({ plugins: ["./foo"] }), "foo.js": withRule(), "a.js": code }),
  plugins("a space in the name", { ".eslintrc.json": rc({ plugins: ["foo "] }), ...foo, "a.js": code }),
  plugins("a tab in the name", { ".eslintrc.json": rc({ plugins: ["fo\to"] }), "a.js": code }),
  plugins("missing", { ".eslintrc.json": rc({ plugins: ["nope"] }), "a.js": code }),
  plugins("missing: a scope", { ".eslintrc.json": rc({ plugins: ["@nope"] }), "a.js": code }),
  plugins("missing, in overrides that match", { ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], plugins: ["nope"] }] }), "a.js": code }),
  plugins("missing, in overrides that do not match", { ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["*.ts"], plugins: ["nope"] }] }), "a.js": code }),
  plugins("missing, in a directory of which no file is linted", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json({ plugins: ["nope"] }), "sub/b.js": code, "a.js": code }),
  plugins("it throws", { ".eslintrc.json": rc({ plugins: ["foo"] }), ...pkg("eslint-plugin-foo", "throw new Error('boom');\n"), "a.js": code }, undefined, { lines: 1 }),
  plugins("it throws, by plugin:foo/rec", { ".eslintrc.json": rc({ extends: "plugin:foo/rec" }), ...pkg("eslint-plugin-foo", "throw new Error('boom');\n"), "a.js": code }, undefined, { lines: 2 }),
  plugins("it requires what does not exist", { ".eslintrc.json": rc({ plugins: ["foo"] }), ...pkg("eslint-plugin-foo", 'require("nope");\n'), "a.js": code }, undefined, { lines: 1 }),

  // Where they are looked for: from the directory of the file of the project, not from what it extends, not from the working directory.
  plugins("from the directory of the configuration file, not the working directory", {
    "sub/.eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...under("sub", foo),
    "sub/a.js": code,
  }, ["sub/a.js"]),
  plugins("in a node_modules above the configuration file", { "sub/deep/.eslintrc.json": rc({ plugins: ["foo"], ...noX }), ...foo, "sub/deep/a.js": code }, ["sub/deep/a.js"]),
  plugins("in a node_modules of the working directory, below the configuration file", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...under("sub", foo),
    "sub/a.js": code,
  }, ["a.js"], { cwd: "sub" }),
  plugins("named by a package, found from the project", {
    ".eslintrc.json": rc({ extends: "one" }),
    ...pkg("eslint-config-one", { plugins: ["foo"], ...noX }),
    ...pkg("eslint-config-one/node_modules/eslint-plugin-foo", withRule("the one of the package")),
    ...foo,
    "a.js": code,
  }),
  plugins("named by a package and only in the node_modules of that package", {
    ".eslintrc.json": rc({ extends: "one" }),
    ...pkg("eslint-config-one", { plugins: ["foo"], ...noX }),
    ...pkg("eslint-config-one/node_modules/eslint-plugin-foo", withRule()),
    "a.js": code,
  }),
  plugins("named by a file in another directory, found from the file that extends", {
    ".eslintrc.json": rc({ extends: "./configs/base.json" }),
    "configs/base.json": json({ plugins: ["foo"], ...noX }),
    ...under("configs", pkg("eslint-plugin-foo", withRule("the one of configs"))),
    ...foo,
    "a.js": code,
  }),
  plugins("-c: from the directory of that file", {
    "configs/other.json": json({ plugins: ["foo"], ...noX }),
    ...under("configs", foo),
    "a.js": code,
  }, ["--no-eslintrc", "-c", "configs/other.json", "a.js"]),
  plugins("--plugin: from the working directory", { ".eslintrc.json": rc(), ...under("sub", foo), "sub/a.js": code }, ["--plugin", "foo", "--rule", "foo/no-x: error", "a.js"], { cwd: "sub" }),
  plugins("--plugin --rule without a file", { ...foo, "a.js": code }, ["--no-eslintrc", "--plugin", "foo", "--rule", "foo/no-x: 2", "a.js"]),
  plugins("--plugin with the long name, and a list", { ...foo, ...pkg("eslint-plugin-bar", withRule("bar")), "a.js": code }, [
    "--no-eslintrc",
    "--plugin",
    "eslint-plugin-foo,bar",
    "--rule",
    "{ foo/no-x: 2, bar/no-x: 1 }",
    "a.js",
  ]),
  plugins("--plugin: missing", { ".eslintrc.json": rc(), "a.js": code }, ["--plugin", "nope", "a.js"]),
  plugins("--resolve-plugins-relative-to", { ".eslintrc.json": rc({ plugins: ["foo"], ...noX }), ...under("elsewhere", foo), "a.js": code }, [
    "--resolve-plugins-relative-to",
    "elsewhere",
    "a.js",
  ]),
  plugins("--resolve-plugins-relative-to wins over the directory of the file", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...foo,
    ...under("elsewhere", pkg("eslint-plugin-foo", withRule("from elsewhere"))),
    "a.js": code,
  }, ["--resolve-plugins-relative-to", "elsewhere", "a.js"]),
  plugins("--resolve-plugins-relative-to: missing there", { ".eslintrc.json": rc({ plugins: ["foo"], ...noX }), "sub/a.js": code, ...under("other", foo), "elsewhere/x": "" }, [
    "--resolve-plugins-relative-to",
    "elsewhere",
    "sub/a.js",
  ]),
  plugins("--resolve-plugins-relative-to, for plugin:foo/rec and --plugin too", {
    ".eslintrc.json": rc({ extends: "plugin:foo/rec" }),
    ...under("elsewhere", pkg("eslint-plugin-foo", withRule("no x", `configs: { rec: ${json(eqeqeq)} }`))),
    "a.js": code,
  }, ["--resolve-plugins-relative-to", "elsewhere", "--plugin", "foo", "--rule", "foo/no-x: 1", "a.js"]),

  // cli-engine.js, "plugin conflicts"
  plugins("no conflict: a file and the packages that it extends in a line", {
    ".eslintrc.json": rc({ extends: ["one"], plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    ...pkg("eslint-config-one", { extends: ["two"], plugins: ["foo"] }),
    ...empty("eslint-config-one/node_modules/eslint-plugin-foo"),
    ...pkg("eslint-config-two", { plugins: ["foo"] }),
    ...empty("eslint-config-two/node_modules/eslint-plugin-foo"),
    "a.js": code,
  }),
  plugins("no conflict: a file and two packages that it extends", {
    ".eslintrc.json": rc({ extends: ["one", "two"], plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    ...pkg("eslint-config-one", { plugins: ["foo"] }),
    ...empty("eslint-config-one/node_modules/eslint-plugin-foo"),
    ...pkg("eslint-config-two", { plugins: ["foo"] }),
    ...empty("eslint-config-two/node_modules/eslint-plugin-foo"),
    "a.js": code,
  }),
  plugins("no conflict: files of two directories, one node_modules", {
    ".eslintrc.json": rc({ plugins: ["foo"] }),
    "sub/.eslintrc.json": json({ plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    "sub/a.js": code,
  }, ["sub/a.js"]),
  plugins("conflict: files of two directories, two node_modules", {
    ".eslintrc.json": rc({ plugins: ["foo"] }),
    "sub/.eslintrc.json": json({ plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    ...under("sub", empty("eslint-plugin-foo")),
    "sub/a.js": code,
  }, ["sub/a.js"]),
  plugins("no conflict: -c and a file, one node_modules", {
    ".eslintrc.json": rc({ plugins: ["foo"] }),
    "node_modules/mine/.eslintrc.json": json({ plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    "a.js": code,
  }, ["-c", "node_modules/mine/.eslintrc.json", "a.js"]),
  plugins("conflict: -c and a file, two node_modules", {
    ".eslintrc.json": rc({ plugins: ["foo"] }),
    "node_modules/mine/.eslintrc.json": json({ plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    ...empty("mine/node_modules/eslint-plugin-foo"),
    "a.js": code,
  }, ["-c", "node_modules/mine/.eslintrc.json", "a.js"]),
  plugins("no conflict: --plugin and a file, one node_modules", {
    "sub/.eslintrc.json": rc({ plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    "sub/a.js": code,
  }, ["--plugin", "foo", "sub/a.js"]),
  plugins("conflict: --plugin and a file, two node_modules", {
    "sub/.eslintrc.json": rc({ plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    ...under("sub", empty("eslint-plugin-foo")),
    "sub/a.js": code,
  }, ["--plugin", "foo", "sub/a.js"]),
  plugins("no conflict with --resolve-plugins-relative-to", {
    ".eslintrc.json": rc({ plugins: ["foo"] }),
    "sub/.eslintrc.json": json({ plugins: ["foo"] }),
    ...empty("eslint-plugin-foo"),
    ...under("sub", empty("eslint-plugin-foo")),
    "sub/a.js": code,
  }, ["--resolve-plugins-relative-to", ".", "sub/a.js"]),
  plugins("no conflict: two directories with a plugin each, each for its own files", {
    "one/.eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...under("one", pkg("eslint-plugin-foo", withRule("one"))),
    "one/a.js": code,
    "two/.eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...under("two", pkg("eslint-plugin-foo", withRule("two"))),
    "two/a.js": code,
  }, ["*/a.js"]),

  // What a rule written for ESLint 8 may do.
  plugins("a rule that is a function", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...pkg("eslint-plugin-foo", 'module.exports = { rules: { "no-x": context => ({ Identifier(node) { if (node.name === "x") context.report({ node, message: "no x" }); } }) } };\n'),
    "a.js": code,
  }),
  plugins("context.report(node, message)", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...pkg("eslint-plugin-foo", 'module.exports = { rules: { "no-x": { create(context) { return { Identifier(node) { if (node.name === "x") context.report(node, "no {{name}}", { name: node.name }); } }; } } } };\n'),
    "a.js": code,
  }),
  plugins("messageId, data, options with a schema", {
    ".eslintrc.json": rc({ plugins: ["foo"], rules: { "foo/no": ["warn", "x"] } }),
    ...pkg("eslint-plugin-foo", 'module.exports = { rules: { no: { meta: { messages: { no: "no {{ name }}!" }, schema: [{ type: "string" }] }, create(context) { return { Identifier(node) { if (node.name === context.options[0]) context.report({ node, messageId: "no", data: node }); } }; } } } };\n'),
    "a.js": code,
  }),
  plugins("options without a schema are allowed", {
    ".eslintrc.json": rc({ plugins: ["foo"], rules: { "foo/no": ["error", "x", { any: 1 }] } }),
    ...pkg("eslint-plugin-foo", 'module.exports = { rules: { no: { create(context) { return { Program(node) { context.report({ node, message: JSON.stringify(context.options) }); } }; } } } };\n'),
    "a.js": code,
  }),
  plugins("--fix", {
    ".eslintrc.json": rc({ plugins: ["test"], rules: { "test/no-example": "error" } }),
    ...pkg("eslint-plugin-test", 'exports.rules = { "no-example": { meta: { type: "problem", fixable: "code" }, create(context) { return { Identifier(node) { if (node.name === "example") context.report({ node, message: "fix", fix: fixer => fixer.replaceText(node, "fixed") }); } }; } } };\n'),
    "a.js": "example;\n",
  }, ["--fix", "--fix-type", "problem", "a.js"]),
  plugins("a fix of a rule without meta.fixable", {
    ".eslintrc.json": rc({ plugins: ["test"], rules: { "test/no-example": "error" } }),
    ...pkg("eslint-plugin-test", 'exports.rules = { "no-example": { create(context) { return { Identifier(node) { context.report({ node, message: "fix", fix: fixer => fixer.replaceText(node, "fixed") }); } }; } } };\n'),
    "a.js": "example;\n",
  }, undefined, { lines: 2 }),
  plugins("a rule throws", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...noX }),
    ...pkg("eslint-plugin-foo", 'module.exports = { rules: { "no-x": { create() { return { Identifier() { throw new Error("boom"); } }; } } } };\n'),
    "a.js": code,
  }, undefined, { lines: 3 }),
  plugins("context.getSourceCode(), getFilename(), getPhysicalFilename(), getCwd()", {
    ".eslintrc.json": shown("it"),
    ...show("it", '[context.getSourceCode().getText(node.body[0]), context.getFilename() === context.filename, context.getPhysicalFilename() === context.physicalFilename, context.getCwd() === context.cwd, require("path").relative(context.getCwd(), context.getFilename())]'),
    "a.js": code,
  }),
  plugins("context.getScope(), getAncestors(), getDeclaredVariables()", {
    ".eslintrc.json": shown("it"),
    ...show("it", '[context.getScope().type, context.getScope().variables.filter(it => it.defs.length > 0).map(it => it.name), context.getAncestors().length, context.getDeclaredVariables(node.body[0]).map(it => it.name)]'),
    "a.js": code,
  }),
  plugins("context.markVariableAsUsed()", {
    ".eslintrc.json": rc({ plugins: ["show"], rules: { "show/it": "error", "no-unused-vars": "error" } }),
    ...show("it", 'context.markVariableAsUsed("x")'),
    "a.js": "var x = 1, y = 2;\n",
  }),
  plugins("context.parserOptions, parserPath, languageOptions, id", {
    ".eslintrc.json": shown("it", { parserOptions: { ecmaVersion: 2018, custom: true } }),
    ...show("it", "JSON.stringify([context.parserOptions, typeof context.parserPath, context.languageOptions && context.languageOptions.ecmaVersion, context.id])"),
    "a.js": code,
  }),
  plugins("context.parserOptions without any", { ".eslintrc.json": shown("it"), ...show("it", "JSON.stringify(context.parserOptions)"), "a.js": code }),
  plugins("context.parserOptions with env: es2021 and node", { ".eslintrc.json": shown("it", { env: { es2021: true, node: true } }), ...show("it", "JSON.stringify(context.parserOptions)"), "a.js": code }),
  plugins("sourceCode.getComments(), getJSDocComment(), getTokenOrCommentBefore(), isSpaceBetweenTokens()", {
    ".eslintrc.json": shown("it"),
    ...show("it", '(s => [s.getComments(node.body[0]).leading.length, s.getJSDocComment(node.body[0]).value, typeof s.getTokenOrCommentBefore, s.isSpaceBetweenTokens(s.ast.tokens[0], s.ast.tokens[1])])(context.getSourceCode())'),
    "a.js": "/** doc */\nfunction f() {}\n",
  }),
  plugins("code path events", {
    ".eslintrc.json": rc({ plugins: ["foo"], rules: { "foo/paths": "error" } }),
    ...pkg("eslint-plugin-foo", 'module.exports = { rules: { paths: { create(context) { const seen = []; return { onCodePathStart(path) { seen.push("start " + path.id); }, onCodePathSegmentStart(segment) { seen.push(segment.id); }, onCodePathEnd(path, node) { seen.push("end " + path.id + " " + path.currentSegments.length); if (node.type === "Program") context.report({ node, message: seen.join(", ") }); } }; } } } };\n'),
    "a.js": "function f() { if (a) return; b(); }\n",
  }),
  plugins("the scope of a script in ES5 and the globals of env", {
    ".eslintrc.json": shown("it", { env: { node: true } }),
    ...show("it", '[context.getScope().type, context.getScope().childScopes.map(it => it.type), context.getScope().set.has("require"), context.getScope().set.has("Promise"), context.getScope().isStrict]'),
    "a.js": code,
  }),
  plugins("inline configuration of a rule of a plugin", { ".eslintrc.json": rc({ plugins: ["foo"] }), ...foo, "a.js": `/* eslint foo/no-x: "warn" */\n${code}` }),
  plugins("eslint-disable of a rule of a plugin", { ".eslintrc.json": rc({ plugins: ["foo"], ...noX }), ...foo, "a.js": "var x = 1; // eslint-disable-line foo/no-x\nx;\n" }),
];

// Finds the blocks that `pattern` matches: the first group is the extension of the block, the second its text.
const patternProcessor = `exports.defineProcessor = (pattern, legacy = false) => {
  const blocksOf = new Map();
  return {
    preprocess(text, filename) {
      const blocks = [];
      blocksOf.set(filename, blocks);
      for (const match of text.matchAll(pattern)) {
        const [whole, extension, code] = match;
        blocks.push({
          text: code,
          filename: blocks.length + "." + extension,
          offset: match.index + whole.indexOf(code),
          lines: text.slice(0, match.index).split("\\n").length,
        });
      }
      return legacy ? blocks.map(it => it.text) : blocks;
    },
    postprocess(lists, filename) {
      const blocks = blocksOf.get(filename);
      lists.forEach((messages, index) => {
        for (const it of messages) {
          it.line += blocks[index].lines;
          if (it.endLine != null) it.endLine += blocks[index].lines;
          if (it.fix) it.fix.range = it.fix.range.map(at => at + blocks[index].offset);
        }
      });
      return lists.flat();
    },
  };
};
`;
const markdownAndHtml = {
  ...pkg("pattern-processor", patternProcessor),
  ...pkg(
    "eslint-plugin-markdown",
    `const { defineProcessor } = require("pattern-processor");
const processor = defineProcessor(${/```(\w+)\n([\s\S]+?)\n```/gu});
exports.processors = { ".md": { ...processor, supportsAutofix: true }, "non-fixable": processor };
`,
  ),
  ...pkg(
    "eslint-plugin-html",
    `const { defineProcessor } = require("pattern-processor");
const processor = defineProcessor(${/<script lang="(\w*)">\n([\s\S]+?)\n<\/script>/gu});
const legacyProcessor = defineProcessor(${/<script lang="(\w*)">\n([\s\S]+?)\n<\/script>/gu}, true);
exports.processors = { ".html": { ...processor, supportsAutofix: true }, "non-fixable": processor, "legacy": legacyProcessor };
`,
  ),
  "test.md":
    '```js\nconsole.log("hello")\n```\n```html\n<div>Hello</div>\n<script lang="js">\n    console.log("hello")\n</script>\n<script lang="ts">\n    console.log("hello")\n</script>\n```\n',
};
const semi = on("semi");
const both = { plugins: ["markdown", "html"], ...semi };
const environment = text => pkg("eslint-plugin-foo", `module.exports = { environments: ${text} };\n`);

const environmentsAndProcessors = [
  environments("globals", {
    ".eslintrc.json": rc({ plugins: ["foo"], env: { "foo/e": true }, ...on("no-undef", "no-global-assign") }),
    ...environment("{ e: { globals: { zed: true, ro: false } } }"),
    "a.js": "zed = 1; ro = 1; nope;\n",
  }),
  environments("parserOptions", {
    ".eslintrc.json": rc({ plugins: ["foo"], env: { "foo/e": true } }),
    ...environment('{ e: { parserOptions: { ecmaVersion: 2015, sourceType: "module" } } }'),
    "a.js": "export const a = 1;\n",
  }),
  environments("false", {
    ".eslintrc.json": rc({ plugins: ["foo"], env: { "foo/e": false }, ...on("no-undef") }),
    ...environment("{ e: { globals: { zed: true } } }"),
    "a.js": "zed;\n",
  }),
  environments("of a plugin with a scope", {
    ".eslintrc.json": rc({ plugins: ["@s/foo", "@t"], env: { "@s/foo/e": true, "@t/e": true }, ...on("no-undef") }),
    ...pkg("@s/eslint-plugin-foo", "module.exports = { environments: { e: { globals: { zed: true } } } };\n"),
    ...pkg("@t/eslint-plugin", "module.exports = { environments: { e: { globals: { tee: true } } } };\n"),
    "a.js": "zed; tee; nope;\n",
  }),
  environments("that the plugin does not have", { ".eslintrc.json": rc({ plugins: ["foo"], env: { "foo/nope": true } }), ...environment("{}"), "a.js": code }),
  environments("of a plugin that `plugins` does not name", { ".eslintrc.json": rc({ env: { "foo/e": true } }), ...environment("{ e: {} }"), "a.js": code }),
  environments("without the prefix", { ".eslintrc.json": rc({ plugins: ["foo"], env: { e: true } }), ...environment("{ e: {} }"), "a.js": code }),
  environments("in a comment", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...on("no-undef") }),
    ...environment("{ e: { globals: { zed: true } } }"),
    "a.js": "/* eslint-env foo/e */\nzed; nope;\n",
  }),
  environments("--env with --plugin", { ".eslintrc.json": rc(on("no-undef")), ...environment("{ e: { globals: { zed: true } } }"), "a.js": "zed; nope;\n" }, [
    "--plugin",
    "foo",
    "--env",
    "foo/e",
    "a.js",
  ]),
  environments("switched on by a configuration of the plugin", {
    ".eslintrc.json": rc({ extends: "plugin:foo/rec", ...on("no-undef") }),
    ...pkg("eslint-plugin-foo", 'module.exports = { environments: { e: { globals: { zed: true } } }, configs: { rec: { plugins: ["foo"], env: { "foo/e": true } } } };\n'),
    "a.js": "zed; nope;\n",
  }),
  environments("in overrides", {
    ".eslintrc.json": rc({ plugins: ["foo"], ...on("no-undef"), overrides: [{ files: ["a.js"], env: { "foo/e": true } }] }),
    ...environment("{ e: { globals: { zed: true } } }"),
    "a.js": "zed;\n",
    "b.js": "zed;\n",
  }, ["a.js", "b.js"]),

  // cli-engine.js, "processors" and "multiple processors"
  environments("a processor for an extension works as soon as the plugin is named", { ".eslintrc.json": rc(both), ...markdownAndHtml }, ["test.md"]),
  environments("a directory does not find the .md", { ".eslintrc.json": rc(both), ...markdownAndHtml, "a.js": "a()\n" }, ["."]),
  environments("--ext .md finds it", { ".eslintrc.json": rc(both), ...markdownAndHtml, "a.js": "a()\n" }, ["--ext", ".js,.md", "."]),
  environments("--fix: only the JavaScript blocks", { ".eslintrc.json": rc(both), ...markdownAndHtml }, ["--fix", "test.md"]),
  environments("--ext html: the blocks in the blocks", { ".eslintrc.json": rc(both), ...markdownAndHtml }, ["--ext", "js,html", "test.md"]),
  environments("--ext html --fix", { ".eslintrc.json": rc(both), ...markdownAndHtml }, ["--ext", "js,html", "--fix", "test.md"]),
  environments("a processor without supportsAutofix: reported, not fixed", {
    ".eslintrc.json": rc({ ...both, overrides: [{ files: "*.html", processor: "html/non-fixable" }] }),
    ...markdownAndHtml,
  }, ["--ext", "js,html", "--fix", "test.md"]),
  environments("overrides for **/*.html/*.js", {
    ".eslintrc.json": rc({
      ...both,
      overrides: [
        { files: "*.html", rules: { semi: "off", "no-console": "off" } },
        { files: "**/*.html/*.js", rules: { semi: "off", "no-console": "error" } },
      ],
    }),
    ...markdownAndHtml,
  }, ["--ext", "js,html", "test.md"]),
  environments("a processor that returns texts: the blocks have the configuration of the file", {
    ".eslintrc.json": rc({
      ...both,
      overrides: [
        { files: "*.html", processor: "html/legacy", rules: { semi: "off", "no-console": "error" } },
        { files: "**/*.html/*.js", rules: { semi: "error", "no-console": "off" } },
      ],
    }),
    ...markdownAndHtml,
  }, ["--ext", "js,html", "test.md"]),
  environments("overrides with files make the blocks be linted", {
    ".eslintrc.json": rc({ ...both, overrides: [{ files: "*.html", processor: "html/.html" }, { files: "*.md", processor: "markdown/.md" }] }),
    ...markdownAndHtml,
  }, ["test.md"]),
  environments("a processor that the plugin does not have", { ".eslintrc.json": rc({ plugins: ["markdown", "html"], processor: "markdown/unknown" }), ...markdownAndHtml }, ["test.md"]),
  environments("a processor of a plugin that is missing", { ".eslintrc.json": rc({ processor: "nope/p" }), "a.js": code }),
  environments("a processor without a slash", { ".eslintrc.json": rc({ plugins: ["markdown"], processor: "markdown" }), ...markdownAndHtml }, ["test.md"]),
  environments("`processor` at the top is for all files", {
    ".eslintrc.json": rc({ plugins: ["foo"], processor: "foo/upper", ...on("no-undef") }),
    ...pkg("eslint-plugin-foo", 'exports.processors = { upper: { preprocess: text => [text.toUpperCase()], postprocess: lists => lists.flat() } };\n'),
    "a.js": "abc;\n",
  }),
  environments("postprocess may drop and change messages", {
    ".eslintrc.json": rc({ plugins: ["foo"], processor: "foo/p", ...on("eqeqeq", "no-var", "no-debugger") }),
    ...pkg("eslint-plugin-foo", 'exports.processors = { p: { preprocess: text => [text], postprocess: lists => lists.flat().filter(it => it.ruleId !== "no-var").map(it => ({ ...it, message: "[" + it.message + "]" })) } };\n'),
    "a.js": code,
  }),
  environments("a processor of a configuration of the plugin", {
    ".eslintrc.json": rc({ extends: "plugin:markdown/rec", ...semi }),
    ...markdownAndHtml,
    ...pkg(
      "eslint-plugin-markdown",
      `const { defineProcessor } = require("pattern-processor");
exports.processors = { markdown: defineProcessor(${/```(\w+)\n([\s\S]+?)\n```/gu}) };
exports.configs = { rec: { plugins: ["markdown"], overrides: [{ files: ["*.md"], processor: "markdown/markdown" }, { files: ["**/*.md/*.js"], rules: { "no-console": "error" } }] } };
`,
    ),
  }, ["."]),
  environments("a syntax error in a block", { ".eslintrc.json": rc(both), ...markdownAndHtml, "test.md": "```js\nvar = 1;\n```\n" }, ["test.md"]),
  environments("--stdin --stdin-filename test.md", { ".eslintrc.json": rc(both), ...markdownAndHtml }, ["--stdin", "--stdin-filename", "test.md"], { stdin: "```js\na()\n```\n" }),
];

const position = "{ start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }";
// Finds a `debugger` statement at the start of any text.
const standIn = `exports.parse = text => ({
  type: "Program", sourceType: "script", range: [0, text.length], loc: ${position}, comments: [],
  body: [{ type: "DebuggerStatement", range: [0, 1], loc: ${position} }],
  tokens: [{ type: "Keyword", value: text[0], range: [0, 1], loc: ${position} }],
});
`;
// Says with which options it is called.
const telling = `exports.parse = (text, options) => {
  const { filePath, ...rest } = options;
  throw Object.assign(new SyntaxError(JSON.stringify({ file: require("path").basename(filePath), ...rest })), { lineNumber: 1, column: 0 });
};
`;
// What stands for a parser of npm: the parser of the ESLint that runs.
const espree = 'module.exports = require.main.require("espree");\n';

const theParser = [
  parser("./parser.js", { ".eslintrc.json": rc({ parser: "./parser.js", ...noDebugger }), "parser.js": standIn, "a.js": "@\n" }),
  parser("./parser finds parser.js", { ".eslintrc.json": rc({ parser: "./parser", ...noDebugger }), "parser.js": standIn, "a.js": "@\n" }),
  parser("a package", { ".eslintrc.json": rc({ parser: "my-parser", ...noDebugger }), ...pkg("my-parser", standIn), "a.js": "@\n" }),
  parser("a package with a scope", { ".eslintrc.json": rc({ parser: "@s/parser", ...noDebugger }), ...pkg("@s/parser", standIn), "a.js": "@\n" }),
  parser("an absolute path", { ".eslintrc.json": rc({ parser: "<dir>/tools/parser.js", ...noDebugger }), "tools/parser.js": standIn, "a.js": "@\n" }),
  parser("a path is relative to the file that says it", {
    ".eslintrc.json": rc({ extends: "./configs/base.json", ...noDebugger }),
    "configs/base.json": json({ parser: "./parser.js" }),
    "configs/parser.js": standIn,
    "a.js": "@\n",
  }),
  parser("a package is looked for from the file that says it", {
    ".eslintrc.json": rc({ extends: "one", ...noDebugger }),
    ...pkg("eslint-config-one", { parser: "my-parser" }),
    ...pkg("eslint-config-one/node_modules/my-parser", standIn),
    "a.js": "@\n",
  }),
  parser("of a configuration of a plugin: from the plugin", {
    ".eslintrc.json": rc({ extends: "plugin:foo/rec", ...noDebugger }),
    ...pkg("eslint-plugin-foo", 'module.exports = { configs: { rec: { parser: "my-parser" } } };\n'),
    ...pkg("eslint-plugin-foo/node_modules/my-parser", standIn),
    "a.js": "@\n",
  }),
  parser("of the child, from the child", {
    ".eslintrc.json": rc(noDebugger),
    "sub/.eslintrc.json": json({ parser: "./parser.js" }),
    "sub/parser.js": standIn,
    "sub/a.js": "@\n",
  }, ["sub/a.js"]),
  parser("in overrides", {
    ".eslintrc.json": rc({ ...noDebugger, overrides: [{ files: ["*.foo"], parser: "my-parser" }] }),
    ...pkg("my-parser", standIn),
    "a.foo": "@\n",
    "a.js": "x;\n",
  }, ["."]),
  parser("--parser: from the working directory", { ".eslintrc.json": rc(noDebugger), "sub/parser.js": standIn, "sub/a.js": "@\n" }, ["--parser", "./parser.js", "a.js"], { cwd: "sub" }),
  parser("--parser wins over the file", { ".eslintrc.json": rc({ parser: "nope", ...noDebugger }), ...pkg("my-parser", standIn), "a.js": "@\n" }, ["--parser", "my-parser", "a.js"]),
  parser("--parser: missing", { ".eslintrc.json": rc(), "a.js": code }, ["--parser", "nope-parser", "a.js"], { lines: 1 }),
  parser("espree, which the project does not have", { ".eslintrc.json": rc({ parser: "espree", ...eqeqeq }), "a.js": code }),
  parser("espree keeps the language of ESLint 8", { ".eslintrc.json": rc({ parser: "espree" }), "a.js": "let a;\n" }),
  parser("parseForESLint", {
    ".eslintrc.json": rc({ parser: "./parser.js", ...noDebugger }),
    "parser.js": `${standIn}const parse = exports.parse;\ndelete exports.parse;\nexports.parseForESLint = text => ({ ast: parse(text) });\n`,
    "a.js": "@\n",
  }),
  parser("parserServices reach the rules", {
    ".eslintrc.json": rc({ parser: "./parser.js", plugins: ["show"], rules: { "show/it": "error" } }),
    "parser.js": `${standIn}const parse = exports.parse;\nexports.parseForESLint = text => ({ ast: parse(text), services: { hello: () => "hello" } });\n`,
    ...show("it", "[context.parserServices.hello(), context.getSourceCode().parserServices.hello(), context.parserPath.endsWith('parser.js')]"),
    "a.js": "@\n",
  }),
  parser("the options that it gets", { ".eslintrc.json": rc({ parser: "./parser.js", parserOptions: { custom: [1], ecmaVersion: 2020 } }), "parser.js": telling, "a.js": code }),
  parser("the options that it gets without parserOptions", { ".eslintrc.json": rc({ parser: "./parser.js" }), "parser.js": telling, "a.js": code }),
  parser("the options that it gets with env: es2022 and node", { ".eslintrc.json": rc({ parser: "./parser.js", env: { es2022: true, node: true } }), "parser.js": telling, "a.js": code }),
  parser("the options that it gets with ecmaVersion: latest", { ".eslintrc.json": rc({ parser: "./parser.js", parserOptions: { ecmaVersion: "latest" } }), "parser.js": telling, "a.js": code }),
  parser("an error without a position", { ".eslintrc.json": rc({ parser: "./parser.js" }), "parser.js": 'exports.parse = () => { throw new Error("boom"); };\n', "a.js": code }),
  parser("missing", { ".eslintrc.json": rc({ parser: "nope-parser" }), "a.js": code }, undefined, { lines: 1 }),
  parser("missing: a path", { ".eslintrc.json": rc({ parser: "./nope.js" }), "a.js": code }, undefined, { lines: 1 }),
  parser("missing, named by a package", { ".eslintrc.json": rc({ extends: "one" }), ...pkg("eslint-config-one", { parser: "nope-parser" }), "a.js": code }, undefined, { lines: 1 }),
  parser("missing, and a later configuration names another", {
    ".eslintrc.json": rc({ extends: "./base.json", parser: "./parser.js", ...noDebugger }),
    "base.json": json({ parser: "nope-parser" }),
    "parser.js": standIn,
    "a.js": "@\n",
  }),
  parser("missing, in overrides that do not match", { ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["*.ts"], parser: "nope-parser" }] }), "a.js": code }),
  parser("it throws when it is loaded", { ".eslintrc.json": rc({ parser: "./parser.js" }), "parser.js": "throw new Error('boom');\n", "a.js": code }, undefined, { lines: 1 }),
  parser("null does not take back the parser of what is extended", { ".eslintrc.json": rc({ extends: "./base.json", parser: null, ...eqeqeq }), "base.json": json({ parser: "nope-parser" }), "a.js": code }, undefined, { lines: 1 }),
  parser("@typescript-eslint/parser, installed", {
    ".eslintrc.json": rc({ parser: "@typescript-eslint/parser", ...eqeqeq }),
    ...pkg("@typescript-eslint/parser", espree),
    "a.ts": code,
    "a.js": code,
  }, ["a.ts", "a.js"]),
  parser("@typescript-eslint/parser, not installed", { ".eslintrc.json": rc({ parser: "@typescript-eslint/parser", ...eqeqeq }), "a.ts": code }, ["a.ts"], { lines: 1 }),
  parser("@babel/eslint-parser, installed", { ".eslintrc.json": rc({ parser: "@babel/eslint-parser", parserOptions: { requireConfigFile: false }, ...eqeqeq }), ...pkg("@babel/eslint-parser", espree), "a.js": code }),
  parser("@babel/eslint-parser, not installed", { ".eslintrc.json": rc({ parser: "@babel/eslint-parser", ...eqeqeq }), "a.js": code }, undefined, { lines: 1 }),
  parser("@typescript-eslint: parser, plugin and plugin:@typescript-eslint/recommended, installed", {
    ".eslintrc.json": rc({ parser: "@typescript-eslint/parser", plugins: ["@typescript-eslint"], extends: ["plugin:@typescript-eslint/recommended"], ...eqeqeq }),
    ...pkg("@typescript-eslint/parser", espree),
    ...pkg("@typescript-eslint/eslint-plugin", 'module.exports = { rules: { "no-explicit-any": { create: () => ({}) } }, configs: { recommended: { rules: { "@typescript-eslint/no-explicit-any": "error" } } } };\n'),
    "a.ts": code,
  }, ["--ext", ".ts", "."]),
  parser("plugin:@typescript-eslint/recommended, not installed", { ".eslintrc.json": rc({ extends: ["plugin:@typescript-eslint/recommended"] }), "a.ts": code }, ["a.ts"]),
];

const es = (version, more = {}) => rc({ parserOptions: { ecmaVersion: version, ...more } });
// What came with which edition.
const editions = [
  [2015, "let a = 1;\n"],
  [2015, "const a = 1;\n"],
  [2015, "var f = () => 1;\n"],
  [2015, "var s = `a`;\n"],
  [2015, "class A {}\n"],
  [2015, "var { a } = b;\n"],
  [2015, "f(...a);\n"],
  [2015, "for (var a of b) {}\n"],
  [2015, "function* g() {}\n"],
  [2015, "function f(a = 1) {}\n"],
  [2015, "var o = { a, [b]: 1, c() {} };\n"],
  [2015, "var n = 0b1 + 0o7;\n"],
  [2015, "var r = /a/u;\n"],
  [2016, "a ** 2;\n"],
  [2017, "async function f() { await 1; }\n"],
  [2017, "f(a, b,);\n"],
  [2018, "var a = { ...b };\n"],
  [2018, "var r = /(?<a>b)(?<=c)/s;\n"],
  [2019, "try {} catch {}\n"],
  [2020, "a ?? b?.c;\n"],
  [2020, "var n = 1n;\n"],
  [2020, "import('a');\n"],
  [2021, "a ??= 1_000;\n"],
  [2022, "class A { #a = 1; static {} }\n"],
  [2022, "var r = /a/d;\n"],
  [2024, "var r = /[a--b]/v;\n"],
];

const theLanguage = [
  ...editions.map(([, text]) => language(`without a version: ${text.trim()}`, { ".eslintrc.json": rc(), "a.js": text })),
  ...editions
    .filter(([version], index) => version > 2015 && editions.findIndex(it => it[0] === version) === index)
    .flatMap(([version, text]) => [
      language(`ecmaVersion ${version - 1}: ${text.trim()}`, { ".eslintrc.json": es(version - 1), "a.js": text }),
      language(`ecmaVersion ${version}: ${text.trim()}`, { ".eslintrc.json": es(version), "a.js": text }),
    ]),
  language("what ES5 has: a comma at the end, keywords as names of properties, getters", { ".eslintrc.json": rc(), "a.js": "var o = { class: 1, get a() { return 1; }, };\no.class;\n" }),
  language("ecmaVersion 3: keywords as names of properties", { ".eslintrc.json": es(3), "a.js": "o.class;\n" }),
  language("ecmaVersion 3 with allowReserved", { ".eslintrc.json": es(3, { allowReserved: true }), "a.js": "var abstract = 1;\n" }),
  language("ecmaVersion 5 with allowReserved", { ".eslintrc.json": es(5, { allowReserved: true }), "a.js": "var a = 1;\n" }),
  language("ecmaVersion 6 is 2015", { ".eslintrc.json": es(6), "a.js": "const a = 1; a ** 2;\n" }),
  language("ecmaVersion 13 is 2022", { ".eslintrc.json": es(13), "a.js": "class A { #a = 1; }\n" }),
  language("ecmaVersion latest", { ".eslintrc.json": es("latest"), "a.js": "var r = /[a--b]/v;\n" }),
  language("ecmaVersion 2025 does not exist", { ".eslintrc.json": es(2025), "a.js": "var a;\n" }),
  language("ecmaVersion 4 does not exist", { ".eslintrc.json": es(4), "a.js": "var a;\n" }),
  language("ecmaVersion as a string", { ".eslintrc.json": es("2015"), "a.js": "let a;\n" }),
  language("env: es6 sets the version", { ".eslintrc.json": rc({ env: { es6: true }, ...on("no-undef") }), "a.js": "const a = new Promise(() => {}); a ** 2;\n" }),
  language("env: es2017", { ".eslintrc.json": rc({ env: { es2017: true }, ...on("no-undef") }), "a.js": "async function f() { new SharedArrayBuffer(); var a = { ...f }; }\n" }),
  language("env: es2020", { ".eslintrc.json": rc({ env: { es2020: true }, ...on("no-undef") }), "a.js": "BigInt(1) ?? globalThis; a ??= 1;\n" }),
  language("env: es2021", { ".eslintrc.json": rc({ env: { es2021: true }, ...on("no-undef") }), "a.js": "a ??= new WeakRef({}); var a;\n" }),
  language("env: es2024", { ".eslintrc.json": rc({ env: { es2024: true } }), "a.js": "var r = /[a--b]/v;\n" }),
  language("env: es2025 does not exist", { ".eslintrc.json": rc({ env: { es2025: true } }), "a.js": "var a;\n" }),
  language("env: es6 is false", { ".eslintrc.json": rc({ env: { es6: false } }), "a.js": "let a;\n" }),
  language("parserOptions win over env", { ".eslintrc.json": rc({ env: { es2021: true }, parserOptions: { ecmaVersion: 5 } }), "a.js": "let a;\n" }),
  language("of two env the later in the file wins", { ".eslintrc.json": rc({ env: { es2021: true, es6: true } }), "a.js": "a ?? b;\n" }),
  language("a version does not bring the globals of that edition", { ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022 }, ...on("no-undef") }), "a.js": "new Promise(() => {}); new Map(); Object; undefined;\n" }),
  language("env in a comment brings the syntax too", { ".eslintrc.json": rc(on("no-undef")), "a.js": "/* eslint-env es6 */\nnew Promise(function () {});\nlet a;\n" }),
  language("env: node allows return at the top", { ".eslintrc.json": rc({ env: { node: true } }), "a.js": "return;\n" }),
  language("env: commonjs allows return at the top", { ".eslintrc.json": rc({ env: { commonjs: true }, ...on("no-undef") }), "a.js": "module.exports = require('a');\nreturn;\n" }),
  language("env: browser does not", { ".eslintrc.json": rc({ env: { browser: true } }), "a.js": "return;\n" }),
  language("globalReturn", { ".eslintrc.json": rc({ parserOptions: { ecmaFeatures: { globalReturn: true } } }), "a.js": "return;\n" }),
  language("impliedStrict", { ".eslintrc.json": rc({ parserOptions: { ecmaFeatures: { impliedStrict: true } } }), "a.js": "with (a) {}\n" }),
  language("a script is sloppy: with, octal numbers, delete of a name", { ".eslintrc.json": rc(), "a.js": "with (a) {}\nvar n = 017;\ndelete n;\n" }),
  language("'use strict' in a script", { ".eslintrc.json": rc(), "a.js": "'use strict';\nwith (a) {}\n" }),
  language("sourceType is script: import", { ".eslintrc.json": es(2022), "a.js": "import a from 'a';\n" }),
  language("sourceType is script: export", { ".eslintrc.json": es(2022), "a.js": "export var a = 1;\n" }),
  language("sourceType is script: await is a name, import.meta is not allowed", { ".eslintrc.json": es(2022), "a.js": "var await = 1;\nimport.meta;\n" }),
  language("sourceType is script: <!-- is a comment", { ".eslintrc.json": rc(), "a.js": "<!-- a\nvar a;\n" }),
  language("sourceType module", { ".eslintrc.json": es(2022, { sourceType: "module" }), "a.js": "import a from 'a';\nawait a;\n" }),
  language("sourceType module is strict", { ".eslintrc.json": es(2015, { sourceType: "module" }), "a.js": "with (a) {}\n" }),
  language("sourceType module without a version", { ".eslintrc.json": rc({ parserOptions: { sourceType: "module" } }), "a.js": "var a;\n" }),
  language("sourceType commonjs", { ".eslintrc.json": es(2022, { sourceType: "commonjs" }), "a.js": "return;\n" }),
  language("sourceType nonsense", { ".eslintrc.json": es(2022, { sourceType: "nonsense" }), "a.js": "var a;\n" }),
  language(".mjs and .cjs are what the configuration says", { ".eslintrc.json": es(2022), "a.mjs": "import a from 'a';\n", "a.cjs": "import a from 'a';\n" }, ["a.mjs", "a.cjs"]),
  language("type: module in package.json says nothing", { "package.json": json({ type: "module" }), ".eslintrc.json": es(2022), "a.js": "import a from 'a';\n" }),
  language("jsx", { ".eslintrc.json": es(2022, { ecmaFeatures: { jsx: true } }), "a.js": "var a = <b/>;\n" }),
  language("jsx in ES5", { ".eslintrc.json": rc({ parserOptions: { ecmaFeatures: { jsx: true } } }), "a.js": "var a = <b c={1}>d</b>;\n" }),
  language("no jsx", { ".eslintrc.json": es(2022), "a.js": "var a = <b/>;\n" }),
  language("no jsx in a .jsx", { ".eslintrc.json": es(2022), "a.jsx": "var a = <b/>;\n" }, ["a.jsx"]),
  language("a .ts is JavaScript", { ".eslintrc.json": es(2022), "a.ts": "var a: number = 1;\n" }, ["a.ts"]),
  language("a shebang", { ".eslintrc.json": rc(eqeqeq), "a.js": `#!/usr/bin/env node\n${code}` }),
  language("--parser-options over the file", { ".eslintrc.json": es(2015), "a.js": "a ** 2;\n" }, ["--parser-options", "ecmaVersion:2016", "a.js"]),
  language("--parser-options ecmaVersion:6, a feature of 7", { "a.js": "a ** 2;\n" }, ["--no-eslintrc", "--parser-options", "ecmaVersion:6", "a.js"]),
  language("--no-eslintrc: the version is 5", { "a.js": "let a;\n" }, ["--no-eslintrc", "a.js"]),
  language("--env es6", { "a.js": "let a;\n" }, ["--no-eslintrc", "--env", "es6", "a.js"]),
  language("in overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["b.js"], parserOptions: { ecmaVersion: 2015 } }] }), "a.js": "let a;\n", "b.js": "let a;\n" }, ["a.js", "b.js"]),
  language("rules see the version: no-redeclare of a builtin, strict, no-implicit-globals", {
    ".eslintrc.json": rc(on("no-redeclare", "strict", "no-implicit-globals", "no-unused-vars")),
    "a.js": "var Object = 1, Promise = 2;\nfunction f() {}\n",
  }),
  language("rules do not run on a file with a syntax error", { ".eslintrc.json": rc(on("eqeqeq", "no-var")), "a.js": `${code}let a;\n` }),
  language("--exit-on-fatal-error", { ".eslintrc.json": rc(), "a.js": "let a;\n", "b.js": code }, ["--exit-on-fatal-error", "a.js", "b.js"]),
];

const rulesThatDoNotExist = [
  unknownRule("error", { ".eslintrc.json": rc(on("no-such-rule")), "a.js": code }),
  unknownRule("warn", { ".eslintrc.json": rc({ rules: { "no-such-rule": "warn" } }), "a.js": code }),
  unknownRule("off", { ".eslintrc.json": rc({ rules: { "no-such-rule": "off" } }), "a.js": code }),
  unknownRule("with options", { ".eslintrc.json": rc({ rules: { "no-such-rule": ["error", { a: 1 }] } }), "a.js": code }),
  unknownRule("in every file, beside the other messages", { ".eslintrc.json": rc(on("no-such-rule", "eqeqeq")), "a.js": code, "b.js": "\n\nvar a;\n" }, ["a.js", "b.js"]),
  unknownRule("in an empty file", { ".eslintrc.json": rc(on("no-such-rule")), "a.js": "" }),
  unknownRule("in a file with a syntax error", { ".eslintrc.json": rc(on("no-such-rule")), "a.js": "var = 1;\n" }),
  unknownRule("eslint-disable of it is one more message", { ".eslintrc.json": rc(on("no-such-rule")), "a.js": `/* eslint-disable no-such-rule */\n${code}` }),
  unknownRule("--rule", { ".eslintrc.json": rc(), "a.js": code }, ["--rule", "no-such-rule: error", "a.js"]),
  unknownRule("in a comment", { ".eslintrc.json": rc(), "a.js": `var a;\n  /* eslint no-such-rule: "error" */\n${code}` }),
  unknownRule("--quiet keeps it, --max-warnings does not count it", { ".eslintrc.json": rc({ rules: { "no-such-rule": "warn", "no-var": "warn" } }), "a.js": code }, ["--quiet", "a.js"]),
  unknownRule("a rule that was removed and replaced", { ".eslintrc.json": rc(on("no-comma-dangle", "space-return-throw-case", "generator-star")), "a.js": code }),
  unknownRule("rules that came after 8.57.1", { ".eslintrc.json": rc(on("no-useless-assignment", "no-unassigned-vars", "preserve-caught-error")), "a.js": code }),
  unknownRule("a rule of a plugin that is built into bun lint and not named by `plugins`", { ".eslintrc.json": rc(on("react-hooks/rules-of-hooks", "import/no-cycle", "n/no-missing-import", "@typescript-eslint/no-explicit-any")), "a.js": code }),
];

const directives =
  "/* eslint-disable */\n/* eslint-enable */\nvar a; // eslint-disable-line\n// eslint-disable-next-line eqeqeq\nvar b;\n/* eslint eqeqeq: 0 */\n/* global c */\n/* globals d */\n/* exported e */\n/* eslint-env node */\n/* a comment */\n";

const noInlineConfiguration = [
  noInlineConfig("eslint-disable has no effect and is warned about", { ".eslintrc.json": rc({ ...eqeqeq, noInlineConfig: true }), "a.js": `/* eslint-disable */\n${code}` }),
  noInlineConfig("every kind of comment", { ".eslintrc.json": rc({ noInlineConfig: true }), "a.js": directives }),
  noInlineConfig("the name of a .yml", { ".eslintrc.yml": "root: true\nnoInlineConfig: true\n", "a.js": "/* globals foo */\n" }),
  noInlineConfig("the name of a package that is extended", { ".eslintrc.yml": "root: true\nextends: foo\n", ...pkg("eslint-config-foo", { noInlineConfig: true }), "a.js": "/* globals foo */\n" }),
  noInlineConfig("the name of a file that is extended", { ".eslintrc.json": rc({ extends: "./configs/base.json" }), "configs/base.json": json({ noInlineConfig: true }), "a.js": "/* globals foo */\n" }),
  noInlineConfig("the name of a file in a directory", { ".eslintrc.json": rc(), "sub/.eslintrc.json": json({ noInlineConfig: true }), "sub/a.js": "/* globals foo */\n" }, ["sub/a.js"]),
  noInlineConfig("the name of overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["b.js"] }, { files: ["a.js"], noInlineConfig: true }] }), "a.js": "/* globals foo */\n", "b.js": "/* globals foo */\n" }, ["a.js", "b.js"]),
  noInlineConfig("the name of -c", { "other.json": json({ noInlineConfig: true }), "a.js": "/* globals foo */\n" }, ["--no-eslintrc", "-c", "other.json", "a.js"]),
  noInlineConfig("the name of package.json", { "package.json": json({ eslintConfig: { root: true, noInlineConfig: true } }), "a.js": "/* globals foo */\n" }),
  noInlineConfig("false in the child", { ".eslintrc.json": rc({ ...eqeqeq, noInlineConfig: true }), "sub/.eslintrc.json": json({ noInlineConfig: false }), "sub/a.js": `/* eslint-disable */\n${code}` }, ["sub/a.js"]),
  noInlineConfig("--no-inline-config does not warn", { ".eslintrc.json": rc(eqeqeq), "a.js": `/* eslint-disable */\n${code}` }, ["--no-inline-config", "a.js"]),
  noInlineConfig("--no-inline-config with noInlineConfig", { ".eslintrc.json": rc({ ...eqeqeq, noInlineConfig: true }), "a.js": `/* eslint-disable */\n${code}` }, ["--no-inline-config", "a.js"]),
  noInlineConfig("with reportUnusedDisableDirectives", { ".eslintrc.json": rc({ noInlineConfig: true, reportUnusedDisableDirectives: true }), "a.js": "/* eslint-disable eqeqeq */\n" }),
];

const withoutAConfiguration = [
  noConfiguration("nothing at all", { "a.js": code }),
  noConfiguration("nothing at all, a directory", { "a.js": code }, ["."]),
  noConfiguration("nothing at all, in a directory below", { "sub/a.js": code }, ["sub/a.js"]),
  noConfiguration("a package.json without eslintConfig", { "package.json": "{}", "a.js": code }),
  noConfiguration("a package.json without eslintConfig in the home directory", { "home/package.json": "{}", "work/a.js": code }, ["a.js"], { cwd: "work", home: "home" }),
  noConfiguration("one of two files has one", { "one/.eslintrc.json": rc(eqeqeq), "one/a.js": code, "two/a.js": code }, ["one/a.js", "two/a.js"]),
  noConfiguration("--stdin", {}, ["--stdin"], { stdin: code }),
  noConfiguration("--no-eslintrc", { "a.js": code }, ["--no-eslintrc", "a.js"]),
  noConfiguration("--rule", { "a.js": code }, ["--rule", "eqeqeq: error", "a.js"]),
  noConfiguration("--env", { "a.js": code }, ["--env", "node", "a.js"]),
  noConfiguration("--global", { "a.js": code }, ["--global", "a", "a.js"]),
  noConfiguration("--parser-options", { "a.js": code }, ["--parser-options", "ecmaVersion:2015", "a.js"]),
  noConfiguration("--parser espree", { "a.js": code }, ["--parser", "espree", "a.js"]),
  noConfiguration("--plugin", { ...foo, "a.js": code }, ["--plugin", "foo", "a.js"]),
  noConfiguration("--ignore-pattern", { "a.js": code, "b.js": code }, ["--ignore-pattern", "b.js", "a.js"]),
  noConfiguration("--ext", { "a.js": code }, ["--ext", ".js", "."]),
  noConfiguration("--rulesdir", { "rules/no-x.js": `module.exports = ${rule()};\n`, "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  noConfiguration("--resolve-plugins-relative-to", { "a.js": code }, ["--resolve-plugins-relative-to", ".", "a.js"]),
  noConfiguration("--ignore-path", { "ig": "b.js\n", "a.js": code }, ["--ignore-path", "ig", "a.js"]),
  noConfiguration("--no-inline-config, --quiet, --max-warnings, --fix-dry-run", { "a.js": code }, ["--no-inline-config", "--quiet", "--max-warnings", "0", "--fix-dry-run", "a.js"]),
  noConfiguration("an .eslintignore alone", { ".eslintignore": "b.js\n", "a.js": code }),
  noConfiguration("-c", { "other.json": json(eqeqeq), "a.js": code }, ["-c", "other.json", "a.js"]),
  noConfiguration("ESLINT_USE_FLAT_CONFIG=false", { "a.js": code }, undefined, { env: { ESLINT_USE_FLAT_CONFIG: "false" } }),
];

const ruleFile = (message = "no x") => `module.exports = ${rule(message)};\n`;

const directoriesOfRules = [
  rulesdir("a rule", { ".eslintrc.json": rc(on("no-x")), "rules/no-x.js": ruleFile(), "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("a rule that is a function", {
    ".eslintrc.json": rc(on("test")),
    "internal-rules/test.js": 'module.exports = context => ({ ExpressionStatement(node) { context.report({ node, message: "ok" }); } });\n',
    "test.js": "console.log('hello')\n",
  }, ["--rulesdir", "internal-rules", "test.js"]),
  rulesdir("two directories", { ".eslintrc.json": rc({ rules: { "no-x": "error", "no-y": "warn" } }), "one/no-x.js": ruleFile(), "two/no-y.js": ruleFile("no y"), "a.js": code }, [
    "--rulesdir",
    "one",
    "--rulesdir",
    "two",
    "a.js",
  ]),
  rulesdir("the same name in two directories: the later wins", { ".eslintrc.json": rc(on("no-x")), "one/no-x.js": ruleFile("one"), "two/no-x.js": ruleFile("two"), "a.js": code }, [
    "--rulesdir",
    "one",
    "--rulesdir",
    "two",
    "a.js",
  ]),
  rulesdir("relative to the working directory", { ".eslintrc.json": rc(on("no-x")), "sub/rules/no-x.js": ruleFile(), "sub/a.js": code }, ["--rulesdir", "rules", "a.js"], { cwd: "sub" }),
  rulesdir("an absolute path", { ".eslintrc.json": rc(on("no-x")), "rules/no-x.js": ruleFile(), "a.js": code }, ["--rulesdir", "<dir>/rules", "a.js"]),
  rulesdir("with --rule and --no-eslintrc", { "rules/no-x.js": ruleFile(), "a.js": code }, ["--no-eslintrc", "--rulesdir", "rules", "--rule", "no-x: 1", "a.js"]),
  rulesdir("a rule that is not in the directory", { ".eslintrc.json": rc(on("no-y")), "rules/no-x.js": ruleFile(), "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("only .js, and not the directories below", {
    ".eslintrc.json": rc(on("one", "two", "three", "four")),
    "rules/one.js": ruleFile("one"),
    "rules/two.cjs": ruleFile("two"),
    "rules/three.json": "{}",
    "rules/deep/four.js": ruleFile("four"),
    "a.js": "x;\n",
  }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("every file is loaded, also of rules that are off", { ".eslintrc.json": rc(on("no-x")), "rules/no-x.js": ruleFile(), "rules/broken.js": "throw new Error('boom');\n", "a.js": code }, ["--rulesdir", "rules", "a.js"], { lines: 1 }),
  rulesdir("a rule with the name of a core rule takes its place", { ".eslintrc.json": rc(eqeqeq), "rules/eqeqeq.js": ruleFile("mine"), "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("options are checked by the schema", {
    ".eslintrc.json": rc({ rules: { "no-x": ["error", 1] } }),
    "rules/no-x.js": 'module.exports = { meta: { schema: [{ type: "string" }] }, create: () => ({}) };\n',
    "a.js": code,
  }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("a rule requires a file beside the directory", { ".eslintrc.json": rc(on("no-x")), "rules/no-x.js": 'module.exports = require("../lib/rule");\n', "lib/rule.js": ruleFile(), "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("in a comment and eslint-disable", { ".eslintrc.json": rc(), "rules/no-x.js": ruleFile(), "a.js": "/* eslint no-x: 2 */\nx;\nx; // eslint-disable-line no-x\n" }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("--fix", {
    ".eslintrc.json": rc(on("no-x")),
    "rules/no-x.js": 'module.exports = { meta: { fixable: "code" }, create(context) { return { Identifier(node) { if (node.name === "x") context.report({ node, message: "no x", fix: fixer => fixer.replaceText(node, "y") }); } }; } };\n',
    "a.js": "x;\n",
  }, ["--rulesdir", "rules", "--fix", "a.js"]),
  rulesdir("the directory does not exist", { ".eslintrc.json": rc(), "a.js": code }, ["--rulesdir", "nope", "a.js"], { lines: 0 }),
  rulesdir("an empty directory", { ".eslintrc.json": rc(eqeqeq), "rules": null, "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("a file that exports nothing of a rule", { ".eslintrc.json": rc(on("no-x")), "rules/no-x.js": "module.exports = {};\n", "a.js": code }, ["--rulesdir", "rules", "a.js"], { lines: 1 }),
  rulesdir("a list with commas", { ".eslintrc.json": rc({ rules: { "no-x": "error", "no-y": "warn" } }), "one/no-x.js": ruleFile(), "two/no-y.js": ruleFile("no y"), "a.js": code }, ["--rulesdir", "one,two", "a.js"]),
  rulesdir("a file that exports null is no rule", { ".eslintrc.json": rc(on("no-x")), "rules/no-x.js": "module.exports = null;\n", "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("a file that exports null leaves the core rule", { ".eslintrc.json": rc(eqeqeq), "rules/eqeqeq.js": "module.exports = null;\n", "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("a function takes any options, whatever schema it has", {
    ".eslintrc.json": rc({ rules: { "no-x": ["error", 1, { a: 2 }] } }),
    "rules/no-x.js": 'module.exports = context => ({ Program(node) { context.report(node, JSON.stringify(context.options)); } });\nmodule.exports.schema = [{ type: "string" }];\n',
    "a.js": code,
  }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("schema beside meta", {
    ".eslintrc.json": rc({ rules: { "no-x": ["error", 1] } }),
    "rules/no-x.js": 'module.exports = { schema: [{ type: "string" }], create: () => ({}) };\n',
    "a.js": code,
  }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("without a schema any options are taken, and meta.defaultOptions means nothing", {
    ".eslintrc.json": rc({ rules: { one: ["error", 1, 2], two: "error" } }),
    "rules/one.js": 'module.exports = { meta: { defaultOptions: ["d"] }, create: context => ({ Program(node) { context.report(node, JSON.stringify(context.options)); } }) };\n',
    "rules/two.js": 'module.exports = require("./one");\n',
    "a.js": code,
  }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("a dot in the name", { ".eslintrc.json": rc(on("no.x")), "rules/no.x.js": ruleFile(), "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("in the place of a core rule, in a comment", { ".eslintrc.json": rc(), "rules/eqeqeq.js": ruleFile("mine"), "a.js": `/* eslint eqeqeq: 2 */\n${code}` }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("in the place of a rule of eslint:recommended", { ".eslintrc.json": rc({ extends: "eslint:recommended" }), "rules/no-debugger.js": ruleFile("mine"), "a.js": code }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("in the place of a core rule it has no options of that", {
    ".eslintrc.json": rc(on("no-inner-declarations", "no-unused-vars", "camelcase")),
    "rules/no-inner-declarations.js": 'module.exports = { meta: { schema: [] }, create: context => ({ Program(node) { context.report(node, JSON.stringify(context.options)); } }) };\n',
    "rules/no-unused-vars.js": 'module.exports = require("./no-inner-declarations");\n',
    "rules/camelcase.js": 'module.exports = require("./no-inner-declarations");\n',
    "a.js": "x;\n",
  }, ["--rulesdir", "rules", "a.js"]),
  rulesdir("for the files of all directories", {
    ".eslintrc.json": rc(),
    "sub/.eslintrc.json": json(on("no-x")),
    "other/.eslintrc.yml": "rules:\n  no-x: warn\n",
    "rules/no-x.js": ruleFile(),
    "a.js": code,
    "sub/a.js": code,
    "other/a.js": code,
  }, ["--rulesdir", "rules", "a.js", "sub", "other"]),
  rulesdir("it is a file", { ".eslintrc.json": rc(), "a.js": code }, ["--rulesdir", "a.js", "a.js"], { lines: 0 }),
  rulesdir("eslint-plugin-rulesdir: the .eslintrc.js tells the plugin where its rules are", {
    ".eslintrc.js": 'require("eslint-plugin-rulesdir").RULES_DIR = __dirname + "/rules";\nmodule.exports = { root: true, plugins: ["rulesdir"], rules: { "rulesdir/no-x": "error", "rulesdir/fn": "error" } };\n',
    "sub/.eslintrc.json": json({ plugins: ["rulesdir"], rules: { "rulesdir/no-x": "warn" } }),
    ...pkg("eslint-plugin-rulesdir", 'const fs = require("fs"), path = require("path");\nlet rules;\nmodule.exports = {\n  get rules() {\n    const directory = module.exports.RULES_DIR;\n    if (typeof directory !== "string") throw new Error("To use eslint-plugin-rulesdir, you must load it beforehand and set the `RULES_DIR` property on the module to a string or an array of strings.");\n    return (rules = rules || Object.fromEntries(fs.readdirSync(directory).map(file => [file.slice(0, -3), require(path.resolve(directory, file))])));\n  },\n};\n'),
    "rules/no-x.js": ruleFile(),
    "rules/fn.js": 'module.exports = context => ({ Program(node) { context.report(node, "fn"); } });\n',
    "a.js": code,
    "sub/a.js": code,
  }, ["a.js", "sub/a.js"]),
];

// One line for each rule that is in eslint:recommended of only one of ESLint 8 and ESLint 10.
const recommended =
  "var a = 1;;\nfunction f() {\n\t  return a;\n}\nif (a) { function g() {} }\nvar s = new Symbol();\nvar b = a + 1 ?? 2;\nclass A { #p = 1; static {} }\nvar n = new BigInt(1);\nvar u = 1; u = 2;\ntry { f(); } catch (e) { throw new Error('x'); }\nvar w; w();\ng(s, b, n, A);\n";

const whatESLint8Has = [
  presets("eslint:recommended", { ".eslintrc.json": rc({ extends: "eslint:recommended" }), "a.js": code }),
  presets("eslint:recommended, where that of ESLint 10 differs", { ".eslintrc.json": rc({ extends: "eslint:recommended", env: { es2022: true } }), "a.js": recommended }),
  presets("eslint:recommended, all its rules", { ".eslintrc.json": rc({ extends: "eslint:recommended" }), "a.js": code }, ["--print-config", "a.js"]),
  presets("eslint:all", { ".eslintrc.json": rc({ extends: "eslint:all" }), "a.js": "debugger;\n" }),
  presets("eslint:all on more code", { ".eslintrc.json": rc({ extends: "eslint:all", env: { es2022: true } }), "a.js": recommended }),
  presets("eslint:all, all its rules", { ".eslintrc.json": rc({ extends: "eslint:all" }), "a.js": code }, ["--print-config", "a.js"]),
  presets("eslint:all, then a rule off", { ".eslintrc.json": rc({ extends: "eslint:all", rules: { "no-debugger": "off", "eol-last": "off" } }), "a.js": "debugger;" }),
  presets("eslint:recommended in overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["a.js"], extends: "eslint:recommended" }] }), "a.js": code, "b.js": code }, ["a.js", "b.js"]),
  presets("rules that ESLint 9 removed: require-jsdoc, valid-jsdoc", { ".eslintrc.json": rc(on("require-jsdoc", "valid-jsdoc")), "a.js": "function f(a) {}\n/**\n * @param {string} b\n */\nfunction g(a) {}\n" }),
  presets("formatting rules", { ".eslintrc.json": rc({ rules: { semi: "error", quotes: ["error", "single"], indent: ["error", 2], "comma-dangle": ["error", "always-multiline"], "no-extra-semi": "error" } }), "a.js": 'var a = "b"\nif (a) {\n    a = {\n  c: 1\n  };;\n}\n' }),
  presets("rules for Node.js that are deprecated: no-process-exit, no-path-concat, handle-callback-err", { ".eslintrc.json": rc(on("no-process-exit", "no-path-concat", "handle-callback-err", "no-sync", "global-require")), "a.js": "process.exit(1);\nvar p = __dirname + '/a';\nfunction f(err) { fs.readFileSync(p); require('a'); }\n" }),
  presets("the default options of 8: no-constant-condition and while (true)", { ".eslintrc.json": rc(on("no-constant-condition")), "a.js": "while (true) { f(); }\nfor (;;) { f(); }\nwhile (1) { f(); }\n" }),
  presets("the default options of 8: no-constant-condition, checkLoops: false", { ".eslintrc.json": rc({ rules: { "no-constant-condition": ["error", { checkLoops: false }] } }), "a.js": "while (true) { f(); }\nif (true) { f(); }\n" }),
  ...[on("no-async-promise-executor", "prefer-promise-reject-errors", "new-cap"), on("getter-return", "accessor-pairs"), on("no-undef")].map(rules =>
    presets(`rules that go by the name of a global: Promise, Symbol, BigInt, Reflect without env: ${Object.keys(rules.rules)[0]} ..`, {
      ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2020 }, ...rules }),
      "a.js": "new Promise(async (resolve, reject) => { reject(1); });\nPromise.reject(2);\nvar s = Symbol('a'), b = BigInt(1);\nReflect.defineProperty(s, 'c', { get() {} });\nReflect.defineProperty(b, 'd', { set(e) {} });\n",
    }),
  ),
  presets("the default options of 8: no-unused-vars and a caught error", { ".eslintrc.json": rc(on("no-unused-vars")), "a.js": "try { f(); } catch (e) {}\n" }),
  presets("the default options of 8: no-useless-computed-key in classes", { ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022 }, ...on("no-useless-computed-key") }), "a.js": "class A { ['a']() {} }\nvar o = { ['a']: 1 };\n" }),
  presets("the default options of 8: no-inner-declarations", { ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022 }, ...on("no-inner-declarations") }), "a.js": "if (a) { function f() {} }\n'use strict';\n" }),
  presets("the default options of 8: no-implicit-coercion, no-sequences, camelcase, no-shadow-restricted-names", {
    ".eslintrc.json": rc(on("no-implicit-coercion", "no-sequences", "camelcase", "no-shadow-restricted-names", "no-empty-function", "radix")),
    "a.js": "var a_b = !!c, d = -(-e), f = (1, 2);\nfunction g(undefined) {}\nvar globalThis = parseInt('1');\n",
  }),
];

// cascading-config-array-factory.js, "deprecation warnings" and "personal config file within home directory"
const home = {
  ".eslintrc.json": json(eqeqeq),
  "exist-with-root/.eslintrc.json": rc(noVar),
  "exist-with-root/a.js": code,
  "exist/.eslintrc.json": json(noVar),
  "exist/a.js": code,
  "not-exist/a.js": code,
};
const three = ["exist-with-root/a.js", "exist/a.js", "not-exist/a.js"];
const undef = rc(on("no-undef"));

const theCommandLine = [
  commandLine("~/.eslintrc.json, from ~", home, three, { home: "." }),
  commandLine("~/.eslintrc.json, from ~/subdir", { ".eslintrc.json": json(eqeqeq), ...under("subdir", { ...home, ".eslintrc.json": undefined }) }, three, { home: ".", cwd: "subdir" }),
  commandLine("~/.eslintrc.json, from beside ~", { "home/.eslintrc.json": json(eqeqeq), ...under("another", { ...home, ".eslintrc.json": undefined }) }, three, { home: "home", cwd: "another" }),
  commandLine("~/.eslintrc.yml", { "home/.eslintrc.yml": "rules:\n  eqeqeq: error\n", "work/a.js": code }, ["a.js"], { home: "home", cwd: "work" }),
  commandLine("~/package.json#eslintConfig", { "home/package.json": json({ eslintConfig: eqeqeq }), "work/a.js": code }, ["a.js"], { home: "home", cwd: "work" }),
  commandLine("~/.eslintrc.js", { "home/.eslintrc.js": js(eqeqeq), "work/a.js": code }, ["a.js"], { home: "home", cwd: "work" }),
  commandLine("~/.eslintrc.json is not read if the project has a file", { "home/.eslintrc.json": json(eqeqeq), "work/.eslintrc.json": json(noVar), "work/a.js": code }, ["a.js"], { home: "home", cwd: "work" }),
  commandLine("~/.eslintrc.json is not read with -c", { "home/.eslintrc.json": json(eqeqeq), "work/other.json": json(noVar), "work/a.js": code }, ["-c", "other.json", "a.js"], { home: "home", cwd: "work" }),
  commandLine("~/.eslintrc.json is not read with --no-eslintrc", { "home/.eslintrc.json": json(eqeqeq), "work/a.js": code }, ["--no-eslintrc", "a.js"], { home: "home", cwd: "work" }),
  commandLine("~/.eslintrc.json is read with --rule", { "home/.eslintrc.json": json(eqeqeq), "work/a.js": code }, ["--rule", "no-var: error", "a.js"], { home: "home", cwd: "work" }),
  commandLine("~/.eslintrc.json: overrides and ignorePatterns are relative to ~", {
    "home/.eslintrc.json": json({ overrides: [{ files: ["a.js"], ...eqeqeq }, { files: ["work/*.js"], ...noVar }], ignorePatterns: ["b.js"] }),
    "work/a.js": code,
    "work/b.js": code,
  }, ["."], { home: "home", cwd: "work" }),
  commandLine("~/.eslintrc.json is broken", { "home/.eslintrc.json": "{", "work/a.js": code }, ["a.js"], { home: "home", cwd: "work", lines: 1 }),
  commandLine("~/.eslintrc.json is broken and the project has a file", { "home/.eslintrc.json": "{", "work/.eslintrc.json": json(noVar), "work/a.js": code }, ["a.js"], { home: "home", cwd: "work" }),

  commandLine("--no-eslintrc", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["--no-eslintrc", "a.js"]),
  commandLine("--no-eslintrc: package.json is not read either", { "package.json": json({ eslintConfig: { root: true, ...eqeqeq } }), "a.js": code }, ["--no-eslintrc", "a.js"]),
  commandLine("--no-eslintrc: a broken file does not matter", { ".eslintrc.json": "{", "a.js": code }, ["--no-eslintrc", "a.js"]),
  commandLine("--no-eslintrc --rule", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["--no-eslintrc", "--rule", "no-var: error", "a.js"]),
  commandLine("--no-eslintrc -c", { ".eslintrc.json": rc(eqeqeq), "other.json": json(noVar), "a.js": code }, ["--no-eslintrc", "-c", "other.json", "a.js"]),
  commandLine("--no-eslintrc: .eslintignore is still read", { ".eslintignore": "b.js\n", "a.js": code, "b.js": code }, ["--no-eslintrc", "--rule", "eqeqeq: 2", "."]),
  commandLine("-c adds to .eslintrc", { ".eslintrc.json": rc(eqeqeq), "other.json": json(noVar), "a.js": code }, ["-c", "other.json", "a.js"]),
  commandLine("-c wins over .eslintrc", { ".eslintrc.json": rc(on("eqeqeq", "no-var")), "other.json": json({ rules: { eqeqeq: "off" } }), "a.js": code }, ["-c", "other.json", "a.js"]),
  commandLine("-c adds to the child and the parent", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json(noVar), "other.json": json(noDebugger), "sub/a.js": code }, ["-c", "other.json", "sub/a.js"]),
  commandLine("-c wins over the child and the parent", {
    ".eslintrc.json": rc(eqeqeq),
    "sub/.eslintrc.json": json(noVar),
    "other.json": json({ rules: { eqeqeq: "warn", "no-var": "off" } }),
    "sub/a.js": code,
  }, ["-c", "other.json", "sub/a.js"]),
  commandLine("--rule wins over -c, which wins over .eslintrc", {
    ".eslintrc.json": rc({ rules: { quotes: ["error", "single"] } }),
    "other.json": json({ rules: { quotes: ["error", "double"] } }),
    "a.js": "var a = 'b', c = \"d\", e = `f`;\n",
  }, ["-c", "other.json", "--rule", "quotes: [1, backtick]", "--parser-options", "ecmaVersion:6", "a.js"]),
  commandLine("--config=other.json", { "other.json": json(noVar), "a.js": code }, ["--config=other.json", "a.js"]),
  commandLine("-c with a .yml", { "other.yml": "rules:\n  no-var: error\n", "a.js": code }, ["-c", "other.yml", "a.js"]),
  commandLine("-c with a file of any other name is JSON or YAML", { "other.conf": "rules:\n  no-var: error\n", "a.js": code }, ["-c", "other.conf", "a.js"]),
  commandLine("-c with a package.json", { "configs/package.json": json({ eslintConfig: noVar }), "a.js": code }, ["-c", "configs/package.json", "a.js"]),
  commandLine("-c with a package.json without eslintConfig", { "configs/package.json": "{}", "a.js": code }, ["-c", "configs/package.json", "a.js"]),
  commandLine("-c: missing", { ".eslintrc.json": rc(), "a.js": code }, ["-c", "nope.json", "a.js"], { lines: 1 }),
  commandLine("-c: the name of a package is a path", { ...pkg("eslint-config-foo", eqeqeq), "a.js": code }, ["-c", "eslint-config-foo", "a.js"], { lines: 1 }),
  commandLine("-c: root in it does not stop the cascade", { ".eslintrc.json": rc(eqeqeq), "other.json": rc(noVar), "a.js": code }, ["-c", "other.json", "a.js"]),
  commandLine("-c: extends is relative to that file", { "configs/other.json": json({ extends: "./base.json" }), "configs/base.json": json(noVar), "a.js": code }, ["-c", "configs/other.json", "a.js"]),
  commandLine("-c: patterns of overrides are relative to the working directory", {
    "node_modules/myconf/.eslintrc.json": json({ overrides: [{ files: "foo/*.js", ...eqeqeq }] }),
    "node_modules/myconf/foo/test.js": "a == b\n",
    "foo/test.js": "a == b\n",
  }, ["--no-eslintrc", "--no-ignore", "-c", "node_modules/myconf/.eslintrc.json", "foo/test.js", "node_modules/myconf/foo/test.js"]),
  commandLine("-c: excludedFiles are relative to the working directory", {
    "node_modules/myconf/.eslintrc.json": json({ overrides: [{ files: "*", excludedFiles: "foo/*.js", ...eqeqeq }] }),
    "node_modules/myconf/foo/test.js": "a == b\n",
    "foo/test.js": "a == b\n",
  }, ["--no-eslintrc", "--no-ignore", "-c", "node_modules/myconf/.eslintrc.json", "foo/test.js", "node_modules/myconf/foo/test.js"]),
  commandLine("-c: ignorePatterns are relative to the working directory", {
    "node_modules/myconf/.eslintrc.json": json({ ignorePatterns: ["!/node_modules/myconf", "foo/*.js"], ...eqeqeq }),
    "node_modules/myconf/foo/test.js": "a == b\n",
    "foo/test.js": "a == b\n",
  }, ["--no-eslintrc", "-c", "node_modules/myconf/.eslintrc.json", "**/*.js"]),
  commandLine("-c from a directory below", { ".eslintrc.json": rc(eqeqeq), "other.json": json(noVar), "sub/a.js": code }, ["-c", "../other.json", "a.js"], { cwd: "sub" }),

  commandLine("--env", { ".eslintrc.json": undef, "a.js": "describe(); nope();\n" }, ["--env", "mocha", "a.js"]),
  commandLine("--env: a list, and twice", { ".eslintrc.json": undef, "a.js": "describe(); window; require; $;\n" }, ["--env", "mocha,browser", "--env", "node", "a.js"]),
  commandLine("--env: unknown", { ".eslintrc.json": rc(), "a.js": code }, ["--env", "nonsense", "a.js"]),
  commandLine("--env wins over env: false of the file", { ".eslintrc.json": rc({ env: { node: false }, ...on("no-undef") }), "a.js": "require;\n" }, ["--env", "node", "a.js"]),
  commandLine("without --env nothing of an environment is defined", { "a.js": "window; require; console; Object;\n" }, ["--no-eslintrc", "--rule", "no-undef: 2", "a.js"]),
  commandLine("--global", { ".eslintrc.json": undef, "a.js": "zed(); nope();\n" }, ["--global", "zed", "a.js"]),
  commandLine("--global is read-only, :true is writable, :false is a part of the name", { ".eslintrc.json": rc(on("no-undef", "no-global-assign")), "a.js": "a = 1; b = 1; c = 1;\n" }, ["--global", "a,b:true", "--global", "c:false", "a.js"]),
  commandLine("--global wins over the file", { ".eslintrc.json": rc({ globals: { a: "off" }, ...on("no-undef") }), "a.js": "a;\n" }, ["--global", "a", "a.js"]),
  commandLine("--parser-options", { ".eslintrc.json": rc(), "a.js": "const a = 1;\n" }, ["--parser-options", "ecmaVersion:2015", "a.js"]),
  commandLine("--parser-options: a list, and nested", { ".eslintrc.json": rc(), "a.js": "export const a = <b/>;\n" }, ["--parser-options", "ecmaVersion:2015,sourceType:module", "--parser-options", "ecmaFeatures:{jsx:true}", "a.js"]),
  commandLine("--parser-options: not key:value", { ".eslintrc.json": rc(), "a.js": code }, ["--parser-options", "test111", "a.js"]),
  commandLine("--rule: words, numbers, options", { ".eslintrc.json": rc(), "a.js": "var a = \"b\";\nif (a == null) {}\n" }, ["--rule", "quotes: [2, single]", "--rule", "eqeqeq: [warn, always, { null: ignore }]", "--rule", "no-var: 1", "a.js"]),
  commandLine("--rule: several in one", { ".eslintrc.json": rc(), "a.js": code }, ["--rule", "{ eqeqeq: 2, no-var: 1 }", "a.js"]),
  commandLine("--rule: JSON", { ".eslintrc.json": rc(), "a.js": code }, ["--rule", '{"eqeqeq": ["error", "always"]}', "a.js"]),
  commandLine("--rule: a severity alone keeps the options of the file", { ".eslintrc.json": rc({ rules: { eqeqeq: ["error", "smart"] } }), "a.js": "if (x == null) {}\nif (x == 1) {}\n" }, ["--rule", "eqeqeq: 1", "a.js"]),
  commandLine("--rule: off", { ".eslintrc.json": rc(on("eqeqeq", "no-var")), "a.js": code }, ["--rule", "eqeqeq: off", "a.js"]),
  commandLine("--rule wins over overrides of the file", { ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], ...eqeqeq }] }), "a.js": code }, ["--rule", "eqeqeq: 0", "a.js"]),
  commandLine("--report-unused-disable-directives", { ".eslintrc.json": rc(), "a.js": "/* eslint-disable eqeqeq */\n" }, ["--report-unused-disable-directives", "a.js"]),
  commandLine("--report-unused-disable-directives-severity warn", { ".eslintrc.json": rc(), "a.js": "/* eslint-disable eqeqeq */\n" }, ["--report-unused-disable-directives-severity", "warn", "a.js"]),
  commandLine("--report-unused-disable-directives-severity off over the file", { ".eslintrc.yml": "root: true\nreportUnusedDisableDirectives: true\n", "a.js": "/* eslint-disable eqeqeq */\n" }, ["--report-unused-disable-directives-severity", "off", "a.js"]),
  commandLine("--report-unused-disable-directives over the file: an error", { ".eslintrc.yml": "root: true\nreportUnusedDisableDirectives: true\n", "a.js": "/* eslint-disable eqeqeq */\n" }, ["--report-unused-disable-directives", "a.js"]),
  commandLine("--report-unused-disable-directives-severity nonsense", { ".eslintrc.json": rc(), "a.js": code }, ["--report-unused-disable-directives-severity", "nonsense", "a.js"], { lines: 1 }),
  commandLine("both --report-unused-disable-directives flags", { ".eslintrc.json": rc(), "a.js": code }, ["--report-unused-disable-directives", "--report-unused-disable-directives-severity", "warn", "a.js"]),
  commandLine("--stdin without a name has the configuration of the working directory", { ".eslintrc.json": rc(eqeqeq) }, ["--stdin"], { stdin: code }),
  commandLine("--stdin-filename: the cascade of that path", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json(noVar) }, ["--stdin", "--stdin-filename", "sub/a.js"], { stdin: code }),
  commandLine("--stdin-filename: overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["*.test.js"], ...eqeqeq }] }) }, ["--stdin", "--stdin-filename", "a.test.js"], { stdin: code }),
  commandLine("--stdin-filename: ignored", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["a.js"] }) }, ["--stdin", "--stdin-filename", "a.js"], { stdin: code }),
  commandLine("--stdin-filename: ignored, --no-ignore", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["a.js"] }) }, ["--stdin", "--stdin-filename", "a.js", "--no-ignore"], { stdin: code }),
  commandLine("--quiet", { ".eslintrc.json": rc({ rules: { eqeqeq: "error", "no-var": "warn" } }), "a.js": code }, ["--quiet", "a.js"]),
  commandLine("--max-warnings 0", { ".eslintrc.json": rc({ rules: { "no-var": "warn" } }), "a.js": code }, ["--max-warnings", "0", "a.js"]),
  commandLine("--max-warnings 1", { ".eslintrc.json": rc({ rules: { "no-var": "warn" } }), "a.js": code }, ["--max-warnings", "1", "a.js"]),
  commandLine("--fix", { ".eslintrc.json": rc(on("semi", "eqeqeq")), "a.js": "var a = 1\nif (a == 2) {}\n" }, ["--fix", "a.js"]),
  commandLine("--fix with the version 5: no-var is not fixed into a syntax error", { ".eslintrc.json": rc(on("no-var", "prefer-const")), "a.js": "var a = 1;\n" }, ["--fix", "a.js"]),
  commandLine("--fix-type without --fix", { ".eslintrc.json": rc(), "a.js": code }, ["--fix-type", "layout", "a.js"]),
  commandLine("--no-warn-ignored is a flag of the other system", { ".eslintrc.json": rc(), "a.js": code }, ["--no-warn-ignored", "a.js"], { lines: 1 }),
  commandLine("--no-config-lookup is a flag of the other system", { ".eslintrc.json": rc(), "a.js": code }, ["--no-config-lookup", "a.js"], { lines: 1 }),
  commandLine("a flag that does not exist", { ".eslintrc.json": rc(), "a.js": code }, ["--nonsense", "a.js"], { lines: 1 }),
];

const invalid = { rules: { eqeqeq: ["error", "sometimes"] } };

const theNamesInErrors = [
  texts("a rule's options: .eslintrc.json", { ".eslintrc.json": rc(invalid), "a.js": code }),
  texts("a rule's options: a file in a directory", { ".eslintrc.json": rc(), "sub/.eslintrc.yml": "rules:\n  eqeqeq: [error, sometimes]\n", "sub/a.js": code }, ["sub/a.js"]),
  texts("a rule's options: from a directory below", { ".eslintrc.json": rc(invalid), "sub/a.js": code }, ["a.js"], { cwd: "sub" }),
  texts("a rule's options: package.json", { "package.json": json({ eslintConfig: { root: true, ...invalid } }), "a.js": code }),
  texts("a rule's options: overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["*.ts"] }, { files: ["*.js"], ...invalid }] }), "a.js": code }),
  texts("a rule's options: overrides in overrides", { ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], overrides: [{ files: ["a.*"], ...invalid }] }] }), "a.js": code }),
  texts("a rule's options: overrides that do not match the file", { ".eslintrc.json": rc({ overrides: [{ files: ["*.ts"], ...invalid }] }), "a.js": code }),
  texts("a rule's options: a file that is extended", { ".eslintrc.json": rc({ extends: "./configs/base.json" }), "configs/base.json": json(invalid), "a.js": code }),
  texts("a rule's options: a package", { ".eslintrc.json": rc({ extends: "foo" }), ...pkg("eslint-config-foo", invalid), "a.js": code }),
  texts("a rule's options: a package by its short name with a scope", { ".eslintrc.json": rc({ extends: "@s/foo" }), ...pkg("@s/eslint-config-foo", invalid), "a.js": code }),
  texts("a rule's options: a package that a package extends", { ".eslintrc.json": rc({ extends: "one" }), ...pkg("eslint-config-one", { extends: "two/strict" }), ...pkg("eslint-config-two", invalid, "strict.js"), "a.js": code }),
  texts("a rule's options: overrides of a package that overrides extend", {
    ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], extends: "foo" }] }),
    ...pkg("eslint-config-foo", { overrides: [{ files: ["a.js"], ...invalid }] }),
    "a.js": code,
  }),
  texts("a rule's options: a configuration of a plugin", { ".eslintrc.json": rc({ extends: "plugin:eslint-plugin-foo/rec" }), ...pkg("eslint-plugin-foo", `module.exports = { configs: { rec: ${json(invalid)} } };\n`), "a.js": code }),
  texts("a rule's options: -c", { "other.json": json(invalid), "a.js": code }, ["--no-eslintrc", "-c", "other.json", "a.js"]),
  texts("a rule's options: what -c extends", { "configs/other.json": json({ extends: "./base.json" }), "configs/base.json": json(invalid), "a.js": code }, ["--no-eslintrc", "-c", "configs/other.json", "a.js"]),
  texts("a rule's options: --rule", { ".eslintrc.json": rc(), "a.js": code }, ["--rule", "eqeqeq: [2, sometimes]", "a.js"]),
  texts("a rule's options: ~/.eslintrc.json", { "home/.eslintrc.json": json(invalid), "work/a.js": code }, ["a.js"], { home: "home", cwd: "work" }),
  texts("a key: a package", { ".eslintrc.json": rc({ extends: "foo" }), ...pkg("eslint-config-foo", { nonsense: 1 }), "a.js": code }),
  texts("a key: overrides of a file that is extended", { ".eslintrc.json": rc({ extends: "./base.yml" }), "base.yml": "overrides:\n  - files: '*.js'\n    nonsense: 1\n", "a.js": code }),
  texts("a key: a configuration of a plugin", { ".eslintrc.json": rc({ extends: "plugin:foo/rec" }), ...pkg("eslint-plugin-foo", "module.exports = { configs: { rec: { nonsense: 1 } } };\n"), "a.js": code }),
  texts("an environment: a package", { ".eslintrc.json": rc({ extends: "foo" }), ...pkg("eslint-config-foo", { env: { nonsense: true } }), "a.js": code }),
  texts("a package that is missing: named by a file in a directory", { ".eslintrc.json": rc(), "sub/.eslintrc.json": json({ extends: "nope" }), "sub/a.js": code }, ["sub/a.js"]),
  texts("a package that is missing: named by a package that a package extends", { ".eslintrc.json": rc({ extends: "one" }), ...pkg("eslint-config-one", { extends: "two" }), ...pkg("eslint-config-two", { extends: "nope" }), "a.js": code }),
  texts("a package that is missing: named by -c", { "other.json": json({ extends: "nope" }), "a.js": code }, ["--no-eslintrc", "-c", "other.json", "a.js"]),
  texts("a plugin that is missing: named by a package", { ".eslintrc.json": rc({ extends: "y" }), ...pkg("eslint-config-y", { plugins: ["x"] }), "a.js": code }),
  texts("a plugin that is missing: named by overrides of a package", { ".eslintrc.json": rc({ extends: "y" }), ...pkg("eslint-config-y", { overrides: [{ files: ["*.js"], plugins: ["x"] }] }), "a.js": code }),
  texts("a plugin that is missing: named by a file in a directory", { ".eslintrc.json": rc(), "sub/.eslintrc.yml": "plugins: [x]\n", "sub/a.js": code }, ["sub/a.js"]),
  texts("a plugin that is missing: plugin:x/rec in a file in a directory", { ".eslintrc.json": rc(), "sub/.eslintrc.yml": "extends: plugin:x/rec\n", "sub/a.js": code }, ["sub/a.js"]),
  texts("a plugin that is missing: -c", { "configs/other.json": json({ plugins: ["x"] }), "a.js": code }, ["--no-eslintrc", "-c", "configs/other.json", "a.js"]),
  texts("a plugin that throws: named by a package", { ".eslintrc.json": rc({ extends: "y" }), ...pkg("eslint-config-y", { plugins: ["x"] }), ...pkg("eslint-plugin-x", "throw new Error('boom');\n"), "a.js": code }, undefined, { lines: 1 }),
  texts("a parser that is missing: overrides of a package", { ".eslintrc.json": rc({ extends: "y" }), ...pkg("eslint-config-y", { overrides: [{ files: ["*.js"], parser: "nope-parser" }] }), "a.js": code }, undefined, { lines: 1 }),
  texts("a processor that is missing: overrides", { ".eslintrc.json": rc({ plugins: ["foo"], overrides: [{ files: ["*.js"], processor: "foo/nope" }] }), ...empty("eslint-plugin-foo"), "a.js": code }),
  texts("a rule's options of a plugin's rule, the plugin comes by plugin:test/recommended", {
    ".eslintrc.json": rc({ extends: "plugin:test/recommended", rules: { "test/foo": ["error", "invalid-option"] } }),
    ...pkg("eslint-plugin-test", 'exports.configs = { recommended: { plugins: ["test"] } };\nexports.rules = { foo: { meta: { schema: [{ type: "number" }] }, create() { return {}; } } };\n'),
    "a.js": "console.log();\n",
  }),
];

const refused = (name, config, more) => validation(name, { ".eslintrc.json": rc(config), "a.js": code }, undefined, more);

const whatIsRefused = [
  refused("an unknown key", { nonsense: 1 }),
  refused("two unknown keys", { nonsense: 1, more: 2 }),
  refused("keys of the other system: files, ignores, languageOptions, linterOptions", { files: ["*.js"], ignores: [], languageOptions: {}, linterOptions: {} }),
  refused("root: a string", { root: "yes" }),
  refused("env: a list", { env: ["node"] }),
  refused("env: a string as a value is taken for true", { env: { node: "yes" } }),
  refused("env: unknown", { env: { nonsense: true } }),
  refused("env: unknown and false", { env: { nonsense: false } }),
  refused("globals: a list", { globals: ["a"] }),
  refused("globals: nonsense as a value", { globals: { a: "nonsense" } }),
  refused("rules: a list", { rules: ["eqeqeq"] }),
  refused("plugins: a string", { plugins: "foo" }),
  refused("plugins: a number in the list", { plugins: [1] }, { lines: 0 }),
  refused("plugins: an object", { plugins: { foo: {} } }),
  refused("parser: a number", { parser: 1 }),
  refused("parser: an object", { parser: {} }),
  refused("parserOptions: a string", { parserOptions: "es6" }),
  refused("settings: a list", { settings: [] }),
  refused("extends: a number", { extends: 1 }),
  refused("extends: a number in the list", { extends: [1] }),
  refused("extends: an object", { extends: {} }),
  refused("processor: a number", { processor: 1 }),
  refused("ignorePatterns: a number", { ignorePatterns: 1 }),
  refused("noInlineConfig: a string", { noInlineConfig: "yes" }),
  refused("reportUnusedDisableDirectives: a severity", { reportUnusedDisableDirectives: "error" }),
  refused("overrides: an object", { overrides: {} }),
  refused("overrides: without files", { overrides: [eqeqeq] }),
  refused("overrides: files is an empty list", { overrides: [{ files: [], ...eqeqeq }] }),
  refused("overrides: files is a number", { overrides: [{ files: 1 }] }),
  refused("overrides: root", { overrides: [{ files: ["*.js"], root: true }] }),
  refused("overrides: ignorePatterns", { overrides: [{ files: ["*.js"], ignorePatterns: ["b.js"] }] }),
  refused("overrides: an unknown key", { overrides: [{ files: ["*.js"], nonsense: 1 }] }),
  refused("overrides: a pattern that starts with /", { overrides: [{ files: ["/*.js"], ...eqeqeq }] }),
  refused("overrides: a pattern with ..", { overrides: [{ files: ["../**"], ...eqeqeq }] }),
  refused("overrides: excludedFiles with ..", { overrides: [{ files: ["*.js"], excludedFiles: ["a/../b.js"], ...eqeqeq }] }),
  refused("overrides: an absolute pattern", { overrides: [{ files: ["<dir>/a.js"], ...eqeqeq }] }),
  refused("a severity: a word", { rules: { eqeqeq: "loud" } }),
  refused("a severity: 3", { rules: { eqeqeq: 3 } }),
  refused("a severity: -1", { rules: { eqeqeq: -1 } }),
  refused("a severity: true", { rules: { eqeqeq: true } }),
  refused("a severity: null", { rules: { eqeqeq: null } }),
  refused("a severity: an object", { rules: { eqeqeq: { a: 1 } } }),
  refused("a severity: an empty list", { rules: { eqeqeq: [] } }),
  refused("a severity: a word in a list", { rules: { eqeqeq: ["loud", "always"] } }),
  refused("a severity: options without one", { rules: { eqeqeq: ["always"] } }),
  refused("a severity: the number as a string", { rules: { eqeqeq: "2" } }),
  refused("a severity of a rule that does not exist", { rules: { "no-such-rule": "loud" } }),
  refused("options: not one of the words", invalid),
  refused("options: too many", { rules: { "no-debugger": ["error", "x"] } }),
  refused("options: the wrong type", { rules: { "max-len": ["error", "wide"] } }),
  refused("options: an unknown property", { rules: { "no-unused-vars": ["error", { nonsense: true }] } }),
  refused("options: two things are wrong", { rules: { "no-unused-vars": ["error", { vars: "some", args: "few" }] } }),
  refused("options: a number below the minimum", { rules: { "max-depth": ["error", -1] } }),
  refused("options: twice the same in a list", { rules: { "no-restricted-globals": ["error", "a", "a"] } }),
  refused("options of a rule that is off are not looked at", { rules: { eqeqeq: ["off", "sometimes"] } }),
  refused("options of a rule that is off by 0 are not looked at", { rules: { eqeqeq: [0, "sometimes"], "no-var": "error" } }),
  refused("the first of two rules that are wrong is named", { rules: { "no-var": ["error", 1], eqeqeq: ["error", "sometimes"] } }),
  validation("options in a comment are a message", { ".eslintrc.json": rc(), "a.js": `var a;\n/* eslint eqeqeq: ["error", "sometimes"] */\n${code}` }),
  validation("a severity in a comment is a message", { ".eslintrc.json": rc(), "a.js": `/* eslint eqeqeq: "loud" */\n${code}` }),
  validation("a file in a directory of which no file is linted is not looked at", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintrc.json": json({ nonsense: 1 }), "sub/b.js": code, "a.js": code }),
  validation("a file in a directory that is ignored is not looked at", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["sub"] }), "sub/.eslintrc.json": json({ nonsense: 1 }), "sub/b.js": code, "a.js": code }, ["."]),
  validation("--rule: a severity", { ".eslintrc.json": rc(), "a.js": code }, ["--rule", "eqeqeq: loud", "a.js"]),
  validation("--rule: cannot be read", { ".eslintrc.json": rc(), "a.js": code }, ["--rule", "eqeqeq: [", "a.js"], { lines: 1 }),
  validation("--global a:nonsense is a name", { ".eslintrc.json": rc(), "a.js": code }, ["--global", "a:nonsense", "a.js"]),
];

const everywhere = each(["foo.js", "bar.js", "subdir/foo.js", "subdir/bar.js", "subdir/second/foo.js", "subdir/very/deep/foo.js"]);
const withDots = { ...everywhere, ...each([".dot.js", "subdir/.dot/foo.js"]) };
// config-array/override-tester.js: `files`, `excludedFiles`
const patterns = [
  [["foo.js"]],
  [["*"]],
  [["*.js"]],
  [["**/*.js"]],
  [["*.js"], ["foo.js"]],
  [["./foo.js"]],
  [["./*"]],
  [["./**"]],
  [["*"], ["foo.js"]],
  [["**/*.js"], ["foo.js"]],
  [["subdir/*.js"]],
  [["subdir/foo.js"]],
  [["subdir/*"]],
  [["subdir/**"]],
  [["./subdir/**"]],
  [["./subdir/*"]],
  [["*"], ["subdir/**"]],
  [["*.js"], ["subdir/**"]],
  [["subdir/**"], ["subdir/second/*"]],
  [["foo.js", "subdir/bar.js"]],
  [["*.js"], ["foo.js", "subdir/bar.js"]],
  [["subdir"]],
  [["subdir/"]],
  [["second/*.js"]],
  [["**/second/*.js"]],
  [["{foo,bar}.js"]],
  [["subdir/{second,very}/**"]],
  [["[fb]*.js"]],
  [["?oo.js"]],
  [["!(foo).js"]],
  [["+(foo|bar).js"]],
  [["!foo.js"]],
  [["FOO.js"]],
  [["**"], ["**/deep/**"]],
  [["foo.*"]],
  [["*.{js,ts}"], ["**/{second,very}/**"]],
];
const patternsAndDots = [[["*"]], [["*.js"]], [["**"]], [["subdir/**"]], [["foo.js"]], [[".*"]], [[".dot/*"]], [["**/.dot/**"]], [["*.js"], [".*"]], [["**"], ["**/.*/**"]]];
const title = (files, excludedFiles) => `files ${files.join(" ")}${excludedFiles ? `, excludedFiles ${excludedFiles.join(" ")}` : ""}`;

const theOverrides = [
  ...patterns.map(([files, excludedFiles]) =>
    overrides(title(files, excludedFiles), { ".eslintrc.json": rc({ overrides: [{ files, excludedFiles, ...eqeqeq }] }), ...everywhere }, Object.keys(everywhere)),
  ),
  ...patternsAndDots.map(([files, excludedFiles]) =>
    overrides(`dot files: ${title(files, excludedFiles)}`, { ".eslintrc.json": rc({ overrides: [{ files, excludedFiles, ...eqeqeq }] }), ...withDots }, [
      "--no-ignore",
      ...Object.keys(withDots),
    ]),
  ),
  overrides("files and excludedFiles as strings", { ".eslintrc.json": rc({ overrides: [{ files: "*.js", excludedFiles: "b.js", ...eqeqeq }] }), "a.js": code, "b.js": code }, ["a.js", "b.js"]),
  overrides("the later wins", { ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], ...eqeqeq }, { files: ["a.js"], rules: { eqeqeq: "off" } }] }), "a.js": code, "b.js": code }, ["a.js", "b.js"]),
  overrides("they win over the rules of the file", { ".eslintrc.json": rc({ overrides: [{ files: ["a.js"], rules: { eqeqeq: "off" } }], ...eqeqeq }), "a.js": code, "b.js": code }, ["a.js", "b.js"]),
  overrides("a severity alone keeps the options", { ".eslintrc.json": rc({ rules: { eqeqeq: ["error", "smart"] }, overrides: [{ files: ["*.js"], rules: { eqeqeq: "warn" } }] }), "a.js": "if (x == null) {}\nif (x == 1) {}\n" }),
  overrides("extends of a file inside", { ".eslintrc.json": rc({ overrides: [{ files: ["a.js"], extends: ["./base.json"] }] }), "base.json": json(eqeqeq), "a.js": code, "b.js": code }, ["a.js", "b.js"]),
  overrides("what is extended inside comes before the rules inside", { ".eslintrc.json": rc({ overrides: [{ files: ["a.js"], extends: ["./base.json"], rules: { eqeqeq: "off" } }] }), "base.json": json(on("eqeqeq", "no-var")), "a.js": code }),
  overrides("overrides in overrides: both have to match", {
    ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], overrides: [{ files: ["test/**"], ...eqeqeq }] }] }),
    "test/a.js": code,
    "lib/a.js": code,
    "test/a.ts": code,
  }, ["test/a.js", "lib/a.js", "test/a.ts"]),
  overrides("overrides in overrides, three deep, with excludedFiles", {
    ".eslintrc.json": rc({ overrides: [{ files: ["lib/**"], overrides: [{ files: ["*.js"], excludedFiles: ["*.min.js"], overrides: [{ files: ["**/a.*"], ...eqeqeq }] }] }] }),
    ...each(["lib/a.js", "lib/a.min.js", "lib/b.js", "a.js"]),
  }, ["lib", "a.js"]),
  overrides("env inside", { ".eslintrc.json": rc({ ...on("no-undef"), overrides: [{ files: ["a.js"], env: { mocha: true } }] }), "a.js": "describe();\n", "b.js": "describe();\n" }, ["a.js", "b.js"]),
  overrides("globals, parserOptions and settings inside", {
    ".eslintrc.json": rc({ ...on("no-undef"), overrides: [{ files: ["a.js"], globals: { zed: "readonly" }, parserOptions: { ecmaVersion: 2015 }, settings: { a: 1 } }] }),
    "a.js": "let a = zed; a;\n",
    "b.js": "var a = zed; a;\n",
  }, ["a.js", "b.js"]),
  overrides("dot files are matched", { ".eslintrc.json": rc({ overrides: [{ files: ["*.js"], ...on("no-unused-vars") }] }), ".test-target.js": "var a = 1;\n" }, ["--no-ignore", ".test-target.js"]),
  overrides("the path is relative to the file with the overrides, not the working directory", {
    "sub/.eslintrc.json": rc({ overrides: [{ files: ["lib/*.js"], ...eqeqeq }, { files: ["sub/lib/*.js"], ...noVar }] }),
    "sub/lib/a.js": code,
  }, ["sub/lib/a.js"]),
  overrides("a file above the file with the overrides is not matched by it", {
    ".eslintrc.json": rc(),
    "sub/.eslintrc.json": json({ overrides: [{ files: ["*.js"], ...eqeqeq }] }),
    "a.js": code,
    "sub/a.js": code,
  }, ["a.js", "sub/a.js"]),
  overrides("in a .yml", { ".eslintrc.yml": "root: true\noverrides:\n  - files: ['*.test.js']\n    rules:\n      eqeqeq: error\n", "a.js": code, "a.test.js": code }, ["a.js", "a.test.js"]),
  overrides("in package.json", { "package.json": json({ eslintConfig: { root: true, overrides: [{ files: "*.test.js", ...eqeqeq }] } }), "a.js": code, "a.test.js": code }, ["a.js", "a.test.js"]),

  // cli-engine.js, "'overrides[].files' adds lint targets"
  overrides("a directory finds what files match: foo/*.txt without **/ignore.txt", {
    ".eslintrc.json": rc({ overrides: [{ files: "foo/*.txt", excludedFiles: "**/ignore.txt" }] }),
    ...each(["foo/nested/test.txt", "foo/test.js", "foo/test.txt", "foo/ignore.txt", "bar/test.js", "bar/test.txt", "bar/ignore.txt", "test.js", "test.txt", "ignore.txt"], ""),
  }, ["."]),
  overrides("a pattern on the command line does not", {
    ".eslintrc.json": rc({ overrides: [{ files: "foo/*.txt", excludedFiles: "**/ignore.txt" }] }),
    ...each(["foo/nested/test.txt", "foo/test.js", "foo/test.txt", "bar/test.js", "test.js", "test.txt"], ""),
  }, ["**/*.js"]),
  overrides("a directory finds what files match: foo/**/*.txt", {
    ".eslintrc.json": rc({ overrides: [{ files: "foo/**/*.txt" }] }),
    ...each(["foo/nested/test.txt", "foo/test.js", "foo/test.txt", "bar/test.js", "bar/test.txt", "test.js", "test.txt"], ""),
  }, ["."]),
  overrides("a pattern that ends in * finds nothing more: foo/**/*", {
    ".eslintrc.json": rc({ overrides: [{ files: "foo/**/*" }] }),
    ...each(["foo/nested/test.txt", "foo/test.js", "foo/test.txt", "bar/test.js", "bar/test.txt", "test.js", "test.txt"], ""),
  }, ["."]),
  overrides("a directory finds what files of a package match", {
    ".eslintrc.json": rc({ extends: "foo" }),
    ...pkg("eslint-config-foo", { overrides: [{ files: "foo/**/*.txt" }] }),
    ...each(["foo/nested/test.txt", "foo/test.js", "foo/test.txt", "bar/test.js", "bar/test.txt", "test.js", "test.txt"], ""),
  }, ["."]),
  overrides("a directory finds what files of a configuration of a plugin match", {
    ".eslintrc.json": rc({ extends: "plugin:foo/bar" }),
    ...pkg("eslint-plugin-foo", `exports.configs = ${json({ bar: { overrides: [{ files: "foo/**/*.txt" }] } })};\n`),
    ...each(["foo/nested/test.txt", "foo/test.js", "foo/test.txt", "bar/test.js", "bar/test.txt", "test.js", "test.txt"], ""),
  }, ["."]),
  overrides("a directory finds *.ts, *.mjs, *.jsx by overrides", {
    ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["*.ts", "*.mjs"] }, { files: ["src/**/*.jsx"] }] }),
    ...each(["a.js", "a.ts", "a.mjs", "a.cjs", "a.jsx", "src/b.jsx", "src/deep/c.jsx"]),
  }, ["."]),
  overrides("a directory finds what the overrides of a child match, below the child", {
    ".eslintrc.json": rc(eqeqeq),
    "sub/.eslintrc.json": json({ overrides: [{ files: ["*.foo"] }] }),
    ...each(["a.foo", "sub/a.foo", "sub/deep/a.foo", "a.js"]),
  }, ["."]),
  overrides("--ext takes the place of .js and of what overrides find", { ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["*.foo"] }] }), ...each(["a.js", "a.foo", "a.bar"]) }, ["--ext", ".bar", "."]),
  overrides("*.{foo,bar} and *.f?o as what a directory finds", { ".eslintrc.json": rc({ ...eqeqeq, overrides: [{ files: ["*.{foo,bar}"] }, { files: ["*.b?z"] }] }), ...each(["a.js", "a.foo", "a.bar", "a.baz"]) }, ["."]),
];

const two = { "a.js": code, "b.js": code };
const four = each(["foo.js", "bar.js", "subdir/foo.js", "subdir/bar.js"], "");
const all = ["**/*.js"];

const whatIsIgnored = [
  ignores("ignorePatterns", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["b.js"] }), ...two }, ["."]),
  ignores("ignorePatterns: a file that is named gets a warning", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["b.js"] }), ...two }, ["a.js", "b.js"]),
  ignores("ignorePatterns: negated", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["*.js", "!a.js"] }), ...two }, ["."]),
  // cli-engine.js, "with ignorePatterns config"
  ignores("ignorePatterns: foo.js, a string", { ".eslintrc.json": rc({ ignorePatterns: "foo.js" }), ...four }, all),
  ignores("ignorePatterns: foo.js and /bar.js", { ".eslintrc.json": rc({ ignorePatterns: ["foo.js", "/bar.js"] }), ...four, "baz.js": "", "subdir/baz.js": "" }, all),
  ignores("ignorePatterns: !/node_modules/foo", {
    ".eslintrc.json": rc({ ignorePatterns: "!/node_modules/foo" }),
    ...each(["node_modules/foo/index.js", "node_modules/foo/.dot.js", "node_modules/bar/index.js", "foo.js"], ""),
  }, all),
  ignores("ignorePatterns: !.eslintrc.js", { ".eslintrc.js": js({ root: true, ignorePatterns: "!.eslintrc.js" }), "foo.js": "" }, all),
  ignores(".eslintignore ignores again what ignorePatterns let in", { ".eslintrc.js": js({ root: true, ignorePatterns: "!.*" }), ".eslintignore": ".foo*", ".foo.js": "", ".bar.js": "" }, all),
  ignores(".eslintignore lets in what ignorePatterns ignore", { ".eslintrc.js": js({ root: true, ignorePatterns: "*.js" }), ".eslintignore": "!foo.js", "foo.js": "", "bar.js": "" }, all),
  ignores("ignorePatterns of a child are for its directory", {
    ".eslintrc.json": rc({ ignorePatterns: "foo.js" }),
    "subdir/.eslintrc.json": json({ ignorePatterns: "bar.js" }),
    ...four,
    "subdir/subsubdir/foo.js": "",
    "subdir/subsubdir/bar.js": "",
  }, all),
  ignores("ignorePatterns of a child let in what the parent ignores", { ".eslintrc.json": rc({ ignorePatterns: "foo.js" }), "subdir/.eslintrc.json": json({ ignorePatterns: "!foo.js" }), "foo.js": "", "subdir/foo.js": "" }, all),
  ignores(".eslintignore lets in what a child ignores", { ".eslintrc.json": rc(), "subdir/.eslintrc.json": json({ ignorePatterns: "*.js" }), ".eslintignore": "!foo.js", "foo.js": "", "subdir/foo.js": "", "subdir/bar.js": "" }, all),
  ignores("root in a child: the ignorePatterns of the parent are not used", { ".eslintrc.json": rc({ ignorePatterns: "foo.js" }), "subdir/.eslintrc.json": rc({ ignorePatterns: "bar.js" }), ...four }, all),
  ignores("root in a child: .eslintignore is used", { ".eslintrc.json": rc(), "subdir/.eslintrc.json": rc({ ignorePatterns: "bar.js" }), ".eslintignore": "foo.js", ...four }, all),
  ignores("ignorePatterns of a package", { ".eslintrc.json": rc({ extends: "one" }), ...pkg("eslint-config-one", { ignorePatterns: "foo.js" }), "foo.js": "", "bar.js": "" }, all),
  ignores("ignorePatterns of a package are relative to the file of the project", { ".eslintrc.json": rc({ extends: "one" }), ...pkg("eslint-config-one", { ignorePatterns: "/foo.js" }), "foo.js": "", "subdir/foo.js": "" }, all),
  ignores("the file lets in what the package ignores", { ".eslintrc.json": rc({ extends: "one", ignorePatterns: "!bar.js" }), ...pkg("eslint-config-one", { ignorePatterns: "*.js" }), "foo.js": "", "bar.js": "" }, all),
  ignores("--no-ignore: ignorePatterns are not used", { ".eslintrc.json": rc({ ignorePatterns: "*.js" }), "foo.js": "" }, ["--no-ignore", ...all]),
  ignores("the directory that is named is not ignored by what is above it", { ".eslintrc.json": json({ ignorePatterns: ["/sub"] }), "sub/.eslintrc.json": rc(eqeqeq), "sub/a.js": code }, ["."], { cwd: "sub" }),
  ignores("the directory that is named is not ignored: subdir", { ".eslintrc.json": rc({ ignorePatterns: ["/subdir"] }), "subdir/.eslintrc.json": rc(eqeqeq), "subdir/a.js": code }, ["subdir"]),
  // config-array/ignore-pattern.js
  ignores("the same patterns in two directories", {
    ".eslintrc.json": rc(),
    "foo/bar/.eslintrc.json": json({ ignorePatterns: ["*.js", "/*.ts", "!a.*", "!/b.*"] }),
    "abc/.eslintrc.json": json({ ignorePatterns: ["*.js", "/*.ts", "!a.*", "!/b.*"] }),
    ...each(["", "dir/", "foo/bar/", "foo/bar/dir/", "abc/", "abc/dir/"].flatMap(it => ["a.js", "a.ts", "b.js", "b.ts", "c.js", "c.ts"].map(name => it + name)), ""),
  }, ["--ext", ".js,.ts", "."]),

  ignores(".eslintignore", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": "b.js\n# c\n", ...two }, ["."]),
  ignores(".eslintignore: only that of the working directory", { ".eslintrc.json": rc(eqeqeq), "sub/.eslintignore": "b.js\n", ...under("sub", two) }, ["."]),
  ignores(".eslintignore: not that of a directory above", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": "*.js\n", ...under("sub", two) }, ["."], { cwd: "sub" }),
  ignores(".eslintignore and ignorePatterns", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["c.js"] }), ".eslintignore": "b.js\n", ...two, "c.js": code }, ["."]),
  ignores(".eslintignore: line ends of Windows, blank lines, comments, spaces at the end", {
    ".eslintrc.json": rc(),
    ".eslintignore": "hide1/\r\n\r\n# hide3/\r\nhide2/   \r\n",
    ...each(["hide1/a.js", "hide2/a.js", "hide3/a.js"], ""),
  }, ["."]),
  ignores(".eslintignore: a byte order mark", { ".eslintrc.json": rc(), ".eslintignore": `${BOM}b.js\n`, ...two }, ["."]),
  ignores(".eslintignore: negation", { ".eslintrc.json": rc(), ".eslintignore": "negation/*.js\n!negation/unignore.js\n", ...each(["negation/ignore.js", "negation/unignore.js"], "") }, ["."]),
  ignores(".eslintignore: !node_modules/package", { ".eslintrc.json": rc(), ".eslintignore": "!/node_modules/package\n", ...each(["node_modules/package/file.js", "node_modules/other/file.js", "a.js"], "") }, ["."]),
  ignores(".eslintignore: node_modules/ one level down", { ".eslintrc.json": rc(), ".eslintignore": "node_modules/\n", ...each(["sub/node_modules/a.js", "sub/a.js"], "") }, ["."]),
  ignores(".eslintignore is a directory", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": null, "a.js": code }, undefined, { lines: 1 }),
  ignores("package.json#eslintIgnore", { ".eslintrc.json": rc(eqeqeq), "package.json": json({ eslintIgnore: ["b.js"] }), ...two }, ["."]),
  ignores("package.json#eslintIgnore is not used beside an .eslintignore", { ".eslintrc.json": rc(eqeqeq), "package.json": json({ eslintIgnore: ["b.js"] }), ".eslintignore": "c.js\n", ...two, "c.js": code }, ["."]),
  ignores("package.json#eslintIgnore is not a list", { ".eslintrc.json": rc(), "package.json": json({ eslintIgnore: "b.js" }), ...two }, ["."]),
  ignores("package.json#eslintIgnore: the file is broken", { ".eslintrc.json": rc(), "package.json": "{", ...two }, ["."], { lines: 1 }),
  ignores("--ignore-path", { ".eslintrc.json": rc(eqeqeq), "ig": "b.js\n", ...two }, ["--ignore-path", "ig", "."]),
  ignores("--ignore-path takes the place of .eslintignore", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": "a.js\n", "ig": "b.js\n", ...two }, ["--ignore-path", "ig", "."]),
  ignores("--ignore-path: the patterns are relative to the working directory, the file is below", {
    ".eslintrc.json": rc(),
    "subdir/ig": "/undef.js\n*.txt\n!bar.txt\n",
    ...each(["undef.js", "subdir/undef.js", "a.js"], ""),
  }, ["--ignore-path", "subdir/ig", "."]),
  ignores("--ignore-path: the patterns are relative to the working directory, the file is above", { ".eslintrc.json": rc(), "ig": "/undef.js\n", ...each(["undef.js", "subdir/undef.js", "subdir/a.js"], "") }, ["--ignore-path", "../ig", ".", "../undef.js"], { cwd: "subdir" }),
  ignores("--ignore-path .gitignore", { ".eslintrc.json": rc(), ".gitignore": "dist\n*.min.js\n", ...each(["dist/a.js", "a.min.js", "a.js"], "") }, ["--ignore-path", ".gitignore", "."]),
  ignores("--ignore-path: missing", { ".eslintrc.json": rc(), "a.js": code }, ["--ignore-path", "nope", "a.js"], { lines: 1 }),
  ignores("--ignore-path: a directory", { ".eslintrc.json": rc(), "dir": null, "a.js": code }, ["--ignore-path", "dir", "a.js"], { lines: 1 }),
  ignores("a .gitignore is not read", { ".eslintrc.json": rc(eqeqeq), ".gitignore": "b.js\n", ...two }, ["."]),
  ignores("--ignore-pattern", { ".eslintrc.json": rc(eqeqeq), ...two }, ["--ignore-pattern", "b.js", "."]),
  ignores("--ignore-pattern: twice", { ".eslintrc.json": rc(), ...each(["a.js", "b.js", "c.js"], "") }, ["--ignore-pattern", "a.js", "--ignore-pattern", "b.js", "."]),
  ignores("--ignore-pattern: ./ at the start matches nothing", { ".eslintrc.json": rc(), ...two }, ["--ignore-pattern", "./b.js", "."]),
  ignores("--ignore-pattern: / at the start is the working directory", { ".eslintrc.json": rc(), ...each(["undef.js", "subdir/undef.js"], "") }, ["--ignore-pattern", "/undef.js", "."]),
  ignores("--ignore-pattern: a directory, with and without a slash", { ".eslintrc.json": rc(), ...each(["one/a.js", "one/deep/a.js", "two/a.js", "three/a.js"], "") }, ["--ignore-pattern", "one", "--ignore-pattern", "two/", "."]),
  ignores("--ignore-pattern: **/*.js", { ".eslintrc.json": rc(), ...each(["foo.js", "foo/bar.js", "foo/bar/baz.js", "foo.j2", "foo/bar.j2"], "") }, ["--ignore-pattern", "**/*.js", "--ext", ".js,.j2", "."]),
  ignores("--ignore-pattern: with a slash in the middle it is relative to the working directory", { ".eslintrc.json": rc(), ...each(["sub/a.js", "deep/sub/a.js"], "") }, ["--ignore-pattern", "sub/a.js", "."]),
  ignores("--ignore-pattern from a directory below the configuration", { ".eslintrc.json": rc(), ...each(["sub/a.js", "sub/b.js"], "") }, ["--ignore-pattern", "/a.js", "."], { cwd: "sub" }),
  ignores("--ignore-pattern lets in what .eslintignore ignores", { ".eslintrc.json": rc(), ".eslintignore": "a.js\n", ...two }, ["--ignore-pattern", "!a.js", "."]),
  ignores("--ignore-pattern lets in what ignorePatterns ignore", { ".eslintrc.json": rc({ ignorePatterns: ["a.js"] }), ...two }, ["--ignore-pattern", "!a.js", "."]),
  ignores("--ignore-pattern !/node_modules/package", { ".eslintrc.json": rc(), ...each(["node_modules/package/file.js", "node_modules/other/file.js"], "") }, ["--ignore-pattern", "!/node_modules/package", "."]),
  ignores("--ignore-pattern !.hidden.js", { ".eslintrc.json": rc(eqeqeq), ".hidden.js": code, "a.js": code }, ["--ignore-pattern", "!.hidden.js", "."]),
  ignores("--no-ignore", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["b.js"] }), ".eslintignore": "a.js\n", ...two }, ["--no-ignore", "."]),
  ignores("--no-ignore: --ignore-pattern is not used either", { ".eslintrc.json": rc(), ...two }, ["--no-ignore", "--ignore-pattern", "b.js", "."]),
  ignores("--no-ignore: node_modules and dot files stay out of a directory", { ".eslintrc.json": rc(), ...each(["a.js", "node_modules/b.js", ".c.js", ".d/e.js"], "") }, ["--no-ignore", "."]),
  ignores("--no-ignore: node_modules and dot files that are named are linted", { ".eslintrc.json": rc(eqeqeq), ...each(["node_modules/b.js", ".c.js", ".d/e.js"]) }, ["--no-ignore", "node_modules/b.js", ".c.js", ".d/e.js"]),
  ignores("by default: node_modules and dot files", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "node_modules/b.js", "sub/node_modules/pkg/b.js", ".c.js", ".d/e.js", "sub/.f.js"]) }, ["."]),
  ignores("by default: the three warnings for files that are named", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["a.js"] }), ...each(["a.js", "node_modules/b.js", "sub/node_modules/pkg/b.js", ".c.js", ".d/e.js"]) }, [
    "a.js",
    "node_modules/b.js",
    "sub/node_modules/pkg/b.js",
    ".c.js",
    ".d/e.js",
  ]),
  ignores("by default: bower_components is not ignored", { ".eslintrc.json": rc(), ...each(["bower_components/a.js", "a.js"], "") }, ["."]),
  ignores("a file above the working directory is not ignored by default", { ".eslintrc.json": rc(eqeqeq), "undef.js": code, "sub/a.js": code }, ["../undef.js"], { cwd: "sub" }),
  ignores("a path with .. in it", { ".eslintrc.json": rc(eqeqeq), "foo/x.js": "", "a.js": code }, ["foo/../a.js"]),
  ignores("the working directory is below a directory with a dot", { ".hidden/.eslintrc.json": rc(eqeqeq), ".hidden/a.js": code }, ["."], { cwd: ".hidden" }),
  ignores("the working directory is below node_modules", { "node_modules/pkg/.eslintrc.json": rc(eqeqeq), "node_modules/pkg/a.js": code }, ["."], { cwd: "node_modules/pkg" }),
  ignores("all files of a directory are ignored", { ".eslintrc.json": rc({ ignorePatterns: ["*.js"] }), ...under("sub", two) }, ["sub"]),
  ignores("all files of a pattern are ignored", { ".eslintrc.json": rc(), ".eslintignore": "sub\n", ...under("sub", two) }, ["sub/*.js"]),
  ignores("all files of a pattern are ignored, ./ at the start", { ".eslintrc.json": rc(), ".eslintignore": "sub\n", ...under("sub", two) }, ["./sub/*.js"]),
  ignores("all files are ignored by --ignore-pattern", { ".eslintrc.json": rc(), ...under("sub", two) }, ["--ignore-pattern", "sub/", "sub"]),
  ignores("all files of one of two patterns are ignored", { ".eslintrc.json": rc({ ignorePatterns: ["sub"] }), ...under("sub", two), "a.js": code }, ["a.js", "sub/*.js"]),
  ignores("node_modules as the directory", { ".eslintrc.json": rc(), "node_modules/a.js": "" }, ["node_modules"]),
  ignores("a pattern for dot files", { ".eslintrc.json": rc(eqeqeq), ...each([".a.js", "sub/.b.js", "c.js"]) }, [".*.js", "sub/.*.js"]),
  ignores("a pattern with a directory with a dot", { ".eslintrc.json": rc(eqeqeq), ...each([".d/e.js", ".d/.f.js"]) }, [".d/*.js"]),
];

const whichFiles = [
  which("a directory finds .js only", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.mjs", "c.cjs", "d.jsx", "e.ts", "f.json", "g"]) }, ["."]),
  which("no arguments at all", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, []),
  which("--ext", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.foo"]) }, ["--ext", ".foo", "."]),
  which("--ext: a list, twice, without the dot", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.foo", "c.bar", "d.baz", "e.qux"]) }, ["--ext", ".js,.foo", "--ext", "bar", "--ext", ".baz", "."]),
  which("--ext: two dots", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "a.test.js", "b.test.ts"]) }, ["--ext", ".test.js", "."]),
  which("--ext does not matter for files that are named", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.foo"]) }, ["--ext", ".foo", "a.js", "b.foo"]),
  which("--ext does not matter for patterns", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.foo", "c.bar"]) }, ["--ext", ".foo", "*.bar", "*.js"]),
  which("a file of any extension that is named", { ".eslintrc.json": rc(eqeqeq), ...each(["a.txt", "b"]) }, ["a.txt", "b"]),
  which("**", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.js2", "sub/c.js", "sub/d.js2"]) }, ["--ext", ".js,.js2", "**"]),
  which("** without --ext", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.js2", "sub/c.js"]) }, ["**"]),
  which("sub/*", { ".eslintrc.json": rc(eqeqeq), ...each(["sub/a.js", "sub/b.txt", "sub/deep/c.js"]) }, ["sub/*"]),
  which("*.js2 and *.js", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.js2"]) }, ["*.js", "*.js2"]),
  which("{a,b}.js", { ".eslintrc.json": rc(eqeqeq), ...each(["a.js", "b.js", "c.js"]) }, ["{a,b}.js"]),
  which("a file once, by two patterns", { ".eslintrc.json": rc(eqeqeq), ...each(["sub/a.js", "sub/b.js"]) }, ["sub/a.js", "sub/*.js", "sub", "./sub/a.js"]),
  which("a directory with a slash, with ./, two directories", { ".eslintrc.json": rc(eqeqeq), ...each(["one/a.js", "two/b.js", "three/c.js"]) }, ["one/", "./two"]),
  which("[ab].js is a file", { ".eslintrc.yml": "root: true", ...each(["a.js", "b.js", "ab.js", "[ab].js"], "") }, ["[ab].js"]),
  which("[ab].js is a pattern", { ".eslintrc.yml": "root: true", ...each(["a.js", "b.js", "ab.js"], "") }, ["[ab].js"]),
  which("an empty string as a file", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["", "a.js"]),
  which("a file that does not exist", { ".eslintrc.json": rc(), "a.js": code }, ["nope.js"]),
  which("a file that does not exist, beside one that does", { ".eslintrc.json": rc(), "a.js": code }, ["a.js", "nope.js"]),
  which("two files that do not exist", { ".eslintrc.json": rc(), "a.js": code }, ["nope.js", "nada.js"]),
  which("a pattern that matches nothing", { ".eslintrc.json": rc(), "a.js": code }, ["nope/*.js"]),
  which("an empty directory", { ".eslintrc.json": rc(), "empty": null }, ["empty"]),
  which("a directory without files to lint", { ".eslintrc.json": rc(), "docs/a.md": "" }, ["docs"]),
  which("--no-error-on-unmatched-pattern", { ".eslintrc.json": rc(), "a.js": code }, ["--no-error-on-unmatched-pattern", "nope.js", "nope/*.js"]),
  which("--no-error-on-unmatched-pattern, beside a file with an error", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["--no-error-on-unmatched-pattern", "nope.js", "a.js"]),
  which("--no-error-on-unmatched-pattern: all are ignored", { ".eslintrc.json": rc({ ignorePatterns: ["sub"] }), "sub/a.js": code }, ["--no-error-on-unmatched-pattern", "sub/*.js"]),
  which("links to a file and to a directory", { ".eslintrc.json": rc(eqeqeq), "real/a.js": code, "linked": { link: "real" }, "b.js": { link: "real/a.js" } }, ["."], { posix: true }),
  which("a broken link", { ".eslintrc.json": rc(eqeqeq), "a.js": code, "b.js": { link: "nope.js" } }, ["."], { posix: true }),
  which("an empty file, and one with a byte order mark", { ".eslintrc.json": rc(on("eqeqeq", "unicode-bom")), "a.js": "", "b.js": BOM + code }, ["."]),
];

const flat = 'module.exports = [{ rules: { "no-var": "error" } }];\n';

const whichSystem = [
  system("both files, ESLINT_USE_FLAT_CONFIG=false", { "eslint.config.js": flat, ".eslintrc.json": rc(eqeqeq), "a.js": code }, undefined, { env: { ESLINT_USE_FLAT_CONFIG: "false" } }),
  system("both files, ESLINT_USE_FLAT_CONFIG=true", { "eslint.config.js": flat, ".eslintrc.json": rc(eqeqeq), "a.js": code }, undefined, { env: { ESLINT_USE_FLAT_CONFIG: "true" } }),
  system("both files", { "eslint.config.js": flat, ".eslintrc.json": rc(eqeqeq), "a.js": code }),
  system("eslint.config.mjs beside .eslintrc.json", { "eslint.config.mjs": 'export default [{ rules: { "no-var": "error" } }];\n', ".eslintrc.json": rc(eqeqeq), "a.js": code }),
  system("eslint.config.cjs beside .eslintrc.json", { "eslint.config.cjs": flat, ".eslintrc.json": rc(eqeqeq), "a.js": code }),
  system("eslint.config.js above the working directory, .eslintrc.json in it", { "eslint.config.js": flat, "sub/.eslintrc.json": rc(eqeqeq), "sub/a.js": code }, undefined, { cwd: "sub" }),
  system(".eslintrc.json above, eslint.config.js below the working directory", { ".eslintrc.json": rc(eqeqeq), "sub/eslint.config.js": flat, "sub/a.js": code }, ["sub/a.js"]),
  system(".eslintrc.json only, ESLINT_USE_FLAT_CONFIG=true", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, undefined, { env: { ESLINT_USE_FLAT_CONFIG: "true" }, lines: 1 }),
  system(".eslintrc.json only, ESLINT_USE_FLAT_CONFIG=false", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, undefined, { env: { ESLINT_USE_FLAT_CONFIG: "false" } }),
  system("eslint.config.js only, ESLINT_USE_FLAT_CONFIG=false", { "eslint.config.js": flat, "a.js": code }, undefined, { env: { ESLINT_USE_FLAT_CONFIG: "false" } }),
  system("both files, a flag of ESLint 8", { "eslint.config.js": flat, ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["--no-eslintrc", "a.js"], { lines: 0 }),
];

const whatIsPrinted = [
  printConfig("rules, env, globals, parserOptions, settings", {
    ".eslintrc.json": rc({ env: { node: true }, globals: { a: "readonly", b: true }, parserOptions: { ecmaVersion: 2020 }, settings: { s: 1 }, rules: { eqeqeq: ["error", "smart"], "no-var": 1, "no-debugger": "off" } }),
    "a.js": code,
  }, ["--print-config", "a.js"]),
  printConfig("an empty configuration", { ".eslintrc.json": rc(), "a.js": code }, ["--print-config", "a.js"]),
  printConfig("the cascade, extends and overrides", {
    ".eslintrc.json": rc({ extends: "./base.json", overrides: [{ files: ["*.js"], rules: { "no-var": "warn" } }], ignorePatterns: ["dist"] }),
    "base.json": json({ rules: { eqeqeq: ["error", "smart"] }, noInlineConfig: true }),
    "sub/.eslintrc.yml": "rules:\n  eqeqeq: warn\nreportUnusedDisableDirectives: true\n",
    "sub/a.js": code,
  }, ["--print-config", "sub/a.js"]),
  printConfig("plugins and the parser", {
    ".eslintrc.json": rc({ plugins: ["foo", "@s/eslint-plugin-bar"], parser: "./parser.js", rules: { "foo/no-x": 2 } }),
    ...foo,
    ...pkg("@s/eslint-plugin-bar", ""),
    "parser.js": standIn,
    "a.js": code,
  }, ["--print-config", "a.js"]),
  printConfig("the flags", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["--env", "mocha", "--global", "a:true", "--rule", "no-var: 1", "--parser-options", "ecmaVersion:6", "--ignore-pattern", "x.js", "--print-config", "a.js"]),
  printConfig("a file that does not exist", { ".eslintrc.json": rc(eqeqeq) }, ["--print-config", "nope.js"]),
  printConfig("a directory", { ".eslintrc.json": rc(eqeqeq), "sub/a.js": code }, ["--print-config", "sub"]),
  printConfig("with another file", { ".eslintrc.json": rc(eqeqeq), "a.js": code, "b.js": code }, ["--print-config", "a.js", "b.js"]),
  printConfig("with --stdin", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["--stdin", "--print-config", "a.js"], { stdin: code }),
  printConfig("without a configuration", { "a.js": code }, ["--print-config", "a.js"]),
];


// What repositories that have a configuration of ESLint 8 do.
const OV = (files, more = {}) => rc({ overrides: [{ files, ...eqeqeq, ...more }] });

const whatRepositoriesDo = [
  of("overrides")("'./sub/**' (visx)", { ".eslintrc.json": OV("./sub/**"), "sub/a.js": code, "a.js": code }, ["."]),
  of("overrides")("'./sub/**' in a config that is extended (visx)", { ".eslintrc.json": rc({ extends: "./c/base.json" }), "c/base.json": json({ overrides: [{ files: "./sub/**", ...eqeqeq }] }), "sub/a.js": code, "a.js": code }, ["."]),
  of("overrides")("files is a string with braces (visx)", { ".eslintrc.json": OV("*.test.{js,jsx}"), "sub/a.test.js": code, "a.js": code, "b.test.jsx": code }, ["."]),
  of("overrides")("--ext wins over files (yargs)", { ".eslintrc.json": OV(["**/*.ts"]), "a.js": code, "b.ts": code, "c.mjs": code }, [".", "--ext", "mjs", "--ext", "js"]),
  of("overrides")("no --ext, files add .ts and .tsx (ts-nextjs, visx)", { ".eslintrc.json": OV(["**/*.ts?(x)"]), "a.js": code, "b.ts": code, "c.tsx": code, "d.mjs": code }, ["."]),
  of("overrides")("a pattern that ends in * adds nothing (visx)", { ".eslintrc.json": OV("sub/**"), "sub/a.js": code, "sub/b.ts": code }, ["."]),
  of("overrides")("one of the patterns ends in *: none adds", { ".eslintrc.json": OV(["*.ts", "sub/*"]), "sub/a.js": code, "b.ts": code }, ["."]),
  of("overrides")("an override in an extended file adds too (next)", { ".eslintrc.json": rc({ extends: "./base.json" }), "base.json": json({ overrides: [{ files: ["**/*.ts?(x)"], ...eqeqeq }] }), "a.js": code, "b.ts": code }, ["."]),
  of("overrides")("extglob @() (storybook)", { ".eslintrc.json": OV(["*.stories.@(ts|tsx|js|jsx|mjs|cjs)", "*.story.@(ts|js)"]), "a.stories.js": code, "a.js": code, "s/b.story.js": code }, [".", "--ext", "js"]),
  of("overrides")("'.storybook/main.@(js|cjs)' is in a dot directory (storybook)", { ".eslintrc.json": OV([".storybook/main.@(js|cjs|mjs|ts)"]), ".storybook/main.js": code, "a.js": code }, ["."]),
  of("overrides")("excludedFiles with braces (excalidraw)", { ".eslintrc.json": OV(["p/**/*.{js,jsx}"], { excludedFiles: ["p/**/*.test.{js,jsx}", "p/**/*.test.*.{js,jsx}"] }), "p/a.js": code, "p/a.test.js": code, "p/q/a.test.x.js": code }, ["."]),
  of("overrides")("'src/**/*.js' in a file that a child extends by ../ (excalidraw)", { ".eslintrc.json": rc({}), "p/base.json": json({ overrides: [{ files: ["src/**/*.js"], ...eqeqeq }] }), "p/c/.eslintrc.json": json({ extends: ["../base.json"] }), "p/c/src/a.js": code, "p/src/a.js": code }, ["."]),
  of("files")("named with another extension than --ext (mobx)", { ".eslintrc.json": rc(eqeqeq), "a.js": code, "b.ts": code, "c.snap": code }, ["a.js", "b.ts", "c.snap", "--ext", ".js,.ts"]),
  of("files")("a directory and a file named (mobx: the shell expands **)", { ".eslintrc.json": rc(eqeqeq), "s/d/a.js": code, "s/d/b.txt": code, "s/e.js": code }, ["s/d", "s/e.js", "--ext", ".js,.ts,.tsx"]),
  of("files")("a pattern with braces of which some do not exist (nestjs)", { ".eslintrc.json": rc(eqeqeq), "src/a.ts": code, "test/b.ts": code }, ["{src,apps,libs,test}/**/*.ts"]),
  of("files")("patterns with braces of extensions (Chart.js)", { ".eslintrc.json": rc(eqeqeq), "src/a.ts": code, "src/b.js": code, "src/c.mjs": code }, ["src/**/*.{js,ts}"]),
  of("files")("a pattern that matches nothing beside one that does", { ".eslintrc.json": rc(eqeqeq), "src/b.js": code }, ["src/*.js", "demo/*.js"]),
  of("files")("a pattern finds a file in a dot directory?", { ".eslintrc.json": rc(eqeqeq), ".s/b.js": code, "a.js": code }, ["**/*.js"]),
  of("files")("--ext without dots, with a comma (drawdb)", { ".eslintrc.json": rc({ ...eqeqeq, parserOptions: { ecmaFeatures: { jsx: true } } }), "a.js": code, "b.jsx": code, "c.ts": code }, [".", "--ext", "js,jsx"]),
  of("command-line")("--report-unused-disable-directives --max-warnings 0 (drawdb, tremor)", { ".eslintrc.json": rc(eqeqeq), "a.js": "// eslint-disable-next-line eqeqeq\nvar x = 1;\n" }, [".", "--ext", "js", "--report-unused-disable-directives", "--max-warnings", "0"]),
  of("command-line")("--max-warnings=0 with a warning (excalidraw)", { ".eslintrc.json": rc({ rules: { eqeqeq: "warn" } }), "a.js": code }, ["--max-warnings=0", "--ext", ".js,.ts,.tsx", "."]),
  of("command-line")("--quiet (visx)", { ".eslintrc.json": rc({ rules: { eqeqeq: "warn", "no-debugger": "error" } }), "p/a.js": code }, ["p/", "--quiet"]),
  of("command-line")("--quiet with reportUnusedDisableDirectives in the file (visx)", { ".eslintrc.json": rc({ reportUnusedDisableDirectives: true, ...eqeqeq }), "p/a.js": "// eslint-disable-next-line eqeqeq\nvar x = 1;\n" }, ["p/", "--quiet"]),
  of("command-line")("--cache (Chart.js, knex)", { ".eslintrc.json": rc(eqeqeq), "a.js": code }, ["--cache", "."]),
  of("ignores")("--ignore-pattern vendor with patterns (highlight.js)", { ".eslintrc.json": rc(eqeqeq), "tools/vendor/a.js": code, "tools/b.js": code, "tools/x/c.js": code }, ["tools/**/*.js", "--ignore-pattern", "vendor"]),
  of("ignores")("lint-staged: an ignored file is named, --max-warnings=0", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": "dist\n", "dist/a.js": code, "b.js": "var x;\n" }, ["--max-warnings=0", "dist/a.js", "b.js"]),
  of("ignores")("lint-staged: a dot file is named", { ".eslintrc.json": rc(eqeqeq), ".x.js": code }, [".x.js"]),
  of("ignores")(".eslintignore of knex", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": "node_modules\n*.stub\n#\nlib/m/import-file.js\ntest/j/k\ntypes/*.d.mts\n", "lib/m/import-file.js": code, "lib/m/a.js": code, "test/j/k/a.js": code, "test/j/a.js": code }, ["."]),
  of("ignores")(".eslintignore of excalidraw", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": "node_modules/\nbuild/\npackage-lock.json\n.vscode/\npublic/workbox\nexamples/**/public\ndev-dist\n", "a/build/a.js": code, "public/workbox/a.js": code, "x/public/workbox/a.js": code, "examples/a/b/public/c.js": code, "examples/public/c.js": code, "a.js": code }, ["."]),
  of("ignores")(".eslintignore of Chart.js: dist/*", { ".eslintrc.json": rc(eqeqeq), ".eslintignore": "dist/*\ntest/i/r/*\n", "dist/a.js": code, "x/dist/a.js": code, "test/i/r/a.js": code, "test/i/r/s/a.js": code }, ["."]),
  of("ignores")(".eslintignore without a line break at the end, *.d.ts (visx)", { ".eslintrc.json": OV("*.ts"), ".eslintignore": "lib/\n*.d.ts\ntsconfig.json", "a.d.ts": code, "b.ts": code, "p/lib/c.ts": code }, ["."]),
  of("ignores")("ignorePatterns of a child: '/*.js', 'lib/' (visx-vendor)", { ".eslintrc.json": rc(eqeqeq), "p/v/.eslintrc.json": json({ ignorePatterns: ["/*.js", "lib/"] }), "p/v/a.js": code, "p/v/s/b.js": code, "p/v/s/lib/c.js": code, "p/a.js": code }, ["p/"]),
  of("ignores")("ignorePatterns: '**/__tests__/**/*' (mobx)", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["**/__tests__/**/*"] }), "p/__tests__/a.js": code, "p/__tests__/.eslintrc.yaml": "env:\n    jest: true\nrules:\n    \"react/display-name\": \"off\"\n", "p/a.js": code }, ["."]),
  of("ignores")("ignorePatterns: 'dist', '.eslintrc.json' , 'node_modules' (tremor)", { ".eslintrc.json": rc({ ...eqeqeq, ignorePatterns: ["dist", ".eslintrc.cjs", "node_modules"] }), "dist/a.js": code, "a/dist/b.js": code, "a.js": code }, ["."]),
  of("ignores")("ignorePatterns in a file that is extended are relative to the file that extends", { ".eslintrc.json": rc({ extends: "./c/base.json" }), "c/base.json": json({ ...eqeqeq, ignorePatterns: ["/x.js"] }), "x.js": code, "c/x.js": code }, ["."]),
  of("unknown-rule")("a rule of a plugin that nobody declares, off (mobx, visx)", { ".eslintrc.json": rc({ rules: { "react/display-name": "off", "jsx-a11y/no-onchange": 0, eqeqeq: 2 } }), "a.js": code }),
  of("unknown-rule")("a rule of a plugin that nobody declares, on", { ".eslintrc.json": rc({ rules: { "react/display-name": "error" } }), "a.js": code }),
  of("presets")("a removed rule of ESLint, on (visx: no-native-reassign is deprecated, not removed)", { ".eslintrc.json": rc({ rules: { "no-native-reassign": "error", "no-negated-in-lhs": "error", "no-spaced-func": "error", "no-new-object": "error", "no-return-await": "error" } }), "a.js": "Object = 1;\nnew Object();\n" }),
  of("presets")("eqeqeq allow-null, indent, eol-last, no-trailing-spaces (express)", { ".eslintrc.yml": "root: true\nenv:\n  es2022: true\n  node: true\nrules:\n  eol-last: error\n  eqeqeq: [error, allow-null]\n  indent: [error, 2, { MemberExpression: \"off\", SwitchCase: 1 }]\n  no-trailing-spaces: error\n  no-unused-vars: [error, { vars: all, args: none, ignoreRestSiblings: true }]\n  no-restricted-globals:\n    - error\n    - name: Buffer\n      message: Use `import`.\n", "a.js": "var a = 1 \nif (a == null) {\n   Buffer.from(a)\n}\ntry { a() } catch (e) {}\nif (a == 1) a?.b" }),
  of("language")("ecmaVersion 2015, object spread (highlight.js lint-languages)", { "c.json": json({ env: { browser: true, es6: true, node: true }, parserOptions: { ecmaVersion: 2015, sourceType: "module" }, rules: {} }), "a.js": "const a = { ...b };\nexport default a;\n", "b.js": "const r = /(?<=a)b/;\nexport default r;\n", "c.js": "export default async function f() {}\n", "d.js": "const r = /(?<n>a)/u, s = /a/s;\nexport { r, s };\n", "e.js": "export default [1, 2,].map((a, b,) => a ** b);\n" }, ["--no-eslintrc", "-c", "c.json", "a.js", "b.js", "c.js", "d.js", "e.js"]),
  of("language")("ecmaVersion 2018 and 2020 in overrides (highlight.js)", { ".eslintrc.json": rc({ env: { es6: true }, parserOptions: { ecmaVersion: 2015, sourceType: "module" }, overrides: [{ files: ["test/**/*.js"], parserOptions: { ecmaVersion: 2018 } }, { files: ["tools/**/*.js"], parserOptions: { ecmaVersion: 2020 } }] }), "test/a.js": "const a = { ...b }; a?.b;\n", "tools/a.js": "const a = { ...b }; a?.b; class A { x = 1 }\n", "a.js": "try {} catch {}\n" }, ["."]),
  of("language")("ecmaVersion 2022, script (knex)", { ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022 }, env: { node: true, mocha: true, es6: true } }), "a.js": "class A { static #x = 1; static { A.#x; } }\nreturn;\n", "b.js": "import a from 'a';\n", "c.js": "await 1;\n", "d.js": "const a = /a/v;\n" }, ["."]),
  of("language")("a child says module and 2018 (knex)", { ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022 }, env: { node: true, es6: true } }), "t/.eslintrc.json": json({ extends: "../.eslintrc.json", env: { browser: true, es6: true }, globals: { Atomics: "readonly" }, parserOptions: { ecmaVersion: 2018, sourceType: "module" }, rules: {} }), "t/a.js": "import a from 'a'; a?.b;\n", "t/b.js": "export default { ...a };\n" }, ["."]),
  of("language")("env es2022 alone, script (express)", { ".eslintrc.json": rc({ env: { es2022: true, node: true } }), "a.js": "class A { #x = 1 }\nreturn;\n", "b.js": "import 'a';\n", "c.js": "with (a) {}\nvar let = 1;\n" }, ["."]),
  of("language")("env es2020 + ecmaVersion latest + module (drawdb)", { ".eslintrc.json": rc({ env: { browser: true, es2020: true }, parserOptions: { ecmaVersion: "latest", sourceType: "module" } }), "a.js": "await 1; const a = /a/v; export { a };\n", "b.js": "const b = <a />;\n" }, ["."]),
  of("language")("ecmaVersion 6 (mobx), impliedStrict + modules (Chart.js)", { ".eslintrc.json": rc({ parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { impliedStrict: true, modules: true } } }), "a.js": "export const a = 010;\n" }, ["."]),
  of("merge")("globals: 'readable' and 'writable' with no-undef, no-global-assign (mobx)", { ".eslintrc.json": rc({ globals: { process: "readable", module: "writable", React: true, JSX: true }, rules: { "no-undef": "error", "no-global-assign": "error" } }), "a.js": "process = 1; module = 2; React = 3; other;\n" }),
  of("merge")("env: jasmine, mocha, jest, serviceworker", { ".eslintrc.json": rc({ env: { jasmine: true, mocha: true, jest: true, serviceworker: true }, rules: { "no-undef": "error" } }), "a.js": "spyOn; suite; jest; clients; importScripts; xit; fdescribe; window;\n" }),
  of("merge")("env: browser true, node false (visx)", { ".eslintrc.json": rc({ env: { browser: true, node: false }, globals: { process: "readonly" }, rules: { "no-undef": "error" }, overrides: [{ files: ["*.test.js"], env: { node: true } }] }), "a.js": "window; process; require; __dirname;\n", "a.test.js": "window; process; require; __dirname;\n" }, ["."]),
  of("cascade")("the cascade goes on above the working directory (9 repositories have no root)", { ".eslintrc.json": rc(eqeqeq), "r/.eslintrc.json": json({ rules: { "no-var": "error" } }), "r/a.js": code }, ["."], { cwd: "r" }),
  of("merge")("parserOptions of a parser that is not there: requireConfigFile, babelOptions, project", { ".eslintrc.json": rc({ ...eqeqeq, parserOptions: { requireConfigFile: false, babelOptions: { presets: ["x"] }, project: "tsconfig.json", tsconfigRootDir: "/x" } }), "a.js": code }),
  of("merge")("settings with a RegExp source, import/resolver (visx)", { ".eslintrc.json": rc({ ...eqeqeq, settings: { "import/ignore": ["node_modules", "\\.json$"], "import/resolver": { node: { extensions: [".ts"] } }, react: { version: "detect" } } }), "a.js": code }),
  of("files")("--fix with a pattern (nestjs)", { ".eslintrc.json": rc({ rules: { "no-var": "error", semi: "error" } }), "src/a.ts": "var x = 1\n" }, ["{src,test}/**/*.ts", "--fix"]),
  of("print-config")("eslint:recommended, env, globals, ignorePatterns", { ".eslintrc.json": rc({ extends: "eslint:recommended", env: { es2022: true, node: true }, globals: { a: true }, ignorePatterns: ["dist"], rules: { eqeqeq: ["error", "smart"] } }), "a.js": code }, ["--print-config", "a.js"]),
];

// What stands for @rushstack/eslint-patch/modern-module-resolution: plugins are looked for from the file that names them.
const patch = pkg(
  "@rushstack/eslint-patch",
  `const path = require("path");
let found = module;
while (found && !/[\\\\/]@eslint[\\\\/]eslintrc[\\\\/]dist[\\\\/]eslintrc\\.cjs$/.test(found.filename)) found = found.parent;
if (!found) throw new Error("Failed to patch ESLint because the calling module was not recognized.");
const { ConfigArrayFactory } = found.exports.Legacy;
if (!ConfigArrayFactory.__patched) {
  ConfigArrayFactory.__patched = true;
  const original = ConfigArrayFactory.prototype._loadPlugin;
  ConfigArrayFactory.prototype._loadPlugin = function (name, ctx) {
    return original.call(this, name, ctx.filePath ? { ...ctx, pluginBasePath: path.dirname(ctx.filePath) } : ctx);
  };
}
`,
  "modern-module-resolution.js",
);
const patched = config => `require("@rushstack/eslint-patch/modern-module-resolution");\n${js(config)}`;

const more = [
  names(".eslintrc.json: a key twice, the later wins", { ".eslintrc.json": '{ "root": true, "rules": { "eqeqeq": "off", "eqeqeq": "error" } }', "a.js": code }),
  names(".eslintrc.yml: a key twice", { ".eslintrc.yml": "root: true\nrules:\n  eqeqeq: off\n  eqeqeq: error\n", "a.js": code }, undefined, { lines: 1 }),
  names(".eslintrc.yml: yes is a string", { ".eslintrc.yml": "root: yes\n", "a.js": code }),
  names(".eslintrc.yml: on and off are strings", { ".eslintrc.yml": "root: true\nrules:\n  eqeqeq: off\n  no-var: on\n", "a.js": code }),
  names(".eslintrc.yml: a merge key", { ".eslintrc.yml": "root: true\nsettings:\n  base: &base\n    eqeqeq: error\nrules:\n  <<: *base\n  no-var: error\n", "a.js": code }),
  names(".eslintrc.yml: two documents", { ".eslintrc.yml": "root: true\n---\nrules:\n  eqeqeq: error\n", "a.js": code }, undefined, { lines: 1 }),
  names(".eslintrc.yml: a tag of JavaScript", { ".eslintrc.yml": "root: true\nsettings:\n  a: !!js/regexp /a/\n", "a.js": code }, undefined, { lines: 1 }),
  names(".eslintrc: keys without quotes, single quotes, a comma at the end", { ".eslintrc": "{\n  root: true, // c\n  rules: { eqeqeq: 'error', },\n}\n", "a.js": code }),
  names(".eslintrc.json: single quotes", { ".eslintrc.json": "{ 'root': true }", "a.js": code }, undefined, { lines: 1 }),
  names(".eslintrc.json: // in a string is no comment", { ".eslintrc.json": rc({ settings: { url: "https://example.com/*a*/" }, ...eqeqeq }), "a.js": code }),

  packages("./node_modules/gts/: a directory, by main in its package.json", {
    ".eslintrc.json": rc({ extends: "./node_modules/gts/" }),
    ...pkg("gts", json({ name: "gts", main: "build/src/index.js" }), "package.json"),
    ...pkg("gts", eqeqeq, "build/src/index.js"),
    "a.js": code,
  }),
  packages("a package that extends absolute paths by require.resolve", {
    ".eslintrc.json": rc({ extends: "airbnb-base" }),
    ...pkg("eslint-config-airbnb-base", 'module.exports = { extends: ["./rules/one", "./rules/two"].map(require.resolve), rules: {} };\n'),
    ...pkg("eslint-config-airbnb-base", eqeqeq, "rules/one.js"),
    ...pkg("eslint-config-airbnb-base", noVar, "rules/two.js"),
    "a.js": code,
  }),
  packages("next/core-web-vitals: a file of a package that extends require.resolve('.')", {
    ".eslintrc.json": rc({ extends: "next/core-web-vitals" }),
    ...pkg("eslint-config-next", eqeqeq),
    ...pkg("eslint-config-next", `module.exports = { extends: [require.resolve(".")], rules: ${json(noVar.rules)} };\n`, "core-web-vitals.js"),
    "a.js": code,
  }),
  packages("prettier, named by plugin:prettier/recommended", {
    ".eslintrc.json": rc({ extends: ["./base.json", "plugin:prettier/recommended"] }),
    "base.json": json(on("eqeqeq", "no-var")),
    ...pkg("eslint-plugin-prettier", 'module.exports = { configs: { recommended: { extends: ["prettier"], plugins: ["prettier"] } }, rules: {} };\n'),
    ...pkg("eslint-config-prettier", { rules: { eqeqeq: "off" } }),
    "a.js": code,
  }),

  plugins("@rushstack/eslint-patch: the plugin of a package is found in the node_modules of that package", {
    ".eslintrc.json": rc({ extends: "one" }),
    ...patch,
    ...pkg("eslint-config-one", patched({ plugins: ["foo"], ...noX })),
    ...pkg("eslint-config-one/node_modules/eslint-plugin-foo", withRule("the one of the package")),
    "a.js": code,
  }),
  plugins("@rushstack/eslint-patch: the plugin of the package before that of the project", {
    ".eslintrc.json": rc({ extends: "one" }),
    ...patch,
    ...pkg("eslint-config-one", patched({ plugins: ["foo"], ...noX })),
    ...pkg("eslint-config-one/node_modules/eslint-plugin-foo", withRule("the one of the package")),
    ...foo,
    "a.js": code,
  }),
  plugins("@rushstack/eslint-patch: required by the .eslintrc.js", {
    ".eslintrc.js": patched({ root: true, extends: "one" }),
    ...patch,
    ...pkg("eslint-config-one", { plugins: ["foo"], ...noX }),
    ...pkg("eslint-config-one/node_modules/eslint-plugin-foo", withRule("the one of the package")),
    "a.js": code,
  }),
  plugins("a plugin that looks for the files of ESLint in require.cache", {
    ".eslintrc.json": rc({ plugins: ["html"], ...eqeqeq }),
    ...pkg(
      "eslint-plugin-html",
      'if (!Object.keys(require.cache).some(it => /[\\\\/]eslint[\\\\/]lib[\\\\/]linter[\\\\/]linter\\.js$/.test(it))) throw new Error("It seems that eslint is not loaded.");\n',
    ),
    "a.js": code,
  }),

  environments("overrides that name **/*.ts make the blocks of that extension be linted", {
    ".eslintrc.json": rc({ plugins: ["markdown"], ...semi, overrides: [{ files: ["**/*.ts"] }] }),
    ...markdownAndHtml,
    "test.md": "```js\na()\n```\n```ts\nb()\n```\n```sh\nc()\n```\n",
  }, ["test.md"]),
  environments("overrides for **/*.md/**", {
    ".eslintrc.json": rc({ plugins: ["markdown"], ...semi, overrides: [{ files: ["**/*.md/**"], rules: { semi: "off", "no-undef": "error" } }] }),
    ...markdownAndHtml,
    "docs/test.md": "```js\na()\n```\n",
    "a.js": "a()\n",
  }, ["**/*.md", "a.js"]),

  language("'use strict' and let", { ".eslintrc.json": rc(), "a.js": "'use strict';\nlet a;\n" }),
  language("let, static, yield, await, async, of as names in a script", { ".eslintrc.json": rc(), "a.js": "var let = 1, static = 2, yield = 3, await = 4, async = 5, of = 6;\n" }),
  language("enum, and the words that strict mode reserves", { ".eslintrc.json": rc(), "a.js": "var interface = 1;\nvar enum = 2;\n" }),
  language("a function in a block, a label before a function", { ".eslintrc.json": rc(), "a.js": "if (a) function f() {}\nl: function g() {}\n" }),
  language("line separators in strings came with 2019", { ".eslintrc.json": rc(), "a.js": "var a = '\u2028';\n" }),
  language("\\u{..} came with 2015", { ".eslintrc.json": rc(), "a.js": "var a = '\\u{61}';\n" }),
  language("a line separator after a backslash continues the line in every edition", { ".eslintrc.json": rc(), "a.js": "var a = 'b \\\u2028 c', d = 'e \\\u2029 f';\n" }),
  language("after two backslashes it does not, and u{ is no escape", { ".eslintrc.json": rc(), "a.js": "var a = '\\\\u{61}';\n", "b.js": "var a = '\\\\\u2028';\n" }, ["a.js", "b.js"]),
  language("new.target came with 2015", { ".eslintrc.json": rc(), "a.js": "function f() { new.target; }\n" }),

  // The rules are those of 8.57.1.
  presets("no rule of 8.57.1 suggests what came later", {
    ".eslintrc.json": rc({ env: { es2022: true }, ...on("eqeqeq", "no-unused-vars", "use-isnan", "no-empty-function", "no-case-declarations", "no-compare-neg-zero", "no-implicit-coercion", "require-await", "no-useless-constructor") }),
    "a.js":
      "var a = 1;\nif (b == NaN) {}\nfunction f() {}\nswitch (b) { case 1: let c; }\nif (b === -0) {}\n!!b;\nasync function g() {}\nclass A { constructor() {} }\nf(g, A);\n",
  }, undefined, { detail: true }),
  presets("what 8.57.1 suggests and fixes", {
    ".eslintrc.json": rc({ env: { es2022: true }, ...on("no-unsafe-negation", "no-useless-escape", "radix", "prefer-const", "no-extra-boolean-cast", "no-console", "no-prototype-builtins") }),
    "a.js": "if (!a in b) {}\nvar s = '\\d';\nparseInt('1');\nlet c = 1;\nif (!!c) {}\nconsole.log(s);\nb.hasOwnProperty('a');\n",
  }, undefined, { detail: true }),
  presets("--fix: no-array-constructor has no fix", { ".eslintrc.json": rc(on("no-array-constructor")), "a.js": "var a = new Array(1, 2);\n" }, ["--fix", "a.js"]),
  presets("texts that changed later: no-eval, no-implicit-coercion, no-restricted-properties, no-useless-backreference", {
    ".eslintrc.json": rc({ rules: { "no-eval": "error", "no-implicit-coercion": "error", "no-restricted-properties": ["error", { object: "a", property: "b" }, { property: "c", message: "No c." }], "no-useless-backreference": "error" } }),
    "a.js": "eval('a');\nvar n = +a, s = '' + a;\na.b; d.c;\nvar r = /\\1(a)/;\n",
  }),
  presets("texts that changed later: no-restricted-imports, id-length", {
    ".eslintrc.json": rc({
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { "no-restricted-imports": ["error", { paths: [{ name: "a", importNames: ["b"] }], patterns: [{ group: ["c/*"], importNames: ["d"] }] }], "id-length": ["error", { max: 3 }] },
    }),
    "a.js": "import * as all from 'a';\nimport * as too from 'c/e';\nclass A { #long = 1; }\n",
  }),
  presets("radix as-needed", { ".eslintrc.json": rc({ rules: { radix: ["error", "as-needed"] } }), "a.js": "parseInt('1', 10);\nparseInt('1');\n" }),
  presets("no-unused-vars: what is reported where", {
    ".eslintrc.json": rc({ env: { es2022: true }, ...on("no-unused-vars") }),
    "a.js": "var a = 1; a = 2;\nfunction f(b, c) { return c; }\nvar { d, ...e } = f;\ntry {} catch (g) {}\nfor (var h in e) {}\n",
  }),
  presets("no-new-symbol, no-new-object, no-return-await, no-native-reassign are there", {
    ".eslintrc.json": rc({ env: { es2022: true }, ...on("no-new-symbol", "no-new-object", "no-return-await", "no-native-reassign", "no-negated-in-lhs", "no-catch-shadow", "lines-around-directive", "newline-after-var") }),
    "a.js": "'use strict';\nvar s = new Symbol(), o = new Object();\nasync function f() { return await s; }\nObject = o;\n",
  }),
  validation("an option that came after 8.57.1: no-unused-vars reportUsedIgnorePattern", { ".eslintrc.json": rc({ rules: { "no-unused-vars": ["error", { reportUsedIgnorePattern: true }] } }), "a.js": code }),
  validation("an option that came after 8.57.1: func-style overrides", {
    ".eslintrc.json": rc({ rules: { "func-style": ["error", "expression", { overrides: { namedExports: "declaration" } }] } }),
    "a.js": code,
  }),
  validation("env: null", { ".eslintrc.json": rc({ env: null }), "a.js": code }),
  validation("rules: null, globals: null", { ".eslintrc.json": rc({ rules: null, globals: null }), "a.js": code }),

  commandLine("--rule of a plugin that nothing names", { ".eslintrc.json": rc(), ...foo, "a.js": code }, ["--rule", "foo/no-x: 2", "a.js"]),
  commandLine("--no-eslintrc --env es2022,node --parser-options sourceType:module", { "a.js": "import a from 'a';\nawait a;\nprocess;\n" }, [
    "--no-eslintrc",
    "--env",
    "es2022,node",
    "--parser-options",
    "sourceType:module",
    "--rule",
    "no-undef: 2",
    "a.js",
  ]),
  commandLine("flags after the files, --flag=value", { ".eslintrc.json": rc({ rules: { "no-var": "warn" } }), "a.js": code, "b.foo": code }, [".", "--ext=.foo,.js", "--max-warnings=1"]),
];

/** @type {Row[]} */
export const cases = [
  ...namesAndFormats,
  ...thatArePrograms,
  ...theCascade,
  ...extendsOfFiles,
  ...howTheyAreMerged,
  ...extendsOfPackages,
  ...thePlugins,
  ...environmentsAndProcessors,
  ...theParser,
  ...theLanguage,
  ...rulesThatDoNotExist,
  ...noInlineConfiguration,
  ...withoutAConfiguration,
  ...directoriesOfRules,
  ...whatESLint8Has,
  ...theCommandLine,
  ...theNamesInErrors,
  ...whatIsRefused,
  ...theOverrides,
  ...whatIsIgnored,
  ...whichFiles,
  ...whichSystem,
  ...whatIsPrinted,
  ...whatRepositoriesDo,
  ...more,
];
