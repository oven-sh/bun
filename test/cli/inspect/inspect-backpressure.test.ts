import { spawn, type Subprocess } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import net from "node:net";
import { join } from "node:path";
import { RawFrontend } from "./raw-frontend";

// The inspected program. It does what stdin tells it and says so on stderr:
//   log   logs a batch of 8 lines, 1 MB of inspector messages, and prints "LOGGED <lines so far>"
//   big   logs one line of 3 MB, a message of 6 MB, and prints "LOGGED <lines so far>"
//   rss   prints "RSS <megabytes>"
//   idle  stops reading stdin, so that only a frontend keeps the process alive, and prints "IDLE"
// A line is "#<n> " and padding, so that a frontend can tell which lines arrived.
const logger = `const pad = Buffer.alloc(64 * 1024, "L").toString();
let lines = 0;
function hit() {
  return lines;
}
globalThis.hit = hit;
process.stdin.on("data", data => {
  for (const command of String(data).split("\\n")) {
    if (command === "log") {
      for (let i = 0; i < 8; i++) console.log("#" + lines++ + " " + pad);
    } else if (command === "big") {
      console.log("#" + lines++ + " " + Buffer.alloc(3 * 1024 * 1024, "L").toString());
    } else if (command === "rss") {
      process.stderr.write("RSS " + Math.round(process.memoryUsage.rss() / 1024 / 1024) + "\\n");
      continue;
    } else if (command === "idle") {
      process.stdin.pause();
      process.stderr.write("IDLE\\n");
      continue;
    } else {
      continue;
    }
    process.stderr.write("LOGGED " + lines + "\\n");
  }
});
`;
// `return lines;` in hit(), where a test sets a breakpoint.
const breakpoint = { lineNumber: 3, urlRegex: "logger\\.js$" };

// A test that times out does not dispose its program.
const programs: Program[] = [];
afterAll(() => {
  for (const program of programs) program.kill();
});

class Program implements AsyncDisposable {
  /** The WebSocket URL of the inspector, once the program printed it. */
  url = "";
  /** How many lines the program has logged. */
  lines = 0;
  /** The last mark of `afterDebuggerThread()` that the program printed. */
  mark = 0;
  /** The last answer to `rss()`, in megabytes. */
  megabytes = 0;
  /** Whether the program said that it stopped reading stdin. */
  isIdle = false;

  #dir = tempDir("inspect-backpressure", { "logger.js": logger });
  #proc: Subprocess<"pipe", "ignore", "pipe">;
  #stderr = "";
  #exited = false;
  #waiters: (() => void)[] = [];

  /**
   * `backlog`: megabytes queued for a frontend that reads nothing before the program drops it.
   * The program's own limit is 128, too much for most tests. `undefined` keeps that limit.
   */
  constructor(args: string[], { backlog = "4" as string | undefined, env = {} as Record<string, string> } = {}) {
    this.#proc = spawn({
      cmd: [bunExe(), ...args, join(String(this.#dir), "logger.js")],
      env: { ...bunEnv, ...env, ...(backlog && { BUN_DEBUG_TEST_INSPECTOR_BACKLOG_MB: backlog }) },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });
    programs.push(this);
    this.#read();
  }

  async #read() {
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of this.#proc.stderr) {
      const text = decoder.decode(chunk, { stream: true });
      this.#stderr += text;
      const lines = (rest + text).split("\n");
      rest = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith("LOGGED ")) this.lines = Number(line.slice(7));
        else if (line.startsWith("MARK ")) this.mark = Number(line.slice(5));
        else if (line.startsWith("RSS ")) this.megabytes = Number(line.slice(4));
        else if (line === "IDLE") this.isIdle = true;
        else this.url ||= line.match(/ws:\/\/127\.0\.0\.1:\d+\/\S*/)?.[0] ?? "";
      }
      for (const waiter of this.#waiters.splice(0)) waiter();
    }
    this.#exited = true;
    for (const waiter of this.#waiters.splice(0)) waiter();
  }

  /** Resolves when `condition()` holds. Rejects with the program's stderr if it exits first. */
  async until(condition: () => boolean, what: string): Promise<void> {
    while (!condition()) {
      if (this.#exited) throw new Error(`the program exited before ${what}:\n${this.#stderr}`);
      await new Promise<void>(resolve => this.#waiters.push(resolve));
    }
  }

  #tell(command: string): void {
    this.#proc.stdin.write(command + "\n");
    this.#proc.stdin.flush();
  }

  /** Logs `megabytes` batches of 1 MB. */
  async log(megabytes: number): Promise<void> {
    for (let i = 0; i < megabytes; i++) {
      const lines = this.lines + 8;
      this.#tell("log");
      await this.until(() => this.lines === lines, "the batch");
    }
  }

  /** Logs one line that is a message of 6 MB. */
  async big(): Promise<void> {
    const lines = this.lines + 1;
    this.#tell("big");
    await this.until(() => this.lines === lines, "the large line");
  }

  /** The resident memory of the program in megabytes. */
  async rss(): Promise<number> {
    this.megabytes = 0;
    this.#tell("rss");
    await this.until(() => this.megabytes !== 0, "the memory report");
    return this.megabytes;
  }

  /** From here on only an attached frontend keeps the program alive. */
  async idle(): Promise<void> {
    this.#tell("idle");
    await this.until(() => this.isIdle, "the program to stop reading stdin");
  }

  /**
   * Resolves once the debugger thread has done what was queued for it, or `frontend` is gone.
   * That thread reads this command from the frontend's socket after its earlier tasks, and the
   * program then prints a mark. The frontend does not have to read.
   */
  async afterDebuggerThread(frontend: RawFrontend): Promise<void> {
    const mark = this.mark + 1;
    frontend.send("Runtime.evaluate", { expression: `process.stderr.write("MARK ${mark}\\n")` }).catch(() => {});
    await Promise.race([
      this.until(() => this.mark === mark, "the mark"),
      frontend.until(() => false, "").catch(() => {}),
    ]);
  }

  get exited(): Promise<number> {
    return this.#proc.exited;
  }

  kill(): void {
    this.#proc.kill();
  }

  async [Symbol.asyncDispose]() {
    this.kill();
    await this.#proc.exited;
    this.#dir[Symbol.dispose]();
  }
}

