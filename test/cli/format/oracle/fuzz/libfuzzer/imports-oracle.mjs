// imports-oracle.mjs <records> --prettier=<dir> [--organize=<dir>] [--oxfmt=<dir>] [--out=<file>] [--shard=0/4]
// Asks the real tools about what the target `imports` has formatted.
//   <records>   what FUZZ_RECORD=<records> fuzz_imports -runs=0 <corpus> has written
//   --prettier  a directory with node_modules/prettier, @trivago/prettier-plugin-sort-imports, @ianvs/prettier-plugin-sort-imports
//               and @vue/compiler-sfc, without which the two leave Vue alone
//   --organize  one with prettier, prettier-plugin-organize-imports and a typescript that has a language service: 5.9
//   --oxfmt     one with oxfmt
//   --out       the differences are written there, one JSON object on a line, the shortest text first
// Run with Node.js: `<BUILTIN_MODULES>` is `require("module").builtinModules` of what runs Prettier.
// A record whose options one of the tools does not have is left out.
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const named = {};
const [records] = process.argv.slice(2).filter(arg => {
  const match = /^--([^=]+)=(.*)$/s.exec(arg);
  if (match) named[match[1]] = match[2];
  return !match;
});
const [shard, shards] = (named.shard ?? "0/1").split("/").map(Number);

async function load(directory, specifier) {
  const require = createRequire(path.resolve(directory, "index.js"));
  const module = await import(pathToFileURL(require.resolve(specifier)).href);
  return module.format || module.parsers ? module : module.default;
}

const tools = {};
if (named.prettier) {
  const prettier = await load(named.prettier, "prettier");
  for (const name of ["@trivago/prettier-plugin-sort-imports", "@ianvs/prettier-plugin-sort-imports"]) {
    const plugin = await load(named.prettier, name);
    tools[name] = (text, options, isPlain) => prettier.format(text, { ...options, plugins: isPlain ? [] : [plugin] });
  }
}
const temporary = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "imports-oracle-"));
if (named.organize) {
  const prettier = await load(named.organize, "prettier");
  const plugin = await load(named.organize, "prettier-plugin-organize-imports");
  // It reads the tsconfig.json of the file.
  const directories = new Map();
  tools["prettier-plugin-organize-imports"] = (text, { tsconfig, filepath, ...options }, isPlain) => {
    const key = JSON.stringify(tsconfig);
    if (!directories.has(key)) {
      const directory = path.join(temporary, String(directories.size));
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: tsconfig }));
      directories.set(key, directory);
    }
    return prettier.format(text, { ...options, filepath: path.join(directories.get(key), filepath), plugins: isPlain ? [] : [plugin] });
  };
}
if (named.oxfmt) {
  const { format } = await load(named.oxfmt, "oxfmt");
  tools.oxfmt = async (text, { filepath, sortImports, jsdoc, ...options }, isPlain) => {
    const result = await format(filepath, text, { printWidth: 80, ...options, ...(isPlain ? {} : { sortImports, jsdoc }) });
    if (result.errors.length) throw new Error(result.errors[0].message);
    return result.code;
  };
}

/** What oxfmt has of Prettier's options. */
const OF_OXFMT = new Set(["printWidth", "useTabs", "tabWidth", "singleQuote", "bracketSameLine", "endOfLine", "semi", "trailingComma", "arrowParens", "objectWrap", "quoteProps", "bracketSpacing", "jsxSingleQuote", "singleAttributePerLine", "embeddedLanguageFormatting", "proseWrap", "htmlWhitespaceSensitivity", "vueIndentScriptAndStyle"]);

