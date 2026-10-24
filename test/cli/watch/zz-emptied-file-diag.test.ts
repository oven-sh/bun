// Temporary. Measures the watcher of this branch on the macOS lanes. It is removed before the branch
// is ready.
import { dlopen, ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isMacOS, isWindows, nodeExe, tempDir } from "harness";
import {
  chmodSync,
  close,
  closeSync,
  createWriteStream,
  open,
  openSync,
  promises,
  readFileSync,
  truncateSync,
  utimesSync,
  write,
  writeFileSync,
  writeSync,
} from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const print = isMacOS || !!process.env.WATCHER_DIAG_PRINT;
const report: Record<string, unknown> = { platform: `${process.platform} ${process.arch} ${release()}` };

const padding = 64;
/** The text of the import: `marker` is 6 digits, and the length is always the same. */
const text = (marker: number) =>
  `console.log("load v=${String(marker).padStart(6, "0")}");//` + Buffer.alloc(padding, "p").toString();

type Record_ = { timestamp: number; events: string[] };
type Hot = {
  cwd: string;
  dep: string;
  /** The `load` and `end` lines so far. */
  lines: () => string[];
  stderr: () => string;
  /** The records of the trace that name the import. */
  trace: () => Record_[];
  /** Resolves to true when a `load` line has this marker. False after `ms`. */
  loaded: (marker: number, ms?: number) => Promise<boolean>;
  /** Resolves to the time of the line that made `done` true. Undefined after `ms`. */
  until: (done: (lines: string[]) => boolean, ms: number) => Promise<number | undefined>;
};

async function withHot<T>(body: (hot: Hot) => Promise<T>) {
  using dir = tempDir("emptied-diag-hot", {
    "app/main.js": `import "./dep.js";\nconsole.log("end");\n`,
    "app/dep.js": text(0),
    "source.txt": "",
  });
  const cwd = join(String(dir), "app");
  const dep = join(cwd, "dep.js");
  const traceFile = join(String(dir), "trace.log");
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
  const trace = () => {
    let file = "";
    try {
      file = readFileSync(traceFile, "utf8");
    } catch {}
    const records: Record_[] = [];
    for (const line of file.split("\n")) {
      if (!line.trim()) continue;
      let record: { timestamp: number; files: Record<string, { events: string[] }> };
      try {
        record = JSON.parse(line);
      } catch {
        // The last line, while the watcher writes it.
        continue;
      }
      for (const [path, entry] of Object.entries(record.files)) {
        if (path.endsWith("dep.js")) records.push({ timestamp: record.timestamp, events: entry.events });
      }
    }
    return records;
  };
  if (!(await loaded(0))) throw new Error(`no first load:\n${stdout}\n${stderr}`);
  return await body({ cwd, dep, lines, stderr: () => stderr, trace, loaded, until });
}

const loadLine = (marker: number) => "load v=" + String(marker).padStart(6, "0");
const count = (lines: string[], start: string) => lines.filter(line => line.startsWith(start)).length;
/** Long enough for a reload that was started to print. This file measures. It does not assert on time. */
const settle = () => Bun.sleep(isDebug ? 2000 : 500);

const bucket = (ms: number) =>
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

const tally = (into: Record<string, number>, key: string) => void (into[key] = (into[key] ?? 0) + 1);