// The tests move tens of megabytes through a debug build, which the default 5 s does not cover.
const timeout = isASAN || isDebug ? 120_000 : undefined;

const closedForNotReading = {
  code: 1013,
  reason: expect.stringMatching(/^Inspector frontend read nothing while \d+ MB were queued for it$/),
};

/**
 * Logs until the program has dropped `stalled`, which does not read. `witness` reads all the time.
 * Then `stalled` reads again: it gets what its socket held and the close frame.
 */
async function logUntilDropped(program: Program, stalled: RawFrontend, witness: RawFrontend): Promise<void> {
  // A socket whose frontend reads nothing still takes bytes while the kernel grows its
  // buffers, and each byte counts as a read. With the default limits it holds about 8 MB,
  // and the frontend is dropped 4 MB later. A kernel with larger limits takes a whole round:
  // the frontend then caught up, and the next round is long enough for buffers of 64 MB.
  for (const megabytes of [32, 128]) {
    if (stalled.closeFrame) break;
    stalled.pause();
    // One megabyte at a time: the witness has each one before the next is logged, so the
    // program never queues for it.
    for (let megabyte = 0; megabyte < megabytes; megabyte++) {
      await program.log(1);
      await witness.until(() => witness.lines.size === program.lines, "the megabyte");
    }
    // The debugger thread runs its tasks in order: once it hands over this answer, it
    // has done what was queued for the stalled frontend before.
    await witness.send("Runtime.evaluate", { expression: "0" });

    // If nothing dropped the stalled frontend, it gets every line and stays connected.
    stalled.resume();
    await stalled.until(() => stalled.lines.size === program.lines, "every line").catch(() => {});
  }
}

// The command that enables the events of the logger, and the commands that turn the debugger on.
type Command = [method: string, params?: object];
const servers: [name: string, args: string[], enable: string, debuggerOn: Command[]][] = [
  [
    "bun --inspect",
    ["--inspect=127.0.0.1:0"],
    "Console.enable",
    // JSC stops at a breakpoint only when breakpoints are active.
    [["Debugger.enable"], ["Debugger.setBreakpointsActive", { active: true }]],
  ],
  [
    "inspector.open()",
    ["--eval", `require("node:inspector").open(0, "127.0.0.1"); require(process.argv[1]);`],
    "Runtime.enable",
    [["Debugger.enable"]],
  ],
];

