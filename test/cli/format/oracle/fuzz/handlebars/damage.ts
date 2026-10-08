// Prettier changes what some templates mean. `bun format` prints the same, but says so and leaves the file alone. This looks for templates
// that it does not say it of: those whose syntax tree, as Prettier compares trees in its own tests, is another one after formatting, or that
// cannot be parsed any more.
//
//   bun damage.ts "<bun-lint> cli @format" <directory with node_modules/prettier> <directory with templates> [-show=10] [-told]
//
// `-told`: also prints the templates that it says it of although the trees are the same: what the parsers drop is in neither tree.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [bin, prettierRoot, directory, ...args] = process.argv.slice(2);
const prettier = await import(join(resolve(prettierRoot), "node_modules/prettier/index.mjs"));
const show = +(args.find(it => it.startsWith("-show=")) ?? "-show=10").slice(6);
const options = { parser: "glimmer" };
// Whether `{{else a}}` is written in one piece says nothing, nor does what the parser takes for the end of such a block, nor do the dashes
// around a comment.
const tree = async (text: string) =>
  JSON.stringify((await prettier.__debug.parse(text, options, { massage: true })).ast, function (key, value) {
    if (key === "chained") return undefined;
    if (key === "inverse" && value?.body.length === 1 && value.body[0].type === "BlockStatement") delete value.body[0].closeStrip;
    if (key === "value" && this.type === "MustacheCommentStatement") return value.replace(/^-+|-+$/g, "");
    return value;
  });

const result = Bun.spawnSync([...bin.split(" "), "--check", "--no-config", "--parser", "glimmer", "."], { cwd: directory });
const told = new Set([...result.stderr.toString().matchAll(/^\[error\] (.*?): formatting .*would change/gm)].map(it => it[1]));

const count = { templates: 0, "the same tree": 0, "of which told": 0, "another tree": 0, "of which not told": 0 };
let shown = 0;
for (const name of readdirSync(directory).sort()) {
  const text = readFileSync(join(directory, name), "utf8");
  // Prettier never comes back from some of these.
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
    if (told.has(name)) {
      count["of which told"]++;
      if (args.includes("-told") && shown++ < show) console.log(`##### told ${name}\n${text}\n--- formatted\n${formatted}`);
    }
  } else {
    count["another tree"]++;
    if (!told.has(name)) {
      count["of which not told"]++;
      if (shown++ < show) console.log(`##### not told ${name}\n${text}\n--- formatted\n${formatted}`);
    }
  }
}
console.log(Object.entries(count).map(([what, number]) => `${what} ${number}`).join(", "));
