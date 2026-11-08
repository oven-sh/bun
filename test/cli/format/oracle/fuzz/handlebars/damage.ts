// Prettier changes the meaning of some templates. `bun fmt` produces the same output, but reports it and leaves the
// file alone. This script looks for templates that `bun fmt` fails to report: those whose syntax tree, compared the way
// Prettier's own tests compare trees, differs after formatting, or that no longer parse.
//
//   bun damage.ts "bun fmt" <directory with node_modules/prettier> <directory with templates> [-show=10] [-told]
//
// `-told` also prints the templates that it reports even though the trees are the same, because whatever the parsers
// drop is in neither tree.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [bin, prettierRoot, directory, ...args] = process.argv.slice(2);
const prettier = await import(join(resolve(prettierRoot), "node_modules/prettier/index.mjs"));
const show = +(args.find(it => it.startsWith("-show=")) ?? "-show=10").slice(6);
const options = { parser: "glimmer" };
// These differences don't matter: whether `{{else a}}` is written in one piece, where the parser puts the end of such a
// block, and the dashes around a comment.
const tree = async (text: string) =>
  JSON.stringify((await prettier.__debug.parse(text, options, { massage: true })).ast, function (key, value) {
    if (key === "chained") return undefined;
    if (key === "inverse" && value?.body.length === 1 && value.body[0].type === "BlockStatement") delete value.body[0].closeStrip;
    if (key === "value" && this.type === "MustacheCommentStatement") return value.replace(/^-+|-+$/g, "");
    return value;
  });

const result = Bun.spawnSync([...bin.split(" "), "--check", "--no-config", "--parser", "glimmer", "."], { cwd: directory });
const reported = new Set([...result.stderr.toString().matchAll(/^\[error\] (.*?): formatting .*would change/gm)].map(it => it[1]));

const count = { templates: 0, "the same tree": 0, "of which told": 0, "another tree": 0, "of which not told": 0 };
let shown = 0;
for (const name of readdirSync(directory).sort()) {
  const text = readFileSync(join(directory, name), "utf8");
  // Prettier hangs on some of these.
  if (/publ.c/iu.test(text)) continue;
  let formatted: string, before: string;
  try {
    formatted = await prettier.format(text, options);
    before = await tree(text);
  } catch {
    continue;
  }
  count.templates++;
  const after = await tree(formatted).catch(() => "cannot be parsed");
  if (before === after) {
    count["the same tree"]++;
    if (reported.has(name)) {
      count["of which told"]++;
      if (args.includes("-told") && shown++ < show) console.log(`##### told ${name}\n${text}\n--- formatted\n${formatted}`);
    }
  } else {
    count["another tree"]++;
    if (!reported.has(name)) {
      count["of which not told"]++;
      if (shown++ < show) console.log(`##### not told ${name}\n${text}\n--- formatted\n${formatted}`);
    }
  }
}
console.log(Object.entries(count).map(([what, number]) => `${what} ${number}`).join(", "));
