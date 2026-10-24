// Temporary. Measures the watcher of this branch on the macOS lanes: the system calls of the watcher
// thread and the time from a save to its load, with the rule of the base branch and with the change.
// It is removed before the branch is ready.
import { expect, test } from "bun:test";
import { isMacOS, isWindows } from "harness";
import { chmodSync, closeSync, openSync, truncateSync, writeFileSync, writeSync } from "node:fs";
import {
  count,
  type Counters,
  extraLine,
  extraText,
  type Hot,
  loadLine,
  modes,
  otherLine,
  otherText,
  platform,
  print,
  settle,
  spread,
  text,
  withHot,
} from "./zz-emptied-file-diag-harness";

const report: Record<string, unknown> = { platform };

/** `open(O_TRUNC)`, then `write()`, with nothing between them. */
function saveInPlace(path: string, contents: string) {
  const fd = openSync(path, "w");
  writeSync(fd, contents);
  closeSync(fd);
}
/** `write()` over the start of the file. No truncation. */
function overwrite(path: string, contents: string) {
  const fd = openSync(path, "r+");
  writeSync(fd, contents);
  closeSync(fd);
}
const minus = (after: Counters, before: Counters) =>
  `kevent ${after.kevent - before.kevent}, fstat ${after.fstat - before.fstat}, lock ${after.lock - before.lock}, hold ${after.hold - before.hold}`;
/** The run that loaded `marker` has printed its `end`. */
const ended = (hot: Hot, marker: number) =>
  hot.until(lines => lines.lastIndexOf("end") > lines.lastIndexOf(loadLine(marker)), 20_000);

// What the watcher thread does for each kind of change: calls of kevent() and fstat(), times that it
// takes the mutex in dispatch_file_updates, and waits that it starts.
(isWindows ? test.skip : test)(
  "counts for each kind of change",
  async () => {
    const times = 100;
    const result: Record<string, unknown> = {};
    for (const mode of modes) {
      result[mode] = await withHot(
        async hot => {
          await settle();
          let marker = 0;
          const out: Record<string, string> = {};
          // The trace has a record now, and so the counters have values.
          overwrite(hot.dep, text(++marker));
          if (!(await hot.loaded(marker))) return { stopped: "no load of the first save" };
          await ended(hot, marker);
          await settle();

          let before = hot.counters();
          for (let i = 0; i < times; i++) {
            overwrite(hot.dep, text(++marker));
            if (!(await hot.loaded(marker))) return { ...out, stopped: `write ${i}` };
            await ended(hot, marker);
          }
          await settle();
          out[`${times} saves that write over the file`] = minus(hot.counters(), before);

          before = hot.counters();
          for (let i = 0; i < times; i++) {
            saveInPlace(hot.dep, text(++marker));
            if (!(await hot.loaded(marker))) return { ...out, stopped: `save in place ${i}` };
            await ended(hot, marker);
          }
          await settle();
          out[`${times} saves in place`] = minus(hot.counters(), before);

          // inotify is not asked for a change of metadata.
          if (isMacOS) {
            before = hot.counters();
            for (let i = 0; i < times; i++) {
              const records = hot.records();
              chmodSync(hot.dep, i % 2 ? 0o644 : 0o600);
              if (!(await hot.traced(records))) return { ...out, stopped: `chmod ${i}` };
            }
            await settle();
            out[`${times} chmod`] = minus(hot.counters(), before);
          }

          before = hot.counters();
          for (let i = 0; i < times; i++) {
            const records = hot.records();
            const ends = count(hot.lines(), "end");
            truncateSync(hot.dep, 0);
            // With the rule of the base branch nothing loads on macOS: the trace has the event.
            if (mode === "base" && isMacOS) {
              if (!(await hot.traced(records))) return { ...out, stopped: `truncation ${i}` };
            } else if ((await hot.until(lines => count(lines, "end") > ends, 5000)) === undefined) {
              return { ...out, stopped: `no run after truncation ${i}` };
            }
            overwrite(hot.dep, text(++marker));
            if (!(await hot.loaded(marker))) return { ...out, stopped: `write after truncation ${i}` };
            await ended(hot, marker);
          }
          await settle();
          out[`${times} saves that empty the file, each with a write after it`] = minus(hot.counters(), before);
          return out;
        },
        { mode },
      );
      console.error("DIAG counts", mode, JSON.stringify(result[mode]));
    }
    report["counts of the watcher thread"] = result;
  },
  600_000,
);

