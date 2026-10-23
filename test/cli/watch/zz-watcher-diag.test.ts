// Temporary. Measures the watcher change of this branch on the macOS lanes, and is removed before the
// branch is ready.
import type { Subprocess } from "bun";
import { dlopen, ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isMacOS, isWindows, tempDir } from "harness";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const print = isMacOS || !!process.env.WATCHER_DIAG_PRINT;
const report: Record<string, unknown> = { platform: `${process.platform} ${process.arch} ${release()}` };

const NOTE: [number, string][] = [
  [0x1, "delete"],
  [0x2, "write"],
  [0x4, "extend"],
  [0x8, "attrib"],
  [0x10, "link"],
  [0x20, "rename"],
  [0x40, "revoke"],
];

test.skipIf(!isMacOS)("kqueue: what a vnode reports for each change", () => {
  const lib = dlopen("libSystem.B.dylib", {
    kqueue: { args: [], returns: "i32" },
    kevent: { args: ["i32", "ptr", "i32", "ptr", "i32", "ptr"], returns: "i32" },
  });
  using dir = tempDir("kqueue-probe", { "file.txt": Buffer.alloc(100, "x").toString(), "sub/child.txt": "child" });
  const file = join(String(dir), "file.txt");
  const sub = join(String(dir), "sub");
  const kq = lib.symbols.kqueue();
  expect(kq).toBeGreaterThan(0);
  const watched = new Map<number, string>();
  const watch = (path: string, name: string) => {
    const fd = openSync(path, "r");
    // struct kevent: ident u64, filter i16, flags u16, fflags u32, data i64, udata u64.
    const change = Buffer.alloc(32);
    change.writeBigUInt64LE(BigInt(fd), 0);
    change.writeInt16LE(-4, 8); // EVFILT_VNODE
    change.writeUInt16LE(0x1 | 0x4 | 0x20, 10); // EV_ADD | EV_ENABLE | EV_CLEAR
    change.writeUInt32LE(0x7f, 12);
    expect(lib.symbols.kevent(kq, ptr(change), 1, null, 0, null)).toBe(0);
    watched.set(fd, name);
    return fd;
  };
  const fds = [watch(file, "file"), watch(sub, "dir")];
  const zero = Buffer.alloc(16);
  const out = Buffer.alloc(32 * 8);
  const drain = () => {
    const seen: Record<string, string> = {};
    for (;;) {
      const n = lib.symbols.kevent(kq, null, 0, ptr(out), 8, ptr(zero));
      if (n <= 0) break;
      for (let i = 0; i < n; i++) {
        const name = watched.get(Number(out.readBigUInt64LE(i * 32)))!;
        const fflags = out.readUInt32LE(i * 32 + 12);
        const names = NOTE.filter(([bit]) => fflags & bit).map(([, n]) => n);
        seen[name] = [...new Set([...(seen[name]?.split("+") ?? []), ...names])].sort().join("+");
      }
    }
    return seen;
  };
  const table: Record<string, Record<string, string>> = {};
  const step = (name: string, change: () => void) => {
    change();
    table[name] = drain();
  };
  try {
    step("overwrite the start", () => {
      const fd = openSync(file, "r+");
      writeSync(fd, "yyyy");
      closeSync(fd);
    });
    step("truncate to a shorter length", () => truncateSync(file, 50));
    step("ftruncate to a shorter length", () => {
      const fd = openSync(file, "r+");
      ftruncateSync(fd, 40);
      closeSync(fd);
    });
    step("truncate to a longer length", () => truncateSync(file, 80));
    step("truncate to the same length", () => truncateSync(file, 80));
    step("append", () => appendFileSync(file, "zzz"));
    step("chmod", () => chmodSync(file, 0o600));
    step("utimes", () => utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1)));
    step("open with O_TRUNC", () => closeSync(openSync(file, "w")));
    step("mkdir in the folder", () => mkdirSync(join(sub, "made")));
    step("new file in the folder", () => writeFileSync(join(sub, "new.txt"), "a"));
    step("write to a file in the folder", () => {
      const fd = openSync(join(sub, "child.txt"), "r+");
      writeSync(fd, "CHILD");
      closeSync(fd);
    });
    step("chmod of the folder", () => chmodSync(sub, 0o700));
  } finally {
    for (const fd of fds) closeSync(fd);
    closeSync(kq);
    lib.close();
  }
  expect(table).toEqual({
    "overwrite the start": { file: "write" },
    "truncate to a shorter length": { file: "attrib" },
    "ftruncate to a shorter length": { file: "attrib" },
    "truncate to a longer length": { file: "attrib+extend" },
    "truncate to the same length": { file: "attrib" },
    "append": { file: "extend+write" },
    "chmod": { file: "attrib" },
    "utimes": { file: "attrib" },
    "open with O_TRUNC": { file: "attrib" },
    "mkdir in the folder": { dir: "link+write" },
    "new file in the folder": { dir: "write" },
    "write to a file in the folder": {},
    "chmod of the folder": { dir: "attrib" },
  });
});

