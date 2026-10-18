import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants, cpus, freemem, loadavg, totalmem, userInfo } from "node:os";
import { dirname, join } from "node:path";

export interface Program {
  corpus: string;
  name: string;
  entry: string;
  files?: () => Record<string, string>;
  flags?: string[];
  args?: string[];
  env?: Record<string, string>;
  stdin?: string;
  workingDirectory?: string;
  setAside?: string;
  mayStartProcesses?: boolean;
  smaller?: () => Program[];
}

export interface Ran {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

export interface Result {
  corpus: string;
  name: string;
  verdict: "same" | "differs" | "set aside";
  why?: string;
  detail?: string;
  world?: string;
  leftOut?: string[];
  featuresLeftOut?: number;
  exitCode?: number | null;
  signal?: string | null;
  whole?: Ran;
  trimmed?: Ran;
  wholeBytes?: number;
  trimmedBytes?: number;
  door?: number;
  features?: string[];
  repro?: string;
  text?: string;
  seconds: number;
}

export type Jail = "a unit of the system's systemd" | "a unit of the user's systemd" | "a process tree of its own" | "none";

export interface Settings {
  bun: string;
  scratch: string;
  kept: string;
  doors: string;
  jobs: number;
  cores?: number[];
  highestLoad: number;
  leastMemory: number;
  mostProcesses: number;
  jail: Jail;
  buildSeconds: number;
  runSeconds: number;
  env: Record<string, string | undefined>;
  buildFlags: string[];
  findsFeature: boolean;
  wronglyLeftOut?: string[];
}

const isWindows = process.platform === "win32";
const outputLimit = 4 << 20;
const kindsOfFacts = ["world", "global", "Bun", "process", "console", "module", "native", "loader", "property", "option", "environment", "autoload"];

export function featuresLeftOut(facts: string[], doors: string): string[] {
  const features: string[] = [];
  const conditions: { feature: string; kind: string; name: string }[] = [];
  for (const line of doors.split("\n")) {
    const [word, feature, kind, ...name] = line.split(" ");
    if (word === "feature") features.push(feature);
    else if (word === "when") conditions.push({ feature, kind, name: name.join(" ") });
  }
  const stated = new Set(facts);
  const holds = (kind: string, name: string) => !kindsOfFacts.includes(kind) || stated.has(`${kind} ${name}`) || stated.has(`${kind} *`);
  const kept = new Set(
    features.filter(feature => {
      const own = conditions.filter(condition => condition.feature === feature);
      return own.length === 0 || own.some(condition => condition.kind !== "feature" && holds(condition.kind, condition.name));
    }),
  );
  for (let hasGrown = true; hasGrown; ) {
    hasGrown = false;
    for (const { feature, kind, name } of conditions) {
      if (kind !== "feature" || kept.has(feature) || (features.includes(name) && !kept.has(name))) continue;
      kept.add(feature);
      hasGrown = true;
    }
  }
  return features.filter(feature => !kept.has(feature));
}

function featureDescribedAs(description: string, doors: string): string | undefined {
  for (const line of doors.split("\n")) {
    const [word, feature, ...words] = line.split(" ");
    if (word === "feature" && words.join(" ") === description) return feature;
  }
}

const running = new Set<number>();

function endGroup(pid: number) {
  try {
    process.kill(isWindows ? pid : -pid, "SIGKILL");
  } catch {}
}

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>, seconds: number, stdin?: string): Promise<Ran> {
  const child = Bun.spawn({
    cmd: isWindows ? cmd : ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", ...cmd],
    cwd,
    env,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
    maxBuffer: outputLimit,
    detached: !isWindows,
  });
  running.add(child.pid);
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  running.delete(child.pid);
  endGroup(child.pid);
  return { stdout, stderr, exitCode: child.signalCode ? null : exitCode, signal: child.signalCode };
}

let units = 0;

