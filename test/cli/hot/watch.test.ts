import { spawn } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isLinux, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

describe.todoIf(isBroken && isWindows)("--watch works", async () => {
  for (const watchedFile of ["entry.js", "tmp.js"]) {
    test(`with ${watchedFile}`, async () => {
      await using tmpdir_ = tempDir("watch-fixture", {
        "tmp.js": "console.log('hello #1')",
        "entry.js": "import './tmp.js'",
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
      });
      await Bun.sleep(1000);
      const tmpfile = join(tmpdir_, "tmp.js");
      const process = spawn({
        cmd: [bunExe(), "--watch", join(tmpdir_, watchedFile)],
        cwd: tmpdir_,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const { stdout } = process;

      const iter = forEachLine(stdout);
      let { value: line, done } = await iter.next();
      expect(done).toBe(false);
      expect(line).toBe("hello #1");

      await writeFile(tmpfile, "console.log('hello #2')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #2");

      await writeFile(tmpfile, "console.log('hello #3')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #3");

      await writeFile(tmpfile, "console.log('hello #4')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #4");

      await writeFile(tmpfile, "console.log('hello #5')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #5");

      process.kill("SIGKILL");
      await process.exited;
    });
  }
});

// The loop of `--hot` and `--watch` sleeps when the program has nothing to do, up to a second at a time. A poll
// before that sleep can take the wakeup of work that is already there, so the sleep must not start while work waits.

// bun:test ends the child of a serial test that times out. It leaves the child of a concurrent test.
const children: Bun.Subprocess[] = [];
afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
});

