// Compares `bun lint` with oxlint on small projects, for plugin rules whose oxlint port behaves differently from the
// plugin. With an oxlint config, `bun lint` follows oxlint.
//
//   BUN_LINT="bun lint" OXLINT_BIN=<oxlint 1.87> OXLINT_TSGOLINT_PATH=<tsgolint 7.0.2003> bun compare.ts [--record] [name..]
//
// Without OXLINT_BIN, oxlint's reports are read from expected.json, which `--record` writes. It was recorded with
// oxlint 1.87.0 and tsgolint 7.0.2003. A report is `file:line:column+length rule`. Duplicates are kept, because two
// reports can start at the same position. labels.json likewise has `file rule line:column+length "text" | ..` for each
// report with more than one label or with label text.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { labelsOf, projects } from "./projects.ts";

const args = process.argv.slice(2);
const names = args.filter(it => !it.startsWith("--"));
const expectedPath = join(import.meta.dir, "expected.json");
const labelsPath = join(import.meta.dir, "labels.json");
const oxlint = process.env.OXLINT_BIN;
const [ours, ...oursArgs] = (process.env.BUN_LINT ?? "bun lint").split(" ");
// With names, `--record` keeps the other projects' recordings.
const expected: Record<string, string[]> =
  oxlint && names.length === 0 ? {} : JSON.parse(readFileSync(expectedPath, "utf8"));
const expectedLabels: Record<string, string[]> =
  oxlint && names.length === 0 ? {} : JSON.parse(readFileSync(labelsPath, "utf8"));

/**
 * `reports` has `file:line:column+length rule` for each diagnostic, at its first label, which is where oxlint prints
 * it. `labels` has all the labels of the diagnostics that `labelsOf` covers.
 */
function run(command: string, before: string[], cwd: string): { reports: string[]; labels: string[] } {
  const { stdout, stderr, error } = spawnSync(command, [...before, "-f", "json", "."], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1 << 28,
  });
  if (error) throw new Error(`${command} ${before.join(" ")}: ${error.message}`);
  let diagnostics;
  try {
    ({ diagnostics } = JSON.parse(stdout));
  } catch {
    throw new Error(`${command}: ${stderr || stdout}`);
  }
  // A file that oxlint can't parse doesn't test any rule, so point it out.
  for (const it of diagnostics) {
    // `TS(2391)` is an error from oxc's semantic analysis.
    if (!/^[a-z]/.test(it.code ?? "") && command === oxlint && !cwd.includes("syntax-error"))
      console.log(`NOT READ by oxlint: ${cwd} ${it.filename}: ${it.message}`);
  }
  const found = diagnostics.filter((it: any) => it.code);
  return {
    reports: found
      .map(
        (it: any) =>
          `${it.filename}:${it.labels[0].span.line}:${it.labels[0].span.column}+${it.labels[0].span.length} ${it.code}`,
      )
      .sort(),
    labels: found.flatMap((it: any) => (labelsOf(it) ? [`${it.filename} ${it.code} ${labelsOf(it)}`] : [])).sort(),
  };
}

/** Returns the items that occur more often in `some` than in `others`. */
function more(some: string[], others: string[]): string[] {
  const left = new Map<string, number>();
  for (const it of others) left.set(it, (left.get(it) ?? 0) + 1);
  return some.filter(it => {
    const count = left.get(it) ?? 0;
    left.set(it, count - 1);
    return count <= 0;
  });
}

let failed = 0;
for (const project of projects) {
  if (names.length > 0 && !names.includes(project.name)) continue;
  const cwd = mkdtempSync(join(tmpdir(), `oxlint-${project.name.replaceAll("/", "-")}-`));
  try {
    const tsconfig = project.typed
      ? {
          "tsconfig.json": JSON.stringify({
            compilerOptions: { strict: true, target: "esnext", module: "esnext", lib: ["esnext", "dom"] },
          }),
        }
      : {};
    const typed = project.typed ? ["--type-aware"] : [];
    for (const [path, text] of Object.entries({
      ".oxlintrc.json": JSON.stringify(project.config),
      ...tsconfig,
      ...project.files,
    })) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), text);
    }
    for (const [path, target] of Object.entries(project.links ?? {})) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      symlinkSync(join(cwd, target), join(cwd, path), "junction");
    }
    if (oxlint) {
      const { reports, labels } = run(oxlint, typed, cwd);
      expected[project.name] = reports;
      // The file only lists projects that have labels.
      delete expectedLabels[project.name];
      if (labels.length > 0) expectedLabels[project.name] = labels;
    }
    const wanted = [...(expected[project.name] ?? []), ...(expectedLabels[project.name] ?? [])];
    // One thread, fewer threads than files, and the default.
    for (const threads of project.name.startsWith("no-cycle/") ? ["--threads=1", "--threads=2", ""] : [""]) {
      const { reports, labels } = run(ours, [...oursArgs, ...typed, ...(threads ? [threads] : [])], cwd);
      const actual = [...reports, ...labels];
      const missing = more(wanted, actual);
      const extra = more(actual, wanted);
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
if (args.includes("--record")) {
  writeFileSync(expectedPath, JSON.stringify(expected, null, 1) + "\n");
  writeFileSync(labelsPath, JSON.stringify(expectedLabels, null, 1) + "\n");
}
console.log(`${projects.length} projects, ${failed} differ`);
process.exit(failed > 0 ? 1 : 0);
