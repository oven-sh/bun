// Temporary. Measures the watcher of this branch on the macOS lanes. It is removed before the branch
// is ready.
import { dlopen, ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { isMacOS, isWindows, nodeExe } from "harness";
import {
  chmodSync,
  close,
  closeSync,
  createWriteStream,
  open,
  openSync,
  promises,
  truncateSync,
  utimesSync,
  write,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  bucket,
  count,
  type Hot,
  loadLine,
  type Mode,
  modes,
  otherLine,
  otherText,
  platform,
  print,
  settle,
  tally,
  text,
  withHot,
} from "./zz-emptied-file-diag-harness";

const report: Record<string, unknown> = { platform };

type Save = (hot: Hot, marker: number) => void | Promise<unknown>;
/** Another program saves the file. One process for each save. The text comes after `cmd`. */
const program =
  (...cmd: string[]): Save =>
  (hot, marker) => {
    const { exitCode, stderr } = Bun.spawnSync({ cmd: [...cmd, text(marker)], cwd: hot.cwd, stderr: "pipe" });
    if (exitCode !== 0) throw new Error(`${cmd[0]} failed: ${stderr}`);
  };
const node = nodeExe();
const python = Bun.which("python3");

/** Saves `saves` times and counts the loads and the trace records of each save. */
async function measure(mode: Mode, saves: number, save: Save) {
  return await withHot(
    async hot => {
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
        const written = mine.findLastIndex(record => record.events.includes("write"));
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
        "time from the first record to the last record with a write": gaps,
      };
    },
    { mode },
  );
}

// A save in place: the file is truncated to 0, and then it is written. How many loads does one save
// start, and does a load read the empty file?
(isWindows ? test.skip : test)(
  "a save in place, for each style",
  async () => {
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
    if (python) {
      styles["python3: open(w), write"] = [
        30,
        program(python, "-c", `import sys\nf = open("dep.js", "w")\nf.write(sys.argv[1])\nf.close()`),
      ];
    }
    report["programs"] = { node, python };
    const result: Record<string, unknown> = {};
    for (const [style, [saves, save]] of Object.entries(styles)) {
      result[style] = await measure("change", saves, save);
      // Kept when a later style stops the file.
      console.error("DIAG", style, JSON.stringify(result[style]));
    }
    report["a save in place"] = result;
  },
  600_000,
);

// The shell truncates the file, and then it starts an interpreter that writes the file. The write
// comes later than the wait of the watcher. With the rule of the base branch the trace has a record
// for the truncation and a record for the write: the time between them is the time that the saver
// takes.
(isWindows ? test.skip : test)(
  "a redirect from an interpreter",
  async () => {
    const interpreters: Record<string, [exe: string, script: string] | undefined> = {
      "sh: node -e > file": node ? [node, `"$1" -e 'process.stdout.write(process.argv[1])' "$0" > dep.js`] : undefined,
      "sh: python3 -c > file": python
        ? [python, `"$1" -c 'import sys; sys.stdout.write(sys.argv[1])' "$0" > dep.js`]
        : undefined,
    };
    const result: Record<string, unknown> = {};
    for (const [style, entry] of Object.entries(interpreters)) {
      if (!entry) continue;
      const [exe, script] = entry;
      // sh gets the text as $0 and the interpreter as $1.
      const save: Save = (hot, marker) => {
        const { exitCode, stderr } = Bun.spawnSync({
          cmd: ["/bin/sh", "-c", script, text(marker), exe],
          cwd: hot.cwd,
          stderr: "pipe",
        });
        if (exitCode !== 0) throw new Error(`${style} failed: ${stderr}`);
      };
      for (const mode of modes) {
        result[`${style}, ${mode}`] = await measure(mode, 40, save);
        console.error("DIAG", style, mode, JSON.stringify(result[`${style}, ${mode}`]));
      }
    }
    report["a redirect from an interpreter"] = result;
  },
  600_000,
);

// A save that empties the file: does it load, and how long after the save?
(isWindows ? test.skip : test)(
  "a save that empties the file, for each style",
  async () => {
    const styles: Record<string, (hot: Hot) => void | Promise<unknown>> = {
      "truncateSync(file, 0)": hot => truncateSync(hot.dep, 0),
      "closeSync(openSync(file, 'w'))": hot => closeSync(openSync(hot.dep, "w")),
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

// A change of the metadata of a file that is empty starts nothing, and the watcher does not wait.
(isWindows ? test.skip : test)(
  "metadata of an empty file",
  async () => {
    report["chmod and utimes of an empty file"] = await withHot(async hot => {
      writeFileSync(hot.dep, "");
      await hot.until(lines => count(lines, "end") > 1, 2000);
      await settle();
      const ends = count(hot.lines(), "end");
      const from = hot.trace().length;
      const counters = hot.counters();
      chmodSync(hot.dep, 0o600);
      utimesSync(hot.dep, new Date(2020, 0, 1), new Date(2020, 0, 1));
      await settle();
      const runs = count(hot.lines(), "end") - ends;
      const holds = hot.counters().hold - counters.hold;
      const start = performance.now();
      writeFileSync(hot.dep, text(1));
      const loaded = await hot.loaded(1);
      return {
        runs,
        holds,
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

// The watch loop waits for the write of a save in place. How long does a save of another file wait
// when it comes right after a save that empties a file?
(isWindows ? test.skip : test)(
  "a save of another file right after a save that empties a file",
  async () => {
    const result: Record<string, unknown> = {};
    for (const mode of modes) {
      result[mode] = await withHot(
        async hot => {
          await settle();
          const alone: number[] = [];
          const afterEmptied: number[] = [];
          let marker = 0;
          const save = async (into: number[], before?: () => void) => {
            const wanted = otherLine(++marker);
            const start = performance.now();
            before?.();
            writeFileSync(hot.other, otherText(marker));
            const seen = await hot.until(lines => lines.includes(wanted), 5000);
            into.push(seen === undefined ? -1 : Math.round((seen - start) * 10) / 10);
            await settle();
          };
          for (let i = 1; i <= 5; i++) {
            await save(alone);
            await save(afterEmptied, () => truncateSync(hot.dep, 0));
            writeFileSync(hot.dep, text(i));
            if (!(await hot.loaded(i))) return { alone, afterEmptied, stopped: `no load of dep.js at ${i}` };
            await settle();
          }
          return { alone, "right after a save that empties a file": afterEmptied };
        },
        { mode },
      );
    }
    report["ms from a save of another file to its load"] = result;
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
