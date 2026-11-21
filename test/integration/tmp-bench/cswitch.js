// Usage: bun cswitch.js <old> <new> busy <variant;...> [rounds]   With every CPU busy: why the reader of a child's output is not running, from a trace of the scheduler.
const fs = require("fs"),
  os = require("os"),
  TOTAL = +(process.env.TOTAL ?? 64) << 20,
  [mode, ...args] = process.argv.slice(2);
const k32 = () =>
  require("bun:ffi").dlopen("kernel32.dll", {
    GetCurrentThreadId: { returns: "u32" },
    QueryPerformanceCounter: { args: ["ptr"], returns: "i32" },
    QueryPerformanceFrequency: { args: ["ptr"], returns: "i32" },
  }).symbols;
const qpc = (f, v = new BigInt64Array(1)) => (f(v), Number(v[0]));
const REASONS = {
  0: "Executive",
  2: "PageIn",
  4: "Delay",
  5: "Suspended",
  6: "UserRequest",
  9: "WrPageIn",
  13: "WrUserRequest",
  15: "Queue",
  18: "VirtualMemory",
  26: "Kernel",
  27: "Resource",
  28: "PushLock",
  30: "QuantumEnd",
  31: "DispatchInt",
  32: "Preempted",
  33: "Yield",
  34: "FastMutex",
  37: "Alert",
  38: "DeferredPreempt",
};
function events(b) {
  const list = [],
    hooks = {};
  for (let at = 0, size; at + 72 <= b.length && (size = b.readUInt32LE(at)) >= 72; at += size) {
    const cpu = b.readUInt16LE(at + 40),
      end = at + Math.min(size, b.readUInt32LE(at + 48) || b.readUInt32LE(at + 4), b.length - at);
    for (let p = at + 72, len; p + 16 <= end && b.readUInt32LE(p) !== 0xffffffff; p += (len + 7) & ~7) {
      const type = b[p + 2],
        head = { 1: 32, 2: 32, 3: 24, 4: 24, 16: 16, 17: 16 }[type];
      if ((len = b.readUInt16LE(head ? p + 4 : p)) < 8) break;
      const hook = head ? b.readUInt16LE(p + 6) : -1,
        key = `${type}:${hook.toString(16)}`,
        d = p + head;
      hooks[key] = (hooks[key] ?? 0) + 1;
      if (!head) continue;
      const t = Number(b.readBigInt64LE(head === 16 ? p + 8 : p + 16));
      if (hook === 0x524)
        list.push({
          t,
          cpu,
          to: b.readUInt32LE(d),
          from: b.readUInt32LE(d + 4),
          toAt: b[d + 8],
          fromAt: b[d + 9],
          reason: b[d + 12],
          state: b[d + 14],
        });
      else if (hook === 0x532)
        list.push({ t, cpu, ready: b.readUInt32LE(d), why: b[d + 4], plus: b[d + 5], flag: b[d + 6] });
      else if (hook === 0x501 || hook === 0x503)
        list.push({ t, pid: b.readUInt32LE(d), thread: b.readUInt32LE(d + 4) });
    }
  }
  return [list.sort((x, y) => x.t - y.t), hooks];
}
function report(list, runs, burners, hz) {
  const pids = new Map(),
    running = [],
    ms = t => (t * 1000) / hz,
    sums = {};
  runs.sort((x, y) => x.t0 - y.t0);
  let i = 0,
    off = {};
  for (const e of list) {
    while (i < runs.length && e.t > runs[i].t1) (i++, (off = {}));
    const run = i < runs.length && e.t >= runs[i].t0 ? runs[i] : null;
    const who = id =>
      id === run.reader
        ? "reader"
        : id === run.writer
          ? "writer"
          : id === 0
            ? "idle"
            : pids.get(id) === run.pid
              ? "helper"
              : pids.get(id) === run.child
                ? "child's"
                : burners.includes(pids.get(id))
                  ? "burner"
                  : "other";
    if (e.thread) pids.set(e.thread, e.pid);
    else if (e.ready) {
      if (run && off[e.ready])
        off[e.ready].ready ??= { t: e.t, by: `${e.flag & 1 ? "dpc" : who(running[e.cpu])} ${e.why}/+${e.plus}` };
    } else {
      running[e.cpu] = e.to;
      if (!run) continue;
      if (e.from === run.reader || e.from === run.writer) off[e.from] = { ...e, next: who(e.to) };
      const was = off[e.to];
      if (!was) continue;
      delete off[e.to];
      const woke = was.ready?.t ?? was.t,
        queued = ms(e.t - woke),
        table = ((sums[run.name] ??= {})[who(e.to)] ??= {});
      const row = (table[
        `${was.state === 5 ? "waits" : "loses"} ${REASONS[was.reason] ?? was.reason} @${was.fromAt} to ${was.next}${was.ready ? `, woken by ${was.ready.by}` : ""}, back @${e.toAt}`
      ] ??= { n: 0, asleep: 0, queued: 0, long: 0, moved: 0 });
      (row.n++,
        (row.asleep += ms(woke - was.t)),
        (row.queued += queued),
        (row.long += +(queued > 0.5)),
        (row.moved += +(e.cpu !== was.cpu)));
    }
  }
  for (const [name, threads] of Object.entries(sums)) {
    const mine = runs.filter(it => it.name === name),
      n = mine.length,
      f = x => (x / n).toFixed(1).padStart(6);
    console.log(
      `cond sw ${name}: ${mine
        .map(it => Math.round(ms(it.t1 - it.t0)))
        .sort((x, y) => x - y)
        .join(
          " ",
        )} ms, ${Math.round(mine.reduce((s, it) => s + it.chunks, 0) / n)} chunks; for each run: times, ms asleep, ms ready, times ready for over 0.5 ms, moves`,
    );
    for (const [thread, table] of Object.entries(threads)) {
      const rows = Object.entries(table).sort(([, x], [, y]) => y.asleep + y.queued - x.asleep - x.queued),
        all = key => f(rows.reduce((s, [, r]) => s + r[key], 0));
      console.log(`cond sw   ${thread}`, all("n"), all("asleep"), all("queued"), all("long"), all("moved"), " in all");
      for (const [key, r] of rows.slice(0, thread === "reader" ? 6 : 1))
        console.log(`cond sw   ${thread}`, f(r.n), f(r.asleep), f(r.queued), f(r.long), f(r.moved), "", key);
    }
  }
}
function timeline(list, run, hz) {
  const pids = new Map(), ms = t => ((t * 1000) / hz).toFixed(1), lines = [];
  const who = id => (id === run.reader ? "parent" : id === run.writer ? "child" : id === 0 ? "idle" : pids.get(id) === run.pid ? "parent's" : pids.get(id) === run.child ? "child's" : "other");
  let on, others = {}, woken = [], child = "not started";
  for (const e of list) {
    if (e.thread) pids.set(e.thread, e.pid);
    if (e.thread || e.t < run.t0 || e.t > run.t1) continue;
    if (e.ready) { if (on?.to === run.reader && pids.get(e.ready) === run.child && woken.length < 3) woken.push(`${who(e.ready)} +${e.plus} after ${ms(e.t - on.t)}`); continue; }
    if (e.cpu !== 2) continue;
    const left = `${e.state === 5 ? "waits" : "loses"} ${REASONS[e.reason] ?? e.reason} @${e.fromAt}`;
    if (on && e.from === run.reader && e.t - on.t > hz / 300) {
      lines.push(`${Object.entries(others).map(([name, it]) => `${name} ${ms(it.t)}/${it.n} @${[...it.at].sort()}`).join(", ")}; child ${child} | at ${ms(on.t - run.t0)} parent @${on.toAt} runs ${ms(e.t - on.t)}, ${left} to ${who(e.to)} @${e.toAt}${woken.length ? "; woken: " + woken.join(", ") : ""}`);
      others = {};
    } else if (on) { const it = (others[who(e.from)] ??= { t: 0, n: 0, at: new Set() }); (it.t += e.t - on.t), it.n++, it.at.add(on.toAt); }
    if (e.from === run.writer) child = left;
    (on = e), (woken = []);
  }
  console.log(`cond sw ${run.name}: ${ms(run.t1 - run.t0)} ms`);
  for (const line of lines.slice(0, 26)) console.log("cond sw   " + line);
}
if (mode === "--turns") {
  const k = k32(), file = os.tmpdir() + "/sw-" + process.pid, t0 = qpc(k.QueryPerformanceCounter);
  const busy = setInterval(() => { for (const end = performance.now() + 50; performance.now() < end; ); }, 1);
  const p = Bun.spawn([process.execPath, __filename, "--write", file], { stderr: "inherit" });
  await p.stdout.bytes();
  clearInterval(busy);
  console.log(JSON.stringify({ t0, t1: qpc(k.QueryPerformanceCounter), pid: process.pid, child: p.pid, reader: k.GetCurrentThreadId(), writer: +fs.readFileSync(file, "utf8") }));
} else if (mode === "--write") {
  const b = Buffer.alloc(65536, 97);
  fs.writeFileSync(args[0], "" + k32().GetCurrentThreadId());
  for (let n = TOTAL; n > 0; n -= b.length) fs.writeSync(1, b);
} else if (mode === "--read") {
  const k = k32(),
    file = os.tmpdir() + "/sw-" + process.pid,
    p = Bun.spawn([process.execPath, __filename, "--write", file], { stderr: "inherit" });
  let t0,
    t1,
    n = 0,
    chunks = 0;
  for await (const c of p.stdout)
    ((t0 ??= qpc(k.QueryPerformanceCounter)),
      chunks++,
      (n += c.length) === TOTAL && (t1 = qpc(k.QueryPerformanceCounter)));
  (console.log(
    JSON.stringify({
      t0,
      t1,
      chunks,
      pid: process.pid,
      child: p.pid,
      reader: k.GetCurrentThreadId(),
      writer: +fs.readFileSync(file, "utf8"),
    }),
  ),
    fs.rmSync(file));
} else if (mode === "--parse") {
  const [list, hooks] = events(fs.readFileSync(args[0]));
  (console.log("cond trace", JSON.stringify(hooks)), report(list, ...JSON.parse(args[1])), timeline(list, JSON.parse(args[1])[0][0], 1e6));
} else {
  const [fresh, condition, variants, rounds = 9] = args,
    isOne = condition === "one",
    dir = fs.mkdtempSync(os.tmpdir() + "\\sw-"),
    runs = [];
  const copy = (from, name) => (
    fs.mkdirSync(`${dir}\\${name}`),
    fs.copyFileSync(from, `${dir}\\${name}\\bun.exe`),
    `${dir}\\${name}\\bun.exe`
  );
  const [a, n, burner] = [copy(mode, "a"), copy(fresh, "n"), copy(mode, "burner")],
    columns = [[a, "old"], ...variants.split(";").map(v => [n, v])];
  const logman = (...rest) => {
    const it = Bun.spawnSync(["logman", rest[0], "NT Kernel Logger", ...rest.slice(1), "-ets"], { timeout: 60000 });
    return it.exitCode && `${it.stdout}${it.stderr}`.trim();
  };
  for (const exe of [a, n]) for (let i = 0; i < 3; i++) Bun.spawnSync([exe, "-e", "1"]);
  const refused = ["(process,thread,cswitch,dispatcher)", "0x813"].reduce(
    (last, flags) =>
      last &&
      logman(
        "start",
        "-p",
        "Windows Kernel Trace",
        flags,
        "-o",
        dir + "\\t.etl",
        "-ct",
        "perf",
        "-bs",
        "1024",
        "-nb",
        "64",
        "256",
        "-max",
        "256",
      ),
    true,
  );
  if (isOne) require("bun:ffi").dlopen("kernel32.dll", { SetProcessAffinityMask: { args: ["i64", "u64"], returns: "i32" } }).symbols.SetProcessAffinityMask(-1n, 4n);
  const burners = (isOne ? [] : os.cpus())
    .map(() =>
      Bun.spawn([burner, "-e", "const end = Date.now() + 200000; while (Date.now() < end);"], {
        stdio: ["ignore", "ignore", "ignore"],
      }),
    );
  try {
    Bun.sleepSync(500);
    for (let round = 0; round < rounds; round++)
      for (let turn = 0; turn < columns.length; turn++) {
        const [exe, variant] = columns[(turn + round) % columns.length],
          out = Bun.spawnSync([exe, __filename, isOne ? "--turns" : "--read"], {
            env: { ...process.env, BUN_TMP_TUNE: exe === a ? "" : variant },
            timeout: 40000,
            stdin: "ignore",
          }).stdout.toString();
        if (out) runs.push({ name: variant || "as is", ...JSON.parse(out) });
      }
  } finally {
    for (const it of burners) it.kill();
    console.log("cond trace:", refused || logman("stop") || "taken");
  }
  for (const file of fs.readdirSync(dir).filter(it => it.endsWith(".etl"))) {
    const b = fs.readFileSync(`${dir}\\${file}`),
      [list, hooks] = events(b),
      hz = qpc(k32().QueryPerformanceFrequency);
    console.log(
      "cond trace",
      file,
      b.length,
      "bytes,",
      hz,
      "Hz,",
      JSON.stringify(hooks),
      "from",
      list[0]?.t,
      "to",
      list.at(-1)?.t,
      "runs from",
      runs[0]?.t0,
      "head",
      b.subarray(0, 88).toString("hex"),
    );
    if (isOne)
      for (const [, variant] of columns) {
        const mine = runs.filter(it => it.name === (variant || "as is")).sort((x, y) => x.t1 - x.t0 - (y.t1 - y.t0));
        timeline(list, mine[mine.length >> 1], hz);
      }
    else report(
      list,
      runs,
      burners.map(it => it.pid),
      hz,
    );
  }
  (Bun.sleepSync(300), fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
}
