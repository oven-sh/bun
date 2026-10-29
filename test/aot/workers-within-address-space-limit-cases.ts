import { afterAll, describe as describeAnywhere, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { inTurn } from "./harness/shared-builds";

const describe = unsupported ? describeAnywhere.skip : describeAnywhere.concurrent;
// No more commands at once than the machine has cores.
const runCommand = (...command: Parameters<typeof run>) => inTurn(() => run(...command));

// Workers of a compiled program start within a limit on the address space of the process (ulimit -v, in kB).

const startsWorkers = `const count = Number(process.argv[2]);
if (Bun.isMainThread) {
  let started = 0;
  let refused = 0;
  const done = () => {
    if (started + refused < count) return;
    console.log("started", started, "refused", refused);
    process.exit(0);
  };
  for (let i = 0; i < count; i++) {
    try {
      const worker = new Worker(new URL(import.meta.url));
      worker.onmessage = () => {
        started++;
        done();
      };
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      refused++;
    }
  }
  done();
} else {
  setInterval(() => {}, 1000);
  postMessage(1);
}
`;

// Each Worker starts once the one before it has answered.
const startsWorkersOneByOne = `const count = Number(process.argv[2]);
if (Bun.isMainThread) {
  let started = 0;
  let refused = 0;
  for (let i = 0; i < count; i++) {
    try {
      const worker = new Worker(new URL(import.meta.url));
      await new Promise(resolve => (worker.onmessage = resolve));
      started++;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      refused++;
    }
  }
  console.log("started", started, "refused", refused);
  process.exit(0);
} else {
  setInterval(() => {}, 1000);
  postMessage(1);
}
`;

const startsWorkersInWorkers = `declare var self: Worker;
function start(depth: number, report: (line: string) => void) {
  if (depth === 4) return report("4");
  const answers: string[] = [];
  for (let i = 0; i < 2; i++) {
    const worker = new Worker(new URL(import.meta.url));
    worker.onmessage = event => {
      if (answers.push(event.data) === 2) report(depth + "(" + answers.join() + ")");
    };
    worker.postMessage(depth + 1);
  }
}
if (Bun.isMainThread) {
  start(0, line => {
    console.log(line);
    process.exit(0);
  });
} else {
  self.onmessage = event => start(event.data, line => postMessage(line));
}
`;

const startsWorkersAgainAndAgain = `import { readFileSync } from "node:fs";
function describeLargeMaps(): string {
  const described: string[] = [];
  for (const line of readFileSync("/proc/self/maps", "utf8").split("\\n")) {
    const [range, , , , , name] = line.split(/ +/);
    const [from, to] = range.split("-");
    const megabytes = Math.round((parseInt(to, 16) - parseInt(from, 16)) / 2 ** 20);
    if (megabytes >= 16) described.push(megabytes + " MB " + (name || "anonymous"));
  }
  return described.join(", ");
}
if (Bun.isMainThread) {
  let ended = 0;
  for (let round = 0; round < 250; round++) {
    const workers: Worker[] = [];
    try {
      while (workers.length < 4) workers.push(new Worker(new URL(import.meta.url)));
    } catch (error) {
      console.error("in round", round, "after", workers.length, "with", describeLargeMaps());
      throw error;
    }
    await Promise.all(
      workers.map(
        worker =>
          new Promise((resolve, reject) => {
            worker.onmessage = resolve;
            worker.onerror = event => reject(new Error(event.message + " in round " + round + " with " + describeLargeMaps()));
          }),
      ),
    );
    await Promise.all(workers.map(worker => worker.terminate()));
    ended += workers.length;
  }
  console.log("ended", ended);
  process.exit(0);
} else {
  type Entry = { id: number; next: Entry | null };
  let head: Entry | null = null;
  for (let i = 0; i < 10_000; i++) head = { id: i, next: head };
  let entries = 0;
  for (let entry: Entry | null = head; entry; entry = entry.next) entries++;
  postMessage(entries);
}
`;

// Workers start one by one until there is no room. Two are terminated, and the next one is constructed in the same turn.
// No room: the constructor throws, or, while another Worker is still ending, the new one gets an 'error' event.
const startsWorkerRightAfterTerminating = `if (Bun.isMainThread) {
  const startAndWait = async () => {
    const worker = new Worker(new URL(import.meta.url));
    await new Promise((resolve, reject) => {
      worker.onmessage = resolve;
      worker.onerror = event => reject(new TypeError(event.message));
    });
    return worker;
  };
  const workers: Worker[] = [];
  for (let round = 0; round < 4; round++) {
    for (;;) {
      try {
        workers.push(await startAndWait());
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        break;
      }
    }
    workers.shift()!.terminate();
    workers.shift()!.terminate();
    workers.push(await startAndWait());
  }
  console.log("at least 8 run:", workers.length >= 8);
  process.exit(0);
} else {
  setInterval(() => {}, 1000);
  postMessage(1);
}
`;

// Workers start one by one until the constructor throws. An earlier one is then held up for eight seconds on its way out. One more is constructed meanwhile and terminated at once, then another.
// No more wait than are ending, so for a third the constructor throws.
const constructsWorkersWhileAnotherIsHeldUp = `declare var self: Worker;
const how = process.argv[2];
if (Bun.isMainThread) {
  const start = async () => {
    const worker = new Worker(new URL(import.meta.url));
    await new Promise(resolve => (worker.onmessage = resolve));
    return worker;
  };
  const ask = (worker: Worker, question: string) => {
    worker.postMessage(question);
    return new Promise(resolve => (worker.onmessage = resolve));
  };
  const heldUp = await start();
  if (how === "its own Worker") await ask(heldUp, "start a Worker");
  for (;;) {
    try {
      await start();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      break;
    }
  }
  let lastTick = performance.now();
  let longestGap = 0;
  setInterval(() => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - lastTick);
    lastTick = now;
  }, 20);
  await ask(heldUp, how);
  await Bun.sleep(200);
  const began = performance.now();
  const since = () => performance.now() - began;
  const heldUpClosed = new Promise<number>(resolve => heldUp.addEventListener("close", () => resolve(since())));
  if (how !== "its exit handler") heldUp.terminate();
  const first = new Worker(new URL(import.meta.url));
  const firstClosed = new Promise<number>(resolve => first.addEventListener("close", () => resolve(since())));
  first.terminate();
  const second = new Worker(new URL(import.meta.url));
  const secondStartedOrFoundNoRoom = new Promise<boolean>(resolve => {
    second.onmessage = () => resolve(true);
    second.onerror = event => resolve(event.message === "TypeError: Failed to spawn worker thread");
  });
  let thrown: unknown;
  try {
    for (let i = 0; i < 64; i++) new Worker(new URL(import.meta.url));
  } catch (error) {
    thrown = error;
  }
  const constructed = since();
  console.log("two are constructed, and the constructor throws, within 4 s:", thrown instanceof TypeError && constructed < 4000);
  console.log("the one that is terminated closes within 4 s:", (await firstClosed) < 4000);
  console.log("the other starts, or finds no room:", await secondStartedOrFoundNoRoom);
  console.log("the one that is held up takes over 4 s to close:", (await heldUpClosed) > 4000);
  console.log("a timer fired at least every 4 s:", longestGap < 4000);
  process.exit(0);
} else {
  let worker: Worker;
  const timer = setInterval(() => {}, 1000);
  self.onmessage = event => {
    if (event.data === "start a Worker") {
      worker = new Worker(new URL(import.meta.url));
      worker.onmessage = () => postMessage("started");
    } else if (event.data === "its own Worker") {
      worker.onmessage = () => postMessage("held up");
      worker.postMessage("a call that blocks");
    } else if (event.data === "a call that blocks") {
      postMessage("held up");
      Bun.sleepSync(8000);
    } else {
      process.on("exit", () => {
        postMessage("held up");
        Bun.sleepSync(8000);
      });
      clearInterval(timer);
      self.onmessage = null;
    }
  };
  postMessage("ready");
}
`;

// Starts Workers until the constructor throws three times in a row, then holds one up for two seconds while it ends and constructs another, which waits for that room.
// When the first closes, its listener constructs Workers until the constructor throws. The waiting Worker can still fit where a new one doesn't, so the program repeats this until it doesn't.
// Workers start until one does not. Then, forty times, one is terminated and has exited, and Workers start again until one does not.
const startsNodeWorkersUntilConstructorThrows = `import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const start = () =>
    new Promise<Worker | string>(resolve => {
      let worker: Worker;
      try {
        worker = new Worker(new URL(import.meta.url));
      } catch (error) {
        return resolve("the constructor threw " + (error as Error).name);
      }
      worker.once("message", () => resolve(worker));
      worker.once("error", (error: Error) => resolve("'error' with " + error.name));
    });
  const workers: Worker[] = [];
  const outcomes = new Set<string>();
  const fill = async () => {
    for (;;) {
      const worker = await start();
      outcomes.add(typeof worker === "string" ? worker : "started");
      if (typeof worker === "string") return;
      workers.push(worker);
    }
  };
  await fill();
  for (let round = 0; round < 40; round++) {
    await workers.shift()!.terminate();
    await fill();
  }
  console.log([...outcomes].sort().join(", "));
  process.exit(0);
} else {
  setInterval(() => {}, 1000);
  parentPort!.postMessage(1);
}
`;

// 48 Workers are constructed one by one, and each that starts stays.
const startsWorkersThatStay = `import { isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  let outcomes = "";
  for (let i = 0; i < 48; i++) {
    try {
      const worker = new Worker(new URL(import.meta.url));
      await new Promise(resolve => (worker.onmessage = resolve));
      outcomes += "started ";
    } catch {
      outcomes += "threw ";
    }
  }
  console.log(outcomes);
  process.exit(0);
} else {
  setInterval(() => {}, 1000);
  postMessage(typeof parentPort);
}
`;

// Workers start until the constructor throws. One ends, so there is room for about one. The others are terminated in a call that blocks, and another is constructed at once.
const keepsObjectsInWorkerConstructedWhileOthersEnd = `declare var self: Worker;
if (Bun.isMainThread) {
  const hear = (worker: Worker, wanted: string) =>
    new Promise<string>(resolve => {
      worker.onmessage = event => void (String(event.data).startsWith(wanted) && resolve(event.data));
      worker.onerror = event => resolve(event.message);
    });
  const workers: Worker[] = [];
  for (;;) {
    try {
      const worker = new Worker(new URL(import.meta.url));
      await hear(worker, "ready");
      workers.push(worker);
    } catch {
      break;
    }
  }
  const first = workers.shift()!;
  const closed = new Promise(resolve => first.addEventListener("close", resolve));
  first.terminate();
  await closed;
  await Promise.all(
    workers.map(worker => {
      const heldUp = hear(worker, "held up");
      worker.postMessage("block");
      return heldUp;
    }),
  );
  for (const worker of workers) worker.terminate();
  const last = new Worker(new URL(import.meta.url));
  const ready = await hear(last, "ready");
  if (ready !== "ready") throw new Error(ready);
  const kept = hear(last, "kept");
  last.postMessage("keep");
  console.log(await kept);
  process.exit(0);
} else {
  type Entry = { id: number; next: Entry | null };
  let head: Entry | null = null;
  self.onmessage = event => {
    if (event.data === "block") {
      postMessage("held up");
      Bun.sleepSync(400);
      return;
    }
    for (let i = 0; i < 2_000_000; i++) head = { id: i, next: head };
    let entries = 0;
    for (let entry: Entry | null = head; entry; entry = entry.next) entries++;
    postMessage("kept " + entries);
  };
  setInterval(() => {}, 1000);
  postMessage("ready");
}
`;

// Workers start until the constructor throws. One ends and has closed. Another is terminated in a call that blocks it, and a new one is constructed at once.
const constructsWorkerAfterTerminatingBlockedOne = `import { readFileSync } from "node:fs";
declare var self: Worker;
const call = process.argv[2];
if (Bun.isMainThread) {
  if (call.includes("pipe")) Bun.spawnSync(["mkfifo", "pipe"]);
  const construct = () => new Worker(new URL(import.meta.url), { argv: [call] });
  const hear = (worker: Worker, wanted: string) =>
    new Promise<string>(resolve => {
      worker.onmessage = event => void (event.data === wanted && resolve(event.data));
      worker.onerror = event => resolve(event.message);
    });
  const workers: Worker[] = [];
  for (;;) {
    try {
      const worker = construct();
      await hear(worker, "ready");
      workers.push(worker);
    } catch {
      break;
    }
  }
  const first = workers.shift()!;
  const closed = new Promise(resolve => first.addEventListener("close", resolve));
  first.terminate();
  await closed;
  const blocked = workers.shift()!;
  const isBlocked = hear(blocked, "blocks");
  blocked.postMessage("block");
  await isBlocked;
  await Bun.sleep(200);
  blocked.terminate();
  try {
    console.log(await hear(construct(), "ready"));
  } catch (error) {
    console.log(String(error));
  }
  process.exit(0);
} else {
  self.onmessage = () => {
    postMessage("blocks");
    if (call.includes("pipe")) readFileSync("pipe");
    else if (call.includes("sleep")) Bun.sleepSync(100_000_000);
    else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  };
  setInterval(() => {}, 1000);
  postMessage("ready");
}
`;

const takesRoomThatWorkerWaitsFor = `import { Worker as NodeWorker, parentPort } from "node:worker_threads";
declare var self: Worker;
const isNode = process.argv[2] === "node";
function construct() {
  let error = "no error";
  let hear = (_: string) => {};
  let hearThatItIsHeldUp = () => {};
  const heard = new Promise<string>(resolve => (hear = resolve));
  const isHeldUp = new Promise<void>(resolve => (hearThatItIsHeldUp = resolve));
  const onMessage = (message: string) => (message === "held up" ? hearThatItIsHeldUp() : hear("started"));
  if (isNode) {
    const worker = new NodeWorker(new URL(import.meta.url), { argv: ["node"] });
    worker.on("message", onMessage);
    worker.once("error", (thrown: Error) => (error = thrown.name + ": " + thrown.message));
    worker.once("exit", code => hear(error + ", code " + code));
    return { worker, heard, isHeldUp, whenClosed: (listener: () => void) => void worker.once("exit", listener) };
  }
  const worker = new Worker(new URL(import.meta.url));
  worker.onmessage = event => onMessage(event.data);
  worker.onerror = event => void (error = event.message);
  worker.addEventListener("close", event => hear(error + ", code " + (event as unknown as { code: number }).code));
  return { worker, heard, isHeldUp, whenClosed: (listener: () => void) => worker.addEventListener("close", listener) };
}
if (Bun.isMainThread) {
  const workers: ReturnType<typeof construct>[] = [];
  for (let thrownInARow = 0; thrownInARow < 3; ) {
    try {
      const worker = construct();
      if ((await worker.heard) !== "started") break;
      workers.push(worker);
      thrownInARow = 0;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      thrownInARow++;
    }
  }
  let heard = "started";
  for (let round = 0; round < 12 && heard === "started"; round++) {
    const heldUp = workers.shift()!;
    let taken = 0;
    heldUp.whenClosed(() => {
      try {
        for (; taken < 64; taken++) workers.push(construct());
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
    });
    heldUp.worker.postMessage("block");
    await heldUp.isHeldUp;
    await Bun.sleep(200);
    heldUp.worker.terminate();
    const waits = construct();
    heard = await waits.heard;
    workers.push(waits);
    if (taken === 64) heard = "the constructor never threw";
    await Promise.all(workers.map(worker => worker.heard));
  }
  console.log(heard);
  process.exit(0);
} else {
  const post = (message: string) => (isNode ? parentPort!.postMessage(message) : postMessage(message));
  const block = () => {
    post("held up");
    Bun.sleepSync(2000);
  };
  if (isNode) parentPort!.on("message", block);
  else self.onmessage = block;
  setInterval(() => {}, 1000);
  post("ready");
}
`;

// Workers start one by one until the constructor throws. Two are terminated, and the thread runs nothing for two seconds: they end, and it has not heard of it.
// Then it constructs Workers in the same turn.
const constructsWorkersBeforeItHearsThatOthersEnded = `if (Bun.isMainThread) {
  const workers: Worker[] = [];
  for (;;) {
    try {
      const worker = new Worker(new URL(import.meta.url));
      await new Promise(resolve => (worker.onmessage = resolve));
      workers.push(worker);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      break;
    }
  }
  workers[0].terminate();
  workers[1].terminate();
  Bun.sleepSync(2000);
  let answered = 0;
  let constructed = 0;
  let thrown: unknown;
  try {
    for (; constructed < 64; constructed++) new Worker(new URL(import.meta.url)).onmessage = () => answered++;
  } catch (error) {
    thrown = error;
  }
  console.log("some are constructed, and then the constructor throws:", constructed > 0 && thrown instanceof TypeError);
  if (!thrown) process.exit(1);
  while (answered < constructed) await Bun.sleep(10);
  console.log("each of them starts");
  process.exit(0);
} else {
  setInterval(() => {}, 1000);
  postMessage(1);
}
`;

// A thread starts Workers until the constructor throws. One of them is held up for eight seconds on its way out, and more are constructed meanwhile until the constructor throws again: one of them waits.
// Then the thread ends: the main thread exits, or a Worker is terminated. A Worker that starts after that writes a line.
// The runs of the program share a folder, so each names its files by the number of its process.
const endsThreadWhoseWorkerWaits = `import { existsSync, writeFileSync, writeSync } from "node:fs";
declare var self: Worker;
const threadEnds = "the-thread-ends-" + process.pid;
const hasStarted = (late: number | string) => "started-" + process.pid + "-" + late;
const start = async () => {
  const worker = new Worker(new URL(import.meta.url));
  await new Promise(resolve => (worker.onmessage = resolve));
  return worker;
};
async function constructWorkerThatWaits() {
  const heldUp = await start();
  for (;;) {
    try {
      await start();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      break;
    }
  }
  heldUp.postMessage("a call that blocks");
  await new Promise(resolve => (heldUp.onmessage = resolve));
  await Bun.sleep(200);
  heldUp.terminate();
  // Only one Worker can wait for the one that is ending, so once the constructor throws, all but one start.
  // Only this thread can start the one that waits, in a turn of its loop, and it takes none from here on.
  const late: Worker[] = [];
  try {
    while (late.length < 64) late.push(new Worker(new URL(import.meta.url), { argv: ["late", String(late.length)] }));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  for (let rounds = 0; late.filter((_, index) => existsSync(hasStarted(index))).length < late.length - 1; rounds++) {
    if (rounds === 3000) throw new Error("a Worker that the constructor let in has not started");
    Bun.sleepSync(10);
  }
  writeFileSync(threadEnds, "");
}
if (!Bun.isMainThread) {
  if (process.argv[2] === "late") {
    if (existsSync(threadEnds)) writeSync(1, "the one that waited has started\\n");
    writeFileSync(hasStarted(process.argv[3]), "");
  }
  self.onmessage = async event => {
    if (event.data === "a call that blocks") {
      postMessage("held up");
      return Bun.sleepSync(8000);
    }
    await constructWorkerThatWaits();
    postMessage("one waits");
  };
  setInterval(() => {}, 1000);
  postMessage("ready");
} else if (process.argv[2] === "the main thread exits") {
  await constructWorkerThatWaits();
  writeSync(1, "exits at " + Date.now() + "\\n");
  process.exit(0);
} else {
  const parent = await start();
  parent.addEventListener("close", event => {
    console.log("closed with code", (event as unknown as { code: number }).code);
    process.exit(0);
  });
  parent.onmessage = () => parent.terminate();
  parent.postMessage("start Workers");
}
`;

// More shapes of objects than the table that finds properties by name has rows for at first.
const readsManyShapesByName = `const objects: any[] = [];
for (let i = 0; i < 120_000; i++) {
  const object: any = {};
  object["only" + i] = i;
  object.value = i;
  object.twice = 2 * i;
  objects.push(object);
}
function sum(list: any[]) {
  let total = 0;
  for (const object of list) total += object.value + object.twice;
  return total;
}
console.log(sum(objects), sum(objects));
for (const object of objects) object.value = 1;
console.log(sum(objects));
`;

type Run = { limitInKB?: number; env?: Record<string, string> };

const env = { ...bunEnv, BUN_CRASH_REPORT_URL: "" };
const folders = new Map<string, Promise<string>>();
const made: Disposable[] = [];
afterAll(() => made.forEach(folder => folder[Symbol.dispose]()));
/** The folder of the executable `program`. A text is built once. */
const built = (program: string) =>
  folders.getOrInsertComputed(program, async () => {
    const folder = tempDir("aot-workers-limit", { "program.ts": program });
    made.push(folder);
    const build = await runCommand(
      [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", "program"],
      String(folder),
      env,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    return String(folder);
  });

// A run within two gigabytes or more may fill them.
let lastLargeRun: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const mine = lastLargeRun.then(work);
  lastLargeRun = mine.catch(() => {});
  return mine;
}

// They hold a thread up for eight seconds and do nothing meanwhile: a run of theirs takes no core from the others.
const programsThatWait = new Set([constructsWorkersWhileAnotherIsHeldUp, endsThreadWhoseWorkerWaits]);

async function runEach(runs: Run[], program: string, ...args: string[]) {
  const folder = await built(program);
  const runProgram = programsThatWait.has(program) ? run : runCommand;
  const results: { stdout: string; stderr: string; exitCode: number | null }[] = [];
  for (const run of runs) {
    const command = run.limitInKB ? `ulimit -v ${run.limitInKB} && exec ./program "$@"` : `exec ./program "$@"`;
    const start = () => runProgram(["sh", "-c", command, "sh", ...args], String(folder), { ...env, ...run.env });
    const { stdout, stderr, exitCode } = await (run.limitInKB && run.limitInKB >= 2 * GB ? oneAtATime(start) : start());
    results.push({ stdout, stderr, exitCode });
  }
  return results;
}

function runWithinEach(limitsInKB: (number | undefined)[], program: string, ...args: string[]) {
  return runEach(
    limitsInKB.map(limitInKB => ({ limitInKB })),
    program,
    ...args,
  );
}

async function runWithin(limitInKB: number | undefined, program: string, ...args: string[]) {
  return (await runWithinEach([limitInKB], program, ...args))[0];
}

const GB = 1024 * 1024;

/** Every `parts`-th case from the `part`-th. */
export function workersWithinAddressSpaceLimit(part: number, parts: number) {
  let cases = 0;
  const isInPart = () => cases++ % parts === part - 1;
  const dealt = <Row>(rows: Row[]) => rows.filter(isInPart);
  const inPart = (define: typeof test) => (name: string, body: () => Promise<void>, timeout: number) => {
    if (isInPart()) define(name, body, timeout);
  };

  describe("Workers of a compiled program within a limit on the address space", () => {
    test.skipIf(!isLinux || isASAN).each(
      dealt([
        [8, 4 * GB],
        [32, 4 * GB],
        [8, 2 * GB],
        [32, 2 * GB],
        [8, GB],
      ]),
    )(
      "%d start within %d kB",
      async (count, limit) => {
        expect(await runWithin(limit, startsWorkers, String(count))).toEqual({
          stdout: `started ${count} refused 0\n`,
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    test.skipIf(!isLinux || isASAN).each(
      dealt([
        [128, 4 * GB],
        [64, 2 * GB],
        [128, 2 * GB],
      ]),
    )(
      "of %d started one by one within %d kB some start and the constructor throws for the rest",
      async (count, limit) => {
        const { stdout, stderr, exitCode } = await runWithin(limit, startsWorkersOneByOne, String(count));
        const [, started, refused] = /^started (\d+) refused (\d+)\n$/.exec(stdout) ?? [];
        expect({
          stdout,
          stderr,
          exitCode,
          all: Number(started) + Number(refused),
          many: Number(started) >= 16,
        }).toEqual({
          stdout,
          stderr: "",
          exitCode: 0,
          all: count,
          many: true,
        });
      },
      120_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "Workers start Workers",
      async () => {
        const leaf = "3(4,4)";
        const two = (depth: number, inner: string) => `${depth}(${inner},${inner})`;
        expect(await runWithin(2 * GB, startsWorkersInWorkers)).toEqual({
          stdout: two(0, two(1, two(2, leaf))) + "\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "a thousand start one after another, four at a time",
      async () => {
        expect(await runWithin(GB, startsWorkersAgainAndAgain)).toEqual({
          stdout: "ended 1000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "a Worker starts in the room of Workers that were just terminated",
      async () => {
        expect(await runWithin(GB, startsWorkerRightAfterTerminating)).toEqual({
          stdout: "at least 8 run: true\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "a Worker starts in the room of Workers that were just terminated within each of 5 limits",
      async () => {
        const limits = Array.from({ length: 5 }, (_, i) => (896 + 117 * i) * 1024);
        const results = await runWithinEach(limits, startsWorkerRightAfterTerminating);
        expect(results.map((result, i) => ({ limit: limits[i], ...result }))).toEqual(
          limits.map(limit => ({ limit, stdout: "at least 8 run: true\n", stderr: "", exitCode: 0 })),
        );
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "a Worker starts in the room of Workers that were just terminated at 8 of the 128 places where the cells begin",
      async () => {
        const places = Array.from({ length: 8 }, (_, i) => String(16 * i + 1));
        const results = await runEach(
          places.map(place => ({ limitInKB: 1104 * 1024, env: { BUN_JSC_seedOfVMRandomForFuzzer: place } })),
          startsWorkerRightAfterTerminating,
        );
        expect(results.map((result, i) => ({ place: places[i], ...result }))).toEqual(
          places.map(place => ({ place, stdout: "at least 8 run: true\n", stderr: "", exitCode: 0 })),
        );
      },
      240_000,
    );

    test.skipIf(!isLinux || isASAN).each(dealt(["a call that blocks", "its exit handler", "its own Worker"]))(
      "the constructor returns at once while %s holds up a Worker that is ending",
      async how => {
        expect(await runWithin(GB, constructsWorkersWhileAnotherIsHeldUp, how)).toEqual({
          stdout:
            "two are constructed, and the constructor throws, within 4 s: true\n" +
            "the one that is terminated closes within 4 s: true\n" +
            "the other starts, or finds no room: true\n" +
            "the one that is held up takes over 4 s to close: true\n" +
            "a timer fired at least every 4 s: true\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    test.skipIf(!isLinux || isASAN).each(dealt(["web", "node"]))(
      "a Worker that waits for room that others take first gets an error (%s)",
      async kind => {
        expect(await runWithin(GB, takesRoomThatWorkerWaitsFor, kind)).toEqual({
          stdout: "TypeError: Failed to spawn worker thread, code 1\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "every Worker of node:worker_threads that is constructed starts, up to the one for which the constructor throws",
      async () => {
        expect(await runWithin(GB, startsNodeWorkersUntilConstructorThrows)).toEqual({
          stdout: "started, the constructor threw TypeError\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "once the constructor has thrown it throws again for as long as no Worker ends",
      async () => {
        const limits = [1104, 1150].map(megabytes => megabytes * 1024);
        const results = await runWithinEach(limits, startsWorkersThatStay);
        expect(results.map((result, i) => ({ limit: limits[i], ...result }))).toEqual(
          limits.map(limit => ({
            limit,
            stdout: expect.stringMatching(/^(started )+(threw )+\n$/),
            stderr: "",
            exitCode: 0,
          })),
        );
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "a Worker that is constructed while others are ending does not take the last of the room, and has room for its objects",
      async () => {
        expect(await runWithin(GB, keepsObjectsInWorkerConstructedWhileOthersEnd)).toEqual({
          stdout: "kept 2000000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    test
      .skipIf(!isLinux || isASAN)
      .each(dealt(["a sleep that does not end", "a read of a pipe that nobody writes to", "Atomics.wait()"]))(
      "a Worker that is constructed after another was terminated in %s starts or gets an error",
      async call => {
        expect(await runWithin(GB, constructsWorkerAfterTerminatingBlockedOne, call)).toEqual({
          stdout: expect.stringMatching(/^(ready|TypeError: Failed to spawn worker thread)\n$/),
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "the constructor throws in the turn in which there is no room, though the thread has not heard yet that Workers have ended",
      async () => {
        expect(await runWithin(GB, constructsWorkersBeforeItHearsThatOthersEnded)).toEqual({
          stdout: "some are constructed, and then the constructor throws: true\neach of them starts\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "a Worker that is terminated while a Worker of its own waits for room ends, and that one never starts",
      async () => {
        expect(await runWithin(GB, endsThreadWhoseWorkerWaits, "a Worker is terminated")).toEqual({
          stdout: "closed with code 0\n",
          stderr: "",
          exitCode: 0,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "the main thread exits at once while a Worker of its own waits for room, and that one never starts",
      async () => {
        const { stdout, stderr, exitCode } = await runWithin(GB, endsThreadWhoseWorkerWaits, "the main thread exits");
        const ended = Date.now();
        const [, exits] = /^exits at (\d+)\n$/.exec(stdout) ?? [];
        expect({ stdout, stderr, exitCode, within4Seconds: ended - Number(exits) < 4000 }).toEqual({
          stdout: expect.stringMatching(/^exits at \d+\n$/),
          stderr: "",
          exitCode: 0,
          within4Seconds: true,
        });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN))(
      "the main thread exits while a Worker of its own waits for room, and that one never starts, where the exit waits for every thread",
      async () => {
        const [result] = await runEach(
          [{ limitInKB: GB, env: { BUN_DESTRUCT_VM_ON_EXIT: "1" } }],
          endsThreadWhoseWorkerWaits,
          "the main thread exits",
        );
        expect(result).toEqual({ stdout: expect.stringMatching(/^exits at \d+\n$/), stderr: "", exitCode: 0 });
      },
      240_000,
    );

    inPart(test.skipIf(!isLinux || isASAN || isDebug))(
      "a small program runs within 416 MB",
      async () => {
        expect(await runWithin(416 * 1024, `console.log("runs", 1 + 1);\n`)).toEqual({
          stdout: "runs 2\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );

    inPart(test)(
      "properties are found by name in more shapes than the table has rows for at first",
      async () => {
        expect(await runWithin(undefined, readsManyShapesByName)).toEqual({
          stdout: "21599820000 21599820000\n14400000000\n",
          stderr: "",
          exitCode: 0,
        });
      },
      120_000,
    );
  });
}