// 64 files are opened with truncation, and then all of them are written.
(isWindows ? test.skip : test)(
  "64 saves in place that overlap",
  async () => {
    const files = 64;
    const result: Record<string, unknown> = {};
    for (const mode of modes) {
      result[mode] = await withHot(
        async hot => {
          await settle();
          // The trace has a record now, and so the counters have values.
          overwrite(hot.dep, text(1));
          if (!(await hot.loaded(1))) return { stopped: "no load of the first save" };
          await settle();
          const rounds: string[] = [];
          for (let round = 1; round <= 5; round++) {
            const before = hot.counters();
            const runs = count(hot.lines(), "end");
            const fds = hot.extras.map(path => openSync(path, "w"));
            fds.forEach((fd, i) => writeSync(fd, extraText(i, round)));
            fds.forEach(fd => closeSync(fd));
            const wanted = hot.extras.map((_, i) => extraLine(i, round));
            // The last run has every new text.
            const seen = await hot.until(lines => {
              const from = lines.lastIndexOf("end", lines.length - 2);
              const last = lines.slice(from + 1);
              return lines.at(-1) === "end" && wanted.every(line => last.includes(line));
            }, 20_000);
            if (seen === undefined) return { rounds, stopped: `round ${round}` };
            await settle();
            rounds.push(`${minus(hot.counters(), before)}, runs ${count(hot.lines(), "end") - runs}`);
          }
          return rounds;
        },
        { mode, extras: files },
      );
      console.error("DIAG overlap", mode, JSON.stringify(result[mode]));
    }
    report["64 saves in place that overlap, for each round"] = result;
  },
  600_000,
);

// The time from the end of a save to the line that its load prints. Rounds with the rule of the base
// branch and rounds with the change come in turn.
(isWindows ? test.skip : test)(
  "time from a save to its load",
  async () => {
    const saves = 100;
    const result: Record<string, Record<string, string>> = {};
    for (const [round, mode] of (["base", "change", "base", "change"] as const).entries()) {
      const name = `round ${round + 1}, ${mode}`;
      result[name] = await withHot(
        async hot => {
          await settle();
          const out: Record<string, string> = {};
          let marker = 0;
          let other = 0;

          const ordinary: number[] = [];
          for (let i = 0; i < saves; i++) {
            const wanted = loadLine(++marker);
            saveInPlace(hot.dep, text(marker));
            const start = performance.now();
            const seen = await hot.until(lines => lines.includes(wanted), 20_000);
            if (seen === undefined) return { ...out, stopped: `save in place ${i}` };
            ordinary.push(seen - start);
            await ended(hot, marker);
          }
          out["a save in place"] = spread(ordinary);

          // With the rule of the base branch an emptied file does not load on macOS.
          if (mode === "change" || !isMacOS) {
            const emptied: number[] = [];
            for (let i = 0; i < saves; i++) {
              const ends = count(hot.lines(), "end");
              truncateSync(hot.dep, 0);
              const start = performance.now();
              const seen = await hot.until(lines => count(lines, "end") > ends, 20_000);
              if (seen === undefined) return { ...out, stopped: `emptied ${i}` };
              emptied.push(seen - start);
              overwrite(hot.dep, text(++marker));
              if (!(await hot.loaded(marker))) return { ...out, stopped: `write after emptied ${i}` };
              await ended(hot, marker);
            }
            out["a save that empties the file"] = spread(emptied);
          }

          const alone: number[] = [];
          const afterEmptied: number[] = [];
          for (let i = 0; i < saves; i++) {
            for (const into of [alone, afterEmptied]) {
              const wanted = otherLine(++other);
              if (into === afterEmptied) truncateSync(hot.dep, 0);
              writeFileSync(hot.other, otherText(other));
              const start = performance.now();
              const seen = await hot.until(lines => lines.includes(wanted), 20_000);
              if (seen === undefined) return { ...out, stopped: `other file ${i}` };
              into.push(seen - start);
              await hot.until(lines => lines.lastIndexOf("end") > lines.lastIndexOf(wanted), 20_000);
              if (into === afterEmptied) {
                overwrite(hot.dep, text(++marker));
                if (!(await hot.loaded(marker))) return { ...out, stopped: `write after other file ${i}` };
                await ended(hot, marker);
              }
            }
          }
          out["a save of another file"] = spread(alone);
          out["a save of another file right after a save that empties a file"] = spread(afterEmptied);
          return out;
        },
        { mode },
      );
      console.error("DIAG time", name, JSON.stringify(result[name]));
    }
    report["ms from the end of a save to the line of its load"] = result;
  },
  600_000,
);

// After a save that emptied a file and its load, the watcher thread sleeps in kevent() with no
// timeout. The next save wakes it: two calls of kevent() for that save, and no more.
(isWindows ? test.skip : test)(
  "the watcher thread is idle after a save that empties a file",
  async () => {
    report["calls of kevent() in 10 s with no change, after a save that emptied a file"] = await withHot(async hot => {
      await settle();
      const ends = count(hot.lines(), "end");
      truncateSync(hot.dep, 0);
      if ((await hot.until(lines => count(lines, "end") > ends, 5000)) === undefined) return "no run for the save";
      overwrite(hot.dep, text(1));
      if (!(await hot.loaded(1))) return "no load of the write";
      await settle();
      const before = hot.counters();
      await Bun.sleep(10_000);
      overwrite(hot.dep, text(2));
      if (!(await hot.loaded(2))) return "no load after 10 s";
      await settle();
      const after = hot.counters();
      // The call that waited for the 10 s, and the 100 microsecond call after it, are for the last save.
      return `${after.kevent - before.kevent - 2} (all calls: ${minus(after, before)})`;
    });
  },
  120_000,
);

(isWindows ? test.skip : test)("report", () => {
  // Fails on purpose on macOS, to show the numbers.
  if (print) throw new Error("DIAGNOSTIC REPORT\n" + JSON.stringify(report, null, 1));
  expect(report).toBeDefined();
});
