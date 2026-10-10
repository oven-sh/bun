// All of `compare.ts`: each plugin on public projects and on the fixtures of its own repository.
//
//     bun run.ts [--fix] [--show=0] [--threads=8] <packages> <corpora> [name ..] -- <bun lint, as a command>
//
// `<packages>`: a directory where `bun add` has installed eslint, typescript@5, typescript-eslint, globals, @eslint/js and
// the packages that `configs/*.mjs` import. The configurations are copied there. `<corpora>`: a directory with shallow clones, by the name
// of the repository, of what is listed below (`git clone --depth 1 https://github.com/<owner>/<name>`).

import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// The configuration, the repository, the patterns.
const cases: [string, string, string[]][] = [
  ["vue", "element-plus/element-plus", ["**/*.vue"]],
  ["vue", "vuejs/eslint-plugin-vue", ["tests/fixtures/**/*.vue"]],
  ["svelte", "huntabyte/shadcn-svelte", ["**/*.svelte"]],
  ["svelte", "sveltejs/eslint-plugin-svelte", ["packages/eslint-plugin-svelte/tests/fixtures/rules/**/*.svelte"]],
  ["astro", "ota-meshi/eslint-plugin-astro", ["tests/fixtures/**/*.astro"]],
  ["astro", "withastro/docs", ["src/**/*.astro"]],
  ["markdown-processor", "eslint/eslint", ["docs/**/*.md"]],
  ["markdown-processor", "eslint/markdown", ["**/*.md"]],
  ["markdown-processor", "sveltejs/eslint-plugin-svelte", ["docs/**/*.md"]],
  ["markdown-language", "eslint/eslint", ["docs/**/*.md"]],
  ["markdown-language", "eslint/markdown", ["**/*.md"]],
  ["json", "ota-meshi/eslint-plugin-jsonc", ["**/*.json", "**/*.jsonc", "**/*.json5"]],
  ["json", "huntabyte/shadcn-svelte", ["**/*.json"]],
  ["css", "eslint/css", ["**/*.css"]],
  ["css", "huntabyte/shadcn-svelte", ["**/*.css"]],
  ["css", "withastro/docs", ["**/*.css"]],
  ["jsonc", "ota-meshi/eslint-plugin-jsonc", ["**/*.json", "**/*.jsonc", "**/*.json5"]],
  ["yml", "ota-meshi/eslint-plugin-yml", ["tests/fixtures/rules/**/*.yaml", "tests/fixtures/rules/**/*.yml"]],
  ["toml", "ota-meshi/eslint-plugin-toml", ["**/*.toml"]],
  ["mdx", "mdx-js/eslint-mdx", ["test/fixtures/**/*.md", "test/fixtures/**/*.mdx"]],
  ["mdx", "withastro/docs", ["src/content/docs/en/**/*.mdx"]],
  ["html", "BenoitZugmeyer/eslint-plugin-html", ["**/*.html", "**/*.htm"]],
  ["graphql", "graphql-hive/graphql-eslint", ["examples/**/*.graphql", "examples/**/*.js", "packages/**/*.graphql"]],
  ["angular", "gothinkster/angular-realworld-example-app", ["src/**/*.html", "src/**/*.ts"]],
  ["angular", "tomastrajan/angular-ngrx-material-starter", ["projects/**/*.html", "projects/**/*.ts"]],
  ["babel", "eslint/eslint", ["lib/**/*.js"]],
  ["babel", "graphql-hive/graphql-eslint", ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]],
];

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const ours = argv.slice(split + 1);
const flags = argv.slice(0, split).filter(it => it.startsWith("--"));
const [packagesArgument, corporaArgument, ...names] = argv.slice(0, split).filter(it => !it.startsWith("--"));
const [packages, corpora] = [resolve(packagesArgument), resolve(corporaArgument)];

for (const name of readdirSync(join(import.meta.dir, "configs"))) {
  copyFileSync(join(import.meta.dir, "configs", name), join(packages, name));
}
let failed = 0;
for (const [config, repository, patterns] of cases) {
  if (names.length > 0 && !names.includes(config)) continue;
  const directory = join(corpora, repository.split("/")[1]);
  if (!existsSync(directory)) {
    console.log(`${config} on ${repository}: not cloned`);
    continue;
  }
  const cmd = ["bun", join(import.meta.dir, "compare.ts"), ...flags, join(packages, `${config}.mjs`), directory];
  const child = Bun.spawn({ cmd: [...cmd, ...patterns, "--", ...ours], stdout: "pipe", stderr: "inherit" });
  const out = (await new Response(child.stdout).text()).trimEnd().split("\n");
  failed += Number((await child.exited) !== 0);
  console.log(`${config} on ${repository}: ${out.pop()}`);
  if (out.length > 0) console.log(out.join("\n").replace(/^/gm, "    "));
}
process.exit(failed === 0 ? 0 : 1);
