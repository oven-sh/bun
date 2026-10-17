// Holds `bun fmt` against Prettier with prettier-plugin-packagejson, on random package.json files or on real ones.
//
//   node fuzz.mjs --modules=<dir> --bun=<bun> [--count=3000] [--seed=1] [--large] [--yarn] [--files=<dir>]
//
// - `--modules`: a directory with node_modules/prettier and node_modules/prettier-plugin-packagejson.
// - `--large`: hundreds of `scripts` and of `pnpm.overrides`, for what depends on how V8 sorts.
// - `--yarn`: with a yarn.lock in the working directory, which changes how dependencies are sorted.
// - `--files`: every package.json below that directory, in the place of random ones.
//
// Run it with Node: the plugin compares some keys of `pnpm.overrides` in a way that is no order, so what it prints depends on
// the engine. Where the plugin throws, the input is not compared: see the header of src/lint/driver/fmt/package_json.rs.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const named = Object.fromEntries(process.argv.slice(2).map(it => it.replace(/^--/, "").split("=")));
const require = createRequire(join(resolve(named.modules), "noop.js"));
const prettier = require("prettier");
const plugin = require.resolve("prettier-plugin-packagejson");
const bun = resolve(named.bun);

let state = Number(named.seed ?? 1) >>> 0;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 8) / 2 ** 24;
const int = below => Math.floor(random() * below);
const pick = list => list[int(list.length)];
const chance = share => random() < share;
const shuffled = list => {
  const all = [...list];
  for (let i = all.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
};
const some = (list, most) => shuffled(list).slice(0, int(most + 1));
const unique = list => [...new Set(list)];

/** An object whose keys stay in the order in which they are written, also those that are numbers. */
class Written {
  constructor(entries) {
    this.entries = entries;
  }
}
const object = (keys, value = scalar) => new Written(keys.map(key => [key, value()]));
const text = value =>
  value instanceof Written
    ? `{${value.entries.map(([key, it]) => `${JSON.stringify(key)}:${text(it)}`).join(",")}}`
    : Array.isArray(value)
      ? `[${value.map(text).join(",")}]`
      : Object.is(value, -0)
        ? "-0"
        : JSON.stringify(value);

// prettier-ignore
const WORDS = ["a", "b", "B", "Z", "z", "_a", "_b", "-x", "a-b", "a_b", "a.b", "a:b", "@s/a", "@s/b", "@S/a", "é", "É", "ä", "z1", "z10", "z2", "10", "9", "0", "01", "1.5", "4294967294", "4294967295", "", "$x", "~y", "😀", "￮", "ﬁ", "a b", "__proto", "constructor", "toString", "A", "aa", "Aa", "aA", "AA", "lodash", "lodash.merge", "lodash-es", "@types/node", "@types/a", "typescript", "react", "react-dom", "React"];
// prettier-ignore
const SCRIPTS = ["build", "prebuild", "postbuild", "test", "pretest", "posttest", "test:unit", "test:e2e", "test:unit:a", "test:unit:b", "test-x", "lint", "lint:fix", "lint:", "lint::a", ":a", ":a:b", "a:b:c", "a:b", "a", "a-b", "a:", "prea", "posta", "preprea", "prepare", "preprepare", "postprepare", "install", "preinstall", "postinstall", "start", "prestart", "dev", "predev", "watch", "build:a", "build:b", "build:*", "build-all", "post", "pre", "prepost", "postpre", "publish", "prepublish", "prepublishOnly", "version", "preversion", "é", "É:a", "10", "2"];
// prettier-ignore
const COMMANDS = ["tsc", "run-s build:*", "run-s a b", "npm-run-all -s build:*", "npm-run-all --serial build:*", "npm-run-all2 --sequential x:*", "npm-run-all build:* -p", "run-p build:*", "xrun-s a:*", "run-sx a:*", "echo && run-s a:*", "(run-s a:*)", "npm-run-all\n-s a:*", "npm-run-all a:* -sx", "npm-run-all a:* --serial;", "echo *", "npm-run-all2  -s *", "a|run-s|*", "npm-run-all3 -s *", " run-s *"];
// prettier-ignore
const RANGES = ["1", "2", "^1.2.3", "~1.2", "1.x", "*", ">=1.0.0 <2", ">1", "<1", "<=2.3.4", ">1.2.3", ">1.2.3-alpha", "1.2.3-beta.1", "1.2.3 - 2", "^0.0.1", "^0.1", "1 || 2", ">=3 || 1.5", "=1.2.3", "v1.2.3", ">=1.2.3-rc.1 <2", "0", "0.0.0", "<0.0.1", "10", "9", "1.10", "1.9", ">=6.0.0 <6.3.1", "<5.7.2", "7", "7.0.0-0", ">=7.0.0 <7.5.2", ">=2", ">5", "<3", "12.1", "12.10"];

const scalar = () => pick([1, "x", true, null, 1.5, -0, 1e21, "é", "\n", [], new Written([]), 0.1, 100]);
const anything = (depth = 0) =>
  object(some(WORDS, 8), () =>
    depth < 3 && chance(0.3) ? anything(depth + 1) : chance(0.1) ? [anything(depth + 1), 1] : scalar(),
  );
const strings = () => Array.from({ length: int(7) }, () => pick(WORDS));
const of = (keys, value) => () => object(some(keys, keys.length), value);
const versions = most => () => object(some(WORDS, most), () => "1");
const selector = names =>
  pick(names) + (chance(0.8) ? `@${pick(RANGES)}` : "") + (chance(0.3) ? `>${pick(["c", "d", "@s/c", "c@1"])}` : "");
const selectors = (names, most) => unique(Array.from({ length: int(most) }, () => selector(names)));

const exportsOf = depth =>
  object(
    some([".", "./a", "./b/*", "./package.json", "import", "require", "default", "types", "node", "10", "2"], 7),
    () => (depth < 3 && chance(0.5) ? exportsOf(depth + 1) : chance(0.1) ? ["./a.js", exportsOf(3)] : pick(["./x.js", null])),
  );
// prettier-ignore
const ESLINT = ["rules", "root", "extends", "env", "overrides", "globals", "parserOptions", "settings", "plugins", "parser", "files", "excludedFiles", "ignorePatterns", "processor", "a", "noInlineConfig"];
const eslintConfig = depth =>
  object(some(ESLINT, 10), () =>
    chance(0.3)
      ? object(some(["no-x", "a/b", "a/b/c", "@s/a/b", "B", "b", "é", "semi", "a/a", "Z/a"], 8))
      : depth < 3 && chance(0.3)
        ? [eslintConfig(depth + 1), eslintConfig(depth + 1), 1]
        : chance(0.2)
          ? "x"
          : anything(),
  );
const person = of(["url", "email", "name", "z"]);
const hooks = of(["pre-push", "pre-commit", "commit-msg", "zzz", "aaa", "post-merge", "update"]);

/** What a key of the document can have. */
const FIELDS = {
  name: () => "x",
  version: () => "1.0.0",
  ...Object.fromEntries(
    // prettier-ignore
    ["keywords", "categories", "files", "activationEvents", "bundledDependencies", "extensionPack", "extensionDependencies", "man", "os", "cpu", "browserslist"].map(key => [key, strings]),
  ),
  ...Object.fromEntries(
    // prettier-ignore
    ["imports", "bin", "contributes", "commitlint", "lint-staged", "config", "babel", "jest", "nyc", "oclif", "mocha", "stylelint", "release", "publishConfig", "galleryBanner"].map(key => [key, () => anything()]),
  ),
  bundleDependencies: () => (chance(0.2) ? [1, "a"] : strings()),
  bugs: of(["email", "url", "z", "a"]),
  repository: () => (chance(0.3) ? "x" : of(["url", "type", "directory", "a"])()),
  funding: of(["url", "type", "a"]),
  license: () => (chance(0.5) ? "MIT" : of(["url", "type"])()),
  author: () => (chance(0.3) ? "x" : person()),
  maintainers: () => [person(), "x"],
  contributors: () => (chance(0.2) ? object(["b", "a"]) : [person()]),
  exports: () => (chance(0.1) ? "./x.js" : exportsOf(0)),
  directories: of(["test", "example", "doc", "man", "bin", "lib", "z", "a"]),
  workspaces: () =>
    chance(0.4)
      ? strings()
      : of(["catalog", "packages", "nohoist", "catalogs", "a"], () => pick([strings(), anything(), versions(6)()]))(),
  binary: of(["host", "package_name", "remote_path", "module_path", "module_name", "a", "z"]),
  scripts: () => object(some(SCRIPTS, 14), () => pick(COMMANDS)),
  betterScripts: () => object(some(SCRIPTS, 6), () => pick(COMMANDS)),
  wireit: of(["build", "a", "test", "B"], () =>
    of(["output", "files", "dependencies", "command", "env", "service", "clean", "a"], () =>
      pick([
        strings(),
        [of(["cascade", "script", "a"])(), "x"],
        of(["B", "a", "C"], of(["default", "external", "a"]))(),
        of(["readyWhen", "a", "z"], of(["lineMatches", "a"]))(),
        "x",
      ]),
    )(),
  ),
  husky: of(["hooks", "a"], hooks),
  "simple-git-hooks": hooks,
  engines: of(["node", "npm", "yarn", "pnpm", "vscode"], () => pick([">=1", "", null])),
  prettier: () =>
    chance(0.1)
      ? "x"
      : of(["semi", "overrides", "tabWidth", "plugins", "Z", "a"], () =>
          pick([
            true,
            [of(["options", "files", "excludeFiles"], () => pick(["*.js", of(["semi", "a", "Z", "tabWidth"])()]))(), 1],
            2,
          ]),
        )(),
  eslintConfig: () => eslintConfig(0),
  resolutions: versions(8),
  overrides: () => object(some(WORDS, 8), () => (chance(0.3) ? versions(3)() : "1")),
  dependencies: versions(14),
  devDependencies: () => object(unique([...some(WORDS, 10), ...some(["npm-run-all", "npm-run-all2"], 2)]), () => "1"),
  peerDependencies: versions(6),
  optionalDependencies: versions(6),
  dependenciesMeta: () =>
    object(
      unique(Array.from({ length: int(8) }, () => pick(["a", "b", "@s/a", "@s/b", "B"]) + pick(["", "@1", "@2", "@npm:x"]))),
      of(["unplugged", "built", "optional", "a@1", "a"], () => (chance(0.3) ? of(["b@2", "b@1", "a"])() : true)),
    ),
  peerDependenciesMeta: () =>
    object(
      some(WORDS, 6),
      of(["optional", "a", "Z"], () => (chance(0.3) ? anything() : true)),
    ),
  packageManager: () => pick(["npm@10", "pnpm@9", "yarn@4", "bun@1", 5, "npm"]),
  devEngines: () =>
    pick([
      of(["runtime", "packageManager", "cpu"], () =>
        pick([
          of(["onFail", "version", "name", "a"], () => pick(["npm", "pnpm", "", "x"]))(),
          [object(["version", "name"])],
          "x",
        ]),
      )(),
      "x",
      null,
    ]),
  volta: of(["yarn", "npm", "node", "pnpm", "extends"]),
  badges: () => [of(["href", "url", "description", "a"])(), 1],
  pnpm: () =>
    chance(0.1)
      ? pick([true, null, 0, ""])
      : // prettier-ignore
        of(["overrides", "patchedDependencies", "packageExtensions", "peerDependencyRules", "onlyBuiltDependencies", "a", "Z", "updateConfig"], () =>
          pick([
            object(selectors(["a", "b", "@s/a", "@s/b", "foo", "é", "B"], 9), () =>
              chance(0.15) ? of(["overrides", "a", "Z", "auditConfig"])() : "1",
            ),
            strings(),
            anything(),
          ]),
        )(),
};

function small() {
  const keys = shuffled(unique([...some(Object.keys(FIELDS), 14), ...some(WORDS, 5)]));
  const entries = keys.map(key => [key, Object.hasOwn(FIELDS, key) ? FIELDS[key]() : chance(0.5) ? anything() : scalar()]);
  // A key that is there twice.
  if (chance(0.05) && entries.length > 0) entries.push([entries[0][0], "x"]);
  return text(new Written(entries)) + pick(["", "\n"]);
}

function large() {
  const names = ["a", "b", "b-x", "b.y", "b1", "@s/a", "@s/b", "foo", "B", "é", "ba", "a-b", "semver", "semver-x"];
  const parts = ["a", "b", "c", "build", "test", "", "a-b", "x"];
  const script = () =>
    pick(["", "pre", "post", "prepre"]) + Array.from({ length: 1 + int(4) }, () => pick(parts)).join(":");
  return text(
    new Written([
      ["pnpm", new Written([["overrides", object(selectors(names, 400), () => "1")]])],
      ["scripts", object(unique(Array.from({ length: int(300) }, script)), () => "")],
    ]),
  );
}

function* found(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== ".git") yield* found(join(directory, entry.name));
    else if (entry.isFile() && entry.name === "package.json") yield fs.readFileSync(join(directory, entry.name), "utf8");
  }
}

