// Records expected.json.zst: for each file in cases.mjs the message that the rule in dump.cjs reports under oxlint. A file that oxlint
// doesn't parse is left out, and printed.
//
//   bun record.mjs --oxlint=<bin/oxlint of oxlint 1.87.0>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cases } from "./cases.mjs";

const option = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oxlint-"));
for (const [file, code] of Object.entries(cases)) fs.writeFileSync(path.join(directory, file), code);
fs.copyFileSync(path.join(import.meta.dirname, "dump.cjs"), path.join(directory, "dump.cjs"));
fs.writeFileSync(
  path.join(directory, ".oxlintrc.json"),
  JSON.stringify({
    categories: { correctness: "off" },
    ignorePatterns: ["dump.cjs"],
    jsPlugins: ["./dump.cjs"],
    rules: { "dump/all": "error" },
  }),
);
const { stdout } = Bun.spawnSync([option("oxlint"), "-f", "json"], { cwd: directory });
const { diagnostics } = JSON.parse(stdout.toString());
const expected = {};
for (const file of Object.keys(cases)) {
  const found = diagnostics.filter(it => it.filename === file);
  if (found.length === 1 && found[0].code === "dump(all)") expected[file] = found[0].message;
  else console.log(`${file}: ${found.map(it => it.message).join(" | ")}`);
}
fs.rmSync(directory, { recursive: true });
fs.writeFileSync(
  path.join(import.meta.dirname, "expected.json.zst"),
  Bun.zstdCompressSync(JSON.stringify(expected), { level: 19 }),
);