// A save in place: the file is truncated to 0, and then it is written. How far apart does the
// watcher see the two, and how many loads does one save start?
(isWindows ? test.skip : test)(
  "a save in place, for each style",
  async () => {
    type Save = (hot: Hot, marker: number) => void | Promise<unknown>;
    /** Another program saves the file. One process for each save. */
    const program =
      (...cmd: string[]): Save =>
      (hot, marker) => {
        const { exitCode, stderr } = Bun.spawnSync({ cmd: [...cmd, text(marker)], cwd: hot.cwd, stderr: "pipe" });
        if (exitCode !== 0) throw new Error(`${cmd[0]} failed: ${stderr}`);
      };
    const styles: Record<string, [saves: number, save: Save]> = {
      "openSync(w), writeSync": [
        60,
        (hot, marker) => {
          const fd = openSync(hot.dep, "w");
          writeSync(fd, text(marker));
          closeSync(fd);
        },
      ],
      "openSync(w), 3 ms, writeSync": [
        30,
        (hot, marker) => {
          const fd = openSync(hot.dep, "w");
          Bun.sleepSync(3);
          writeSync(fd, text(marker));
          closeSync(fd);
        },
      ],
      "openSync(w), 30 ms, writeSync": [
        30,
        (hot, marker) => {
          const fd = openSync(hot.dep, "w");
          Bun.sleepSync(30);
          writeSync(fd, text(marker));
          closeSync(fd);
        },
      ],
      "await open(w), await write": [
        60,
        async (hot, marker) => {
          const handle = await promises.open(hot.dep, "w");
          await handle.write(text(marker));
          await handle.close();
        },
      ],
      "open(w) callback, write callback": [
        60,
        (hot, marker) =>
          new Promise<void>((resolve, reject) =>
            open(hot.dep, "w", (error, fd) =>
              error
                ? reject(error)
                : write(fd, text(marker), error => (error ? reject(error) : close(fd, () => resolve()))),
            ),
          ),
      ],
      "createWriteStream": [
        60,
        (hot, marker) =>
          new Promise<void>(resolve => void createWriteStream(hot.dep).end(text(marker), () => resolve())),
      ],
      "sh: printf > file": [30, program("/bin/sh", "-c", `printf '%s' "$0" > dep.js`)],
      "sh: cat source > file": [
        30,
        (hot, marker) => {
          writeFileSync(join(hot.cwd, "..", "source.txt"), text(marker));
          Bun.spawnSync({ cmd: ["/bin/sh", "-c", `cat ../source.txt > dep.js`], cwd: hot.cwd });
        },
      ],
    };
    const node = nodeExe();
    if (node) {
      styles["node: fs.writeFileSync"] = [
        30,
        program(node, "-e", `require("fs").writeFileSync("dep.js", process.argv[1])`),
      ];
      styles["node: fs.writeFile"] = [
        30,
        program(node, "-e", `require("fs").writeFile("dep.js", process.argv[1], () => {})`),
      ];
      styles["node: fs.promises.writeFile"] = [
        30,
        program(node, "-e", `require("fs").promises.writeFile("dep.js", process.argv[1])`),
      ];
      styles["node: createWriteStream"] = [
        30,
        program(node, "-e", `require("fs").createWriteStream("dep.js").end(process.argv[1])`),
      ];
    }
    const python = Bun.which("python3");
    if (python) {
      styles["python3: open(w), write"] = [
        30,
        program(python, "-c", `import sys\nf = open("dep.js", "w")\nf.write(sys.argv[1])\nf.close()`),
      ];
    }
    report["programs"] = { node, python };
    const result: Record<string, unknown> = {};
    for (const [style, [saves, save]] of Object.entries(styles)) {
      result[style] = await withHot(async hot => {
        await settle();
        const recordsBefore = hot.trace().length;
        const errorsBefore = hot.stderr().split("error:").length;
        const records: Record<string, number> = {};
        const gaps: Record<string, number> = {};
        let done = 0;
        for (let i = 1; i <= saves; i++) {
          const from = hot.trace().length;
          await save(hot, i);
          if (!(await hot.loaded(i))) break;
          // The run that loaded the marker has ended.
          await hot.until(lines => lines.lastIndexOf("end") > lines.lastIndexOf(loadLine(i)), 20_000);
          done++;
          const mine = hot.trace().slice(from);
          tally(records, `${mine.length}: ${mine.map(record => record.events.join("+")).join(", ")}`);
          const written = mine.findIndex(record => record.events.includes("write"));
          if (written > 0) tally(gaps, bucket(mine[written].timestamp - mine[0].timestamp));
        }
        await settle();
        // Without the first load.
        const loads = count(hot.lines(), "load ") - 1;
        const ends = count(hot.lines(), "end") - 1;
        const errors = hot.stderr().split("error:").length - errorsBefore;
        return {
          saves: `${done} of ${saves} loaded`,
          loads,
          "runs where the import printed nothing": ends - loads,
          errors,
          "trace records for one save": records,
          "trace records in all": hot.trace().length - recordsBefore,
          "time from the first record to the record with the write": gaps,
        };
      });
      // Kept when a later style stops the file.
      console.error("DIAG", style, JSON.stringify(result[style]));
    }
    report["a save in place"] = result;
  },
  600_000,
);