// ---------------------------------------------------------------------------------------------
// `bun --hot` with one import. Each load of the import prints `load <n> v=<marker>`, and the entry
// then prints `end`.

const padding = 64;
/** The text of the import: `marker` is 6 digits at a fixed offset, and the rest is a comment. */
const text = (marker: number, pad = padding) =>
  `globalThis.n = (globalThis.n ?? 0) + 1; console.log("load " + globalThis.n + " v=${String(marker).padStart(6, "0")}");//` +
  Buffer.alloc(pad, "p").toString();
const markerAt = text(0).indexOf("v=") + 2;

type Hot = {
  dep: string;
  /** The `load` and `end` lines so far. */
  lines: () => string[];
  stderr: () => string;
  /** The records of the trace so far, as text. */
  trace: () => string[];
  /** Resolves when a `load` line has this marker. False after 20 s. */
  loaded: (marker: number) => Promise<boolean>;
  /** One `pwrite` over the marker, and the load that follows it. The size stays. */
  sentinel: () => Promise<number>;
};

async function withHot<T>(body: (hot: Hot) => Promise<T>) {
  using dir = tempDir("watcher-diag-hot", {
    "app/main.js": `import "./dep.js";\nconsole.log("end");\n`,
    "app/dep.js": text(0),
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
  let changed = Promise.withResolvers<void>();
  (async () => {
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      changed.resolve();
      changed = Promise.withResolvers<void>();
    }
  })();
  (async () => {
    for await (const chunk of proc.stderr) stderr += Buffer.from(chunk).toString();
  })();
  const lines = () => stdout.split("\n").slice(0, -1);
  const loaded = async (marker: number) => {
    const wanted = "v=" + String(marker).padStart(6, "0");
    const deadline = Bun.sleep(20_000).then(() => "late" as const);
    while (!lines().some(line => line.startsWith("load ") && line.endsWith(wanted))) {
      if ((await Promise.race([changed.promise, deadline])) === "late") return false;
    }
    return true;
  };
  let marker = 900_000;
  const sentinel = async () => {
    marker++;
    const fd = openSync(dep, "r+");
    writeSync(fd, String(marker), markerAt);
    closeSync(fd);
    if (!(await loaded(marker))) throw new Error(`no load for the sentinel ${marker}:\n${stdout}\n${stderr}`);
    return marker;
  };
  const trace = () => {
    try {
      return readFileSync(traceFile, "utf8")
        .split("\n")
        .filter(line => line.trim());
    } catch {
      return [];
    }
  };
  if (!(await loaded(0))) throw new Error(`no first load:\n${stdout}\n${stderr}`);
  return await body({ dep, lines, stderr: () => stderr, trace, loaded, sentinel });
}

const loadsOf = (lines: string[]) => lines.filter(line => line.startsWith("load ")).length;
/** Long enough for a reload that was started to print. This file measures; it does not assert on time. */
const settle = () => Bun.sleep(isDebug ? 2000 : 500);

// One change each, and how many loads it starts. On kqueue every one of them raises an event.
(isWindows ? test.skip : test)("loads that one change of each kind starts", async () => {
  let setxattr: ((path: string) => void) | undefined;
  let lib: ReturnType<typeof dlopen> | undefined;
  if (isMacOS) {
    lib = dlopen("libSystem.B.dylib", {
      setxattr: { args: ["ptr", "ptr", "ptr", "usize", "u32", "i32"], returns: "i32" },
    });
    let value = 0;
    setxattr = path => {
      const bytes = Buffer.from(String(value++));
      const rc = lib!.symbols.setxattr(
        ptr(Buffer.from(path + "\0")),
        ptr(Buffer.from("user.bun.diag\0")),
        ptr(bytes),
        bytes.length,
        0,
        0,
      );
      if (rc !== 0) throw new Error("setxattr failed");
    };
  }
  const counts = await withHot(async hot => {
    const counts: Record<string, number> = {};
    const change = async (name: string, apply: () => void) => {
      const before = loadsOf(hot.lines());
      const traced = hot.trace().length;
      apply();
      // kqueue reports each of these changes, and the watcher has handled one once the trace has it.
      if (isMacOS)
        while (
          !hot
            .trace()
            .slice(traced)
            .some(line => line.includes("dep.js"))
        )
          await Bun.sleep(1);
      await settle();
      counts[name] = loadsOf(hot.lines()) - before;
    };
    await change("chmod", () => chmodSync(hot.dep, 0o600));
    await change("utimes", () => utimesSync(hot.dep, new Date(2020, 0, 1), new Date(2020, 0, 1)));
    if (setxattr) await change("setxattr", () => setxattr!(hot.dep));
    await change("truncate to the same length", () => truncateSync(hot.dep, text(0).length));
    await change("truncate to a shorter length", () => truncateSync(hot.dep, text(0).length - 8));
    await change("truncate to a longer length", () => truncateSync(hot.dep, text(0).length + 8));
    return counts;
  });
  lib?.close();
  report["loads that one change starts"] = counts;
  if (isMacOS) {
    expect(counts).toEqual({
      "chmod": 0,
      "utimes": 0,
      "setxattr": 0,
      "truncate to the same length": 0,
      "truncate to a shorter length": 1,
      "truncate to a longer length": 1,
    });
  }
});

// Many saves of each style, and how many loads they start in all.
(isWindows ? test.skip : test)("loads per save, for each style of save", async () => {
  const saves = 150;
  const styles: Record<string, (dep: string, marker: number, i: number) => void | Promise<unknown>> = {
    // What most editors and node's fs.writeFile do.
    "open(O_TRUNC), write": (dep, marker) => {
      const fd = openSync(dep, "w");
      writeSync(fd, text(marker));
      closeSync(fd);
    },
    // What Bun.write and bun's fs.writeFile do. Every second save is shorter than the file.
    "write, ftruncate": (dep, marker, i) => {
      const next = text(marker, i % 2 ? 8 : padding);
      const fd = openSync(dep, "r+");
      writeSync(fd, next);
      ftruncateSync(fd, next.length);
      closeSync(fd);
    },
    "Bun.write": (dep, marker, i) => Bun.write(dep, text(marker, i % 2 ? 8 : padding)),
    "rename over": (dep, marker) => {
      writeFileSync(dep + ".next", text(marker));
      renameSync(dep + ".next", dep);
    },
  };
  const result: Record<string, string> = {};
  for (const [style, save] of Object.entries(styles)) {
    result[style] = await withHot(async hot => {
      await settle();
      const errorsBefore = hot.stderr().split("error:").length;
      let done = 0;
      for (let i = 1; i <= saves; i++) {
        await save(hot.dep, i, i);
        if (!(await hot.loaded(i))) break;
        done++;
      }
      await settle();
      // Without the first load.
      const loads = loadsOf(hot.lines()) - 1;
      const ends = hot.lines().filter(line => line === "end").length - 1;
      const errors = hot.stderr().split("error:").length - errorsBefore;
      return `${done} of ${saves} saves loaded: ${loads} loads, ${ends - loads} runs where the import printed nothing, ${errors} errors`;
    });
  }
  report["loads per save"] = result;
});

// Changes of metadata only.
(isWindows ? test.skip : test)("wakeups for changes of metadata alone", async () => {
  report["300 chmod and 300 utimes"] = await withHot(async hot => {
    const before = loadsOf(hot.lines());
    const traced = hot.trace().length;
    let mode = 0o600;
    for (let i = 0; i < 300; i++) {
      chmodSync(hot.dep, (mode ^= 0o044));
      utimesSync(hot.dep, new Date(2020, 0, 1 + (i % 20)), new Date(2020, 0, 1 + (i % 20)));
    }
    await settle();
    const records = hot.trace().slice(traced);
    const loads = loadsOf(hot.lines()) - before;
    expect(loads).toBe(0);
    return `${records.filter(line => line.includes("metadata")).length} trace records with metadata, ${records.length} records in all, ${loads} loads`;
  });
});

// ---------------------------------------------------------------------------------------------
// `bun bake`, as the rows of test/cli/bake/bake.test.ts "bun bake rejects ..." use it.

const env = { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1", NO_COLOR: "1" };
const fixed = `export default {};`;
const badConfig = `export default { plugins: [{ name: "a", framework: { plugins: [], fileSystemRouterTypes: [] } }] };`;
const server = `export default { fetch: () => new Response("fixed") };`;

function collectOutput(proc: Subprocess<"ignore", "pipe", "pipe">) {
  let text = "";
  let changed = Promise.withResolvers<void>();
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      text += decoder.decode(chunk, { stream: true });
      changed.resolve();
      changed = Promise.withResolvers<void>();
    }
  };
  const done = Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  return {
    get text() {
      return text;
    },
    /** False when `ms` passed, or the process ended, first. */
    async waitFor(pattern: RegExp, ms: number) {
      const deadline = Bun.sleep(ms).then(() => "late" as const);
      while (!pattern.test(text)) {
        const first = await Promise.race([
          changed.promise.then(() => "more" as const),
          done.then(() => "end" as const),
          deadline,
        ]);
        if (first !== "more" && !pattern.test(text)) return false;
      }
      return true;
    },
  };
}

