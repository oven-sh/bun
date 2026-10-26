import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
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
    await Promise.all(workers.map(worker => new Promise(resolve => (worker.onmessage = resolve))));
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

// Workers start one by one until the constructor throws. Two are terminated, and the next one starts in the same turn.
const startsWorkerRightAfterTerminating = `if (Bun.isMainThread) {
  const startAndWait = async () => {
    const worker = new Worker(new URL(import.meta.url));
    await new Promise(resolve => (worker.onmessage = resolve));
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

async function runWithin(limitInKB: number | undefined, program: string, ...args: string[]) {
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
  const command = limitInKB ? `ulimit -v ${limitInKB} && exec ./program "$@"` : `exec ./program "$@"`;
  const { stdout, stderr, exitCode } = await runCommand(["sh", "-c", command, "sh", ...args], String(folder), env);
  return { stdout, stderr, exitCode };
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
