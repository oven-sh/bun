// Popular open-source repositories as they are (their configuration files, plugins, ignore files and commands), through their own
// linter and formatter and through `bun lint` and `bun format`. See README.md.
//
//     bun run.ts --bun=<bun> --work=<directory> [--only=owner/repo,..] [--stages=clone,install,lint,fix,format,time,clean]
//                [--jobs=4] [--cpus=0-15] [--memory-kb=16000000] [--seconds=900] [--keep]
//     bun run.ts --work=<directory> --table                 the tables, from the results that are there
//     bun run.ts --bun=<bun> --work=<directory> --discover=owner/repo[@ref]   clones it and prints what an entry of the manifest needs
//     bun run.ts --bun=<bun> --work=<directory> --exec=owner/repo [--cwd=packages/a] -- <command>   in a copy of the clone, in the sandbox.
//                `BUN`, `TOOLS` are the executable and the `node_modules/.bin` of the judges
//
// Not part of CI: it needs the network, root, and tens of gigabytes.

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  compareEslint,
  compareOxlint,
  compareTrees,
  cut,
  writtenFiles,
  type LintComparison,
  type OxlintReport,
  type TreeComparison,
} from "./compare.ts";
import { ownDirectory, sandboxed, type Command, type Limits } from "./sandbox.ts";

type Run = {
  tool: "eslint" | "oxlint" | "prettier" | "oxfmt";
  /** Relative to the repository. */
  cwd?: string;
  /** Their executable, relative to the repository, where their command does not take it from `node_modules/.bin`. */
  bin?: string;
  /** The arguments of their command, without what chooses a format, writes files or keeps a cache. */
  args: string[];
  // `args` are as in their script, which a shell reads: `lib/**/*.js` without quotes is what `sh` makes of it.
  shell?: boolean;
  env?: Record<string, string>;
  /** Arguments that only one of the two gets. Each needs a reason in `notes`. */
  theirArgs?: string[];
  ourArgs?: string[];
  /** Where the command is from: the name of the script, or the file of the workflow. */
  from?: string;
  notes?: string;
};
type Entry = {
  repo: string;
  sha: string;
  install: "none" | "bun" | "pnpm" | "yarn" | "yarn1";
  installArgs?: string[];
  /** Where their tools are installed, if not at the top: `tools/eslint`. */
  installCwd?: string;
  /**
   * With `install: "none"`: the versions of their tools in their lock file. oxlint and oxfmt need nothing else of a repository's
   * dependencies, unless the configuration has plugins in JavaScript or asks for types.
   */
  pinned?: Partial<Record<Run["tool"], string>>;
  /** Commands that have to run once after the installation, in the sandbox, because a configuration file needs what they generate. */
  prepare?: string[][];
  lint?: Run[];
  format?: Run[];
  notes?: string;
};

const dashes = process.argv.indexOf("--");
const flags = new Map(
  process.argv.slice(2, dashes < 0 ? undefined : dashes).map(it => {
    const [, name, value] = /^--([\w-]+)(?:=(.*))?$/s.exec(it) ?? [];
    if (!name) throw new Error(`not a flag: ${it}`);
    return [name, value ?? ""] as const;
  }),
);
const work = resolve(flags.get("work") ?? "");
if (!flags.has("work")) throw new Error("--work=<directory>");
const bun = flags.has("bun") ? realpathSync(flags.get("bun")!) : "";
const limits: Limits = {
  cpus: flags.get("cpus") ?? null,
  memoryKb: Number(flags.get("memory-kb") ?? 16_000_000),
  seconds: Number(flags.get("seconds") ?? 900),
};
const here = import.meta.dir;
const manifest: Entry[] = JSON.parse(readFileSync(flags.get("manifest") || join(here, "manifest.json"), "utf8"));
/** The versions that `bun lint` and `bun format` are compared with where a repository has none installed, and Prettier always. */
const JUDGES = { eslint: "10.12.0", prettier: "3.9.9", oxlint: "1.80.0", oxfmt: "0.72.0" };

const nameOf = (repo: string) => repo.replace("/", "__");
const cloneOf = (repo: string) => join(work, nameOf(repo));
const resultsOf = (repo: string) => join(work, ".results", `${nameOf(repo)}.json`);
const cache = join(work, ".cache");
const tools = join(work, ".tools");

