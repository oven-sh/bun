// Which files are read, and as what: every extension, file name and interpreter of `prettier.getSupportInfo()`, in both spellings of
// case, and every name in the tables of `bun format`, through Prettier, oxfmt and `bun format` in both flavors.
//
//   bun support-info.mjs --prettier=<directory with node_modules/prettier> --oxfmt=<path of oxfmt> --bin="<bun> format" --scratch=<directory> [--show]
//
// Each name gets texts that are not formatted, in the languages of its family, each in a directory of its own. The tools write. What
// is compared is the bytes afterwards, and for Prettier whether the file is named in an error. The next version of Prettier shows here what moved.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const scratch = path.resolve(flag("scratch"));
const withPrettier = path.resolve(flag("prettier"));
const prettier = createRequire(withPrettier + "/")("prettier");
const show = process.argv.includes("--show");

const script = ["const  a = 1\n", "const  a: number = 1\n", "// @flow\ntype  A = {| a: 1 |};\n", "const a = <b   />\n"];
const style = ["a{color:RED}\n"];
const data = ['{"a":1,   "b":[]}\n', '{"a":1,\'b\':[1,\n2],"d":{},}\n', '// c\n{"a":   1}\n', "{a:   1}\n"];
const markup = ['<div   a="b"><template><p   >x</p></template>{{  a  }}</div>\n'];
const texts = {
  "babel": script,
  "flow": script,
  "typescript": script,
  "css": style,
  "less": [...style, "a{b:c;// d\n}\n", "@a: 1;\n.b{.c;}\n"],
  "scss": [...style, "a{b:c;// d\n}\n", "$a:1;\n@mixin b{c:d}\n"],
  "json": data,
  "json5": data,
  "jsonc": data,
  "json-stringify": data,
  "yaml": ["a:    1\n"],
  "markdown": ['*  a\n\n<B   c="d" />\n', 'import a from "b"\n\n*  a\n'],
  "mdx": ['*  a\n\n<B   c="d" />\n', 'import a from "b"\n\n*  a\n'],
  "graphql": ["type A{b:C}\n"],
  "glimmer": ['<a   b="c">{{d}}</a>\n'],
  "html": markup,
  "vue": markup,
  "angular": markup,
  "lwc": markup,
  "mjml": markup,
};
// A name that nobody knows: it may be anything.
const all = [...new Set(Object.values(texts).flat())];
// The tools read these as their configuration.
const configurations = { ".prettierrc": ["semi:    true\n"], "package.json": ['{"name":"x",   "version":"1.0.0"}\n'] };