const variants = ["first write makes app/", "app/ is there", "app/ has a page"] as const;
type Variant = (typeof variants)[number];
/** Most of the time-outs in CI are in the rows that start without app/. */
const order: Variant[] = ["first write makes app/", "first write makes app/", "app/ is there", "app/ has a page"];
type Hang = {
  variant: Variant;
  stage: string;
  out: string;
  trace: string;
  config: string;
  /** Whether one more save of the same text starts the server. */
  startsAfterOneMoreSave?: boolean;
  /** The main thread of the child, from sample(1). */
  sample?: string;
};
const counts = Object.fromEntries(variants.map(v => [v, { runs: 0, hangs: 0, halfSaved: 0, halfSavedStarted: 0 }]));
const hangs: Hang[] = [];
const split: boolean[] = [];
let sequence = 0;

async function withBake<T>(
  files: Record<string, string>,
  body: (root: string, output: ReturnType<typeof collectOutput>, trace: () => string, pid: () => number) => Promise<T>,
) {
  using dir = tempDir("bake-diag", files);
  const root = String(dir);
  // Outside the project, so that the watcher does not report its own trace.
  const traceFile = join(root, "..", `bake-diag-trace-${process.pid}-${sequence++}.jsonl`);
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "bake", "--port=0"],
      env: { ...env, BUN_WATCHER_TRACE: traceFile },
      cwd: root,
      killSignal: "SIGKILL",
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    return await body(
      root,
      collectOutput(proc),
      () => {
        try {
          return readFileSync(traceFile, "utf8").replaceAll(root, "");
        } catch {
          return "(no trace)";
        }
      },
      () => proc.pid,
    );
  } finally {
    rmSync(traceFile, { force: true });
  }
}

