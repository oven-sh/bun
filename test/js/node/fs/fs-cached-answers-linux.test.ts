// On Linux, with BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH=1, the JS thread answers an async
// stat or lstat itself when the kernel holds the answer in memory (`openat2(RESOLVE_CACHED)`), and
// hands everything else to the thread pool. These tests pin what a caller can observe of that: the
// same results and errors as the pool gives, the place in the event loop, and that the pool still
// gets what the kernel cannot answer without waiting.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
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
const PER_GO = 16;

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
  // A pool thread closes the descriptor of each answer, a turn or two after it. How many of these paths are still open.
  const openDescriptors = (...paths) => {
    const real = paths.map(path => fs.realpathSync(path));
    const isOfThem = fd => { try { return real.includes(fs.readlinkSync("/proc/self/fd/" + fd)); } catch { return false; } };
    return fs.readdirSync("/proc/self/fd").filter(isOfThem).length;
  };
  // That count, once it is 0 or 3 s have passed.
  const closed = async (...paths) => {
    for (const deadline = performance.now() + 3000; openDescriptors(...paths) !== 0 && performance.now() < deadline; ) await nextTurn();
    return openDescriptors(...paths);
  };
  // The first async calls go to the pool: they leave the names in the kernel's cache and classify the mount.
  const warm = async () => { for (const name of ["file.txt", "missing.txt"]) await fsp.stat(name).catch(() => {}); };
  // After a call that the kernel could not answer, the JS thread may not ask for some time.
  // Resolves once it asks again and has forgotten that call.
  const asking = async () => {
    const deadline = performance.now() + 20000;
    while (canAnswer) {
      await nextTurn();
      if ((await counted(() => fsp.stat("."))).hits === 1) break;
      if (performance.now() > deadline) throw new Error("no answer from the kernel's caches in 20 s");
    }
    await nextTurn();
  };
  // A mount or unmount anywhere on the machine makes the kernel refuse a cached lookup that was
  // under way, and that call goes to the pool. So: the first of a few rounds that \`wanted\` accepts.
  const countedUntil = async (wanted, f) => {
    let round;
    for (let i = 0; i < (canAnswer ? 3 : 1); i++) {
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
  canAnswer = answersFromCache(dir),
) {
  await using proc = Bun.spawn({
    cmd: wrap([bunExe(), "-e", `const canAnswer = ${canAnswer};` + prelude + script]),
    // Without the flag every call is the pool's.
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
    ["stat of a file of 2 MiB", `fsp.stat("large.bin")`, `fs.statSync("large.bin")`, "yes"],
    ["lstat of a file", `fsp.lstat("file.txt")`, `fs.lstatSync("file.txt")`, "yes"],
    // `statx` of a symlink can read the disk: the walk of an `lstat` may meet no symlink, and the
    // kernel refuses such a path each time, which is not held against the other calls.
    ["lstat of a symlink", `fsp.lstat("link")`, `fs.lstatSync("link")`, "never asked"],
    ["lstat of a dangling symlink", `fsp.lstat("dangling")`, `fs.lstatSync("dangling")`, "never asked"],
    [
      "lstat below a symlink to a directory",
      `fsp.lstat("sublink/inner.txt")`,
      `fs.lstatSync("sublink/inner.txt")`,
      "never asked",
    ],
    ["fs.stat with a callback", `callback(fs.stat, "file.txt")`, `fs.statSync("file.txt")`, "yes"],
    ["fs.lstat with a callback", `callback(fs.lstat, "file.txt")`, `fs.lstatSync("file.txt")`, "yes"],
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

  test.concurrent("an absolute path is answered on the mount of the root directory only", async () => {
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
          // The walk may not leave the mount it starts on: the pool answers for another one.
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
      // The kernel also refuses the walk at a directory that is a mount point in another mount
      // namespace only, as /tmp is where systemd gives a service a /tmp of its own.
      if (mountOf(cwd).point === "/") expect([0, 2]).toContain(counts("inTemp").hits);
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
        // A call is answered if a pool thread had classified the mount by then. None is asked in vain.
        moved: result.moved.misses,
        there: result.there.hits,
        inProc: [result.inProc.hits, result.inProc.misses],
        back: result.back.hits,
      }).toEqual({ here: 2, moved: 0, there: 2, inProc: [0, 0], back: 1 });
    }
  });

  test.concurrent(
    "settles from the loop: after the caller's microtasks and nextTicks, in the order asked",
    async () => {
      using dir = tempDir("fs-cached", files);
      const cwd = String(dir);
      const canAnswer = answersFromCache(cwd);
      const contexts = ["fs callback", "promise reaction", "timer", "immediate", "socket"];
      const result = await run(
        cwd,
        `
      const net = require("node:net");
      const order = () => new Promise(resolve => {
        const log = [];
        const before = getCounters().fs_cached_hit;
        const done = () => { if (log.length === 5) resolve({ log, hits }); };
        fsp.stat("file.txt").then(() => { log.push("stat"); done(); });
        fs.lstat("file.txt", () => { log.push("lstat"); done(); });
        const hits = getCounters().fs_cached_hit - before;
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
          for (let round = 0; round < 3 && (${canAnswer} ? results[name]?.hits !== 2 : round < 1); round++) {
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
        // Answered on the JS thread, the two still come from the loop's queue, one behind the other.
        if (canAnswer) expect({ context, hits, log }).toEqual({ context, hits: 2, log: [...start, "stat", "lstat"] });
      }
    },
  );

  test.concurrent("a rejection waits for the turn to end: a catch attached in a setImmediate is in time", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const result = await run(
      cwd,
      `
      (async () => {
        await warm();
        let caught = 0, hits = 0;
        for (let round = 0; round < 20; round++) {
          await asking();
          await new Promise(resolve => fs.readFile("sub/inner.txt", () => {
            const before = getCounters().fs_cached_hit;
            const missing = fsp.stat("missing.txt");
            hits += getCounters().fs_cached_hit - before;
            setImmediate(() => missing.catch(() => { caught++; resolve(); }));
          }));
        }
        console.log(JSON.stringify({ caught, isAnswered: hits > 0 }));
      })();
      `,
    );
    // An unhandled rejection ends the process: `run` throws for it.
    expect(result).toEqual({ caught: 20, isAnswered: answersFromCache(cwd) && remembersMissingNames(cwd) });
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
        // The chain ends once the loop has run each of the three beside it. Its first link is the pool's: the read is in front.
        let timerFired = false, immediateRan = false, read = false;
        setTimeout(() => { timerFired = true; }, 1);
        fs.readFile("sub/inner.txt", () => { read = true; });
        setImmediate(() => { immediateRan = true; });
        const { hits } = await counted(async () => {
          for (let links = 0; links < 50 || !(timerFired && read && immediateRan); links++) await fsp.stat("file.txt");
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
          round => round.hits === 112,
          async () => { for (let i = 0; i < 8; i++) await Promise.all([stats(16), fsp.readFile("file.txt")]); },
        );
        // One answer in front of it does not.
        const one = await countedUntil(
          round => round.hits === 8,
          async () => { for (let i = 0; i < 8; i++) await Promise.all([stats(1), fsp.readFile("file.txt")]); },
        );
        // An answer would overtake a job that went to the pool before it in the same go.
        await asking();
        const behind = await counted(async () => { for (let i = 0; i < 8; i++) await Promise.all([fsp.readFile("file.txt"), stats(1)]); });
        // After many that the kernel could not answer, it still finds out that it can answer again.
        await asking();
        for (let i = 0; i < 300; i++) await size("never-d-" + i);
        const recovered = await counted(async () => { for (let i = 0; i < 200; i++) { await size("file.txt"); await size("never-e-" + i); } });
        console.log(JSON.stringify({ wide: wide.result, unknown, persistent, alternating, crowded, one, behind, recovered }));
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
        behind: [result.behind.hits, result.behind.misses],
        recovered: result.recovered.hits >= 60,
      }).toEqual({
        wide: [
          [PER_GO, 0],
          [0, 0],
          [3, 0],
        ],
        unknown: [2, 1],
        // Four in a row, then 1 that is not asked about, four, then 3 that are not, four, then 7, ...
        persistent: [0, 28],
        alternating: [20, 20],
        // All of the 8 goes but the 5th.
        crowded: [112, 0],
        one: [8, 0],
        behind: [0, 0],
        recovered: true,
      });
    }
  });

  test.concurrent.each([
    [
      "without BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH",
      { BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH: "0" },
    ],
    ["with BUN_FEATURE_FLAG_DISABLE_RESOLVE_BENEATH", { BUN_FEATURE_FLAG_DISABLE_RESOLVE_BENEATH: "1" }],
  ])("%s every call is the pool's", async (_name, env) => {
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
      env,
      cmd => cmd,
      false,
    );
    expect(result).toEqual({ result: [5, true, "ENOENT"], hits: 0, misses: 0 });
  });

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
          // A pool thread closes the descriptor of each answer, after the turn.
          for (let i = 0; i < 8; i++) fsp.stat("large.bin");
          require("node:worker_threads").parentPort.postMessage(getCounters().fs_cached_hit - before);
          process.exit(0);
        });
      \`;
      (async () => {
        fs.writeFileSync("large.bin", Buffer.alloc(2 << 20, 1));
        await warm();
        await fsp.stat("large.bin");
        let result;
        for (let attempt = 0; attempt < 3 && (${canAnswer} ? result?.queued !== 8 : attempt < 1); attempt++) {
          const worker = new Worker(queueAndExit, { eval: true });
          const [queued, exitCode] = await Promise.all([
            new Promise(resolve => worker.once("message", resolve)),
            new Promise(resolve => worker.once("exit", resolve)),
          ]);
          // The worker's thread hands them to the pool when it ends.
          result = { queued, exitCode, left: await closed("large.bin") };
        }
        console.log(JSON.stringify(result));
      })();
      `,
    );
    expect(result).toEqual({ queued: canAnswer ? 8 : expect.any(Number), exitCode: 0, left: 0 });
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
        await closed("file.txt", ".");
        fill();
        const fullAgain = await counted(sizes);
        free();
        const after = await countedUntil(round => round.hits === 2, sizes);
        console.log(JSON.stringify({ full, freed, fullAgain, after, leaked: await closed("file.txt", ".") }));
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

  test.concurrent("descriptors that wait for a busy pool are few", async () => {
    using dir = tempDir("fs-cached", files);
    const cwd = String(dir);
    const result = await run(
      cwd,
      `
      (async () => {
        // A pool thread closes the descriptor of each answer, also that of a small file.
        await warm();
        await asking();
        await closed("file.txt", ".");
        // Each of the two threads of the pool reads a FIFO that nothing is written to yet.
        require("node:child_process").execFileSync("mkfifo", ["fifo-a", "fifo-b"]);
        const readers = [fsp.readFile("fifo-a", "utf8"), fsp.readFile("fifo-b", "utf8")];
        const writers = [];
        for (const name of ["fifo-a", "fifo-b"]) {
          // A writer that does not wait can open a FIFO only once a reader is in its open.
          for (const deadline = performance.now() + 3000; ; await nextTurn()) {
            try { writers.push(fs.openSync(name, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); break; }
            catch (e) { if (e.code !== "ENXIO" || performance.now() > deadline) throw e; }
          }
        }
        const descriptors = () => openDescriptors("file.txt");
        const before = { descriptors: descriptors(), hits: getCounters().fs_cached_hit };
        const stats = [];
        for (let go = 0; go < 6; go++) {
          for (let i = 0; i < ${PER_GO}; i++) stats.push(fsp.stat("file.txt"));
          await nextTurn();
        }
        const waiting = { descriptors: descriptors() - before.descriptors, hits: getCounters().fs_cached_hit - before.hits };
        for (const [i, fd] of writers.entries()) {
          fs.writeSync(fd, "ab"[i]);
          fs.closeSync(fd);
        }
        const sizes = new Set((await Promise.all(stats)).map(stats => stats.size));
        const read = await Promise.all(readers);
        const deadline = performance.now() + 3000;
        while (descriptors() !== before.descriptors && performance.now() < deadline) await nextTurn();
        console.log(JSON.stringify({ waiting, sizes: [...sizes], read, left: descriptors() - before.descriptors }));
      })();
      `,
      { UV_THREADPOOL_SIZE: "2" },
    );
    expect({ sizes: result.sizes, read: result.read, left: result.left }).toEqual({
      sizes: [5],
      read: ["a", "b"],
      left: 0,
    });
    // 64 wait at most: after that the pool answers, when it gets to it.
    if (answersFromCache(cwd)) expect(result.waiting).toEqual({ descriptors: 64, hits: 64 });
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

  test.concurrent("a macro's calls are the pool's, also the one it leaves behind", async () => {
    using dir = tempDir("fs-cached-macro", {
      "macro.ts": `
        import fs from "node:fs";
        import { getCounters } from "bun:internal-for-testing";
        export async function leftover() {
          for (let i = 0; i < 8; i++) await fs.promises.stat(".");
          fs.stat(".", () => console.log("settled"));
          return getCounters().fs_cached_hit;
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
    // A debug build also logs the macro call to stdout. The pool decides which of the two lines is first.
    const lines = stdout.split("\n").filter(line => line === "settled" || line.startsWith("answered: "));
    expect({ lines: lines.sort(), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      lines: ["answered: 0", "settled"],
      stderr: "",
      exitCode: 0,
    });
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
  // cross mounts: those paths are the pool's.
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
        await asking();
        console.log(JSON.stringify(await counted(sizes)));
      })();
      `,
    );
    // This namespace has no mount there: the file is the one of the temporary directory.
    expect(result.result).toEqual([5, 5]);
    if (answersFromCache(cwd))
      expect({ hits: result.hits, isAsked: result.misses >= 1 }).toEqual({ hits: 0, isAsked: true });
  });

  // A container's root directory is an overlayfs mount. Here: one of a user namespace, with its
  // upper layer on a tmpfs of that namespace (overlayfs leaves a work directory that nobody can remove).
  const onOverlay = (dir: string) => (cmd: string[]) => [
    "unshare",
    "-Urm",
    "sh",
    "-c",
    'mount -t tmpfs tmpfs "$1/scratch" && mkdir "$1/scratch/upper" "$1/scratch/work" && mount -t overlay overlay -o "lowerdir=$1/lower,upperdir=$1/scratch/upper,workdir=$1/scratch/work" "$1/merged" && cd "$1/merged" && shift && exec "$@"',
    "sh",
    dir,
    ...cmd,
  ];
  const canMountOverlay =
    canUnshareMounts &&
    (() => {
      using dir = tempDir("fs-cached-overlay-probe", { lower: {}, scratch: {}, merged: {} });
      const cmd = onOverlay(String(dir))(["true"]);
      return Bun.spawnSync({ cmd, stdout: "ignore", stderr: "ignore" }).exitCode === 0;
    })();
  test.skipIf(!canMountOverlay)("with the working directory on overlayfs", async () => {
    using dir = tempDir("fs-cached-overlay", { lower: files, scratch: {}, merged: {} });
    const cwd = String(dir);
    type Answered = "yes" | "asked in vain" | "never asked";
    const rows: [name: string, async_: string, sync: string, answered: Answered][] = [
      ["file of the lower layer", `fsp.stat("file.txt")`, `fs.statSync("file.txt")`, "yes"],
      ["file of the upper layer", `fsp.stat("upper.txt")`, `fs.statSync("upper.txt")`, "yes"],
      ["directory", `fsp.stat("sub")`, `fs.statSync("sub")`, "yes"],
      ["below a directory", `fsp.stat("sub/inner.txt")`, `fs.statSync("sub/inner.txt")`, "yes"],
      ["missing file", `fsp.stat("missing.txt")`, `fs.statSync("missing.txt")`, "yes"],
      ["lstat of a file", `fsp.lstat("file.txt")`, `fs.lstatSync("file.txt")`, "yes"],
      ["lstat of a symlink", `fsp.lstat("link")`, `fs.lstatSync("link")`, "never asked"],
      // overlayfs does not let a cached lookup read a symlink.
      ["through a symlink", `fsp.stat("link")`, `fs.statSync("link")`, "asked in vain"],
      // The walk from the root directory may not cross onto the overlay mount.
      [
        "absolute path",
        `fsp.stat(process.cwd() + "/file.txt")`,
        `fs.statSync(process.cwd() + "/file.txt")`,
        "asked in vain",
      ],
    ];
    const { type, results } = await run(
      cwd,
      `
      fs.writeFileSync("upper.txt", "upper");
      fs.symlinkSync("file.txt", "link");
      const rows = [${rows.map(([, async_, sync, answered]) => `[${answered === "yes"}, () => ${async_}, () => ${sync}]`).join(",\n")}];
      (async () => {
        await warm();
        const mount = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\\n").find(line => line.split(" ")[4] === process.cwd());
        const results = [];
        for (const [isAnswered, call, callSync] of rows) {
          const first = await settle(call);
          const repeats = await countedUntil(
            round => !isAnswered || (round.hits === 3 && round.misses === 0),
            async () => [await settle(call), await settle(call), await settle(call)],
          );
          results.push({ first, repeats, sync: settleSync(callSync) });
        }
        console.log(JSON.stringify({ type: mount?.split(" - ")[1]?.split(" ")[0], results }));
      })();
      `,
      {},
      onOverlay(cwd),
      kernelHasResolveCached,
    );
    expect(type).toBe("overlay");
    const seen = Object.fromEntries(
      rows.map(([name, , , answered], index) => {
        const { first, repeats, sync } = results[index];
        // Whoever answers, the answer is that of the sync function.
        expect(first).toEqual(sync);
        expect(repeats.result).toEqual([sync, sync, sync]);
        const { hits, misses } = repeats;
        return [name, answered === "asked in vain" ? { hits, isAsked: misses >= 1 } : { hits, misses }];
      }),
    );
    if (kernelHasResolveCached) {
      const expected = { "yes": { hits: 3, misses: 0 }, "never asked": { hits: 0, misses: 0 } };
      expect(seen).toEqual(
        Object.fromEntries(
          rows.map(([name, , , answered]) => [
            name,
            answered === "asked in vain" ? { hits: 0, isAsked: true } : expected[answered],
          ]),
        ),
      );
    }
  });

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
            cmd: [cwd + "/program", "file.txt"],
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
          program({ BUN_FEATURE_FLAG_EXPERIMENTAL_ASYNC_FS_FAST_PATH: "0" }),
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
        if (answersFromCache(cwd)) {
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