/** Starts `bun <flag> main.js` in `cwd`. */
function start(flag: string, cwd: string, env = bunEnv) {
  const runner = spawn({
    cmd: [bunExe(), flag, "--no-clear-screen", "main.js"],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  children.push(runner);
  return runner;
}

/** Follows a process that stays alive. `until` polls, and throws with the output if the process ends first. */
function alive(runner: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const output = { stdout: "", stderr: "" };
  let end: string | undefined;
  const read = async (name: "stdout" | "stderr") => {
    for await (const chunk of runner[name]) output[name] += Buffer.from(chunk).toString();
  };
  void Promise.allSettled([read("stdout"), read("stderr"), runner.exited]).then(() => {
    end = `exited with ${runner.signalCode ?? runner.exitCode}`;
  });
  return {
    output,
    async until(done: () => boolean) {
      while (!done()) {
        if (end) throw new Error(`${end}\nstdout: ${output.stdout}\nstderr: ${output.stderr}`);
        await Bun.sleep(1);
      }
    },
  };
}

/**
 * The timeout argument of the poll that blocks the main thread of `pid`, or `undefined` if none does. Linux only.
 * The kernel prints `running` for a thread that is not blocked, so a poll that returns at once never shows.
 * The system calls are epoll_pwait2, and epoll_pwait on x64 and on arm64 for a kernel that lacks it.
 */
function blockingPoll(pid: number) {
  const path = `/proc/${pid}/syscall`;
  try {
    const fields = readFileSync(path, "latin1").split(" ");
    return ["441", "281", "22"].includes(fields[0]) ? fields[4] : undefined;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    // The process is gone: `until` reports how it ended.
    if (code === "ENOENT" || code === "ESRCH") return undefined;
    throw new Error(`cannot read ${path}: ${code}`, { cause: error });
  }
}

// A task that is not done after one batch yields: it goes on after the loop has polled.
test.concurrent.each(
  ["--hot", "--watch"].flatMap(flag => [
    [
      flag,
      "a Worker's messages",
      // The Worker has queued every message when the first is delivered. One task delivers 1024.
      `
        const posted = new Int32Array(new SharedArrayBuffer(4));
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        let received = 0;
        worker.onmessage = event => {
          if (event.data === "ready") {
            worker.postMessage(posted);
            Atomics.wait(posted, 0, 0);
            throw new Error("the bug");
          }
          if (++received === 5000) console.log("done");
        };
      `,
    ],
    [
      flag,
      "the messages of a MessageChannel",
      `
        const { port1, port2 } = new MessageChannel();
        let received = 0;
        port2.onmessage = () => {
          if (++received === 5000) console.log("done");
        };
        for (let i = 0; i < 5000; i++) port1.postMessage(i);
        throw new Error("the bug");
      `,
    ],
    [
      flag,
      "the output of a shell builtin",
      `
        Bun.$\`yes > \${new Uint8Array(1 << 20)}\`.nothrow().then(() => console.log("done"));
        throw new Error("the bug");
      `,
    ],
  ]),
)("%s delivers %s after an uncaught error", async (flag, _, main) => {
  using dir = tempDir("hot-yield-after-error", {
    "worker.js": `
      self.onmessage = ({ data: posted }) => {
        for (let i = 0; i < 5000; i++) postMessage(i);
        Atomics.store(posted, 0, 1);
        Atomics.notify(posted, 0);
      };
      postMessage("ready");
    `,
    "main.js": main,
  });
  await using runner = start(flag, String(dir));
  const child = alive(runner);
  await child.until(() => child.output.stdout.includes("done"));
  expect(child.output.stderr).toContain("error: the bug");
  // The loop sleeps again: it did not start to spin.
  if (isLinux) await child.until(() => blockingPoll(runner.pid) !== undefined);
});

// The loop polls before it runs a task that yielded. The Worker keeps more than two batches queued until the
// request is answered, so a loop that runs queued tasks without a poll never reads the request.
test.concurrent.each(["--hot", "--watch"])(
  "%s answers a request between the batches of a Worker's messages after an uncaught error",
  async flag => {
    using dir = tempDir("hot-poll-between-batches", {
      "worker.js": `
        self.onmessage = ({ data: state }) => {
          let posted = 0;
          while (Atomics.load(state, 2) === 0) {
            if (posted - Atomics.load(state, 1) >= 4096) continue;
            postMessage(posted);
            Atomics.store(state, 0, ++posted);
          }
          postMessage("done");
        };
        postMessage("ready");
      `,
      "main.js": `
        const state = new Int32Array(new SharedArrayBuffer(12)); // posted, received, answered
        const server = Bun.serve({
          port: 0,
          fetch() {
            Atomics.store(state, 2, 1);
            return new Response("answered");
          },
        });
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        let received = 0;
        worker.onmessage = event => {
          if (event.data === "ready") return worker.postMessage(state);
          if (event.data === "done") return console.log("done");
          while (Atomics.load(state, 0) - received < 2500 && Atomics.load(state, 2) === 0);
          Atomics.store(state, 1, ++received);
          if (received === 4000) console.log("url " + server.url.href + " ");
          if (received === 1) throw new Error("the bug");
        };
      `,
    });
    await using runner = start(flag, String(dir));
    const child = alive(runner);
    let url: string | undefined;
    await child.until(() => (url = /url (\S+) /.exec(child.output.stdout)?.[1]) !== undefined);
    expect(await (await fetch(url!)).text()).toBe("answered");
    await child.until(() => child.output.stdout.includes("done"));
  },
);

/**
 * Start of a script that runs in `src/` with `BUN_WATCHER_TRACE` set. Its `fence()` returns once the watcher
 * thread has handled every change made before the call: the watcher logs each batch before it handles it, so the
 * batch of the first directory is done once that of the second is logged.
 */
const fence = `
  const { mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
  require("./fence/f.js");
  function fence() {
    const trace = process.env.BUN_WATCHER_TRACE;
    for (const name of ["1", "2"]) {
      const from = statSync(trace).size;
      mkdirSync("fence/" + name);
      while (!/[\\\\/]fence[\\\\/]/.test(readFileSync(trace, "latin1").slice(from))) Bun.sleepSync(1);
    }
  }
`;

// The watcher thread restarts the process by itself when the program has not run its kill-signal listeners
// 500 ms after a save. The loop runs an immediate right before it polls, and the interval gives that poll
// something to wait on. Not concurrent: those 500 ms are wall-clock time.
test("--watch runs the kill-signal listeners for a save that waits when the loop goes to sleep", async () => {
  using dir = tempDir("watch-queued-reload", {
    "trace.log": "",
    "src/fence/f.js": "",
    "src/main.js": `
      ${fence}
      process.on("SIGTERM", () => console.log("listener ran"));
      setInterval(() => {}, 1e6);
      setImmediate(() => {
        writeFileSync(__filename, 'console.log("restarted");\\nprocess.exit(0);\\n');
        fence();
      });
      throw new Error("the bug");
    `,
  });
  const root = String(dir);
  await using runner = start("--watch", join(root, "src"), { ...bunEnv, BUN_WATCHER_TRACE: join(root, "trace.log") });
  const [stdout, stderr, exitCode] = await Promise.all([runner.stdout.text(), runner.stderr.text(), runner.exited]);
  expect(stderr).toContain("error: the bug");
  expect({ stdout, exitCode }).toEqual({ stdout: "listener ran\nrestarted\n", exitCode: 0 });
});

// The sleep ends by itself after a second, so these look at the main thread from outside: /proc names the system
// call that blocks it. Each script writes `queued` once its work waits, and the work writes `ran`.
test.concurrent.skipIf(!isLinux).each([
  [
    // The loop runs an immediate right before it polls.
    "after a failed run while the reload of a save waits",
    `
      ${fence}
      setImmediate(() => {
        writeFileSync(__filename, 'require("node:fs").writeFileSync("../ran", "");');
        fence();
        writeFileSync("../queued", "");
      });
      throw new Error("the bug");
    `,
  ],
  ...[
    ["failed", `throw new Error("the bug");`],
    ["good", ``],
  ].map(([run, end]) => [
    `after a ${run} run while a signal waits`,
    `
      const { writeFileSync } = require("node:fs");
      process.on("SIGUSR2", () => writeFileSync("../ran", ""));
      setImmediate(() => {
        process.kill(process.pid, "SIGUSR2");
        writeFileSync("../queued", "");
      });
      ${end}
    `,
  ]),
  // The loop reports the failed reload to an unhandledRejection listener right before it sleeps.
  ...[
    ["an immediate", `setImmediate(() => writeFileSync("../ran", ""));`],
    ["a timer", `setTimeout(() => writeFileSync("../ran", ""), 0);`],
    ["a tick", `process.nextTick(() => writeFileSync("../ran", ""));`],
    ["a microtask", `Promise.resolve().then(() => writeFileSync("../ran", ""));`],
  ].map(([work, start]) => [
    `while ${work} of an unhandledRejection listener waits`,
    `
      const { writeFileSync } = require("node:fs");
      process.on("unhandledRejection", () => {
        ${start}
        writeFileSync("../queued", "");
      });
      throw new Error("the bug");
    `,
  ]),
  // The sleep itself reports a rejection that the last turn left.
  [
    "while the report of a rejection from a timer waits",
    `
      const { writeFileSync } = require("node:fs");
      process.on("unhandledRejection", () => writeFileSync("../ran", ""));
      setTimeout(() => {
        Promise.reject(new Error("late"));
        writeFileSync("../queued", "");
      }, 0);
    `,
  ],
  ...[
    ["a tick", `process.nextTick(() => writeFileSync("../ran", ""));`],
    ["a microtask", `Promise.resolve().then(() => writeFileSync("../ran", ""));`],
  ].map(([work, start]) => [
    `while ${work} of the listener of a rejection from a timer waits`,
    `
      const { writeFileSync } = require("node:fs");
      process.on("unhandledRejection", () => {
        ${start}
        writeFileSync("../queued", "");
      });
      setTimeout(() => Promise.reject(new Error("late")), 0);
    `,
  ]),
  [
    "while the report of a rejection from a tick of that listener waits",
    `
      const { writeFileSync } = require("node:fs");
      process.on("unhandledRejection", error => {
        if (error.message === "second") return writeFileSync("../ran", "");
        process.nextTick(() => Promise.reject(new Error("second")));
        writeFileSync("../queued", "");
      });
      setTimeout(() => Promise.reject(new Error("late")), 0);
    `,
  ],
  [
    "after a failed run between the batches of a MessageChannel",
    `
      const { writeFileSync } = require("node:fs");
      const { port1, port2 } = new MessageChannel();
      let received = 0;
      port2.onmessage = () => {
        if (++received === 1) writeFileSync("../queued", "");
        if (received === 3000) writeFileSync("../ran", "");
      };
      for (let i = 0; i < 3000; i++) port1.postMessage(i);
      throw new Error("the bug");
    `,
  ],
])("--hot does not sleep %s", async (_, main) => {
  using dir = tempDir("hot-sleep-with-work", {
    "trace.log": "",
    "src/fence/f.js": "",
    "src/main.js": `console.log("first run");`,
  });
  const root = String(dir);
  await using runner = start("--hot", join(root, "src"), { ...bunEnv, BUN_WATCHER_TRACE: join(root, "trace.log") });
  const child = alive(runner);
  await child.until(() => child.output.stdout.includes("first run"));
  // The sleep of the idle loop, and its timeout. A loop that has not slept yet has nothing to poll, and the poll
  // before its sleep would leave the wakeup alone.
  let sleep: string | undefined;
  await child.until(() => (sleep = blockingPoll(runner.pid)) !== undefined);

  // One write in place is one file event. The wakeup of a second event would end the sleep.
  writeFileSync(join(root, "src", "main.js"), main, { flag: "r+" });
  await child.until(() => existsSync(join(root, "queued")));
  let sleptFirst = false;
  await child.until(() => {
    sleptFirst = blockingPoll(runner.pid) === sleep && !existsSync(join(root, "ran"));
    return sleptFirst || existsSync(join(root, "ran"));
  });
  expect(sleptFirst).toBe(false);
  // The loop sleeps again: it did not start to spin.
  await child.until(() => blockingPoll(runner.pid) !== undefined);
});
