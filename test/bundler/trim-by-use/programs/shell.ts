import { $ } from "bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = mkdtempSync(join(tmpdir(), "shell-use-"));
$.cwd(folder);
console.log(await $`echo hello ${"two words"}`.text());
await $`mkdir -p a/b && touch a/b/one.txt a/b/two.txt && echo content > a/b/one.txt`;
console.log((await $`ls a/b`.text()).trim().split("\n").sort().join(","));
console.log((await $`cat a/b/one.txt | /usr/bin/tr a-z A-Z`.text()).trim());
console.log((await $`echo a/b/*.txt`.text()).trim().split(" ").length);
await $`cp a/b/one.txt a/three.txt && mv a/three.txt a/four.txt`;
console.log((await $`FOO=bar /bin/sh -c 'echo $FOO'`.text()).trim());
const failed = await $`/bin/sh -c 'exit 3'`.nothrow().quiet();
console.log(failed.exitCode);
try {
  await $`cat missing.txt`.quiet();
} catch (error: any) {
  console.log(error.name, error.exitCode);
}
console.log($.escape("a b'c"), $.braces("x{1,2}").join(" "));
await $`rm -rf a`;
console.log((await $`ls`.text()).length);
await $`cd / && rm -rf ${folder}`;
