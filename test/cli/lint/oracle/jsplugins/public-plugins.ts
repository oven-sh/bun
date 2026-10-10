// Public plugins under real ESLint and under `bun-lint js_plugin batch`, with all their rules that run without types.
//
//     cd <a directory where the plugins are installed>
//     ESLINT_DIR=.. TYPESCRIPT_ESLINT_DIR=.. bun public-plugins.ts <bun-lint> cases.jsonl [package=prefix ..]
//
// The cases are those of `cases.ts`, with `"allowInlineConfig": false`: `batch` does not apply comments.
// What is known to differ: `/* global */` and `/* exported */` comments, which `batch` does apply; a rule that parses text with
// `languageOptions.parser`, which is not there; a lone surrogate in a message.

import { join } from "node:path";

const [binary, cases, ...given] = process.argv.slice(2);
const plugins = given.length
  ? given
  : [
      "eslint-plugin-unicorn=unicorn",
      "eslint-plugin-n=n",
      "eslint-plugin-promise=promise",
      "eslint-plugin-react=react",
      "eslint-plugin-jsx-a11y=jsx-a11y",
      "eslint-plugin-jsdoc=jsdoc",
      "eslint-plugin-import-x=import-x",
      "@stylistic/eslint-plugin=@stylistic",
      "eslint-plugin-regexp=regexp",
      "eslint-plugin-sonarjs=sonarjs",
      "eslint-plugin-perfectionist=perfectionist",
      "eslint-plugin-security=security",
      "eslint-plugin-simple-import-sort=simple-import-sort",
      "eslint-plugin-unused-imports=unused-imports",
      "@eslint-community/eslint-plugin-eslint-comments=eslint-comments",
    ];

async function run(cmd: string[], into?: string) {
  const started = performance.now();
  const child = Bun.spawn({ cmd, stdout: into ? Bun.file(into) : "pipe", stderr: "ignore" });
  const out = into ? "" : await new Response(child.stdout as ReadableStream).text();
  await child.exited;
  return { out, seconds: ((performance.now() - started) / 1000).toFixed(1) };
}

for (const plugin of plugins) {
  const [name, prefix] = plugin.split("=");
  const flags = [`--plugin=${name}`, `--alias=${prefix}`];
  const file = (kind: string) => `${prefix.replace(/\W/g, "")}.${kind}.jsonl`;
  const eslint = ["bun", join(import.meta.dir, "run-eslint.ts"), ...flags];
  const rules = (await run([...eslint, "--list-rules"])).out.trim().split("\n").at(-1)!;
  const theirs = await run([...eslint, `--rules=${rules}`, cases], file("expected"));
  const ours = await run([binary, "js_plugin", "batch", ...flags, `--rules=${rules}`, cases], file("actual"));
  const compared = await run(["bun", join(import.meta.dir, "compare.ts"), cases, file("expected"), file("actual"), "--show=0"]);
  console.log(`${name}: ${Object.keys(JSON.parse(rules)).length} rules, ESLint ${theirs.seconds} s, ours ${ours.seconds} s`);
  console.log(compared.out.trim().replace(/^/gm, "  "));
}