const inputs = named.files
  ? unique(found(resolve(named.files)))
  : Array.from({ length: Number(named.count ?? 3000) }, "large" in named ? large : small);

const root = fs.mkdtempSync(join(tmpdir(), "packagejson-fuzz-"));
try {
  fs.writeFileSync(join(root, ".prettierrc"), '{ "plugins": ["prettier-plugin-packagejson"] }\n');
  if ("yarn" in named) fs.writeFileSync(join(root, "yarn.lock"), "");
  const file = index => join(root, String(index), "package.json");
  for (const [index, input] of inputs.entries()) {
    fs.mkdirSync(join(root, String(index)));
    fs.writeFileSync(file(index), input);
  }
  // The plugin looks for lock files there.
  process.chdir(root);
  // `--config`: a package.json with `prettier` is a configuration.
  spawnSync(bun, ["fmt", "--log-level=silent", "--config", ".prettierrc", "."], { cwd: root });
  let [same, thrown, different] = [0, 0, 0];
  for (const [index, input] of inputs.entries()) {
    const expected = await prettier.format(input, { filepath: file(index), plugins: [plugin] }).catch(() => null);
    const printed = fs.readFileSync(file(index), "utf8");
    if (expected === null) thrown++;
    else if (expected === printed) same++;
    else if (++different <= 5) console.log(JSON.stringify({ input, expected, printed }, null, 2));
  }
  console.log(`${same} the same, ${different} different, ${thrown} that the plugin throws for`);
  process.exitCode = different > 0 ? 1 : 0;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