describe.concurrent.each(servers)("%s", (_, args, enable, debuggerOn) => {
  test(
    "drops a frontend that stops reading and tells it why, and another frontend keeps what it had",
    async () => {
      await using program = new Program(args);
      await program.until(() => program.url !== "", "the inspector URL");
      // Both frontends are debuggers with the same domain on. The witness reads all the time.
      const witness = await RawFrontend.connect(program.url);
      const stalled = await RawFrontend.connect(program.url);
      try {
        for (const frontend of [witness, stalled]) {
          await frontend.send(enable);
          for (const [method, params] of debuggerOn) await frontend.send(method, params);
        }
        // The breakpoint of the frontend that will stall works: the witness resumes the program.
        expect(await stalled.send("Debugger.setBreakpointByUrl", breakpoint)).toEqual({
          id: expect.any(Number),
          result: expect.objectContaining({ breakpointId: expect.any(String) }),
        });
        const hit = witness.send("Runtime.evaluate", { expression: "hit()" });
        await witness.until(() => witness.count("Debugger.paused") === 1, "the pause at the breakpoint");
        await witness.send("Debugger.resume");
        await hit;

        await logUntilDropped(program, stalled, witness);
        expect(stalled.closeFrame).toEqual(closedForNotReading);
        expect(stalled.lines.size).toBeLessThan(program.lines);

        // The breakpoint went with the frontend that set it. The debugger and the domain that
        // the witness also had on stay on: it is not paused again, and it still gets a line.
        const after = witness.send("Runtime.evaluate", { expression: `hit(); console.log("#1000000 after")` });
        await Promise.race([after, witness.until(() => witness.count("Debugger.paused") === 2, "").catch(() => {})]);
        expect(witness.count("Debugger.paused")).toBe(1);
        await witness.until(() => witness.lines.has(1000000), "a line logged after the stalled frontend left");
        expect(witness.closeFrame).toBeUndefined();
      } finally {
        stalled.close();
        witness.close();
      }
    },
    timeout,
  );
});

test.concurrent(
  "keeps a frontend that reads, however far behind it is and whatever the size of one message",
  async () => {
    await using program = new Program(["--inspect=127.0.0.1:0"]);
    await program.until(() => program.url !== "", "the inspector URL");
    const slow = await RawFrontend.connect(program.url);
    try {
      await slow.send("Console.enable");
      slow.pause();

      // For each megabyte logged, the frontend takes one chunk: 512 KB at most. It ends up
      // 16 MB or more behind. Its socket holds about 8 MB of that and the rest waits, twice
      // the limit. But 4 MB are never queued since it last took a byte.
      for (let i = 0; i < 16; i++) {
        await program.log(1);
        await slow.readChunk();
      }
      // One message of 6 MB passes the limit by itself. The frontend still reads.
      await program.big();
      for (let i = 0; i < 16; i++) {
        await slow.readChunk();
        await program.log(1);
      }

      slow.resume();
      await slow.until(() => slow.lines.size === program.lines, "every line");
      expect(slow.closeFrame).toBeUndefined();
    } finally {
      slow.close();
    }
  },
  timeout,
);

test.concurrent(
  "a dropped frontend gets the reason when it reads again, also when the program has nothing left to do",
  async () => {
    await using program = new Program(["--inspect=127.0.0.1:0"]);
    await program.until(() => program.url !== "", "the inspector URL");
    // A frontend keeps the program alive. This header says that the witness does not.
    const witness = await RawFrontend.connect(program.url, "Ref-Event-Loop: 0\r\n");
    const stalled = await RawFrontend.connect(program.url);
    try {
      await witness.send("Console.enable");
      await stalled.send("Console.enable");
      // A recording that only the stalled frontend started ends when the program drops it,
      // and every frontend gets the event that says so.
      await stalled.send("ScriptProfiler.startTracking");
      const dropped = () => witness.count("ScriptProfiler.trackingComplete") === 1;

      stalled.pause();
      for (let megabyte = 0; megabyte < 256 && !dropped(); megabyte++) {
        await program.log(1);
        await witness.until(() => witness.lines.size === program.lines, "the megabyte");
      }
      expect(dropped()).toBe(true);

      // Now nothing but the dropped frontend's open socket keeps the program alive.
      await program.idle();
      witness.close();

      stalled.resume();
      await stalled.until(() => false, "").catch(() => {});
      expect(stalled.closeFrame).toEqual(closedForNotReading);
      // With that socket closed the program has nothing left and exits.
      expect(await program.exited).toBe(0);
    } finally {
      stalled.close();
      witness.close();
    }
  },
  timeout,
);

