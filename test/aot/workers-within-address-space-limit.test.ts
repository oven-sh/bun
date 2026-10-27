import { expect } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isDebug, isLinux, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

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

const startsNodeWorkers = `import { isMainThread, parentPort, Worker } from "node:worker_threads";
if (isMainThread) {
  let started = 0;
  for (let i = 0; i < 8; i++) {
    new Worker(new URL(import.meta.url)).once("message", () => {
      if (++started < 8) return;
      console.log("started", started);
      process.exit(0);
    });
  }
} else {
  setInterval(() => {}, 1000);
  parentPort!.postMessage(1);
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
  postMessage(head!.id);
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

// Workers start one by one until the constructor throws. An earlier one is then held up for eight seconds on its way out. Two more are constructed meanwhile, and the second is terminated at once.
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
  const second = new Worker(new URL(import.meta.url));
  const constructed = since();
  const firstStartedOrFoundNoRoom = new Promise<boolean>(resolve => {
    first.onmessage = () => resolve(true);
    first.onerror = event => resolve(event.message === "TypeError: Failed to spawn worker thread");
  });
  const secondClosed = new Promise<number>(resolve => second.addEventListener("close", () => resolve(since())));
  second.terminate();
  console.log("two are constructed within 4 s:", constructed < 4000);
  console.log("the one that is terminated closes within 4 s:", (await secondClosed) < 4000);
  console.log("the other starts, or finds no room:", await firstStartedOrFoundNoRoom);
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

// Workers start one by one until the constructor throws. Two are terminated, and six are constructed in the same turn.
const constructsMoreWorkersThanFindRoom = `import { Worker as NodeWorker, parentPort } from "node:worker_threads";
const isNode = process.argv[2] === "node";
function construct() {
  let error = "no error";
  if (isNode) {
    const worker = new NodeWorker(new URL(import.meta.url), { argv: ["node"] });
    const heard = new Promise<string>(resolve => {
      worker.once("message", () => resolve("started"));
      worker.once("error", (thrown: Error) => (error = thrown.name + ": " + thrown.message));
      worker.once("exit", code => resolve(error + ", code " + code));
    });
    return { heard, terminate: () => void worker.terminate() };
  }
  const worker = new Worker(new URL(import.meta.url));
  const heard = new Promise<string>(resolve => {
    worker.onmessage = () => resolve("started");
    worker.onerror = event => void (error = event.message);
    worker.addEventListener("close", event => resolve(error + ", code " + (event as unknown as { code: number }).code));
  });
  return { heard, terminate: () => worker.terminate() };
}
if (Bun.isMainThread) {
  const workers: ReturnType<typeof construct>[] = [];
  for (;;) {
    try {
      const worker = construct();
      if ((await worker.heard) !== "started") break;
      workers.push(worker);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      break;
    }
  }
  workers[0].terminate();
  workers[1].terminate();
  const constructed = Array.from({ length: 6 }, construct);
  for (const worker of constructed) console.log(await worker.heard);
  process.exit(0);
} else {
  setInterval(() => {}, 1000);
  if (isNode) parentPort!.postMessage(1);
  else postMessage(1);
}
`;

// A thread starts Workers until the constructor throws. One of them is held up for eight seconds on its way out, and one more is constructed meanwhile. Then the thread ends:
// the main thread exits, or a Worker is terminated. The Worker that was constructed last would write a line.
const endsThreadWhoseWorkerWaits = `import { writeSync } from "node:fs";
declare var self: Worker;
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
  new Worker(new URL(import.meta.url), { argv: ["waited"] });
}
if (!Bun.isMainThread) {
  if (process.argv[2] === "waited") writeSync(1, "the one that waited has started\\n");
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

// Four Workers start and wait. A fifth keeps objects until it catches a RangeError, and goes on holding them. Then the four keep a few objects every millisecond, and more as time goes by:
// a Worker that has ended leaves room to the others.
const workersWithFewObjectsRunOutOfRoom = `declare var self: Worker;
type Link = { next: Link | null; a: number; b: number };
let head: Link | null = null;
if (Bun.isMainThread) {
  const megabytesKeptFirst = Number(process.argv[2]);
  for (let i = 0; i < megabytesKeptFirst * 1024 * 32; i++) head = { next: head, a: i, b: i };
  const start = () => {
    const worker = new Worker(new URL(import.meta.url));
    return new Promise<Worker>(resolve => (worker.onmessage = () => resolve(worker)));
  };
  const ends: string[] = [];
  const workers: Worker[] = [];
  for (let i = 0; i < 4; i++) {
    const worker = await start();
    let message = "no error";
    worker.addEventListener("error", event => (message = String((event as ErrorEvent).message).slice(0, 25)));
    worker.addEventListener("close", event => {
      ends.push(message + ", code " + (event as unknown as { code: number }).code);
      if (ends.length < 4) return;
      console.log(ends.join("\\n"));
      process.exit(0);
    });
    workers.push(worker);
  }
  const filler = await start();
  filler.postMessage("fill");
  await new Promise(resolve => (filler.onmessage = resolve));
  for (const worker of workers) worker.postMessage("keep a few");
} else {
  self.onmessage = event => {
    if (event.data === "fill") {
      try {
        for (let i = 0; ; i++) head = { next: head, a: i, b: i };
      } catch (error) {
        postMessage(error instanceof RangeError);
      }
      return;
    }
    let i = 0;
    let turns = 0;
    setInterval(() => {
      for (const end = i + (64 << Math.min(turns++ >> 4, 10)); i < end; i++) head = { next: head, a: i, b: i };
    }, 1);
  };
  setInterval(() => {}, 1000);
  postMessage("ready");
}
`;

// Every Worker starts first. Ahead of each of three waves a Worker of its own keeps objects until it catches a RangeError, and goes on holding them.
// Then the four Workers of the wave parse a long text again and again, and keep what they get, until each has ended.
const wavesOfWorkersRunOutOfRoom = `declare var self: Worker;
type Link = { next: Link | null; a: number; b: number };
let head: Link | null = null;
const keep: unknown[] = [];
const text = JSON.stringify(
  Array.from({ length: 4000 }, (_, i) => ({ id: i, name: "n" + i, tags: ["a", "b", String(i)], nested: { x: i, y: [i, i + 1] } })),
);
if (Bun.isMainThread) {
  const start = () => {
    const worker = new Worker(new URL(import.meta.url));
    worker.addEventListener("error", () => {});
    return new Promise<Worker>(resolve => (worker.onmessage = () => resolve(worker)));
  };
  const waves: Worker[][] = [];
  const fillers: Worker[] = [];
  for (let wave = 0; wave < 3; wave++) {
    waves.push([]);
    for (let i = 0; i < 4; i++) waves[wave].push(await start());
  }
  for (let wave = 0; wave < 3; wave++) fillers.push(await start());
  for (let wave = 0; wave < 3; wave++) {
    fillers[wave].postMessage("fill");
    // One that finds no room while it has few objects ends, too.
    await new Promise(resolve => {
      fillers[wave].onmessage = resolve;
      fillers[wave].addEventListener("close", resolve);
    });
    const codes = await Promise.all(
      waves[wave].map(worker => {
        worker.postMessage("parse");
        return new Promise<number>(resolve =>
          worker.addEventListener("close", event => resolve((event as unknown as { code: number }).code)),
        );
      }),
    );
    console.log("wave", wave, "ended with codes", codes.join(" "));
  }
  process.exit(0);
} else {
  self.onmessage = event => {
    if (event.data === "fill") {
      try {
        for (let i = 0; ; i++) head = { next: head, a: i, b: i };
      } catch {}
      return postMessage("full");
    }
    setInterval(() => keep.push(JSON.parse(text)), 1);
  };
  setInterval(() => {}, 1000);
  postMessage("ready");
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

async function runEach(runs: Run[], program: string, ...args: string[]) {
  using folder = tempDir("aot-workers-limit", { "program.ts": program });
  const env = { ...bunEnv, BUN_CRASH_REPORT_URL: "" };
  const built = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", "program"],
    String(folder),
    env,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  const results: { stdout: string; stderr: string; exitCode: number | null }[] = [];
  for (const run of runs) {
    const command = run.limitInKB ? `ulimit -v ${run.limitInKB} && exec ./program "$@"` : `exec ./program "$@"`;
    const { stdout, stderr, exitCode } = await runCommand(["sh", "-c", command, "sh", ...args], String(folder), {
      ...env,
      ...run.env,
    });
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

describe.concurrent("Workers of a compiled program within a limit on the address space", () => {
  test.skipIf(!isLinux || isASAN).each([
    [8, 4 * GB],
    [32, 4 * GB],
    [8, 2 * GB],
    [32, 2 * GB],
    [8, GB],
  ])(
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

  test.skipIf(!isLinux || isASAN).each([
    [128, 4 * GB],
    [64, 2 * GB],
    [128, 2 * GB],
  ])(
    "of %d started one by one within %d kB some start and the constructor throws for the rest",
    async (count, limit) => {
      const { stdout, stderr, exitCode } = await runWithin(limit, startsWorkersOneByOne, String(count));
      const [, started, refused] = /^started (\d+) refused (\d+)\n$/.exec(stdout) ?? [];
      expect({ stdout, stderr, exitCode, all: Number(started) + Number(refused), many: Number(started) >= 16 }).toEqual(
        {
          stdout,
          stderr: "",
          exitCode: 0,
          all: count,
          many: true,
        },
      );
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "those of node:worker_threads start",
    async () => {
      expect(await runWithin(2 * GB, startsNodeWorkers)).toEqual({ stdout: "started 8\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!isLinux || isASAN)(
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

  test.skipIf(!isLinux || isASAN)(
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

  test.skipIf(!isLinux || isASAN)(
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

  test.skipIf(!isLinux || isASAN)(
    "a Worker starts in the room of Workers that were just terminated within each of 40 limits",
    async () => {
      const limits = Array.from({ length: 40 }, (_, i) => (896 + 13 * i) * 1024);
      const results = await runWithinEach(limits, startsWorkerRightAfterTerminating);
      expect(results.map((result, i) => ({ limit: limits[i], ...result }))).toEqual(
        limits.map(limit => ({ limit, stdout: "at least 8 run: true\n", stderr: "", exitCode: 0 })),
      );
    },
    240_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "a Worker starts in the room of Workers that were just terminated at each of the 128 places where the cells begin",
    async () => {
      const places = Array.from({ length: 128 }, (_, i) => String(i + 1));
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

  test.skipIf(!isLinux || isASAN).each(["a call that blocks", "its exit handler", "its own Worker"])(
    "the constructor returns at once while %s holds up a Worker that is ending",
    async how => {
      expect(await runWithin(GB, constructsWorkersWhileAnotherIsHeldUp, how)).toEqual({
        stdout:
          "two are constructed within 4 s: true\n" +
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

  // On arm64 a Worker of node:worker_threads may start in less room than it then takes.
  test.skipIf(!isLinux || isASAN).each(isArm64 ? ["web"] : ["web", "node"])(
    "of more Workers than find room once others have ended some start and the rest get an error (%s)",
    async kind => {
      const { stdout, stderr, exitCode } = await runWithin(GB, constructsMoreWorkersThanFindRoom, kind);
      const lines = stdout.split("\n").slice(0, -1);
      expect({ stdout, stderr, exitCode, count: lines.length, different: [...new Set(lines)].sort() }).toEqual({
        stdout,
        stderr: "",
        exitCode: 0,
        count: 6,
        different: ["TypeError: Failed to spawn worker thread, code 1", "started"],
      });
    },
    240_000,
  );

  test.skipIf(!isLinux || isASAN)(
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

  test.skipIf(!isLinux || isASAN)(
    "the main thread exits at once while a Worker of its own waits for room, and that one never starts",
    async () => {
      const { stdout, stderr, exitCode } = await runWithin(GB, endsThreadWhoseWorkerWaits, "the main thread exits");
      const ended = Date.now();
      const [, exits] = /^exits at (\d+)\n$/.exec(stdout) ?? [];
      expect({ stdout, stderr, exitCode, within4Seconds: ended - Number(exits) < 4000 }).toEqual({
        stdout,
        stderr: "",
        exitCode: 0,
        within4Seconds: true,
      });
    },
    240_000,
  );

  test.skipIf(!isLinux || isASAN)(
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

  test.skipIf(!isLinux || isASAN).each([0, 48])(
    "Workers with few objects end one by one where another Worker has taken all the room, and the program goes on (the main thread keeps %d MB first)",
    async megabytesKeptFirst => {
      const places = Array.from({ length: 8 }, (_, i) => String(16 * i + 1));
      const results = await runEach(
        places.map(place => ({ limitInKB: 768 * 1024, env: { BUN_JSC_seedOfVMRandomForFuzzer: place } })),
        workersWithFewObjectsRunOutOfRoom,
        String(megabytesKeptFirst),
      );
      const stdout = "RangeError: Out of memory, code 1\n".repeat(4);
      expect(results.map((result, i) => ({ place: places[i], ...result }))).toEqual(
        places.map(place => ({ place, stdout, stderr: "", exitCode: 0 })),
      );
    },
    240_000,
  );

  test.skipIf(!isLinux || isASAN)(
    "wave after wave of Workers ends where no room is left, and the program goes on",
    async () => {
      const places = Array.from({ length: 8 }, (_, i) => String(16 * i + 1));
      const results = await runEach(
        places.map(place => ({ limitInKB: 1536 * 1024, env: { BUN_JSC_seedOfVMRandomForFuzzer: place } })),
        wavesOfWorkersRunOutOfRoom,
      );
      const stdout = [0, 1, 2].map(wave => `wave ${wave} ended with codes 1 1 1 1\n`).join("");
      expect(results.map((result, i) => ({ place: places[i], ...result }))).toEqual(
        places.map(place => ({ place, stdout, stderr: "", exitCode: 0 })),
      );
    },
    240_000,
  );

  test.skipIf(!isLinux || isASAN || isDebug)(
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

  test("properties are found by name in more shapes than the table has rows for at first", async () => {
    expect(await runWithin(undefined, readsManyShapesByName)).toEqual({
      stdout: "21599820000 21599820000\n14400000000\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);
});
