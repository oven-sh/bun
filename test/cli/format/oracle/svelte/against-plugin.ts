// `bun format` against Prettier with prettier-plugin-svelte 4.1.1, on components: real ones, or those of generate.cjs.
//
//   bun against-plugin.ts <bun> <directory with node_modules/prettier, prettier-plugin-svelte and svelte> <directory with .svelte files> ['<options as JSON>']
//
// Prints the files for which the two differ: other bytes, or only one of them refuses. What `bun format` refuses because the plugin would
// damage the file is counted by itself.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [bun, withPrettier, directory] = process.argv.slice(2, 5).map(it => resolve(it));
const options = JSON.parse(process.argv[5] ?? "{}");
const require = createRequire(withPrettier + "/");
const prettier = require("prettier");
const plugin = require("prettier-plugin-svelte");
console.error = () => {};
const names = readdirSync(directory, { recursive: true, encoding: "utf8" }).filter(it => it.endsWith(".svelte"));

const root = mkdtempSync(join(tmpdir(), "svelte-against-plugin-"));
try {
  cpSync(directory, join(root, "src"), { recursive: true, filter: it => !it.includes("node_modules") });
  writeFileSync(join(root, ".prettierrc"), JSON.stringify({ plugins: ["prettier-plugin-svelte"], ...options }));
  const run = spawnSync(bun, ["format", "--log-level=warn", "src"], { cwd: root, maxBuffer: 1 << 30 });
  const refusals = new Map(
    Array.from(`${run.stderr}`.matchAll(/^\[error\] src[\\/](.+?\.svelte): (.*)$/gm), it => [it[1], it[2]]),
  );

  // What the plugin leaves behind for the next file of the process: see make-fixtures.ts.
  const literalline = prettier.doc.builders.literalline;
  const whole = [...literalline];
  const count = {
    same: 0,
    bothRefuse: 0,
    damaged: 0,
    pluginDamagesPrettier: 0,
    differ: 0,
    onlyWeRefuse: 0,
    onlyTheyRefuse: 0,
  };
  for (const name of names) {
    await prettier.format("<p></p>", { parser: "svelte", plugins: [plugin] });
    const format = prettier.format(readFileSync(join(directory, name), "utf8"), {
      ...options,
      parser: "svelte",
      plugins: [plugin],
    });
    const theirs: string | null = await format.catch(() => null);
    const refusal = refusals.get(name.replaceAll("\\", "/"));
    const ours = refusal === undefined ? readFileSync(join(root, "src", name), "utf8") : null;
    let kind: keyof typeof count = ours === theirs ? (ours === null ? "bothRefuse" : "same") : "differ";
    if (literalline.length !== whole.length) {
      literalline.length = 0;
      literalline.push(...whole);
      kind = "pluginDamagesPrettier";
    } else if (refusal?.includes("would change what is in it")) kind = "damaged";
    else if (ours === null && theirs !== null) kind = "onlyWeRefuse";
    else if (theirs === null && ours !== null) kind = "onlyTheyRefuse";
    count[kind]++;
    if (kind === "differ" || kind === "onlyWeRefuse" || kind === "onlyTheyRefuse") console.log(`${kind} ${name}`);
  }
  console.log(JSON.stringify(count));
} finally {
  rmSync(root, { recursive: true });
}