async function natural(variant: Variant) {
  const files: Record<string, string> = { "bake.config.ts": badConfig };
  if (variant === "app/ is there") files["app/pages/.keep"] = "";
  if (variant === "app/ has a page") files["app/pages/index.html"] = `<!doctype html><html><body></body></html>`;
  await withBake(files, async (root, output, trace, pid) => {
    const hang = (stage: string): Hang | undefined => {
      counts[variant].hangs++;
      if (hangs.length < 4) {
        let config = "(unreadable)";
        try {
          config = readFileSync(join(root, "bake.config.ts"), "utf8");
        } catch {}
        const entry: Hang = {
          variant,
          stage,
          out: output.text.replaceAll(root, "").slice(0, 500),
          trace: trace().slice(0, 500),
          config: config.slice(0, 120),
        };
        hangs.push(entry);
        return entry;
      }
    };
    counts[variant].runs++;
    if (!(await output.waitFor(/error: /, 30_000))) return hang("no first error");
    const late = Symbol();
    const first = await Promise.race([
      Bun.write(join(root, "app/server.ts"), server),
      Bun.sleep(10_000).then(() => late),
    ]);
    if (first === late) return hang("the first Bun.write did not resolve");
    await Bun.write(join(root, "bake.config.ts"), fixed);
    const started = await output.waitFor(/url: /, 10_000);
    // A reload that ran between the write() and the ftruncate() of that Bun.write.
    if (output.text.includes("error: Unexpected }")) {
      counts[variant].halfSaved++;
      if (started) counts[variant].halfSavedStarted++;
    }
    if (!started) {
      const entry = hang("no url 10 s after the writes");
      if (entry && isMacOS) {
        try {
          const sampled = Bun.spawnSync({ cmd: ["sample", String(pid()), "1", "-mayDie"], timeout: 15_000 });
          const text = sampled.stdout.toString();
          const from = text.indexOf("Call graph:");
          entry.sample = (from === -1 ? text + sampled.stderr.toString() : text.slice(from)).slice(0, 1800);
        } catch (error) {
          entry.sample = String(error);
        }
      }
      // A save that is one `write()` after an `open()` that truncates.
      writeFileSync(join(root, "bake.config.ts"), fixed);
      const startedLater = await output.waitFor(/url: /, 5_000);
      if (entry) entry.startsAfterOneMoreSave = startedLater;
    }
  });
}