export function inJail(jail: Jail, cmd: string[], { cwd, env, seconds, core }: { cwd: string; env: Record<string, string | undefined>; seconds: number; core?: string }): string[] {
  const pinned = core === undefined ? [] : ["taskset", "-c", core];
  if (jail === "none") return [...pinned, ...cmd];
  const ownProcessTree = ["unshare", "--user", "--map-current-user", "--pid", "--fork", "--kill-child=SIGKILL", "--mount-proc"];
  const limited = [...pinned, "timeout", "--signal=KILL", String(seconds), ...ownProcessTree, "/bin/sh", "-c", `"$@"`, "--", ...cmd];
  if (jail === "a process tree of its own") return limited;
  const manager = jail === "a unit of the user's systemd" ? ["systemd-run", "--user"] : ["sudo", "-n", "systemd-run", `--uid=${userInfo().username}`];
  const properties = ["KillMode=control-group", "KillSignal=SIGKILL", "TimeoutStopSec=1", `RuntimeMaxSec=${seconds + 5}`, "MemoryMax=4G", "MemorySwapMax=0", "LimitCORE=0", "LogLevelMax=crit", "PrivateUsers=yes", "PrivateNetwork=yes"];
  if (core !== undefined) properties.push(`AllowedCPUs=${core}`);
  const variables = Object.entries(env).flatMap(([name, value]) => (value === undefined ? [] : [`${name}=${value}`]));
  return [
    ...manager,
    "--wait",
    "--collect",
    "--pipe",
    "--quiet",
    `--unit=trimmed-against-whole-${process.pid}-${units++}`,
    `--working-directory=${cwd}`,
    ...properties.flatMap(property => ["-p", property]),
    "--",
    "/usr/bin/env",
    "-i",
    ...variables,
    ...limited,
  ];
}

