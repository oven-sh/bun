// Run the vendored V8 mjsunit regexp tests under node (the oracle engine).
//
//   node test/js/third_party/v8-regexp/run-under-node.mjs [substring-filter]
//
// Each test file runs in its own node process (fresh globals, sloppy script
// mode) via one-file.mjs. Prints PASS/FAIL per file; exits non-zero on any
// failure. A file that passes here but fails under bun is a bun/JSC
// divergence, not a test problem.

import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "mjsunit");
const runner = join(here, "one-file.mjs");
const filter = process.argv[2] || "";

const files = readdirSync(dir)
  .filter(f => f.endsWith(".js") && f.includes(filter))
  .sort();

let failures = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, [runner, join(dir, file)], { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    console.log(`PASS ${file}`);
  } catch (e) {
    failures++;
    const detail = (e.stdout ? String(e.stdout) : "") + (e.stderr ? String(e.stderr) : "");
    console.log(`FAIL ${file}\n${detail.split("\n").slice(0, 6).join("\n")}`);
  }
}
console.log(`\n${files.length - failures}/${files.length} files passed`);
process.exit(failures ? 1 : 0);
