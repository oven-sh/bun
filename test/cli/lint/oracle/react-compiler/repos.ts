// What oxlint reports with its rules of the React Compiler in the repositories of ../repos, with their configuration.
//
//   sudo bun repos.ts --work=<work of ../repos/run.ts> --out=<jsonl> [--only=owner/repo,..] [--manifest=<path>]
//                     [--judge=<oxlint>] [--judge-only] [--tool="<path> <arguments>"] [--all] [--runs=<directory>]
//                     [--cpus=0-7] [--seconds=600] [--memory-kb=8000000]
//
// The clones are those of `../repos/run.ts --stages=clone,install`. Each command runs in its sandbox, in a copy of the clone.
// Their oxlint runs if it has the rules (1.79.0 or later), else the judge: `--judge`, or the one in <work>/.tools. With
// `--judge-only` the judge runs everywhere.
// `--tool` runs another command in place of both, with the same arguments. What a run writes is in `--runs` (<work>/.runs)
// until it ends.
//
// Their arguments, but for those that hide diagnostics (`--quiet`) and those that cost time and change nothing for these rules
// (`--type-aware`, `--type-check`). A repository is left out if `--print-config` does not have the plugin `react`, unless `--all`.
//
// The output: a line {"repo", "version", "files", "exit", ..} for each run, then a line as of oxlint.ts for each file that has
// diagnostics of the rules; the path starts with `owner__repo/`.

import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { ownDirectory, sandboxed, type Limits } from "../repos/sandbox.ts";
import { byFile, jsonDocuments, JsonlWriter, options, RULE_NAMES, table, type RawReport } from "./shared.ts";

type Run = {
  tool: string;
  cwd?: string;
  bin?: string;
  args: string[];
  shell?: boolean;
  env?: Record<string, string>;
  theirArgs?: string[];
};
type Entry = { repo: string; pinned?: Record<string, string>; lint?: Run[] };

const { flags } = options(process.argv.slice(2));
if (!flags.has("work") || !flags.has("out")) throw new Error("usage: bun repos.ts --work=<directory> --out=<jsonl>");
const work = realpathSync(flags.get("work")!);
const tools = join(work, ".tools");
const allRuns = resolve(flags.get("runs") ?? join(work, ".runs"));
const manifestPath = flags.get("manifest") || join(import.meta.dir, "..", "repos", "manifest.json");
const manifest: Entry[] = JSON.parse(readFileSync(manifestPath, "utf8"));
const only = flags.has("only") ? new Set(flags.get("only")!.split(",")) : null;
const judge = resolve(flags.get("judge") ?? join(tools, "node_modules", ".bin", "oxlint"));
const instead = flags.get("tool")?.split(" ") ?? null;
const limits: Limits = {
  cpus: flags.get("cpus") ?? null,
  memoryKb: Number(flags.get("memory-kb") ?? 8_000_000),
  seconds: Number(flags.get("seconds") ?? 600),
};

const nameOf = (repo: string) => repo.replace("/", "__");
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
let serial = 0;

/** What an executable needs to be seen: the `node_modules` that it is installed in, or its directory. */
function around(executable: string): string {
  const path = realpathSync(executable);
  const at = path.indexOf("/node_modules/");
  return at < 0 ? dirname(path) : path.slice(0, at + "/node_modules".length);
}

/** One command in a copy of the repository. What it writes is thrown away. */
async function inCopy(
  entry: Entry,
  run: Run,
  cmd: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const runs = join(allRuns, nameOf(entry.repo));
  const base = join(runs, `react-compiler-${process.pid}-${serial++}`);
  const [upper, scratch, out] = ["upper", "work", "out"].map(name => ownDirectory(join(base, name)));
  const clone = join(work, nameOf(entry.repo));
  const code = await sandboxed({
    cmd,
    cwd: join(clone, run.cwd ?? "."),
    env: run.env,
    ro: [tools, around(judge), ...(instead ? [around(instead[0])] : [])].filter(existsSync),
    rw: [out],
    overlay: { lower: clone, upper, work: scratch },
    stdout: join(out, "stdout"),
    stderr: join(out, "stderr"),
    limits,
  });
  const result = { code, stdout: read(join(out, "stdout")), stderr: read(join(out, "stderr")) };
  if (!realpathSync(base).startsWith(realpathSync(runs) + "/react-compiler-"))
    throw new Error(`not a directory of this script: ${base}`);
  rmSync(base, { recursive: true, force: true });
  return result;
}