export function jailOfThisMachine(): Jail {
  if (process.platform !== "linux") return "none";
  const jails: Jail[] = ["a unit of the user's systemd", "a unit of the system's systemd", "a process tree of its own"];
  const works = (jail: Jail) => {
    const cmd = inJail(jail, ["true"], { cwd: "/", env: { PATH: process.env.PATH }, seconds: 5, core: "0" });
    return Bun.which(cmd[0]!) !== null && Bun.spawnSync({ cmd, stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  };
  return jails.find(works) ?? "none";
}

function endEverything(jail: Jail) {
  for (const pid of running) endGroup(pid);
  if (!jail.startsWith("a unit")) return;
  const manager = jail === "a unit of the user's systemd" ? ["systemctl", "--user"] : ["sudo", "-n", "systemctl"];
  Bun.spawnSync({ cmd: [...manager, "stop", `trimmed-against-whole-${process.pid}-*`], stdout: "ignore", stderr: "ignore" });
}

const signalNames = new Map(Object.entries(constants.signals).map(([name, number]) => [128 + number, name]));

function withSignalNamed(ran: Ran): Ran {
  const signal = ran.exitCode === null ? undefined : signalNames.get(ran.exitCode);
  return signal ? { ...ran, exitCode: null, signal } : ran;
}

const isSame = (one: Ran, other: Ran) => one.stdout === other.stdout && one.stderr === other.stderr && one.exitCode === other.exitCode && one.signal === other.signal;

const cut = (text: string, length = 2000) => (text.length <= length ? text : `${text.slice(0, length)}\n.. ${text.length - length} more characters`);

const shortened = (ran: Ran): Ran => ({ ...ran, stdout: cut(ran.stdout), stderr: cut(ran.stderr) });

function firstDifference(whole: Ran, trimmed: Ran): string {
  if (whole.signal !== trimmed.signal) return `signal ${whole.signal} | ${trimmed.signal}`;
  if (whole.exitCode !== trimmed.exitCode) return `exit code ${whole.exitCode} | ${trimmed.exitCode}`;
  for (const stream of ["stdout", "stderr"] as const) {
    if (whole[stream] === trimmed[stream]) continue;
    const [wholeLines, trimmedLines] = [whole[stream].split("\n"), trimmed[stream].split("\n")];
    const line = wholeLines.findIndex((text, index) => text !== trimmedLines[index]);
    const at = line < 0 ? wholeLines.length : line;
    return `${stream} line ${at + 1}: ${JSON.stringify(cut(wholeLines[at] ?? "", 200))} | ${JSON.stringify(cut(trimmedLines[at] ?? "", 200))}`;
  }
  return "";
}

const foundBefore: string[][] = [];

const opensTheWorld = `if (globalThis.neverSetByAnyProgram) (0, eval)("0");\n`;

class Bench {
  readonly executable: string;
  readonly entry: string;
  readonly sources: string;

  constructor(
    readonly program: Program,
    readonly settings: Settings,
    readonly folder: string,
    readonly core: string | undefined,
  ) {
    this.executable = join(folder, "run", isWindows ? "program.exe" : "program");
    this.sources = join(folder, "sources");
    this.entry = program.files ? join(this.sources, program.entry) : program.entry;
    for (const name of ["run", "build", "sources"]) mkdirSync(join(folder, name), { recursive: true });
    for (const [path, text] of Object.entries(program.files?.() ?? {})) {
      mkdirSync(dirname(join(this.sources, path)), { recursive: true });
      writeFileSync(join(this.sources, path), text);
    }
    writeFileSync(join(folder, "opens-the-world.js"), opensTheWorld);
  }

  env(more: Record<string, string> = {}): Record<string, string | undefined> {
    const [home, temporary] = [join(this.folder, "home"), join(this.folder, "tmp")];
    return {
      TZ: "UTC",
      LANG: "en_US.UTF-8",
      NO_COLOR: "1",
      BUN_ENABLE_CRASH_REPORTING: "0",
      DO_NOT_TRACK: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
      ...this.settings.env,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: temporary,
      TEMP: temporary,
      TMP: temporary,
      BUN_FEATURE_FLAG_TRIM_RUNTIME: undefined,
      BUN_TRIM_RUNTIME_WITHOUT: undefined,
      ...more,
    };
  }

  freshFolders() {
    for (const name of ["home", "tmp", "cwd"]) {
      rmSync(join(this.folder, name), { recursive: true, force: true });
      mkdirSync(join(this.folder, name), { recursive: true });
    }
    if (this.program.workingDirectory) cpSync(this.program.workingDirectory, join(this.folder, "cwd"), { recursive: true });
  }

  flags(how: "whole" | "trimmed" | "opened"): string[] {
    const trims = how === "whole" ? [] : ["--compile-trim-runtime", "--aot-explain=runtime-use"];
    const entries = how === "opened" ? [this.entry, join(this.folder, "opens-the-world.js")] : [this.entry];
    return ["build", "--compile", "--aot", ...trims, ...this.settings.buildFlags, ...(this.program.flags ?? []), ...entries];
  }

  async jailed(command: string[], cwd: string, env: Record<string, string | undefined>, seconds: number, stdin?: string): Promise<Ran> {
    const { jail } = this.settings;
    const launch = inJail(jail, command, { cwd, env, seconds, core: this.core });
    const started = performance.now();
    const ran = await spawned(launch, cwd, jail.startsWith("a unit") ? process.env : env, jail === "none" ? seconds : seconds + 15, stdin);
    return performance.now() - started >= seconds * 1000 ? { ...ran, exitCode: null, signal: "SIGKILL" } : withSignalNamed(ran);
  }

  async build(how: "whole" | "trimmed" | "opened", saveAs: string, without: string[] = []): Promise<Ran> {
    this.freshFolders();
    rmSync(this.executable, { force: true });
    const env = this.env(without.length > 0 ? { BUN_TRIM_RUNTIME_WITHOUT: without.join(",") } : {});
    const command = [this.settings.bun, ...this.flags(how), "--outfile", this.executable];
    const [cwd, seconds] = [join(this.folder, "build"), this.settings.buildSeconds];
    const built = await this.jailed(command, cwd, env, seconds);
    if (built.exitCode === 0) renameSync(this.executable, join(this.folder, saveAs));
    return built;
  }

  async run(saved: string): Promise<Ran> {
    this.freshFolders();
    renameSync(join(this.folder, saved), this.executable);
    try {
      const [cwd, env, seconds] = [join(this.folder, "cwd"), this.env(this.program.env), this.settings.runSeconds];
      return await this.jailed([this.executable, ...(this.program.args ?? [])], cwd, env, seconds, this.program.stdin);
    } finally {
      renameSync(this.executable, join(this.folder, saved));
    }
  }

  async differsWithout(features: string[], whole: Ran): Promise<boolean> {
    const built = await this.build("opened", "forced", features);
    if (built.exitCode !== 0) return false;
    const ran = await this.run("forced");
    rmSync(join(this.folder, "forced"), { force: true });
    return !isSame(ran, whole);
  }

  async smallestSetThatDiffers(leftOut: string[], whole: Ran): Promise<string[] | undefined> {
    if (await this.differsWithout([], whole)) return undefined;
    for (const found of foundBefore) {
      if (found.every(feature => leftOut.includes(feature)) && (await this.differsWithout(found, whole))) return found;
    }
    if (!(await this.differsWithout(leftOut, whole))) return [];
    let suspects = leftOut;
    while (suspects.length > 1) {
      const half = suspects.slice(0, suspects.length >> 1);
      const rest = suspects.slice(suspects.length >> 1);
      if (await this.differsWithout(half, whole)) suspects = half;
      else if (await this.differsWithout(rest, whole)) suspects = rest;
      else break;
    }
    if (!foundBefore.some(found => found.join() === suspects.join())) foundBefore.push(suspects);
    return suspects;
  }

  keepSources(): string {
    const kept = join(this.settings.kept, this.program.corpus, this.program.name.replace(/[^\w.-]+/g, "_"));
    if (!this.program.files) return this.entry;
    rmSync(kept, { recursive: true, force: true });
    cpSync(this.sources, kept, { recursive: true });
    return join(kept, this.program.entry);
  }
}

const quoted = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

export async function compare(program: Program, settings: Settings, folder: string, core?: string): Promise<Result> {
  const started = performance.now();
  const result = (rest: Omit<Result, "corpus" | "name" | "seconds">): Result => ({
    corpus: program.corpus,
    name: program.name,
    ...rest,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  });
  if (program.setAside) return result({ verdict: "set aside", why: program.setAside });
  if (program.mayStartProcesses && !settings.jail.startsWith("a unit")) return result({ verdict: "set aside", why: "may start processes, and there is no cgroup to hold them here" });
  rmSync(folder, { recursive: true, force: true });
  try {
    const bench = new Bench(program, settings, folder, core);

    const builtWhole = await bench.build("whole", "whole");
    if (builtWhole.exitCode !== 0) {
      const error = builtWhole.signal ? `the build ended with ${builtWhole.signal}` : (builtWhole.stderr.split("\n").find(line => line.startsWith("error")) ?? "");
      return result({ verdict: "set aside", why: "does not compile", detail: cut(error, 200) });
    }
    const wholeBytes = statSync(join(folder, "whole")).size;
    const whole = await bench.run("whole");
    if (whole.signal === "SIGKILL") return result({ verdict: "set aside", why: "does not end, or prints without end" });
    rmSync(join(folder, "whole"));

    const differs = (why: string, rest: Partial<Result>): Result => {
      const entry = bench.keepSources();
      const build = (how: "whole" | "trimmed") => [settings.bun, ...bench.flags(how).map(flag => (flag === bench.entry ? entry : flag)), "--outfile", how].map(quoted).join(" ");
      const run = (how: string) => [`./${how}`, ...(program.args ?? [])].map(quoted).join(" ");
      const text = program.files?.()[program.entry];
      return result({ verdict: "differs", why, wholeBytes, whole: shortened(whole), text: text && text.length < 4000 ? text : undefined, repro: `${build("whole")} && ${build("trimmed")}; ${run("whole")}; ${run("trimmed")}`, ...rest });
    };

    const builtTrimmed = await bench.build("trimmed", "trimmed", settings.wronglyLeftOut);
    const facts = [...builtTrimmed.stderr.matchAll(/^aot: runtime use: (.*)$/gm)].map(match => match[1]);
    const world = facts[0] ?? "";
    const listed = [...builtTrimmed.stderr.matchAll(/^aot: left out: (.*)$/gm)].map(match => match[1]);
    const leftOut = listed.length > 0 ? listed.filter(feature => feature !== "tools" && feature !== "jit") : world === "closed" ? featuresLeftOut(facts, settings.doors) : [];
    if (builtTrimmed.signal === "SIGKILL") return result({ verdict: "set aside", why: "the trimmed build does not end" });
    if (builtTrimmed.exitCode !== 0) return differs("the trimmed build fails", { world, leftOut, trimmed: shortened(builtTrimmed) });
    const trimmedBytes = statSync(join(folder, "trimmed")).size;

    const trimmed = await bench.run("trimmed");
    if (isSame(whole, trimmed)) return result({ verdict: "same", world, exitCode: whole.exitCode, signal: whole.signal, wholeBytes, trimmedBytes, featuresLeftOut: leftOut.length });

    await bench.build("whole", "whole");
    if (!isSame(whole, await bench.run("whole")) || !isSame(whole, await bench.run("whole"))) return result({ verdict: "set aside", why: "not the same each time" });
    rmSync(join(folder, "whole"));
    if (isSame(whole, await bench.run("trimmed"))) return result({ verdict: "set aside", why: "trimmed differs only sometimes", detail: firstDifference(whole, trimmed), world });

    const sentence = /built with --compile-trim-runtime, without (.*?), and something has just asked for it\..*?number: (\d+)/s.exec(trimmed.stderr);
    const named = sentence && featureDescribedAs(sentence[1], settings.doors);
    const features = named ? [named] : settings.findsFeature ? await bench.smallestSetThatDiffers(leftOut, whole) : undefined;
    return differs(firstDifference(whole, trimmed), {
      world,
      leftOut,
      trimmedBytes,
      trimmed: shortened(trimmed),
      door: sentence ? Number(sentence[2]) : undefined,
      features: features ?? undefined,
      detail: named ? undefined : features === undefined ? "no feature found" : features.length === 0 ? "not by a feature: the closed world itself" : undefined,
    });
  } catch (error) {
    return result({ verdict: "set aside", why: "the runner failed", detail: cut(String(error), 300) });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export function described(result: Result): string {
  const lines = [`DIFFERS ${result.corpus} ${result.name}: ${result.why}`];
  const told = (ran: Ran | undefined) => (ran ? `exit ${ran.exitCode ?? ran.signal}, stdout ${ran.stdout.length}, stderr ${ran.stderr.length}: ${JSON.stringify(cut(ran.stderr.trim().split("\n")[0] ?? "", 240))}` : "");
  lines.push(`  whole    ${told(result.whole)}`, `  trimmed  ${told(result.trimmed)}`);
  lines.push(`  world    ${result.world}`);
  if (result.door !== undefined) lines.push(`  door     ${result.door}`);
  lines.push(`  feature  ${result.features?.join(" ") || result.detail || "?"}`);
  lines.push(`  left out ${result.leftOut?.length ?? 0}: ${result.leftOut?.join(" ") ?? ""}`);
  lines.push(`  repro    ${result.repro}`);
  if (result.text) lines.push(result.text.replace(/^/gm, "  | "));
  return lines.join("\n");
}

async function compareAndShrink(program: Program, settings: Settings, folder: string, core?: string): Promise<Result> {
  const first = await compare(program, { ...settings, findsFeature: settings.findsFeature && !program.smaller }, folder, core);
  if (first.verdict !== "differs" || !program.smaller) return first;
  const stillDiffers = async (candidate: Program) => (await compare(candidate, { ...settings, findsFeature: false }, folder, core)).verdict === "differs";
  let smallest = program;
  for (let isSmaller = true; isSmaller; ) {
    isSmaller = false;
    for (const candidate of smallest.smaller?.() ?? []) {
      if (!(await stillDiffers(candidate))) continue;
      smallest = candidate;
      isSmaller = true;
      break;
    }
  }
  const last = await compare(smallest, settings, folder, core);
  return last.verdict === "differs" ? last : first;
}

function availableMemory(): number {
  const found = existsSync("/proc/meminfo") && /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
  return found ? Number(found[1]) * 1024 : freemem();
}

function processesOfThisUser(): number {
  if (!existsSync("/proc/self/stat")) return 0;
  const uid = process.getuid!();
  let count = 0;
  for (const name of readdirSync("/proc")) {
    if (name.charCodeAt(0) > 57) continue;
    try {
      if (statSync(`/proc/${name}`).uid === uid) count++;
    } catch {}
  }
  return count;
}

const hasRoom = (settings: Settings) => loadavg()[0] < settings.highestLoad && availableMemory() >= settings.leastMemory;

export const aQuarterOfTheMemory = () => totalmem() / 4;

export const coresOfTheMachine = () => cpus().length;

export async function compareAll(programs: Iterable<Program>, settings: Settings, each: (result: Result) => void): Promise<void> {
  const queue = programs[Symbol.iterator]();
  let number = 0;
  let tooMany = 0;
  const watchdog = setInterval(() => {
    const count = processesOfThisUser();
    if (count <= settings.mostProcesses) return;
    tooMany = count;
    endEverything(settings.jail);
  }, 2000);
  const worker = async (slot: number) => {
    const core = settings.cores && String(settings.cores[slot % settings.cores.length]);
    for (let next = queue.next(); !next.done && !tooMany; next = queue.next()) {
      while (!next.value.setAside && !tooMany && !hasRoom(settings)) await Bun.sleep(3000 + slot * 100);
      const result = await compareAndShrink(next.value, settings, join(settings.scratch, String(number++)), core);
      if (!tooMany) each(result);
    }
  };
  try {
    await Promise.all(Array.from({ length: settings.jobs }, (_, slot) => worker(slot)));
  } finally {
    clearInterval(watchdog);
    endEverything(settings.jail);
  }
  if (tooMany) throw new Error(`stopped: this user has ${tooMany} processes, more than ${settings.mostProcesses}; every program that was running has been ended`);
}

export class Tally {
  readonly rows = new Map<string, Map<string, number>>();

  add(result: Result) {
    const row = this.rows.get(result.corpus) ?? new Map<string, number>();
    this.rows.set(result.corpus, row);
    const count = (key: string) => row.set(key, (row.get(key) ?? 0) + 1);
    count("programs");
    count(result.verdict);
    if (result.verdict === "set aside") count(`set aside: ${result.why}`);
    if (result.verdict === "same") {
      count(`same: ${result.exitCode === 0 ? "exit 0" : "another exit"}`);
      count(`same: ${result.world === "closed" ? "closed" : "open"}`);
    }
    if (result.verdict === "differs") count(`differs: ${result.features?.join("+") || result.detail || result.why}`);
  }

  toString(): string {
    const lines: string[] = [];
    for (const [corpus, row] of this.rows) {
      const parts = (prefix: string) =>
        [...row]
          .filter(([key]) => key.startsWith(prefix))
          .sort((one, other) => other[1] - one[1])
          .map(([key, count]) => `${key.slice(prefix.length)} ${count}`)
          .join(", ");
      lines.push(
        `${corpus}: programs ${row.get("programs")} | set aside ${row.get("set aside") ?? 0} (${parts("set aside: ")}) | same ${row.get("same") ?? 0} (${parts("same: ")}) | DIFFER ${row.get("differs") ?? 0} (${parts("differs: ")})`,
      );
    }
    return lines.join("\n");
  }
}
