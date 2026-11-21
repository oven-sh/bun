// On Linux the JS thread answers an async stat or lstat itself when the kernel holds the answer
// in memory (`openat2(RESOLVE_CACHED)`), and hands everything else to the thread pool. These
// tests pin what a caller can observe of that: the same results and errors as the pool gives,
// the place in the event loop, and that the pool still gets what the kernel cannot answer
// without waiting.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { release } from "node:os";

const files = {
  "file.txt": "hello",
  "other/file.txt": "a longer file",
  "sub/inner.txt": "inner",
};

/** The mount that `dir` is on: where it is mounted, and its filesystem type as `/proc/self/mountinfo` names it. */
function mountOf(dir: string) {
  const real = realpathSync(dir);
  let best = { point: "", type: "" };
  for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    if (separator < 0) continue;
    const point = fields[4].replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    const isWithin = real === point || real.startsWith(point === "/" ? "/" : point + "/");
    // A later line is mounted over an earlier one.
    if (isWithin && point.length >= best.point.length) best = { point, type: fields[separator + 1] };
  }
  return best;
}

const filesystemOf = (dir: string) => mountOf(dir).type;

const ANSWERS_FROM_MEMORY = new Set(["ext4", "ext3", "ext2", "xfs", "btrfs", "f2fs", "tmpfs", "overlay"]);

const [major, minor] = release().split(".").map(Number);
const kernelHasResolveCached = isLinux && (major > 5 || (major === 5 && minor >= 12));

/** Whether the JS thread can answer for a working directory of `dir`. */
function answersFromCache(dir: string) {
  return kernelHasResolveCached && ANSWERS_FROM_MEMORY.has(filesystemOf(dir));
}

// How many operations of one go the JS thread answers: `CachedAnswerGate::PER_GO`.
const PER_GO = 32;

// tmpfs forgets a name that is not there as soon as the lookup is over.
function remembersMissingNames(dir: string) {
  return filesystemOf(dir) !== "tmpfs";
}

const prelude = `
  const fs = require("node:fs");
  const fsp = require("node:fs/promises");
  const { getCounters } = require("bun:internal-for-testing");
  const plain = value => JSON.parse(JSON.stringify(value ?? null, (key, v) => (typeof v === "bigint" ? v + "n" : v)));
  const failure = e => ({ name: e.name, code: e.code, syscall: e.syscall, errno: e.errno, path: e.path, message: e.message });
  const settle = async f => { try { return { value: plain(await f()) }; } catch (e) { return { error: failure(e) }; } };
  const settleSync = f => { try { return { value: plain(f()) }; } catch (e) { return { error: failure(e) }; } };
  const callback = (f, ...args) => new Promise((resolve, reject) => f(...args, (err, value) => (err ? reject(err) : resolve(value))));
  const nextTurn = () => new Promise(resolve => setImmediate(resolve));
  // Counts what \`f\` adds to the two counters.
  const counted = async f => {
    const before = getCounters();
    const result = await f();
    const after = getCounters();
    return { result, hits: after.fs_cached_hit - before.fs_cached_hit, misses: after.fs_cached_miss - before.fs_cached_miss };
  };
  // The first async calls go to the pool: they leave the names in the kernel's cache and classify the mount.
  const warm = async () => { for (const name of ["file.txt", "missing.txt"]) await fsp.stat(name).catch(() => {}); };
  // After a call that the kernel could not answer, the JS thread may not ask for some time.
  // Resolves once it asks again and has forgotten that call. Gives up where it never answers.
  const asking = async () => {
    for (let i = 0; canAnswer && i < 2100; i++) {
      await nextTurn();
      if ((await counted(() => fsp.stat("."))).hits === 1) break;
    }
    await nextTurn();
  };
  // A mount or unmount anywhere on the machine makes the kernel refuse a cached lookup that was
  // under way, and that call goes to the pool. So: the first of a few rounds that \`wanted\` accepts.
  const countedUntil = async (wanted, f) => {
    let round;
    for (let i = 0; i < (canAnswer ? 10 : 1); i++) {
      await asking();
      round = await counted(() => f(i));
      if (wanted(round)) break;
    }
    return round;
  };
`;

async function run(
  dir: string,
  script: string,
  env: Record<string, string> = {},
  wrap: (cmd: string[]) => string[] = cmd => cmd,
) {
  await using proc = Bun.spawn({
    cmd: wrap([bunExe(), "-e", `const canAnswer = ${answersFromCache(dir)};` + prelude + script]),
    // A release build that is not a canary answers only where it is asked to.
    env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH: "1", ...env },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0 || !stdout.trim()) {
    throw new Error(`fixture failed (exit ${exitCode})\n${stdout}\n${stderr}`);
  }
  return JSON.parse(stdout);
}

