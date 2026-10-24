// Temporary. Shared by the two zz-emptied-file-diag test files, which measure the watcher of this
// branch on the macOS lanes. It is removed before the branch is ready.
import { bunEnv, bunExe, isDebug, isMacOS } from "harness";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

export const print = isMacOS || !!process.env.WATCHER_DIAG_PRINT;
export const platform = `${process.platform} ${process.arch} ${release()}`;

/** "base": the build uses the rule of the base branch (a new size of 0 is not reported, nothing is held). */
export type Mode = "base" | "change";
export const modes: Mode[] = ["base", "change"];

const padding = 64;
/** The text of the import: `marker` is 6 digits, and the length is always the same. */
export const text = (marker: number) =>
  `console.log("load v=${String(marker).padStart(6, "0")}");//` + Buffer.alloc(padding, "p").toString();
export const loadLine = (marker: number) => "load v=" + String(marker).padStart(6, "0");
export const otherLine = (marker: number) => "other v=" + String(marker).padStart(6, "0");
export const otherText = (marker: number) => `console.log("${otherLine(marker)}");`;
export const extraLine = (index: number, marker: number) => `extra${index} v=${String(marker).padStart(6, "0")}`;
export const extraText = (index: number, marker: number) => `console.log("${extraLine(index, marker)}");`;

export type TraceRecord = { timestamp: number; events: string[] };
export type Counters = { kevent: number; fstat: number; lock: number; hold: number };
export type Hot = {
  cwd: string;
  dep: string;
  other: string;
  /** The files `extra<i>.js`, when the options asked for them. */
  extras: string[];
  /** The lines that the process printed so far. */
  lines: () => string[];
  stderr: () => string;
  /** The records of the trace that name the import `dep.js`. */
  trace: () => TraceRecord[];
  /** The number of records in the trace, for all files. */
  records: () => number;
  /** The counters of the last record of the trace. */
  counters: () => Counters;
  /** Resolves to true when a `load` line has this marker. False after `ms`. */
  loaded: (marker: number, ms?: number) => Promise<boolean>;
  /** Resolves to the time of the output that made `done` true. Undefined after `ms`. */
  until: (done: (lines: string[]) => boolean, ms: number) => Promise<number | undefined>;
  /** Resolves to true when the trace has more than `before` records. False after `ms`. */
  traced: (before: number, ms?: number) => Promise<boolean>;
};

export const count = (lines: string[], start: string) => lines.filter(line => line.startsWith(start)).length;
/** Long enough for a reload that was started to print. These files measure. They do not assert on time. */
export const settle = () => Bun.sleep(isDebug ? 1500 : 300);

export async function withHot<T>(body: (hot: Hot) => Promise<T>, options: { mode?: Mode; extras?: number } = {}) {
  const extraCount = options.extras ?? 0;
  const files: Record<string, string> = {
    "app/main.js":
      `import "./dep.js";\nimport "./other.js";\n` +
      Array.from({ length: extraCount }, (_, i) => `import "./extra${i}.js";\n`).join("") +
      `console.log("end");\n`,
    "app/dep.js": text(0),
    "app/other.js": otherText(0),
    "source.txt": "",
  };
  for (let i = 0; i < extraCount; i++) files[`app/extra${i}.js`] = extraText(i, 0);
  using dir = tempDir("emptied-diag-hot", files);
  const cwd = join(String(dir), "app");
  const dep = join(cwd, "dep.js");
  // The watcher uses the rule of the base branch when this path ends with ".base".
  const traceFile = join(String(dir), options.mode === "base" ? "trace.log.base" : "trace.log");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
    env: { ...bunEnv, BUN_WATCHER_TRACE: traceFile },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  let stdout = "";
  let stderr = "";
  let at = performance.now();
  let changed = Promise.withResolvers<void>();
  (async () => {
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      at = performance.now();
      changed.resolve();
      changed = Promise.withResolvers<void>();
    }
  })();
  (async () => {
    for await (const chunk of proc.stderr) stderr += Buffer.from(chunk).toString();
  })();
  const lines = () => stdout.split("\n").slice(0, -1);
  const until = async (done: (lines: string[]) => boolean, ms: number) => {
    const deadline = Bun.sleep(ms).then(() => "late" as const);
    while (!done(lines())) {
      if ((await Promise.race([changed.promise, deadline])) === "late") return undefined;
    }
    return at;
  };
  const loaded = async (marker: number, ms = 20_000) => {
    const wanted = loadLine(marker);
    return (await until(lines => lines.includes(wanted), ms)) !== undefined;
  };
  type Parsed = { timestamp: number; files: Record<string, { events: string[] }>; counters?: Counters };
  const parsed = () => {
    let file = "";
    try {
      file = readFileSync(traceFile, "utf8");
    } catch {}
    const out: Parsed[] = [];
    for (const line of file.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // The last line, while the watcher writes it.
      }
    }
    return out;
  };
  const trace = () => {
    const records: TraceRecord[] = [];
    for (const record of parsed()) {
      for (const [path, entry] of Object.entries(record.files)) {
        if (path.endsWith("dep.js")) records.push({ timestamp: record.timestamp, events: entry.events });
      }
    }
    return records;
  };
  const records = () => parsed().length;
  const counters = () => parsed().at(-1)?.counters ?? { kevent: 0, fstat: 0, lock: 0, hold: 0 };
  const traced = async (before: number, ms = 5000) => {
    const deadline = performance.now() + ms;
    while (records() <= before) {
      if (performance.now() > deadline) return false;
      await Bun.sleep(1);
    }
    return true;
  };
  if (!(await loaded(0))) throw new Error(`no first load:\n${stdout}\n${stderr}`);
  return await body({
    cwd,
    dep,
    other: join(cwd, "other.js"),
    extras: Array.from({ length: extraCount }, (_, i) => join(cwd, `extra${i}.js`)),
    lines,
    stderr: () => stderr,
    trace,
    records,
    counters,
    loaded,
    until,
    traced,
  });
}

export const tally = (into: Record<string, number>, key: string) => void (into[key] = (into[key] ?? 0) + 1);

export const bucket = (ms: number) =>
  ms < 1
    ? "under 1 ms"
    : ms < 2
      ? "1 ms"
      : ms < 5
        ? "2 to 4 ms"
        : ms < 10
          ? "5 to 9 ms"
          : ms < 20
            ? "10 to 19 ms"
            : ms < 50
              ? "20 to 49 ms"
              : ms < 100
                ? "50 to 99 ms"
                : "100 ms or more";

/** Median and 90th percentile of `values`, in ms with one decimal. */
export function spread(values: number[]) {
  if (values.length === 0) return "no values";
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1);
  return `median ${at(0.5)} ms, p90 ${at(0.9)} ms, max ${sorted.at(-1)!.toFixed(1)} ms (${sorted.length} values)`;
}