/** Their executable: the one that is installed for the directory of the command, or the version of their lock file. */
function theirTool(entry: Entry, run: Run): string | null {
  const root = join(work, nameOf(entry.repo));
  if (run.bin) return join(root, run.bin);
  for (let at = join(root, run.cwd ?? "."); at.startsWith(root); at = dirname(at)) {
    const path = join(at, "node_modules", ".bin", "oxlint");
    if (existsSync(path)) return path;
  }
  const pinned = entry.pinned?.oxlint;
  const path = pinned ? join(tools, `oxlint-${pinned}`, "node_modules", ".bin", "oxlint") : null;
  return path !== null && existsSync(path) ? path : null;
}

function commandOf(run: Run, before: string[], args: string[], after: string[]) {
  if (!run.shell) return [...before, ...args, ...after];
  const script = `n=${before.length}; exec "\${@:1:$n}" ${args.join(" ")} "\${@:$((n+1))}"`;
  return ["bash", "-c", script, "bash", ...before, ...after];
}

const hasTheRules = (version: string | null) => {
  const [major, minor] = (version ?? "0.0").split(".").map(Number);
  return major > 1 || (major === 1 && minor >= 79);
};
const DROPPED = /^--(?:quiet|type-aware|type-check)$/;

const writer = new JsonlWriter(resolve(flags.get("out")!));
const rows: (string | number)[][] = [];
const byRule = new Map<string, number>(RULE_NAMES.map(rule => [rule, 0]));
for (const entry of manifest) {
  if (only !== null && !only.has(entry.repo)) continue;
  if (!existsSync(join(work, nameOf(entry.repo), ".git"))) continue;
  for (const run of entry.lint ?? []) {
    if (run.tool !== "oxlint") continue;
    let command = instead;
    let version: string | null = null;
    let whose = "another tool";
    if (command === null) {
      const theirs = flags.has("judge-only") ? null : theirTool(entry, run);
      if (theirs !== null) {
        version = /\d+\.\d+\.\d+[\w.-]*/.exec((await inCopy(entry, run, [theirs, "--version"])).stdout)?.[0] ?? null;
      }
      whose = theirs !== null && hasTheRules(version) ? "theirs" : "the judge";
      command = [whose === "theirs" ? theirs! : judge];
      if (whose === "the judge") {
        version = /\d+\.\d+\.\d+[\w.-]*/.exec((await inCopy(entry, run, [judge, "--version"])).stdout)?.[0] ?? null;
      }
    }
    const args = [...run.args, ...(run.theirArgs ?? [])].filter(arg => !DROPPED.test(arg));
    if (!flags.has("all")) {
      const at = args.findIndex(arg => arg === "-c" || arg === "--config");
      const config = at >= 0 ? args.slice(at, at + 2) : args.filter(arg => /^(?:--config|-c)=/.test(arg));
      const plugin = args.includes("--react-plugin");
      const printed = await inCopy(entry, run, [...command, ...config, "--print-config"]);
      const [resolved] = jsonDocuments(printed.stdout) as Generator<{ plugins?: string[] }>;
      // Nothing printed: the configuration is refused, which the run below will say.
      if (!plugin && resolved !== undefined && resolved.plugins?.includes("react") !== true) continue;
    }
    const result = await inCopy(entry, run, commandOf(run, command, args, ["-f", "json"]));
    let report: RawReport | null = null;
    for (const document of jsonDocuments(result.stdout)) {
      if ((document as Partial<RawReport>).number_of_files !== undefined) report = document as RawReport;
    }
    let diagnostics = 0;
    let files = 0;
    const header = { repo: entry.repo, cwd: run.cwd ?? ".", args, whose, version, exit: result.code };
    if (report === null) {
      writer.write({ ...header, failed: (result.stderr + result.stdout).slice(0, 1500) });
    } else {
      writer.write({ ...header, files: report.number_of_files, rules: report.number_of_rules });
      for (const [file, found] of [...byFile(report)].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const ofTheRules = found.filter(d => d.rule !== null && RULE_NAMES.includes(d.rule));
        if (ofTheRules.length === 0) continue;
        files++;
        diagnostics += ofTheRules.length;
        for (const diagnostic of ofTheRules) byRule.set(diagnostic.rule!, byRule.get(diagnostic.rule!)! + 1);
        const path = normalize(join(nameOf(entry.repo), run.cwd ?? ".", file));
        writer.write({ path, parse: "ok", diagnostics: ofTheRules });
      }
    }
    rows.push([
      entry.repo,
      whose,
      version ?? "-",
      report === null ? "no report" : String(result.code),
      report?.number_of_files ?? 0,
      files,
      diagnostics,
    ]);
  }
}
writer.close();
console.log(
  table(
    ["Repository", "Whose oxlint", "Version", "Exit", "Files", "Files with diagnostics", "Diagnostics of the 22 rules"],
    rows,
  ),
);
console.log();
console.log(table(["Rule", "Diagnostics"], [...byRule]));