describe.skipIf(!isLinux)("async fs operations that the kernel can answer from its caches", () => {
  type Answered = "yes" | "never asked" | "never" | "if missing names are remembered" | "on some filesystems";
  // Each row: the async call, its sync twin, and whether the JS thread answers it given a warm cache.
  const rows: [name: string, async_: string, sync: string, answered: Answered][] = [
    ["stat of a file", `fsp.stat("file.txt")`, `fs.statSync("file.txt")`, "yes"],
    ["stat of a directory", `fsp.stat("sub")`, `fs.statSync("sub")`, "yes"],
    ["stat of the working directory", `fsp.stat(".")`, `fs.statSync(".")`, "yes"],
    ["stat below a directory", `fsp.stat("sub/inner.txt")`, `fs.statSync("sub/inner.txt")`, "yes"],
    ["stat with bigint", `fsp.stat("file.txt", { bigint: true })`, `fs.statSync("file.txt", { bigint: true })`, "yes"],
    // The JS thread does not close the descriptor of a file this large itself.
    ["stat of a file of 2 MiB", `fsp.stat("large.bin")`, `fs.statSync("large.bin")`, "yes"],
    ["lstat of a file", `fsp.lstat("file.txt")`, `fs.lstatSync("file.txt")`, "yes"],
    ["lstat of a symlink", `fsp.lstat("link")`, `fs.lstatSync("link")`, "yes"],
    ["lstat of a dangling symlink", `fsp.lstat("dangling")`, `fs.lstatSync("dangling")`, "yes"],
    ["fs.stat with a callback", `callback(fs.stat, "file.txt")`, `fs.statSync("file.txt")`, "yes"],
    ["fs.lstat with a callback", `callback(fs.lstat, "link")`, `fs.lstatSync("link")`, "yes"],
    ["Bun.file().stat()", `Bun.file("file.txt").stat()`, `fs.statSync("file.txt")`, "yes"],
    [
      "stat of a missing file",
      `fsp.stat("missing.txt")`,
      `fs.statSync("missing.txt")`,
      "if missing names are remembered",
    ],
    [
      "lstat of a missing file",
      `fsp.lstat("missing.txt")`,
      `fs.lstatSync("missing.txt")`,
      "if missing names are remembered",
    ],
    [
      "stat of a missing file without throwIfNoEntry",
      `fsp.stat("missing.txt", { throwIfNoEntry: false })`,
      `fs.statSync("missing.txt", { throwIfNoEntry: false })`,
      "if missing names are remembered",
    ],
    [
      "fs.stat of a missing file with a callback",
      `callback(fs.stat, "missing.txt")`,
      `fs.statSync("missing.txt")`,
      "if missing names are remembered",
    ],
    // overlayfs and XFS do not let a cached lookup read a symlink.
    ["stat through a symlink", `fsp.stat("link")`, `fs.statSync("link")`, "on some filesystems"],
    [
      "stat below a symlink to a directory",
      `fsp.stat("sublink/inner.txt")`,
      `fs.statSync("sublink/inner.txt")`,
      "on some filesystems",
    ],
    ["stat of a dangling symlink", `fsp.stat("dangling")`, `fs.statSync("dangling")`, "on some filesystems"],
    // The kernel leaves what lies below a file to a lookup that may wait.
    ["stat below a file", `fsp.stat("file.txt/below")`, `fs.statSync("file.txt/below")`, "never"],
    // `access` decides for the real user and a lookup for the effective one, and a read of a
    // link or of a file's content can wait for the disk: these are the pool's.
    ["access of a file", `fsp.access("file.txt")`, `fs.accessSync("file.txt")`, "never asked"],
    ["access of a missing file", `fsp.access("missing.txt")`, `fs.accessSync("missing.txt")`, "never asked"],
    ["exists of a file", `fsp.exists("file.txt")`, `fs.existsSync("file.txt")`, "never asked"],
    ["readlink", `fsp.readlink("link")`, `fs.readlinkSync("link")`, "never asked"],
    ["readFile", `fsp.readFile("file.txt", "utf8")`, `fs.readFileSync("file.txt", "utf8")`, "never asked"],
    ["fstat", `callback(fs.fstat, 0).then(stats => stats.ino)`, `fs.fstatSync(0).ino`, "never asked"],
  ];

  // One process for all rows: they share nothing but the warm cache.
  let matrix: Promise<{ cwd: string; results: any[] }> | undefined;
  let matrixDir: Disposable | undefined;
  afterAll(() => matrixDir?.[Symbol.dispose]());
  const runMatrix = async () => {
    const dir = tempDir("fs-cached", files);
    matrixDir = dir;
    const cwd = String(dir);
    const isAnswered = (answered: Answered) =>
      answersFromCache(cwd) &&
      (answered === "yes" || (answered === "if missing names are remembered" && remembersMissingNames(cwd)));
    const results = await run(
      cwd,
      `
      fs.symlinkSync("file.txt", "link");
      fs.symlinkSync("sub", "sublink");
      fs.symlinkSync("nowhere", "dangling");
      fs.writeFileSync("large.bin", Buffer.alloc(2 << 20, 1));
      const rows = [${rows.map(([, async_, sync, answered]) => `[${isAnswered(answered)}, () => ${async_}, () => ${sync}]`).join(",\n")}];
      (async () => {
        await warm();
        const results = [];
        for (const [isAnswered, call, callSync] of rows) {
          const first = await settle(call);
          const repeats = await countedUntil(
            round => !isAnswered || (round.hits === 3 && round.misses === 0),
            async () => [await settle(call), await settle(call), await settle(call)],
          );
          results.push({ first, repeats, sync: settleSync(callSync) });
        }
        console.log(JSON.stringify(results));
      })();
      `,
    );
    return { cwd, results };
  };

  test.concurrent.each(rows.map((row, index) => [...row, index] as const))(
    "%s",
    async (_name, _async, _sync, answered, index) => {
      const { cwd, results } = await (matrix ??= runMatrix());
      const { first, repeats, sync } = results[index];
      const canAnswer = answersFromCache(cwd);
      // Whoever answers, the answer is that of the sync function.
      expect(first).toEqual(sync);
      expect(repeats.result).toEqual([sync, sync, sync]);

      const counts = { hits: repeats.hits, misses: repeats.misses };
      if (
        canAnswer &&
        (answered === "yes" || (answered === "if missing names are remembered" && remembersMissingNames(cwd)))
      ) {
        expect(counts).toEqual({ hits: 3, misses: 0 });
      } else if (canAnswer && answered === "never asked") {
        expect(counts).toEqual({ hits: 0, misses: 0 });
      } else if (canAnswer && answered === "never") {
        // The first of the three is asked. Then the JS thread asks less often.
        expect({ hits: repeats.hits, isAsked: repeats.misses >= 1 }).toEqual({ hits: 0, isAsked: true });
      }
    },
    30_000,
  );

  test.concurrent("an absolute path is answered on the mounts of the root and of the working directory", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const result = await run(
      cwd,
      `
      (async () => {
        await warm();
        const file = ${JSON.stringify(cwd + "/file.txt")};
        const calls = {
          root: async () => [(await fsp.stat("/")).ino, (await fsp.lstat("/")).ino],
          inTemp: async () => [(await fsp.stat(file)).size, (await fsp.lstat(file)).size],
          // The pool answers for a file on any other mount.
          proc: async () => [(await fsp.stat("/proc/self/status")).isFile()],
          dev: async () => [(await fsp.stat("/dev/null")).isCharacterDevice()],
        };
        const results = {};
        for (const [name, call] of Object.entries(calls)) {
          await call();
          results[name] = await countedUntil(round => round.hits === 2 || round.hits === 0, call);
        }
        console.log(JSON.stringify(results));
      })();
      `,
    );
    expect({ inTemp: result.inTemp.result, proc: result.proc.result, dev: result.dev.result }).toEqual({
      inTemp: [5, 5],
      proc: [true],
      dev: [true],
    });
    expect(result.root.result[0]).toBe(result.root.result[1]);
    if (answersFromCache("/")) {
      const counts = (name: string) => ({ hits: result[name].hits, misses: result[name].misses });
      expect(counts("root")).toEqual({ hits: 2, misses: 0 });
      // The temporary directory is the working directory: whatever mount it is on is known.
      if (answersFromCache(cwd)) expect(counts("inTemp")).toEqual({ hits: 2, misses: 0 });
      else expect(counts("inTemp").hits).toBe(0);
      expect(counts("proc")).toEqual({ hits: 0, misses: 1 });
      if (mountOf("/dev/null").point !== "/") expect(counts("dev")).toEqual({ hits: 0, misses: 1 });
    }
  });

  test.concurrent("sees a change of the file at once", async () => {
    using dir = tempDir("fs-cached", files);
    const result = await run(
      String(dir),
      `
      (async () => {
        await warm();
        await asking();
        const seen = [];
        seen.push((await fsp.stat("file.txt")).size);
        fs.appendFileSync("file.txt", " world");
        seen.push((await fsp.stat("file.txt")).size);
        fs.unlinkSync("file.txt");
        seen.push((await settle(() => fsp.stat("file.txt"))).error.code, await fsp.stat("file.txt", { throwIfNoEntry: false }) ?? null);
        fs.mkdirSync("file.txt");
        seen.push((await fsp.stat("file.txt")).isDirectory(), (await fsp.lstat("file.txt")).isDirectory());
        console.log(JSON.stringify(seen));
      })();
      `,
    );
    expect(result).toEqual([5, 11, "ENOENT", null, true, true]);
  });

  test.concurrent("a relative path follows the working directory", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const canAnswer = answersFromCache(cwd);
    const twoHits = `round => !${canAnswer} || round.hits === 2`;
    const result = await run(
      cwd,
      `
      (async () => {
        await warm();
        const sizes = async () => [(await fsp.stat("file.txt")).size, (await fsp.stat("file.txt")).size];
        const here = await countedUntil(${twoHits}, sizes);
        process.chdir("other");
        // The mount of the new working directory is not classified yet: the pool does that.
        const moved = await counted(sizes);
        const there = await countedUntil(${twoHits}, sizes);
        // procfs is not a filesystem that the JS thread asks about.
        process.chdir("/proc/self");
        const names = async () => [(await fsp.stat("status")).isFile(), (await fsp.lstat("cwd")).isSymbolicLink(), (await settle(() => fsp.stat("missing"))).error.code];
        await names();
        const inProc = await counted(names);
        process.chdir(${JSON.stringify(cwd + "/sub")});
        const missing = (await settle(() => fsp.stat("file.txt"))).error?.code;
        const back = await countedUntil(round => !${canAnswer} || round.hits === 1, async () => [missing, (await fsp.stat("inner.txt")).size]);
        console.log(JSON.stringify({ here, moved, there, inProc, back }));
      })();
      `,
    );
    expect({
      here: result.here.result,
      moved: result.moved.result,
      there: result.there.result,
      inProc: result.inProc.result,
      back: result.back.result,
    }).toEqual({ here: [5, 5], moved: [13, 13], there: [13, 13], inProc: [true, true, "ENOENT"], back: ["ENOENT", 5] });
    if (canAnswer) {
      expect({
        here: result.here.hits,
        // The second call is answered if the pool had classified the mount by then.
        moved: [result.moved.hits <= 1, result.moved.misses],
        there: result.there.hits,
        inProc: [result.inProc.hits, result.inProc.misses],
        back: result.back.hits,
      }).toEqual({ here: 2, moved: [true, 0], there: 2, inProc: [0, 0], back: 1 });
    }
  });

  test.concurrent("settles from the loop: after the caller, before the immediates, in the order asked", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const canAnswer = answersFromCache(cwd);
    const contexts = ["fs callback", "promise reaction", "timer", "immediate", "socket"];
    const result = await run(
      cwd,
      `
      const net = require("node:net");
      let rounds = 0;
      const order = () => new Promise(resolve => {
        const log = [];
        const before = getCounters().fs_cached_hit;
        const done = () => { if (log.length === 7) resolve({ log, hits }); };
        fsp.stat("file.txt").then(() => { log.push("stat"); done(); });
        fs.lstat("file.txt", () => { log.push("lstat"); done(); });
        const hits = getCounters().fs_cached_hit - before;
        // A job of the pool that is asked for later is done later, however long the caller goes on.
        const made = "made-" + rounds++;
        fs.mkdir(made, () => { log.push("mkdir"); done(); });
        while (!fs.existsSync(made)) {}
        setImmediate(() => { log.push("immediate"); done(); });
        process.nextTick(() => { log.push("nextTick"); done(); });
        queueMicrotask(() => { log.push("microtask"); done(); });
        log.push("sync");
      });
      (async () => {
        await warm();
        const server = net.createServer(socket => socket.on("data", data => socket.write(data))).listen(0, "127.0.0.1");
        await new Promise(resolve => server.once("listening", resolve));
        const socket = net.connect(server.address().port, "127.0.0.1");
        await new Promise(resolve => socket.once("connect", resolve));
        const contexts = {
          "fs callback": run => fs.readFile("sub/inner.txt", run),
          "promise reaction": run => fsp.readFile("sub/inner.txt").then(run),
          "timer": run => setTimeout(run, 1),
          "immediate": run => setImmediate(run),
          "socket": run => { socket.once("data", run); socket.write("x"); },
        };
        const results = {};
        for (const [name, enter] of Object.entries(contexts)) {
          for (let round = 0; round < 10 && (${canAnswer} ? results[name]?.hits !== 2 : round < 1); round++) {
            await asking();
            results[name] = await new Promise(resolve => enter(() => order().then(resolve)));
          }
        }
        socket.destroy();
        server.close();
        console.log(JSON.stringify(results));
      })();
      `,
    );
    for (const context of contexts) {
      const { log, hits } = result[context];
      // A promise reaction is a microtask itself: the microtask queue empties before the nextTick queue.
      const start =
        context === "promise reaction" ? ["sync", "microtask", "nextTick"] : ["sync", "nextTick", "microtask"];
      // Never before the caller is done, whoever answers.
      expect({ context, start: log.slice(0, 3) }).toEqual({ context, start });
      if (canAnswer) {
        // Answered on the JS thread, the two come from the loop's queue, where the pool would
        // have put them had it been done at once: in front of what the pool did after them, and
        // of the immediate.
        expect({ context, hits, fs: log.filter(entry => entry !== "immediate") }).toEqual({
          context,
          hits: 2,
          fs: [...start, "stat", "lstat", "mkdir"],
        });
        expect({ context, isAfterBoth: log.indexOf("immediate") > log.indexOf("lstat") }).toEqual({
          context,
          isAfterBoth: true,
        });
      }
    }
  });

  test.concurrent("at the top level, comes before the first immediate", async () => {
    // The first script of a process cannot get an answer from the cache, no mount is classified
    // yet: the first script of a worker can.
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const canAnswer = answersFromCache(cwd);
    const result = await run(
      cwd,
      `
      const { Worker } = require("node:worker_threads");
      const topLevel = \`
        const fs = require("node:fs");
        const { getCounters } = require("bun:internal-for-testing");
        const log = [];
        const before = getCounters().fs_cached_hit;
        fs.stat("file.txt", (err, stats) => {
          log.push("fs-cb:" + (err === null) + ":" + stats.isFile());
          process.nextTick(() => log.push("tick-from-fs-cb"));
        });
        const hits = getCounters().fs_cached_hit - before;
        setImmediate(() => {
          log.push("setImmediate");
          require("node:worker_threads").parentPort.postMessage({ log, hits });
        });
      \`;
      (async () => {
        await warm();
        let result;
        for (let attempt = 0; attempt < 10 && (${canAnswer} ? result?.hits !== 1 : attempt < 1); attempt++) {
          const worker = new Worker(topLevel, { eval: true });
          result = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
          await worker.terminate();
        }
        console.log(JSON.stringify(result));
      })();
      `,
    );
    if (canAnswer) {
      expect(result).toEqual({ log: ["fs-cb:true:true", "tick-from-fs-cb", "setImmediate"], hits: 1 });
    }
  });

  test.concurrent("a chain of awaited calls lets timers, immediates and I/O run", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const result = await run(
      cwd,
      `
      (async () => {
        await warm();
        await asking();
        // The chain ends once the loop has run each of the three beside it.
        let timerFired = false, immediateRan = false, read = false;
        setTimeout(() => { timerFired = true; }, 1);
        fs.readFile("sub/inner.txt", () => { read = true; });
        setImmediate(() => { immediateRan = true; });
        const { hits } = await counted(async () => {
          while (!(timerFired && read && immediateRan)) await fsp.stat("file.txt");
        });
        console.log(JSON.stringify({ timerFired, read, immediateRan, isAnswered: hits > 0 }));
      })();
      `,
    );
    expect(result).toEqual({
      timerFired: true,
      read: true,
      immediateRan: true,
      isAnswered: answersFromCache(cwd) || expect.any(Boolean),
    });
  });

  test.concurrent("asks only while the kernel answers and the go is narrow", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const result = await run(
      cwd,
      `
      (async () => {
        await warm();
        const size = name => fsp.stat(name).then(stats => stats.size, () => -1);
        const stats = n => Promise.all(Array.from({ length: n }, () => size("file.txt")));
        const counts = async f => { const { hits, misses } = await counted(f); return [hits, misses]; };
        // More calls at once than it answers: the rest are the pool's, and so is the go after.
        const wide = await countedUntil(
          round => round.hits === ${PER_GO} + 3,
          async () => [await counts(() => stats(100)), await counts(() => stats(3)), await counts(() => stats(3))],
        );
        // A name that the kernel has never been asked for: the rest of its go is the pool's.
        const unknown = await countedUntil(
          round => round.hits === 2 && round.misses === 1,
          round => Promise.all([size("file.txt"), size("file.txt"), size("never-a-" + round), size("file.txt"), size("file.txt")]),
        );
        // Call after call of them: it asks less and less often.
        await asking();
        const persistent = await counted(async () => { for (let i = 0; i < 200; i++) await size("never-b-" + i); });
        // A go that the kernel answers ends that: each of these is asked about.
        const alternating = await countedUntil(
          round => round.hits === 20 && round.misses === 20,
          async round => { for (let i = 0; i < 20; i++) { await size("file.txt"); await size("never-c-" + round + "-" + i); } },
        );
        // Answers in front of a job for the pool hold that job up: such goes are asked less
        // and less often too.
        const crowded = await countedUntil(
          round => round.hits === 64,
          async () => { for (let i = 0; i < 8; i++) await Promise.all([stats(16), fsp.readFile("file.txt")]); },
        );
        // One answer in front of it does not.
        const one = await countedUntil(
          round => round.hits === 8,
          async () => { for (let i = 0; i < 8; i++) await Promise.all([stats(1), fsp.readFile("file.txt")]); },
        );
        console.log(JSON.stringify({ wide: wide.result, unknown, persistent, alternating, crowded, one }));
      })();
      `,
    );
    expect(result.unknown.result).toEqual([5, 5, -1, 5, 5]);
    if (answersFromCache(cwd)) {
      expect({
        wide: result.wide,
        unknown: [result.unknown.hits, result.unknown.misses],
        persistent: [result.persistent.hits, result.persistent.misses],
        alternating: [result.alternating.hits, result.alternating.misses],
        crowded: [result.crowded.hits, result.crowded.misses],
        one: [result.one.hits, result.one.misses],
      }).toEqual({
        wide: [
          [PER_GO, 0],
          [0, 0],
          [3, 0],
        ],
        unknown: [2, 1],
        // The 1st, 2nd, 4th, 8th, ... 128th of the 200.
        persistent: [0, 8],
        alternating: [20, 20],
        // The 1st, 2nd, 4th and 8th of the 8 goes.
        crowded: [64, 0],
        one: [8, 0],
      });
    }
  });

  test.concurrent.each(["BUN_FEATURE_FLAG_DISABLE_ASYNC_FS_FAST_PATH", "BUN_FEATURE_FLAG_DISABLE_RESOLVE_BENEATH"])(
    "%s leaves every call to the pool",
    async flag => {
      using dir = tempDir("fs-cached", files);
      const result = await run(
        String(dir),
        `
        (async () => {
          await warm();
          await warm();
          console.log(JSON.stringify(await counted(async () => [(await fsp.stat("file.txt")).size, (await fsp.lstat(".")).isDirectory(), (await settle(() => fsp.stat("missing.txt"))).error.code])));
        })();
        `,
        { [flag]: "1" },
      );
      expect(result).toEqual({ result: [5, true, "ENOENT"], hits: 0, misses: 0 });
    },
  );

  test.concurrent("a worker that exits with answers still queued", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const canAnswer = answersFromCache(cwd);
    const result = await run(
      cwd,
      `
      const { Worker } = require("node:worker_threads");
      const queueAndExit = \`
        const fsp = require("node:fs/promises");
        const { getCounters } = require("bun:internal-for-testing");
        setImmediate(() => {
          const before = getCounters().fs_cached_hit;
          for (let i = 0; i < 8; i++) fsp.stat("file.txt");
          require("node:worker_threads").parentPort.postMessage(getCounters().fs_cached_hit - before);
          process.exit(0);
        });
      \`;
      (async () => {
        await warm();
        let result;
        for (let attempt = 0; attempt < 10 && (${canAnswer} ? result?.queued !== 8 : attempt < 1); attempt++) {
          const worker = new Worker(queueAndExit, { eval: true });
          const [queued, exitCode] = await Promise.all([
            new Promise(resolve => worker.once("message", resolve)),
            new Promise(resolve => worker.once("exit", resolve)),
          ]);
          result = { queued, exitCode };
        }
        console.log(JSON.stringify(result));
      })();
      `,
    );
    expect(result).toEqual({ queued: canAnswer ? 8 : expect.any(Number), exitCode: 0 });
  });

  test.concurrent("with no descriptor left, the pool answers and nothing is remembered of it", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const result = await run(
      cwd,
      `
      (async () => {
        const held = [];
        const fill = () => { try { for (;;) held.push(fs.openSync("/dev/null", "r")); } catch {} };
        const free = () => { for (const fd of held.splice(0)) fs.closeSync(fd); };
        const sizes = async () => [(await fsp.stat("file.txt")).size, (await fsp.lstat("file.txt")).size];
        // The pool thread that is to learn of the kernel and the mounts has no descriptor for it.
        fill();
        const full = await counted(sizes);
        free();
        await warm();
        const freed = await countedUntil(round => round.hits === 2, sizes);
        // The lookup needs a descriptor, the pool's stat does not.
        fill();
        const fullAgain = await counted(sizes);
        free();
        const open = fs.readdirSync("/proc/self/fd").length;
        const after = await countedUntil(round => round.hits === 2, sizes);
        console.log(JSON.stringify({ full, freed, fullAgain, after, leaked: fs.readdirSync("/proc/self/fd").length - open }));
      })();
      `,
      {},
      cmd => ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", ...cmd],
    );
    expect({
      full: result.full.result,
      freed: result.freed.result,
      fullAgain: result.fullAgain.result,
      after: result.after.result,
      leaked: result.leaked,
    }).toEqual({
      full: [5, 5],
      freed: [5, 5],
      fullAgain: [5, 5],
      after: [5, 5],
      leaked: 0,
    });
    if (answersFromCache(cwd)) {
      expect({
        full: [result.full.hits, result.full.misses],
        freed: result.freed.hits,
        fullAgain: [result.fullAgain.hits, result.fullAgain.misses >= 1],
        after: result.after.hits,
      }).toEqual({ full: [0, 0], freed: 2, fullAgain: [0, true], after: 2 });
    }
  });

  test.concurrent("a chdir behind the runtime's back is noticed", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const result = await run(
      cwd,
      `
      const { dlopen } = require("bun:ffi");
      const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, { chdir: { args: ["cstring"], returns: "int" } });
      (async () => {
        await warm();
        await asking();
        // The mount that was learned for the working directory is not the one the file is on.
        libc.symbols.chdir(Buffer.from("/proc/self\\0"));
        const isFile = async () => (await fsp.stat("status")).isFile();
        const first = await counted(isFile);
        await isFile();
        const later = await counted(async () => [await isFile(), await isFile()]);
        console.log(JSON.stringify({ first, later }));
      })();
      `,
    );
    expect({ first: result.first.result, later: result.later.result }).toEqual({ first: true, later: [true, true] });
    if (answersFromCache(cwd)) {
      expect({
        first: [result.first.hits, result.first.misses],
        later: [result.later.hits, result.later.misses],
      }).toEqual({
        first: [0, 1],
        later: [0, 0],
      });
    }
  });

  test.concurrent("a macro that leaves an answer queued still exits", async () => {
    using dir = tempDir("fs-cached-macro", {
      "macro.ts": `
        import fs from "node:fs";
        import { getCounters } from "bun:internal-for-testing";
        export async function leftover() {
          for (let i = 0; i < 2000 && getCounters().fs_cached_hit === 0; i++) await fs.promises.stat(".");
          const before = getCounters().fs_cached_hit;
          fs.stat(".", () => console.log("settled"));
          return getCounters().fs_cached_hit - before;
        }
      `,
      "index.ts": `
        import { leftover } from "./macro.ts" with { type: "macro" };
        console.log("answered: " + leftover());
      `,
    });
    const cwd = String(dir);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH: "1" },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A debug build also logs the macro call to stdout.
    const lines = stdout.split("\n").filter(line => line === "settled" || line.startsWith("answered: "));
    expect({ lines, stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      lines: ["settled", answersFromCache(cwd) ? "answered: 1" : expect.stringMatching(/^answered: [01]$/)],
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a loop that parks between its turns does not park on an answer", async () => {
    using dir = tempDir("fs-cached-hot", {
      "server.js": `
        const fsp = require("node:fs/promises");
        const { getCounters } = require("bun:internal-for-testing");
        const server = Bun.serve({
          port: 0,
          async fetch() {
            const before = getCounters().fs_cached_hit;
            const started = performance.now();
            // More in a row than one turn of the loop takes from its queue.
            for (let i = 0; i < 40; i++) await fsp.stat(".");
            return Response.json({ hits: getCounters().fs_cached_hit - before, ms: performance.now() - started });
          },
        });
        console.log(JSON.stringify({ port: server.port }));
        // After an unhandled rejection only the watcher keeps the process alive, and the loop
        // then waits up to a second for another thread between two turns.
        Promise.reject(new Error("unhandled on purpose"));
      `,
    });
    const cwd = String(dir);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "server.js"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH: "1" },
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    let printed = "";
    for await (const chunk of proc.stdout) {
      printed += new TextDecoder().decode(chunk);
      if (/\{"port":\d+\}/.test(printed)) break;
    }
    const { port } = JSON.parse(/\{"port":\d+\}/.exec(printed)![0]);
    const canAnswer = answersFromCache(cwd);
    let answer = { hits: -1, ms: 0 };
    for (let attempt = 0; attempt < 50 && (canAnswer ? answer.hits !== 40 : attempt < 1); attempt++) {
      answer = await (await fetch(`http://127.0.0.1:${port}/`)).json();
    }
    if (canAnswer) {
      expect({ hits: answer.hits, isParked: answer.ms >= 900 }).toEqual({ hits: 40, isParked: false });
    }
  });

  // CI has FUSE. A filesystem that is slow to answer holds up neither the JS thread nor what
  // the pool answers for other paths.
  const canMountFuse =
    isLinux &&
    existsSync("/dev/fuse") &&
    Bun.which("fusermount") != null &&
    Bun.spawnSync({ cmd: ["python3", "-c", "import fuse"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  test.skipIf(!canMountFuse)(
    "with the working directory on a slow mount",
    async () => {
      using dir = tempDir("fs-cached-fuse", { ...files, mount: {} });
      const cwd = String(dir);
      const mount = cwd + "/mount";
      const DELAY = 0.5;
      await using daemon = Bun.spawn({
        cmd: ["python3", "fuse-fs.py", "-f", mount],
        cwd: import.meta.dir + "/../../../cli/run",
        env: { ...bunEnv, FUSE_FS_DELAY: String(DELAY) },
        stdout: "ignore",
        stderr: "pipe",
      });
      try {
        const result = await run(
          cwd,
          `
          (async () => {
            const mount = ${JSON.stringify(mount)};
            const local = ${JSON.stringify(cwd + "/file.txt")};
            while (!fs.existsSync(mount + "/main.js")) await nextTurn();
            await warm();
            await asking();
            process.chdir(mount);
            // The pool thread that answers this one is also the one that learns of the new mount.
            const started = performance.now();
            const size = (await fsp.stat(local)).size;
            const ms = performance.now() - started;
            const onMount = async () => [(await fsp.stat("main.js")).isFile(), (await fsp.lstat("main-symlink.js")).isSymbolicLink()];
            await onMount();
            console.log(JSON.stringify({ size, ms, onMount: await counted(onMount) }));
          })();
          `,
        );
        expect({ size: result.size, isHeldUp: result.ms >= DELAY * 1000, onMount: result.onMount }).toEqual({
          size: 5,
          isHeldUp: false,
          onMount: { result: [true, true], hits: 0, misses: 0 },
        });
      } finally {
        await Bun.spawn({ cmd: ["fusermount", "-u", "-z", mount], stdout: "ignore", stderr: "ignore" }).exited;
      }
    },
    60_000,
  );

  // systemd mounts over /tmp, /home and /usr for its services, each in a mount namespace of its
  // own. The kernel then refuses, in every namespace, a cached walk through them that may not
  // cross mounts: the JS thread walks again without that limit and checks where it ended.
  const canUnshareMounts =
    isLinux &&
    Bun.spawnSync({
      cmd: ["unshare", "-Urm", "mount", "--bind", import.meta.dir, import.meta.dir],
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
  test.skipIf(!canUnshareMounts)("a directory that is a mount point in another mount namespace", async () => {
    using dir = tempDir("fs-cached-ns", { ...files, "over/x": "" });
    const cwd = String(dir);
    await using holder = Bun.spawn({
      cmd: [
        "unshare",
        "-Urm",
        "sh",
        "-c",
        'mount --bind "$1" "$2" && echo mounted && exec sleep 120',
        "sh",
        cwd + "/over",
        cwd + "/sub",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = holder.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(value)).toBe("mounted\n");
    const result = await run(
      cwd,
      `
      (async () => {
        await warm();
        const sizes = async () => [(await fsp.stat("sub/inner.txt")).size, (await fsp.lstat(${JSON.stringify(cwd + "/sub/inner.txt")})).size];
        await sizes();
        console.log(JSON.stringify(await countedUntil(round => round.hits === 2, sizes)));
      })();
      `,
    );
    // This namespace has no mount there: the file is the one of the temporary directory.
    expect(result.result).toEqual([5, 5]);
    if (answersFromCache("/") && answersFromCache(cwd)) {
      expect({ hits: result.hits, misses: result.misses }).toEqual({ hits: 2, misses: 0 });
    }
  });

  const canUseShm = isLinux && existsSync("/dev/shm") && mountOf("/dev/shm").point === "/dev/shm";
  test.skipIf(!canUseShm)(
    "an absolute path to the mount of the working directory, which is not that of the root",
    async () => {
      // `tempDir` has no directory on another mount than the temporary directory's.
      const cwd = mkdtempSync("/dev/shm/bun-fs-cached-");
      try {
        writeFileSync(cwd + "/file.txt", "hello");
        const result = await run(
          cwd,
          `
        (async () => {
          await warm();
          const file = ${JSON.stringify(cwd + "/file.txt")};
          const sizes = async () => [(await fsp.stat(file)).size, (await fsp.lstat(file)).size];
          await sizes();
          console.log(JSON.stringify(await countedUntil(round => round.hits === 2, sizes)));
        })();
        `,
        );
        expect(result.result).toEqual([5, 5]);
        if (answersFromCache("/") && answersFromCache(cwd)) {
          expect({ hits: result.hits, misses: result.misses }).toEqual({ hits: 2, misses: 0 });
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  // In a compiled executable the module graph answers for some paths, and for a path that the
  // disk does not have it looks on the disk itself: those are never the JS thread's.
  describe.each([
    ["--compile", []],
    ["--compile --aot", ["--aot"]],
  ] as const)("in an executable built with %s", (_name, flags) => {
    const main = `
      const fs = require("node:fs");
      const fsp = require("node:fs/promises");
      const path = require("node:path");
      const { getCounters } = require("bun:internal-for-testing");
      require("./lib/a.cjs");
      const nextTurn = () => new Promise(resolve => setImmediate(resolve));
      const settle = async f => {
        try { const stats = await f(); return stats == null ? null : [stats.isFile(), stats.isDirectory(), Number(stats.size)]; }
        catch (e) { return e.code + " " + e.syscall; }
      };
      (async () => {
        const onDisk = process.argv[2];
        for (let i = 0; i < 2000 && getCounters().fs_cached_hit === 0; i++) { await settle(() => fsp.stat(onDisk)); await nextTurn(); }
        const paths = {
          disk: onDisk,
          missingOnDisk: onDisk + ".none",
          inExecutable: Bun.main,
          missingInExecutable: path.join(path.dirname(Bun.main), "none.txt"),
          source: path.join(__dirname, "lib/a.cjs"),
          besideSource: path.join(__dirname, "lib/none.cjs"),
        };
        const out = {};
        for (const [name, p] of Object.entries(paths)) {
          const calls = [
            () => fsp.stat(p),
            () => fsp.lstat(p),
            () => fsp.stat(p, { throwIfNoEntry: false }),
            () => new Promise((resolve, reject) => fs.stat(p, (err, stats) => (err ? reject(err) : resolve(stats)))),
            () => Bun.file(p).stat(),
          ];
          const results = [];
          await settle(calls[0]);
          const before = getCounters().fs_cached_hit;
          for (const call of calls) { await nextTurn(); results.push(await settle(call)); }
          out[name] = { results, hits: getCounters().fs_cached_hit - before };
        }
        console.log(JSON.stringify(out));
      })();
    `;

    test.concurrent(
      "the answers are those of the pool",
      async () => {
        using dir = tempDir("fs-cached-exe", {
          "src/main.cjs": main,
          "src/lib/a.cjs": "module.exports = 1;",
          "file.txt": "hello",
        });
        const cwd = String(dir);
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", ...flags, "src/main.cjs", "--outfile", "program"],
          env: bunEnv,
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, buildErrors, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        // Not every build of Bun includes the compiler behind --aot.
        if (/^error: --aot (only supports|isn't available)/m.test(buildErrors)) return;
        expect({ buildErrors: buildExit === 0 ? "" : buildErrors, buildExit }).toEqual({
          buildErrors: "",
          buildExit: 0,
        });
        // With --aot the graph answers for the modules of a program that runs without its sources.
        rmSync(cwd + "/src", { recursive: true });

        const program = async (env: Record<string, string>) => {
          await using proc = Bun.spawn({
            cmd: [cwd + "/program", cwd + "/file.txt"],
            env: { ...bunEnv, BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH: "1", ...env },
            cwd,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          if (exitCode !== 0 || !stdout.trim())
            throw new Error(`program failed (exit ${exitCode})\n${stdout}\n${stderr}`);
          return JSON.parse(stdout) as Record<string, { results: unknown[]; hits: number }>;
        };
        const [answered, fromPool] = await Promise.all([
          program({}),
          program({ BUN_FEATURE_FLAG_DISABLE_ASYNC_FS_FAST_PATH: "1" }),
        ]);
        const results = (run: typeof answered) =>
          Object.fromEntries(Object.entries(run).map(([name, row]) => [name, row.results]));
        const hits = (run: typeof answered) =>
          Object.fromEntries(Object.entries(run).map(([name, row]) => [name, row.hits]));
        expect(results(answered)).toEqual(results(fromPool));
        expect(results(answered).disk).toEqual(Array(5).fill([true, false, 5]));
        expect(hits(fromPool)).toEqual({
          disk: 0,
          missingOnDisk: 0,
          inExecutable: 0,
          missingInExecutable: 0,
          source: 0,
          besideSource: 0,
        });
        if (answersFromCache("/") && answersFromCache(cwd)) {
          expect({ ...hits(answered), disk: hits(answered).disk > 0 }).toMatchObject({
            disk: true,
            inExecutable: 0,
            missingInExecutable: 0,
          });
          // It holds them by their paths on the disk.
          if (flags.length > 0) {
            expect({ source: results(answered).source, hits: hits(answered).source }).toEqual({
              source: Array(5).fill([true, false, expect.any(Number)]),
              hits: 0,
            });
          }
        }
      },
      120_000,
    );
  });
});