/** The tool and its options for `a.ts --name=value ..`. Nothing: no tool has them. */
function parse(how) {
  const [filepath, ...flags] = how.split(/ --(?=[\w.]+=)/);
  const options = { filepath };
  let [tool, isOxfmt] = [undefined, false];
  for (const flag of flags) {
    const [, name, text] = /^([\w.]+)=(.*)$/s.exec(flag);
    let value = text;
    // The target `options` makes names and values that are no flags.
    try {
      if (/^(true|false|\d+|[[{].*)$/s.test(text)) value = JSON.parse(text);
    } catch {
      return;
    }
    if (name == "plugins") tool = Array.isArray(value) ? value[0] : value;
    else if (name == "flavor") isOxfmt = true;
    else if (name.startsWith("tsconfig.")) (options.tsconfig ??= {})[name.slice(9)] = value;
    else if (name.startsWith("jsdoc.")) (options.jsdoc = options.jsdoc === true || !options.jsdoc ? {} : options.jsdoc)[name.slice(6)] = value;
    else if (name == "sortPackageJson" || name == "checkIgnorePragma") return;
    else options[name] = value;
  }
  if (tool && (isOxfmt || options.jsdoc || options.sortImports)) return;
  if (!tool) {
    if (!isOxfmt) return;
    tool = "oxfmt";
    for (const name in options) if (!OF_OXFMT.has(name) && !["filepath", "sortImports", "jsdoc"].includes(name)) return;
    if (options.endOfLine == "auto" || options.tabWidth === 0) return;
  }
  options.tsconfig ??= {};
  if (tool != "prettier-plugin-organize-imports") delete options.tsconfig;
  return tools[tool] && { tool, options };
}

const words = text => new Set(text.match(/[\w$\u0080-\uffff]+/g) ?? []);
const log = { error: console.error, warn: console.warn };
async function ask(tool, text, options, isPlain) {
  console.error = console.warn = () => {};
  try {
    return { out: await tools[tool](text, options, isPlain) };
  } catch (error) {
    return { error: String(error?.message ?? error).split("\n")[0] };
  } finally {
    Object.assign(console, log);
  }
}

const bytes = fs.readFileSync(records);
const counts = new Map();
const differences = [];
const seen = new Set();
let index = 0;
for (let at = 0; at < bytes.length; index++) {
  const parts = [];
  for (let part = 0; part < 6; part++) {
    const length = bytes.readUInt32LE(at);
    parts.push(bytes.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  if (index % shards != shard) continue;
  const [how, text, status, ours, plainStatus, plain] = parts.map(String);
  // Prettier takes a string.
  if (!parts[1].equals(Buffer.from(text)) || seen.has(how + "\0" + text)) continue;
  seen.add(how + "\0" + text);
  const parsed = parse(how);
  if (!parsed) continue;
  const { tool, options } = parsed;
  const theirs = await ask(tool, text, options, false);
  let verdict;
  if (status != "formatted") verdict = theirs.error ? "both refuse" : status == "Syntax" ? "only we refuse" : `only we refuse: ${status}`;
  else if (theirs.error) verdict = "only they refuse";
  else if (theirs.out == ours) verdict = "same";
  else {
    const theirPlain = await ask(tool, text, options, true);
    if (plainStatus != "formatted" || theirPlain.out != plain) verdict = "different without the step too";
    else {
      const [a, b] = [words(ours), words(theirs.out)];
      if ([...b].some(word => !a.has(word))) verdict = "DIFFERENT: WE LOSE A WORD THAT THEY KEEP";
      else if ([...a].some(word => !b.has(word))) verdict = "different: we keep a word that they lose";
      else verdict = "different";
    }
  }
  // What no file has.
  if (/[\0-\x08\x0b\x0e-\x1f\x7f\ufffd]|\r(?!\n)/.test(text) && !/same|both/.test(verdict)) verdict = `(control characters) ${verdict.toLowerCase()}`;
  const key = `${tool} ${options.filepath.replace(/^.*\./, "")}: ${verdict}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (/different$|different:|only we refuse:|only they refuse|only we refuse/i.test(verdict)) differences.push({ verdict, tool, how, text, ours: status == "formatted" ? ours : status, theirs: theirs.out ?? `throws: ${theirs.error}` });
}
fs.rmSync(temporary, { recursive: true, force: true });
for (const key of [...counts.keys()].sort()) console.log(String(counts.get(key)).padStart(7), key);
if (named.out) {
  differences.sort((a, b) => a.text.length - b.text.length);
  fs.writeFileSync(named.out, differences.map(it => JSON.stringify(it) + "\n").join(""));
}