// A save that empties the file: does it load, and how long after the save?
(isWindows ? test.skip : test)(
  "a save that empties the file, for each style",
  async () => {
    const styles: Record<string, (hot: Hot) => void | Promise<unknown>> = {
      "truncateSync(file, 0)": hot => truncateSync(hot.dep, 0),
      "writeFileSync(file, '')": hot => writeFileSync(hot.dep, ""),
      "Bun.write(file, '')": hot => Bun.write(hot.dep, ""),
      "sh: : > file": hot => {
        Bun.spawnSync({ cmd: ["/bin/sh", "-c", `: > dep.js`], cwd: hot.cwd });
      },
    };
    const result: Record<string, unknown> = {};
    for (const [style, empty] of Object.entries(styles)) {
      result[style] = await withHot(async hot => {
        await settle();
        const latency: number[] = [];
        const emptied: Record<string, number> = {};
        const filled: Record<string, number> = {};
        const events = (from: number) =>
          hot
            .trace()
            .slice(from)
            .map(record => record.events.join("+"))
            .join(", ");
        let marker = 0;
        for (let i = 0; i < 5; i++) {
          const ends = count(hot.lines(), "end");
          let from = hot.trace().length;
          const start = performance.now();
          await empty(hot);
          const seen = await hot.until(lines => count(lines, "end") > ends, 2000);
          tally(emptied, events(from));
          if (seen === undefined) {
            return { loaded: `no load in 2 s at attempt ${i + 1}`, latency, "trace records for the save": emptied };
          }
          latency.push(Math.round((seen - start) * 10) / 10);
          await settle();
          from = hot.trace().length;
          writeFileSync(hot.dep, text(++marker));
          if (!(await hot.loaded(marker))) return { loaded: `no load of the text that came after`, latency };
          await settle();
          tally(filled, events(from));
        }
        return {
          loaded: "5 of 5",
          "ms from the save to the line of the run": latency,
          "runs where the import printed nothing": count(hot.lines(), "end") - count(hot.lines(), "load "),
          "trace records for the save": emptied,
          "trace records for the text that came after": filled,
        };
      });
    }
    console.error("DIAG", JSON.stringify(result));
    report["a save that empties the file"] = result;
  },
  600_000,
);

// A change of the metadata of a file that is empty starts nothing.
(isWindows ? test.skip : test)(
  "metadata of an empty file",
  async () => {
    report["chmod and utimes of an empty file"] = await withHot(async hot => {
      writeFileSync(hot.dep, "");
      await hot.until(lines => count(lines, "end") > 1, 2000);
      await settle();
      const ends = count(hot.lines(), "end");
      const from = hot.trace().length;
      chmodSync(hot.dep, 0o600);
      utimesSync(hot.dep, new Date(2020, 0, 1), new Date(2020, 0, 1));
      await settle();
      const runs = count(hot.lines(), "end") - ends;
      const start = performance.now();
      writeFileSync(hot.dep, text(1));
      const loaded = await hot.loaded(1);
      return {
        runs,
        "trace records": hot
          .trace()
          .slice(from)
          .map(record => record.events.join("+")),
        "the text that came after loaded": loaded,
        "ms": Math.round(performance.now() - start),
      };
    });
  },
  120_000,
);

// How long does kevent() wait for each timeout that the watch loop uses or could use?
test.skipIf(!isMacOS)("kevent: the length of a wait with a timeout", () => {
  const lib = dlopen("libSystem.B.dylib", {
    kqueue: { args: [], returns: "i32" },
    kevent: { args: ["i32", "ptr", "i32", "ptr", "i32", "ptr"], returns: "i32" },
  });
  const kq = lib.symbols.kqueue();
  expect(kq).toBeGreaterThan(0);
  const out = Buffer.alloc(32 * 8);
  const result: Record<string, string> = {};
  try {
    for (const [name, nanoseconds] of [
      ["100 microseconds", 100_000],
      ["1 ms", 1_000_000],
      ["10 ms", 10_000_000],
      ["50 ms", 50_000_000],
    ] as const) {
      // struct timespec: tv_sec i64, tv_nsec i64.
      const timeout = Buffer.alloc(16);
      timeout.writeBigInt64LE(BigInt(nanoseconds), 8);
      const waits: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        expect(lib.symbols.kevent(kq, null, 0, ptr(out), 8, ptr(timeout))).toBe(0);
        waits.push(performance.now() - start);
      }
      waits.sort((a, b) => a - b);
      result[name] = `min ${waits[0].toFixed(3)} ms, median ${waits[10].toFixed(3)} ms, max ${waits[19].toFixed(3)} ms`;
    }
  } finally {
    closeSync(kq);
    lib.close();
  }
  report["kevent wait for a timeout of"] = result;
});

(isWindows ? test.skip : test)("report", () => {
  // Fails on purpose on macOS, to show the numbers.
  if (print) throw new Error("DIAGNOSTIC REPORT\n" + JSON.stringify(report, null, 1));
  expect(report).toBeDefined();
});