/** name -> texts */
const asked = new Map();
// Of what is no TOML oxfmt makes something else that is no TOML.
const toml = name => (/toml|^Pipfile$/i.test(name) ? ["a   = 1\n"] : undefined);
const ask = (name, family) => asked.has(name) || asked.set(name, configurations[name] ?? toml(name) ?? family);
const swapped = text => text.replace(/[a-z]/gi, it => (it === it.toLowerCase() ? it.toUpperCase() : it.toLowerCase()));
const { languages } = await prettier.getSupportInfo();
for (const language of languages) {
  const family = texts[language.parsers[0]];
  for (const extension of language.extensions ?? [])
    for (const name of [`a${extension}`, `a${swapped(extension)}`]) ask(name, family);
  for (const name of language.filenames ?? []) for (const it of [name, swapped(name)]) ask(it, family);
}
// By the first line. The text is behind it.
const interpreters = new Set(languages.flatMap(it => it.interpreters ?? []).concat("sh", "python3"));
const lines = [
  "#!/usr/bin/env %",
  "#!/usr/bin/%",
  "#!/usr/local/bin/%",
  "#!/bin/%",
  "#!/usr/bin/env % --x",
  "#!/usr/bin/env -S % --x",
  "#! /usr/bin/env %",
];
for (const interpreter of interpreters) {
  for (const [index, line] of lines.entries()) {
    if (index > 0 && interpreter !== "node" && interpreter !== "tsx") continue;
    ask(
      `for-${interpreter}-${index}`,
      script.map(it => `${line.replace("%", interpreter)}\n${it}`),
    );
  }
}
// What linguist has under JSON and YAML and Prettier leaves out, and other files that tools write.
for (const name of [
  ...[
    "composer.lock",
    "Pipfile.lock",
    "flake.lock",
    "deno.lock",
    "mcmod.info",
    "MODULE.bazel.lock",
    ".tern-config",
    ".watchmanconfig",
  ],
  ...["yarn.lock", "bun.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "uv.lock", "go.sum", "Gemfile.lock"],
  ...[
    "tsconfig.json",
    "jsconfig.json",
    "tslint.json",
    ".eslintrc",
    ".eslintrc.json",
    "devcontainer.json",
    "api-extractor.json",
  ],
]) {
  ask(name, all);
}
// What `bun format` has in its tables, whatever it is there for.
const source = path.resolve(import.meta.dirname, "../../../../src");
const tables = [
  "lint/driver/fmt/files.rs",
  "format/json/mod.rs",
  "format/yaml/mod.rs",
  "format/markdown/mod.rs",
  "format/css/mod.rs",
];
for (const file of [...tables, "format/html/mod.rs", "format/graphql/mod.rs", "format/handlebars/mod.rs"]) {
  for (const [, word] of fs.readFileSync(path.join(source, file), "utf8").matchAll(/\bb"([\w.+-]{1,32})"/g)) {
    if (/[a-z]/i.test(word)) for (const name of [word, word.startsWith(".") ? `a${word}` : `a.${word}`]) ask(name, all);
  }
}

const cases = [...asked].flatMap(([name, family]) => family.map(text => ({ name, text })));
function run(tool, command, configuration, namesWhatItRefuses) {
  const root = path.join(scratch, tool);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [index, { name, text }] of cases.entries()) {
    fs.mkdirSync(path.join(root, String(index)), { recursive: true });
    fs.writeFileSync(path.join(root, String(index), name), text);
  }
  for (const [name, text] of Object.entries(configuration)) fs.writeFileSync(path.join(root, name), text);
  const result = spawnSync(command[0], [...command.slice(1), "."], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const errors = result.stderr.replace(/\x1b\[[0-9;]*m/g, "");
  return cases.map(({ name, text }, index) => {
    const after = fs.readFileSync(path.join(root, String(index), name), "utf8");
    if (after !== text) return after;
    // oxfmt does not always say which file it refuses.
    return namesWhatItRefuses && errors.includes(`[error] ${index}/${name}`) ? "(refused)" : "(as it was)";
  });
}

const bin = flag("bin").split(" ");
let differences = 0;
for (const [flavor, theirs, configuration] of [
  ["Prettier", ["node", path.join(withPrettier, "node_modules/prettier/bin/prettier.cjs"), "--write"], {}],
  ["oxfmt", [path.resolve(flag("oxfmt")), "--threads=1"], { ".oxfmtrc.json": "{}\n" }],
]) {
  const isPrettier = flavor === "Prettier";
  const expected = run(`${flavor}-theirs`, theirs, configuration, isPrettier);
  const actual = run(`${flavor}-ours`, bin, configuration, isPrettier);
  const names = new Map();
  for (const [index, { name, text }] of cases.entries()) {
    if (expected[index] === actual[index]) continue;
    names.set(name, [...(names.get(name) ?? []), { text, expected: expected[index], actual: actual[index] }]);
  }
  differences += names.size;
  const touched = expected.filter(it => it !== "(as it was)").length;
  console.log(
    `${flavor}: ${asked.size} names, ${cases.length} files, ${touched} written or refused: ${names.size} names differ`,
  );
  for (const [name, all] of names) {
    console.log(`  ${name}: ${all.length} of its texts`);
    if (show) for (const it of all.slice(0, 2)) console.log(`    ${JSON.stringify(it)}`);
  }
}
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(differences ? 1 : 0);