(isMacOS || process.env.WATCHER_DIAG_PRINT ? test.concurrent : test.skip).each(Array.from({ length: 15 }, (_, i) => i))(
  "bun bake starts after the project is repaired, group %d",
  async group => {
    const until = performance.now() + 35_000;
    for (let i = 0; i < 120 && performance.now() < until; i++) {
      await natural(order[(group + i) % order.length]);
    }
  },
);

// The two steps of `Bun.write`, with the reload in between.
(isWindows ? test.skip : test.concurrent).each([0, 1, 2])(
  "bun bake, repaired with a save that stops before its truncation, %d",
  async () => {
    await withBake({ "bake.config.ts": badConfig }, async (root, output) => {
      expect(await output.waitFor(/error: /, 30_000)).toBe(true);
      await Bun.write(join(root, "app/server.ts"), server);
      const fd = openSync(join(root, "bake.config.ts"), "r+");
      writeSync(fd, fixed);
      // The reload that reads the file as it is now.
      expect(await output.waitFor(/error: Unexpected \}/, 10_000)).toBe(true);
      ftruncateSync(fd, fixed.length);
      closeSync(fd);
      split.push(await output.waitFor(/url: /, 10_000));
    });
  },
);

(isWindows ? test.skip : test)("report", () => {
  report["bun bake, natural"] = Object.fromEntries(
    Object.entries(counts).map(([name, { runs, hangs, halfSaved, halfSavedStarted }]) => [
      name,
      `${hangs} of ${runs} hang; ${halfSaved} read the half-saved file, ${halfSavedStarted} of those started`,
    ]),
  );
  report["bun bake, hangs"] = hangs;
  report["bun bake, save stopped before its truncation: starts"] = split;
  // Fails on purpose on macOS, to show the numbers.
  if (print) throw new Error("DIAGNOSTIC REPORT\n" + JSON.stringify(report, null, 1));
  expect(hangs).toEqual([]);
  expect(split).toEqual([true, true, true]);
});