// The inspected process dials these transports. They have no close frame.
type Dialed = [
  name: string,
  listen: (server: net.Server, dir: string) => void,
  how: (server: net.Server, dir: string) => { args: string[]; env: Record<string, string> },
];
const dialed: Dialed[] = [
  [
    "--inspect=tcp://",
    server => server.listen(0, "127.0.0.1"),
    server => ({ args: [`--inspect=tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`], env: {} }),
  ],
  [
    "BUN_INSPECT_CONNECT_TO=unix://",
    (server, dir) => server.listen(join(dir, "frontend.sock")),
    (_, dir) => ({ args: [], env: { BUN_INSPECT_CONNECT_TO: "unix://" + join(dir, "frontend.sock") } }),
  ],
];

describe.concurrent.each(dialed)("%s", (_, listen, how) => {
  /** Starts the program, which dials the frontend. */
  async function dial(dir: string, backlog: string | undefined) {
    const { promise: accepted, resolve: accept } = Promise.withResolvers<net.Socket>();
    const server = net.createServer(accept);
    listen(server, dir);
    await new Promise(resolve => server.once("listening", resolve));
    const program = new Program(how(server, dir).args, { backlog, env: how(server, dir).env });
    const frontend = RawFrontend.accept(await accepted);
    return { server, program, frontend };
  }

  test(
    "disconnects a frontend that stops reading",
    async () => {
      using dir = tempDir("inspect-dialed", {});
      const { server, program, frontend: stalled } = await dial(String(dir), "4");
      await using _ = program;
      try {
        await stalled.send("Console.enable");
        stalled.pause();

        // Its socket holds about 8 MB. The program drops it 4 MB later, when the debugger
        // thread next looks: so that thread gets its turn after each megabyte.
        for (let megabyte = 0; megabyte < 128 && !stalled.ended; megabyte++) {
          await program.log(1);
          await program.afterDebuggerThread(stalled);
        }

        // If nothing dropped it, it now gets every line and stays connected.
        stalled.resume();
        await stalled.until(() => stalled.lines.size === program.lines, "every line").catch(() => {});
        expect(stalled.ended).toBe(true);
        expect(stalled.lines.size).toBeLessThan(program.lines);
      } finally {
        stalled.close();
        server.close();
      }
    },
    timeout,
  );

  test(
    "a frontend that was away gets every line and its answers",
    async () => {
      using dir = tempDir("inspect-dialed", {});
      // 24 MB are logged while it is away. Its socket holds about 8 MB, and the limit is out of reach.
      const { server, program, frontend } = await dial(String(dir), "64");
      await using _ = program;
      try {
        await frontend.send("Console.enable");
        frontend.pause();
        await program.log(24);

        frontend.resume();
        await frontend.until(() => frontend.lines.size === program.lines, "every line");
        expect(await frontend.send("Runtime.evaluate", { expression: "1 + 1" })).toEqual({
          id: expect.any(Number),
          result: expect.objectContaining({ result: expect.objectContaining({ value: 2 }) }),
        });
        expect(frontend.ended).toBe(false);
      } finally {
        frontend.close();
        server.close();
      }
    },
    timeout,
  );
});

// This test queues what the program queues by default. A debug build is too slow for that.
test.skipIf(isASAN || isDebug)("the limit is 128 MB queued, and the memory comes back", async () => {
  using dir = tempDir("inspect-limit", {});
  const path = join(String(dir), "frontend.sock");
  const { promise: accepted, resolve: accept } = Promise.withResolvers<net.Socket>();
  // A unix socket holds a fixed amount, so the megabytes below are the same in every run.
  const server = net.createServer(accept).listen(path);
  try {
    await new Promise(resolve => server.once("listening", resolve));
    await using program = new Program([], { backlog: undefined, env: { BUN_INSPECT_CONNECT_TO: "unix://" + path } });
    const stalled = RawFrontend.accept(await accepted);
    try {
      await stalled.send("Console.enable");
      const before = await program.rss();
      stalled.pause();

      let megabytes = 0;
      for (; megabytes < 512 && !stalled.ended; megabytes++) {
        await program.log(1);
        await program.afterDebuggerThread(stalled);
      }
      // 128 MB wait with no byte taken, and the program looks once more 16 MB later.
      expect({ dropped: stalled.ended, megabytes }).toEqual({ dropped: true, megabytes: expect.any(Number) });
      expect(megabytes).toBeGreaterThanOrEqual(128);
      expect(megabytes).toBeLessThan(192);

      // Nothing is queued for a frontend that is gone, and what was queued is free again.
      await program.log(64);
      expect((await program.rss()) - before).toBeLessThan(100);
    } finally {
      stalled.close();
    }
  } finally {
    server.close();
  }
});
