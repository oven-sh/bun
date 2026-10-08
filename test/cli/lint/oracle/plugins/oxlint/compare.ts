// Compares `bun lint` with oxlint on small projects, for the rules of plugins whose port in oxlint differs from the plugin: with a
// configuration of oxlint, oxlint is what counts.
//
//   BUN_LINT="<bun-lint> cli" OXLINT_BIN=<oxlint 1.80> bun compare.ts [--record] [name..]
//
// Without OXLINT_BIN, what oxlint reports is read from expected.json, which `--record` writes.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { projects } from "./projects.ts";

const args = process.argv.slice(2);
const names = args.filter(it => !it.startsWith("--"));
const expectedPath = join(import.meta.dir, "expected.json");
const oxlint = process.env.OXLINT_BIN;
const [ours, ...oursArgs] = (process.env.BUN_LINT ?? "bun lint").split(" ");
const expected: Record<string, string[]> = oxlint ? {} : JSON.parse(readFileSync(expectedPath, "utf8"));

/** `file:line:column rule` of each diagnostic, at its first label, which is what oxlint prints. */
function run(command: string, before: string[], cwd: string): string[] {
  const { stdout, stderr, error } = spawnSync(command, [...before, "-f", "json", "."], { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 1 << 28 });
  if (error) throw new Error(`${command} ${before.join(" ")}: ${error.message}`);
  let diagnostics;
  try {
    ({ diagnostics } = JSON.parse(stdout));
  } catch {
    throw new Error(`${command}: ${stderr || stdout}`);
  }
  return diagnostics
    .filter((it: any) => it.code)
    .map((it: any) => `${it.filename}:${it.labels[0].span.line}:${it.labels[0].span.column} ${it.code}`)
    .sort();
}

let failed = 0;
for (const project of projects) {
  if (names.length > 0 && !names.includes(project.name)) continue;
  const cwd = mkdtempSync(join(tmpdir(), "oxlint-"));
  try {
    for (const [path, text] of Object.entries({ ".oxlintrc.json": JSON.stringify(project.config), ...project.files })) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text);
    }
    if (oxlint) expected[project.name] = run(oxlint, [], cwd);
    const wanted = expected[project.name] ?? [];
    // With one thread, with fewer threads than files, and with as many as there are.
    for (const threads of project.name.startsWith("no-cycle/") ? ["--threads=1", "--threads=2", ""] : [""]) {
      const actual = run(ours, [...oursArgs, ...(threads ? [threads] : [])], cwd);
      const missing = wanted.filter(it => !actual.includes(it));
      const extra = actual.filter(it => !wanted.includes(it));
      if (missing.length + extra.length > 0) {
        failed++;
        console.log(`FAIL ${project.name} ${threads}: ${project.about}`);
        for (const it of missing.slice(0, 10)) console.log(`  only oxlint: ${it}`);
        for (const it of extra.slice(0, 10)) console.log(`  only ours:   ${it}`);
        break;
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
if (args.includes("--record")) writeFileSync(expectedPath, JSON.stringify(expected, null, 1) + "\n");
console.log(`${projects.length} projects, ${failed} differ`);
process.exit(failed > 0 ? 1 : 0);