/** Removes a directory of runs. Only what this script has made is below `<work>/.runs`. */
function removeRuns(path: string) {
  const runs = join(realpathSync(work), ".runs");
  if (!existsSync(path)) return;
  if (!realpathSync(path).startsWith(runs + "/")) throw new Error(`not a directory of runs: ${path}`);
  rmSync(path, { recursive: true, force: true });
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const head = (text: string, length = 1500) =>
  text.length > length ? `${text.slice(0, length / 2)}\n…\n${text.slice(-length / 2)}` : text;

type Outcome = {
  code: number;
  seconds: number | null;
  user: number | null;
  rssMb: number | null;
  instructions: number | null;
  out: string;
  stdout: string;
  stderr: string;
  upper: string;
};

let serial = 0;

/** One command in a copy of the repository: what it writes is in `upper`, and the clone stays as it is. */
async function inCopy(
  entry: Entry,
  label: string,
  command: Pick<Command, "cmd" | "env"> & { cwd?: string; upper?: string; perf?: boolean; seconds?: number },
): Promise<Outcome> {
  const base = join(work, ".runs", nameOf(entry.repo), `${label}-${serial++}`);
  const [upper, out] = [command.upper ?? ownDirectory(join(base, "upper")), ownDirectory(join(base, "out"))];
  const clone = cloneOf(entry.repo);
  const code = await sandboxed({
    cmd: command.cmd,
    cwd: join(clone, command.cwd ?? "."),
    env: command.env,
    ro: [dirname(bun), tools],
    rw: [out],
    overlay: { lower: clone, upper, work: ownDirectory(join(dirname(upper), "work")) },
    stdout: join(out, "stdout"),
    stderr: join(out, "stderr"),
    time: join(out, "time"),
    perf: command.perf ? join(out, "perf") : undefined,
    limits: { ...limits, seconds: Math.min(limits.seconds, command.seconds ?? limits.seconds) },
  });
  // `time` writes a line of its own first if the command fails.
  const [seconds, user, system, rss] = (read(join(out, "time")).trim().split("\n").at(-1) ?? "").split(" ").map(Number);
  const instructions = Number(/^(\d+),,instructions/m.exec(read(join(out, "perf")))?.[1]);
  return {
    code,
    seconds: Number.isFinite(seconds) ? seconds : null,
    user: Number.isFinite(system) ? Math.round((user + system) * 100) / 100 : null,
    rssMb: Number.isFinite(rss) ? Math.round(rss / 1024) : null,
    instructions: Number.isFinite(instructions) ? instructions : null,
    out: base,
    stdout: join(out, "stdout"),
    stderr: join(out, "stderr"),
    upper,
  };
}

const summary = ({ code, seconds, user, rssMb, instructions, stderr, stdout }: Outcome) => ({
  code,
  seconds,
  user,
  rssMb,
  instructions,
  stderr: head(read(stderr)),
  // A report is not kept. What is printed instead of one is.
  stdout: /^\s*[[{]/.test(read(stdout).slice(0, 100)) ? undefined : head(read(stdout), 800),
});

/** In the clone itself, with the network: git and package managers. */
async function inClone(
  entry: Entry,
  label: string,
  cmd: string[],
  env: Record<string, string> = {},
  network = true,
  cwd = ".",
) {
  const out = ownDirectory(join(work, ".runs", nameOf(entry.repo), `${label}-${serial++}`));
  const code = await sandboxed({
    cmd,
    cwd: join(cloneOf(entry.repo), cwd),
    env: {
      BUN_INSTALL_CACHE_DIR: join(cache, "bun"),
      COREPACK_HOME: join(cache, "corepack"),
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      YARN_CACHE_FOLDER: join(cache, "yarn"),
      YARN_ENABLE_GLOBAL_CACHE: "false",
      YARN_ENABLE_SCRIPTS: "false",
      YARN_ENABLE_TELEMETRY: "0",
      GIT_LFS_SKIP_SMUDGE: "1",
      GIT_TERMINAL_PROMPT: "0",
      CI: "1",
      ...env,
    },
    ro: bun ? [dirname(bun), tools] : [],
    rw: [cloneOf(entry.repo), ownDirectory(cache), out],
    network,
    stdout: join(out, "stdout"),
    stderr: join(out, "stderr"),
    limits: { ...limits, seconds: 1800 },
  });
  const result = { code, stdout: read(join(out, "stdout")), stderr: read(join(out, "stderr")) };
  removeRuns(out);
  return result;
}

async function clone(entry: Entry, ref?: string) {
  const directory = cloneOf(entry.repo);
  if (existsSync(join(directory, ".git", "HEAD"))) {
    const at = await inClone(entry, "git", ["git", "rev-parse", "HEAD"], {}, false);
    if (!entry.sha || at.stdout.trim() === entry.sha) return at.stdout.trim();
  }
  ownDirectory(directory);
  const script = [
    "set -e",
    "[ -d .git ] || git init -q .",
    `git fetch -q --depth 1 --filter=blob:none https://github.com/${entry.repo}.git "$1"`,
    "git checkout -q --force FETCH_HEAD",
    "git rev-parse HEAD",
  ].join("\n");
  const result = await inClone(entry, "git", ["bash", "-c", script, "clone", entry.sha || ref || "HEAD"]);
  if (result.code !== 0) throw new Error(`clone: ${head(result.stderr, 600)}`);
  return result.stdout.trim();
}

async function install(entry: Entry) {
  const extra = entry.installArgs ?? [];
  const root = cloneOf(entry.repo);
  // Their version of pnpm. Not through corepack: the one that comes with Node.js does not know how to start pnpm 12.
  const pnpm =
    /^pnpm@([\w.-]+)/.exec(JSON.parse(read(join(root, "package.json")) || "{}").packageManager ?? "")?.[1] ?? "latest";
  if (entry.install === "pnpm") await installTools(pinnedTool("pnpm", pnpm), { pnpm });
  // A lock file of another package manager is read, and counts as changed.
  const theirLock = (
    await inClone(entry, "git", ["git", "ls-files", "bun.lock", "bun.lockb"], {}, false)
  ).stdout.trim();
  const frozen = theirLock ? "--frozen-lockfile" : "--no-save";
  const commands: Record<Entry["install"], string[] | null> = {
    none: null,
    bun: [bun, "install", frozen, "--ignore-scripts", "--no-progress", ...extra],
    pnpm: [
      join(pinnedTool("pnpm", pnpm), "node_modules", ".bin", "pnpm"),
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      `--store-dir=${join(cache, "pnpm")}`,
      ...extra,
    ],
    yarn: ["corepack", "yarn", "install", "--immutable", "--mode=skip-build", ...extra],
    yarn1: ["corepack", "yarn", "install", "--frozen-lockfile", "--ignore-scripts", "--non-interactive", ...extra],
  };
  const cmd = commands[entry.install];
  const started = performance.now();
  let result = { code: 0, stdout: "", stderr: "" };
  if (cmd) result = await inClone(entry, "install", cmd, {}, true, entry.installCwd);
  // `bun install` writes the lock file that it has made of another package manager's, which would be formatted too.
  if (entry.install === "bun" && frozen === "--no-save") {
    await inClone(entry, "git", ["rm", "-f", "bun.lock"], {}, false, entry.installCwd);
  }
  const prepared: { cmd: string[]; code: number; stderr: string }[] = [];
  for (const cmd of result.code === 0 ? (entry.prepare ?? []) : []) {
    const it = await inClone(entry, "prepare", cmd, { PATH: `${dirname(bun)}:/usr/local/bin:/usr/bin:/bin` }, false);
    prepared.push({ cmd, code: it.code, stderr: head(it.stderr, 600) });
  }
  const du = Bun.spawnSync({ cmd: ["du", "-sm", cloneOf(entry.repo)] })
    .stdout.toString()
    .split("\t")[0];
  // What the installation has left in the tree would be linted and formatted too.
  const status = await inClone(entry, "git", ["git", "status", "--porcelain"], {}, false);
  return {
    with: entry.install,
    code: result.code,
    seconds: Math.round((performance.now() - started) / 1000),
    megabytes: Number(du),
    stderr: result.code === 0 ? "" : head(result.stderr + result.stdout),
    prepared,
    changed: status.stdout.trim().split("\n").filter(Boolean).slice(0, 20),
  };
}

/** Packages of npm in a directory of their own below `<work>/.tools`, which every run can read. */
async function installTools(directory: string, dependencies: Record<string, string>) {
  const wanted = JSON.stringify({ private: true, dependencies });
  if (existsSync(join(directory, "node_modules", ".bin")) && read(join(directory, "package.json")) === wanted) return;
  ownDirectory(tools);
  ownDirectory(directory);
  writeFileSync(join(directory, "package.json"), wanted);
  const out = ownDirectory(join(work, ".runs", "_tools", String(serial++)));
  const code = await sandboxed({
    cmd: [bun, "install", "--ignore-scripts", "--no-progress"],
    cwd: directory,
    env: { BUN_INSTALL_CACHE_DIR: join(cache, "bun") },
    ro: [dirname(bun)],
    rw: [directory, ownDirectory(cache), out],
    network: true,
    stdout: join(out, "stdout"),
    stderr: join(out, "stderr"),
    limits,
  });
  if (code !== 0) throw new Error(`could not install ${JSON.stringify(dependencies)}: ${read(join(out, "stderr"))}`);
  removeRuns(out);
}

const pinnedTool = (tool: string, version: string) => join(tools, `${tool}-${version}`);

/**
 * Their executable: the one that is installed for the directory the command runs in, or the version that their lock file has, or
 * the judge.
 */
function theirTool(entry: Entry, run: Run) {
  const root = cloneOf(entry.repo);
  if (run.bin) return { path: join(root, run.bin), installed: true };
  for (let at = join(root, run.cwd ?? "."); at.startsWith(root); at = dirname(at)) {
    const path = join(at, "node_modules", ".bin", run.tool);
    if (existsSync(path)) return { path, installed: true };
  }
  const pinned = entry.pinned?.[run.tool];
  return {
    path: join(pinned ? pinnedTool(run.tool, pinned) : tools, "node_modules", ".bin", run.tool),
    installed: !!pinned,
  };
}

async function versionOf(entry: Entry, run: Run, path: string) {
  const it = await inCopy(entry, "version", { cmd: [path, "--version"], cwd: run.cwd });
  const version = /\d+\.\d+\.\d+[\w.-]*/.exec(read(it.stdout))?.[0] ?? null;
  removeRuns(it.out);
  return version;
}

/** The command line of a tool: `before` is the executable and what comes first, `after` what this script adds. */
function commandOf(run: Run, before: string[], after: string[]) {
  if (!run.shell) return [...before, ...run.args, ...after];
  return [
    "bash",
    "-c",
    `n=${before.length}; exec "\${@:1:$n}" ${run.args.join(" ")} "\${@:$((n+1))}"`,
    "bash",
    ...before,
    ...after,
  ];
}

/** A run of ours that takes four times as long as theirs, and more than three minutes, hangs. */
const patience = (theirs: Outcome) => Math.max(180, Math.ceil((theirs.seconds ?? 0) * 4));

/** In a package that has a `lint` or a `format` script, `bun lint` runs the script, except in that script. */
const asScript = (command: "lint" | "format") => ({ npm_lifecycle_event: command });

function parse<T>(path: string): T | null {
  try {
    const text = readFileSync(path, "utf8");
    // oxlint prints what plugins print before the report.
    return JSON.parse(text.startsWith("{") || text.startsWith("[") ? text : text.slice(text.search(/^[[{]/m)));
  } catch {
    return null;
  }
}

/** The lines on stderr that say what was skipped, without the numbers that change from run to run. */
const warnings = (stderr: string) =>
  [...new Set(stderr.split("\n").filter(it => /^(warn|error):/.test(it)))].slice(0, 40);

async function lint(entry: Entry, run: Run) {
  const their = theirTool(entry, run);
  const version = await versionOf(entry, run, their.path);
  const json = ["-f", "json"];
  const theirs = await inCopy(entry, "theirs", {
    cmd: commandOf(run, [their.path], [...json, ...(run.theirArgs ?? [])]),
    cwd: run.cwd,
    env: run.env,
    perf: true,
  });
  const ours = await inCopy(entry, "ours", {
    cmd: commandOf(run, [bun, "lint"], [...json, "--timing", ...(run.ourArgs ?? [])]),
    cwd: run.cwd,
    env: { ...run.env, ...asScript("lint") },
    perf: true,
    seconds: patience(theirs),
  });
  const compare = (a: any, b: any) =>
    run.tool === "eslint"
      ? compareEslint(a, b, cloneOf(entry.repo))
      : compareOxlint(a as OxlintReport, b as OxlintReport);
  const verdictOf = (comparison: LintComparison, theirCode: number) =>
    comparison.messages.onlyTheirs + comparison.messages.onlyOurs + comparison.fixes.different === 0 &&
    comparison.files.theirs === comparison.files.ours &&
    comparison.files.onlyTheirs.length + comparison.files.onlyOurs.length === 0 &&
    theirCode === ours.code
      ? "identical"
      : "differs";
  // A report in the format of the other linter is no report: `bun lint` chooses by the configuration file, not by the flags.
  const report = (path: string) => {
    const it = parse<any>(path);
    return (run.tool === "eslint" ? Array.isArray(it) : Array.isArray(it?.diagnostics)) ? it : null;
  };
  const [a, b] = [report(theirs.stdout), report(ours.stdout)];
  const comparison = a && b ? compare(a, b) : null;
  // What another version of their tool reports can be what the tool has learnt since: `bun lint` follows one version of each.
  // ESLint's judge runs with their configuration and their plugins.
  let judge = null;
  if (version !== JUDGES[run.tool as "eslint"] && !(comparison && verdictOf(comparison, theirs.code) === "identical")) {
    const it = await inCopy(entry, "judge", {
      cmd: commandOf(run, [join(tools, "node_modules", ".bin", run.tool)], [...json, ...(run.theirArgs ?? [])]),
      cwd: run.cwd,
      env: run.env,
    });
    const judgeReport = report(it.stdout);
    const judged = judgeReport && b ? compare(judgeReport, b) : null;
    judge = {
      version: JUDGES[run.tool as "eslint"],
      ...summary(it),
      comparison: judged && cut(judged),
      verdict: !judgeReport ? "cannot run: theirs" : !b ? "cannot run: ours" : verdictOf(judged!, it.code),
    };
    if (!flags.has("keep")) removeRuns(it.out);
  }
  const result = {
    ...run,
    version,
    installed: their.installed,
    theirs: summary(theirs),
    ours: summary(ours),
    warnings: warnings(read(ours.stderr)),
    // What `--timing` prints, above all how much JavaScript the plugins are.
    timing: read(ours.stderr)
      .split("\n")
      .filter(it => /^  (wall|summed|JavaScript)/.test(it))
      .map(it => it.trim()),
    comparison: comparison && cut(comparison),
    verdict: !a ? "cannot run: theirs" : !b ? "cannot run: ours" : verdictOf(comparison!, theirs.code),
    judge,
  };
  if (!flags.has("keep")) for (const it of [theirs, ours]) removeRuns(it.out);
  return result;
}

/** What a run has changed: a tool may write a file that it does not change. */
function changedFiles(entry: Entry, upper: string) {
  const files = writtenFiles(upper);
  for (const [file, path] of files) {
    const original = join(cloneOf(entry.repo), file);
    if (existsSync(original) && readFileSync(original).equals(readFileSync(path))) files.delete(file);
  }
  return files;
}

function diffs(theirs: Map<string, string>, ours: Map<string, string>, files: string[], entry: Entry) {
  return files.slice(0, 12).map(file => {
    const original = join(cloneOf(entry.repo), file);
    const cmd = ["diff", "-U1", theirs.get(file) ?? original, ours.get(file) ?? original];
    return { file, diff: Bun.spawnSync({ cmd }).stdout.toString().split("\n").slice(2, 42).join("\n").slice(0, 3000) };
  });
}

const byExtension = (files: string[]) => {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const extension = /\.[^./]+$/.exec(file)?.[0] ?? "(none)";
    counts[extension] = (counts[extension] ?? 0) + 1;
  }
  return counts;
};

function treeResult(tree: TreeComparison, theirs: Map<string, string>, ours: Map<string, string>, entry: Entry) {
  const wrong = [...tree.different, ...tree.onlyTheirs, ...tree.onlyOurs];
  return {
    theirs: tree.theirs,
    ours: tree.ours,
    same: tree.same,
    different: tree.different.length,
    onlyTheirs: tree.onlyTheirs.length,
    onlyOurs: tree.onlyOurs.length,
    byExtension: byExtension(wrong),
    files: {
      different: tree.different.slice(0, 40),
      onlyTheirs: tree.onlyTheirs.slice(0, 40),
      onlyOurs: tree.onlyOurs.slice(0, 40),
    },
    diffs: diffs(theirs, ours, wrong, entry),
  };
}

async function fix(entry: Entry, run: Run) {
  const their = theirTool(entry, run);
  const theirs = await inCopy(entry, "theirs-fix", {
    cmd: commandOf(run, [their.path], ["--fix", ...(run.theirArgs ?? [])]),
    cwd: run.cwd,
    env: run.env,
  });
  const ours = await inCopy(entry, "ours-fix", {
    cmd: commandOf(run, [bun, "lint"], ["--fix", ...(run.ourArgs ?? [])]),
    cwd: run.cwd,
    env: { ...run.env, ...asScript("lint") },
    seconds: patience(theirs),
  });
  const [a, b] = [changedFiles(entry, theirs.upper), changedFiles(entry, ours.upper)];
  const tree = compareTrees(a, b);
  const result = {
    tool: run.tool,
    cwd: run.cwd,
    theirs: summary(theirs),
    ours: summary(ours),
    tree: treeResult(tree, a, b, entry),
    // 2: it could not lint.
    verdict:
      theirs.code >= 2
        ? "cannot run: theirs"
        : ours.code >= 2
          ? "cannot run: ours"
          : tree.different.length + tree.onlyTheirs.length + tree.onlyOurs.length === 0
            ? "identical"
            : "differs",
  };
  if (!flags.has("keep")) for (const it of [theirs, ours]) removeRuns(it.out);
  return result;
}

const lines = (text: string) => text.split("\n").filter(Boolean);

/** Appends empty lines to every tracked file, which every formatter takes away again: then `-l` lists each file that it reads. */
const PERTURB = `
const { appendFileSync, lstatSync } = require("node:fs");
const files = Bun.spawnSync({ cmd: ["git", "ls-files", "-z"] }).stdout.toString().split("\\0").filter(Boolean);
for (const file of files) {
  try {
    const stat = lstatSync(file);
    if (stat.isFile() && stat.size < 2_000_000) appendFileSync(file, "\\n\\n\\n");
  } catch {}
}
`;

async function format(entry: Entry, run: Run) {
  const their = theirTool(entry, run);
  const version = await versionOf(entry, run, their.path);
  const judge = join(tools, "node_modules", ".bin", run.tool);
  const judged = version !== JUDGES[run.tool as "prettier" | "oxfmt"];
  const env = { ...run.env, ...asScript("format") };
  const [theirArgs, ourArgs] = [run.theirArgs ?? [], run.ourArgs ?? []];
  const write = run.tool === "prettier" ? ["--write"] : [];

  const theirCheck = await inCopy(entry, "theirs-check", {
    cmd: commandOf(run, [their.path], ["--list-different", ...theirArgs]),
    cwd: run.cwd,
    env: run.env,
    perf: true,
  });
  const ourCheck = await inCopy(entry, "ours-check", {
    cmd: commandOf(run, [bun, "format"], ["--list-different", ...ourArgs]),
    cwd: run.cwd,
    env,
    perf: true,
  });
  const theirWrite = await inCopy(entry, "theirs-write", {
    cmd: commandOf(run, [their.path], [...write, ...theirArgs]),
    cwd: run.cwd,
    env: run.env,
  });
  const judgeWrite = judged
    ? await inCopy(entry, "judge-write", {
        cmd: commandOf(run, [judge], [...write, ...theirArgs]),
        cwd: run.cwd,
        env: run.env,
      })
    : theirWrite;
  const ourWrite = await inCopy(entry, "ours-write", {
    cmd: commandOf(run, [bun, "format"], ourArgs),
    cwd: run.cwd,
    env,
  });

  // Which files each of them reads.
  const perturbed = await inCopy(entry, "perturb", { cmd: [bun, "-e", PERTURB] });
  const ourFiles = await inCopy(entry, "ours-files", {
    cmd: commandOf(run, [bun, "format"], ["--list-different", ...ourArgs]),
    cwd: run.cwd,
    env,
    upper: perturbed.upper,
  });
  const read_ = {
    // `a.js 12ms`, `a.js 12ms (unchanged)`
    theirs:
      run.tool === "prettier"
        ? lines(read(judgeWrite.stdout)).flatMap(it => /^(.*) \d+ms(?: \(unchanged\))?$/.exec(it)?.[1] ?? [])
        : null,
    ours: lines(read(ourFiles.stdout)),
  };
  const theirSet = new Set(read_.theirs ?? []);
  const ourSet = new Set(read_.ours);

  const trees = [theirWrite, judgeWrite, ourWrite].map(it => changedFiles(entry, it.upper));
  const [againstTheirs, againstJudge] = [compareTrees(trees[0], trees[2]), compareTrees(trees[1], trees[2])];
  const [a, b] = [new Set(lines(read(theirCheck.stdout))), new Set(lines(read(ourCheck.stdout)))];
  const clean = (tree: TreeComparison) => tree.different.length + tree.onlyTheirs.length + tree.onlyOurs.length === 0;
  const result = {
    ...run,
    version,
    installed: their.installed,
    judge: JUDGES[run.tool as "prettier" | "oxfmt"],
    check: {
      theirs: { ...summary(theirCheck), flagged: a.size },
      ours: { ...summary(ourCheck), flagged: b.size },
      onlyTheirs: [...a].filter(it => !b.has(it)).slice(0, 40),
      onlyOurs: [...b].filter(it => !a.has(it)).slice(0, 40),
    },
    write: { theirs: summary(theirWrite), judge: summary(judgeWrite), ours: summary(ourWrite) },
    files: read_.theirs && {
      theirs: theirSet.size,
      ours: ourSet.size,
      onlyTheirs: byExtension([...theirSet].filter(it => !ourSet.has(it))),
      onlyOurs: byExtension([...ourSet].filter(it => !theirSet.has(it))),
      examples: {
        onlyTheirs: [...theirSet].filter(it => !ourSet.has(it)).slice(0, 20),
        onlyOurs: [...ourSet].filter(it => !theirSet.has(it)).slice(0, 20),
      },
    },
    warnings: warnings(read(ourWrite.stderr)),
    againstTheirs: treeResult(againstTheirs, trees[0], trees[2], entry),
    againstJudge: judged ? treeResult(againstJudge, trees[1], trees[2], entry) : null,
    verdict:
      theirWrite.code > 2 || theirWrite.code < 0
        ? "cannot run: theirs"
        : clean(againstJudge) && judgeWrite.code === ourWrite.code
          ? "identical"
          : "differs",
    verdictAgainstTheirs: clean(againstTheirs) && theirWrite.code === ourWrite.code ? "identical" : "differs",
  };
  if (!flags.has("keep")) {
    for (const it of [theirCheck, ourCheck, theirWrite, judgeWrite, ourWrite, perturbed, ourFiles]) removeRuns(it.out);
  }
  return result;
}

/** The best of three, in turns. The first run of each is kept apart: `bun lint` keeps the evaluated configuration. */
async function time(entry: Entry, run: Run, kind: "lint" | "format") {
  const their = theirTool(entry, run);
  const mode = kind === "lint" ? ["-f", "json"] : ["--list-different"];
  const uppers = ["theirs", "ours"].map(it =>
    ownDirectory(join(work, ".runs", nameOf(entry.repo), `time-${it}-${serial++}`, "upper")),
  );
  const runs: { theirs: Outcome[]; ours: Outcome[] } = { theirs: [], ours: [] };
  for (let round = 0; round < 3; round++) {
    runs.theirs.push(
      await inCopy(entry, "time", {
        cmd: commandOf(run, [their.path], [...mode, ...(run.theirArgs ?? [])]),
        cwd: run.cwd,
        env: run.env,
        upper: uppers[0],
        perf: true,
      }),
    );
    runs.ours.push(
      await inCopy(entry, "time", {
        cmd: commandOf(run, [bun, kind], [...mode, ...(run.ourArgs ?? [])]),
        cwd: run.cwd,
        env: { ...run.env, ...asScript(kind) },
        upper: uppers[1],
        perf: true,
      }),
    );
    for (const it of [runs.theirs.at(-1)!, runs.ours.at(-1)!]) removeRuns(it.out);
    // Three rounds of ten minutes say no more than one.
    if ((runs.theirs[0].seconds ?? 0) > 150) break;
  }
  for (const it of uppers) removeRuns(dirname(it));
  const best = (list: Outcome[]) => ({
    first: list[0].seconds,
    seconds: Math.min(...list.map(it => it.seconds ?? Infinity)),
    user: Math.min(...list.map(it => it.user ?? Infinity)),
    rssMb: Math.min(...list.map(it => it.rssMb ?? Infinity)),
    instructions: Math.min(...list.map(it => it.instructions ?? Infinity)),
    rounds: list.length,
  });
  return {
    kind,
    tool: run.tool,
    cwd: run.cwd,
    load: Number(read("/proc/loadavg").split(" ")[0]),
    theirs: best(runs.theirs),
    ours: best(runs.ours),
  };
}

async function clean(entry: Entry) {
  return (await inClone(entry, "clean", ["git", "clean", "-ffdxq"], {}, false)).code;
}

async function discover(spec: string) {
  const [repo, ref] = spec.split("@");
  const entry: Entry = { repo, sha: "", install: "none" };
  const sha = await clone(entry, ref);
  const root = cloneOf(repo);
  const files = (await inClone(entry, "git", ["git", "ls-files"], {}, false)).stdout.split("\n");
  const configs = files.filter(it =>
    /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|\.eslintignore|\.oxlintrc\.jsonc?|oxlint\.config\.ts|oxlint\.json|\.prettierrc(\.\w+)?|prettier\.config\.[cm]?[jt]s|\.prettierignore|\.oxfmtrc\.jsonc?|oxfmt\.config\.[cm]?[jt]s|biome\.jsonc?|\.editorconfig|dprint\.json)$/.test(
      it,
    ),
  );
  const locks = files.filter(it =>
    /^(bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|\.yarnrc\.yml)$/.test(it),
  );
  const pkg = JSON.parse(read(join(root, "package.json")) || "{}");
  const wanted = /eslint|oxlint|prettier|oxfmt|biome|\bxo\b|standard|\bvp\b|dprint/;
  const scripts = Object.entries<string>(pkg.scripts ?? {}).filter(
    ([name, text]) => wanted.test(text) || wanted.test(name),
  );
  const lock = locks.map(it => read(join(root, it))).join("\n");
  const locked: Record<string, string[]> = {};
  for (const tool of ["eslint", "oxlint", "oxlint-tsgolint", "prettier", "oxfmt", "typescript-eslint", "typescript"]) {
    const versions = [
      // pnpm, bun; yarn; npm
      ...lock.matchAll(new RegExp(`(?:^|[\\s/'"\\[])${tool}@(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, "gm")),
      ...lock.matchAll(new RegExp(`^"?${tool}@[^\\n]*:\\n\\s+version:? "?(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, "gm")),
      ...lock.matchAll(new RegExp(`"node_modules/${tool}": \\{\\s+"version": "([^"]+)"`, "g")),
    ].map(it => it[1]);
    if (versions.length) locked[tool] = [...new Set(versions)];
  }
  const dependencies = Object.entries<string>({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([name]) =>
    /eslint|oxlint|prettier|oxfmt|biome|^xo$|^standard$|^typescript$|vite-plus/.test(name),
  );
  console.log(
    JSON.stringify(
      {
        repo,
        sha,
        files: files.length,
        packageManager: pkg.packageManager,
        locks,
        configs: configs.slice(0, 60),
        configCount: configs.length,
        prettierInPackageJson: pkg.prettier,
        eslintConfigInPackageJson: pkg.eslintConfig && "yes",
        scripts: Object.fromEntries(scripts),
        "lint-staged": pkg["lint-staged"],
        dependencies: Object.fromEntries(dependencies),
        locked,
      },
      null,
      1,
    ),
  );
}

// ── tables ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function table(header: string[], rows: (string | number | null | undefined)[][]) {
  if (rows.length === 0) return "(none)\n";
  return (
    [header, header.map(() => "---"), ...rows].map(row => `| ${row.map(it => it ?? "").join(" | ")} |`).join("\n") +
    "\n"
  );
}

function tables() {
  const results = manifest.flatMap(it =>
    existsSync(resultsOf(it.repo)) ? [JSON.parse(read(resultsOf(it.repo)))] : [],
  );
  const label = (result: any, run: any) => result.repo + (run.cwd && run.cwd !== "." ? ` (${run.cwd})` : "");
  const ratio = (a: number | null, b: number | null) => (a && b ? (a / b).toFixed(1) : "");
  let text = `Revisions of bun: ${[...new Set(results.map(it => it.revision))].join(", ")}\n\n`;
  for (const tool of ["eslint", "oxlint"]) {
    const runs = results.flatMap(result =>
      (result.lint ?? []).filter((it: any) => it.tool === tool).map((run: any) => ({ result, run })),
    );
    const identical = runs.filter(it => it.run.verdict === "identical").length;
    text += `## ${tool} and bun lint: ${identical} of ${runs.length} runs identical\n\n`;
    text += table(
      [
        "Repository",
        "Version",
        "Files",
        "Their messages",
        "Suppressed",
        "Same",
        "Only theirs",
        "Only ours",
        "Other fix",
        "Exit theirs",
        "Exit ours",
        "Verdict",
        `Against ${JUDGES[tool as "eslint"]}`,
      ],
      runs.map(({ result, run }) => {
        const c = run.comparison;
        return [
          label(result, run),
          run.version,
          c?.files.theirs,
          c?.messages.theirs,
          c?.suppressed.theirs,
          c?.messages.same,
          c?.messages.onlyTheirs,
          c?.messages.onlyOurs,
          c?.fixes.different,
          run.theirs.code,
          run.ours.code,
          run.verdict,
          run.judge?.verdict ?? run.verdict,
        ];
      }),
    );
    const fixes = results.flatMap(result =>
      (result.fix ?? []).filter((it: any) => it.tool === tool).map((run: any) => ({ result, run })),
    );
    text += `\n### --fix\n\n`;
    text += table(
      [
        "Repository",
        "Files they change",
        "Files we change",
        "Same bytes",
        "Different",
        "Only theirs",
        "Only ours",
        "Verdict",
      ],
      fixes.map(({ result, run }) => [
        label(result, run),
        run.tree.theirs,
        run.tree.ours,
        run.tree.same,
        run.tree.different,
        run.tree.onlyTheirs,
        run.tree.onlyOurs,
        run.verdict,
      ]),
    );
    text += "\n";
  }
  for (const tool of ["prettier", "oxfmt"]) {
    const runs = results.flatMap(result =>
      (result.format ?? []).filter((it: any) => it.tool === tool).map((run: any) => ({ result, run })),
    );
    const identical = runs.filter(it => it.run.verdict === "identical").length;
    text += `## ${tool} and bun format: ${identical} of ${runs.length} runs identical to ${tool} ${JUDGES[tool as "prettier"]}\n\n`;
    text += table(
      [
        "Repository",
        "Their version",
        "Files they read",
        "Files we read",
        "They change",
        "We change",
        "Same bytes",
        "Different",
        "Only theirs",
        "Only ours",
        "Verdict",
        "Against their version",
      ],
      runs.map(({ result, run }) => {
        const tree = run.againstJudge ?? run.againstTheirs;
        return [
          label(result, run),
          run.version,
          run.files?.theirs,
          run.files?.ours,
          tree.theirs,
          tree.ours,
          tree.same,
          tree.different,
          tree.onlyTheirs,
          tree.onlyOurs,
          run.verdict,
          run.verdictAgainstTheirs,
        ];
      }),
    );
    text += "\n";
  }
  const timed = results.flatMap(result => (result.time ?? []).map((run: any) => ({ result, run })));
  for (const [title, unit, of] of [
    ["Wall time", "s", (it: any) => it.seconds],
    ["CPU time", "s", (it: any) => it.user],
    ["Instructions", "G", (it: any) => (Number.isFinite(it.instructions) ? +(it.instructions / 1e9).toFixed(2) : null)],
    ["Peak memory", "MB", (it: any) => it.rssMb],
  ] as const) {
    text += `## ${title}\n\n`;
    text += table(
      ["Repository", "Tool", `theirs (${unit})`, `ours (${unit})`, "Ratio"],
      timed.map(({ result, run }) => [
        label(result, run),
        run.tool,
        of(run.theirs),
        of(run.ours),
        ratio(of(run.theirs), of(run.ours)),
      ]),
    );
    text += "\n";
  }
  return text;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

if (flags.has("table")) {
  console.log(tables());
  process.exit(0);
}
if (!bun) throw new Error("--bun=<path of bun>");
if (process.getuid?.() !== 0) throw new Error("the sandbox needs root");
mkdirSync(join(work, ".results"), { recursive: true });
if (flags.has("discover")) {
  await discover(flags.get("discover")!);
  process.exit(0);
}
if (flags.has("exec")) {
  const entry = manifest.find(it => it.repo === flags.get("exec")) ?? {
    repo: flags.get("exec")!,
    sha: "",
    install: "none",
  };
  const it = await inCopy(entry, "exec", {
    cmd: ["bash", "-c", process.argv.slice(dashes + 1).join(" ")],
    cwd: flags.get("cwd"),
    env: { BUN: bun, TOOLS: join(tools, "node_modules", ".bin"), ...asScript((flags.get("as") as "lint") ?? "lint") },
  });
  process.stdout.write(read(it.stdout));
  process.stderr.write(read(it.stderr));
  console.error(`exit ${it.code}, ${it.seconds} s, ${it.rssMb} MB`);
  removeRuns(join(work, ".runs", nameOf(entry.repo), it.out.split("/").at(-1)!));
  process.exit(0);
}
const revision = Bun.spawnSync({ cmd: [bun, "--revision"] })
  .stdout.toString()
  .trim();
const only = flags.get("only")?.split(",");
const stages = (flags.get("stages") ?? "clone,install,lint,fix,format").split(",");
const entries = manifest.filter(it => !only || only.includes(it.repo));
await installTools(tools, JUDGES);

async function one(entry: Entry) {
  const path = resultsOf(entry.repo);
  const result: Record<string, unknown> = existsSync(path) ? JSON.parse(read(path)) : {};
  Object.assign(result, { repo: entry.repo, sha: entry.sha, notes: entry.notes });
  const save = () => writeFileSync(path, JSON.stringify(result, null, 1));
  const say = (text: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${entry.repo}: ${text}`);
  try {
    if (stages.includes("clone")) await clone(entry);
    for (const [tool, version] of Object.entries(entry.pinned ?? {})) {
      await installTools(pinnedTool(tool, version), { [tool]: version });
    }
    if (stages.includes("install")) {
      result.install = await install(entry);
      say(`installed: exit ${(result.install as any).code}, ${(result.install as any).megabytes} MB`);
      save();
    }
    for (const [stage, runs, with_] of [
      ["lint", entry.lint, lint],
      ["fix", entry.lint, fix],
      ["format", entry.format, format],
    ] as const) {
      if (!stages.includes(stage) || !runs) continue;
      result[stage] = [];
      for (const run of runs) {
        const it = await with_(entry, run);
        (result[stage] as unknown[]).push(it);
        say(`${stage} ${run.tool} ${run.cwd ?? ""}: ${it.verdict}`);
      }
      Object.assign(result, { revision });
      save();
    }
    if (stages.includes("time")) {
      result.time = [];
      for (const run of entry.lint ?? []) (result.time as unknown[]).push(await time(entry, run, "lint"));
      for (const run of entry.format ?? []) (result.time as unknown[]).push(await time(entry, run, "format"));
      Object.assign(result, { timeRevision: revision });
      save();
      say("timed");
    }
    if (stages.includes("clean")) say(`node_modules removed: exit ${await clean(entry)}`);
  } catch (error) {
    result.error = String(error);
    say(String(error));
    save();
  }
  if (!flags.has("keep")) removeRuns(join(work, ".runs", nameOf(entry.repo)));
}

const queue = [...entries];
await Promise.all(
  Array.from({ length: Number(flags.get("jobs") ?? 1) }, async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) await one(entry);
  }),
);
console.log(tables());
