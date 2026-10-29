import { spawn, type Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import net from "node:net";
import { RawFrontend } from "./raw-frontend";

// The inspected program. For each "log" on stdin it logs a batch of 8 lines and then prints
// "LOGGED <lines so far>". A line is "#<n> " and 64 KB of padding, so that a frontend can tell
// which lines arrived. A batch is 1 MB of inspector messages.
const logger = /* js */ `
  const pad = Buffer.alloc(64 * 1024, "L").toString();
  let lines = 0;
  process.stdin.on("data", data => {
    for (const command of String(data).split("\\n")) {
      if (command !== "log") continue;
      for (let i = 0; i < 8; i++) console.log("#" + lines++ + " " + pad);
      process.stderr.write("LOGGED " + lines + "\\n");
    }
  });
`;

// Runtime.evaluate goes through JSC's InjectedScript. In the prebuilt WebKit it has exception
// checks missing, which abort the program under validateExceptionChecks.
const { BUN_JSC_validateExceptionChecks, BUN_JSC_dumpSimulatedThrows, ...env } = bunEnv;

class Program implements AsyncDisposable {
  /** The WebSocket URL of the inspector, once the program printed it. */
  url = "";
  /** How many lines the program has logged. */
  lines = 0;
  /** The last mark of `afterDebuggerThread()` that the program printed. */
  mark = 0;

  #proc: Subprocess<"pipe", "ignore", "pipe">;
  #stderr = "";
  #exited = false;
  #waiters: (() => void)[] = [];

  constructor(args: string[], source: string) {
    this.#proc = spawn({
      cmd: [bunExe(), ...args, "-e", source],
      // A frontend is dropped once 128 MB were queued for it since it last took a byte.
      // That is too much for a test, so the tests set 4 MB.
      env: { ...env, BUN_DEBUG_TEST_INSPECTOR_BACKLOG_MB: "4" },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });
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

  /** Logs `megabytes` batches of 1 MB. */
  async log(megabytes: number): Promise<void> {
    for (let i = 0; i < megabytes; i++) {
      const lines = this.lines + 8;
      this.#proc.stdin.write("log\n");
      this.#proc.stdin.flush();
      await this.until(() => this.lines === lines, "the batch");
    }
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

  get running(): boolean {
    return this.#proc.exitCode === null && this.#proc.signalCode === null;
  }

  async [Symbol.asyncDispose]() {
    this.#proc.kill();
    await this.#proc.exited;
  }
}

// The tests move tens of megabytes through a debug build, which the default 5 s does not cover.
const timeout = isASAN || isDebug ? 120_000 : undefined;

// The command that enables the events of the logger, and the commands that turn the debugger on.
type Command = [method: string, params?: object];
const servers: [name: string, args: string[], source: string, enable: string, debuggerOn: Command[]][] = [
  [
    "bun --inspect",
    ["--inspect=127.0.0.1:0"],
    logger,
    "Console.enable",
    // JSC pauses at a `debugger` statement only on request.
    [["Debugger.enable"], ["Debugger.setPauseOnDebuggerStatements", { enabled: true }]],
  ],
  [
    "inspector.open()",
    [],
    `require("node:inspector").open(0, "127.0.0.1");` + logger,
    "Runtime.enable",
    [["Debugger.enable"]],
  ],
];

describe.concurrent.each(servers)("%s", (_, args, source, enable, debuggerOn) => {
  test(
    "drops a frontend that stops reading and tells it why, and another frontend keeps its events",
    async () => {
      await using program = new Program(args, source);
      await program.until(() => program.url !== "", "the inspector URL");
      // The witness reads all the time. It enables the same domain as the frontend that will stall.
      const witness = await RawFrontend.connect(program.url);
      const stalled = await RawFrontend.connect(program.url);
      try {
        await witness.send(enable);
        await stalled.send(enable);
        // The frontend that will stall is a debugger. The witness is not.
        for (const [method, params] of debuggerOn) await stalled.send(method, params);

        // A socket whose frontend reads nothing still takes bytes for a moment, while the kernel
        // grows its buffers, and each byte counts as a read. A round that is over before that
        // moment finds a frontend that caught up. The second round meets buffers that are grown.
        for (let round = 0; round < 2 && !stalled.closeFrame; round++) {
          stalled.pause();
          // One megabyte at a time: the witness has each one before the next is logged, so the
          // program never queues for it. The stalled frontend takes what its socket holds, about
          // 8 MB. It is dropped 4 MB later.
          for (let megabyte = 0; megabyte < 32; megabyte++) {
            await program.log(1);
            await witness.until(() => witness.lines.size === program.lines, "the megabyte");
          }
          // The debugger thread runs its tasks in order: once it hands over this answer, it
          // has done what was queued for the stalled frontend before.
          await witness.send("Runtime.evaluate", { expression: "0" });

          // The stalled frontend reads again. It gets what its socket held, then the reason.
          // If nothing dropped it, it gets every line and stays connected.
          stalled.resume();
          await stalled.until(() => stalled.lines.size === program.lines, "every line").catch(() => {});
        }
        expect(stalled.closeFrame).toEqual({
          code: 1013,
          reason: expect.stringMatching(/^Inspector frontend read nothing while \d+ MB were queued for it$/),
        });
        expect(stalled.lines.size).toBeLessThan(program.lines);

        // The debugger went with the frontend that turned it on: nothing is left to resume the
        // program, so this statement must not pause it. The domain both had enabled stays on.
        await witness.send("Runtime.evaluate", { expression: `debugger; console.log("#1000000 after")` });
        await witness.until(() => witness.lines.has(1000000), "a line logged after the stalled frontend left");
        expect(witness.closeFrame).toBeUndefined();
        expect(program.running).toBe(true);
      } finally {
        stalled.close();
        witness.close();
      }
    },
    timeout,
  );
});

test.concurrent(
  "keeps a frontend that reads, however far behind it is",
  async () => {
    await using program = new Program(["--inspect=127.0.0.1:0"], logger);
    await program.until(() => program.url !== "", "the inspector URL");
    const slow = await RawFrontend.connect(program.url);
    try {
      await slow.send("Console.enable");
      slow.pause();

      // For each megabyte logged, the frontend takes one chunk: 512 KB at most. It ends up
      // 16 MB or more behind. Its socket holds about 8 MB of that and the rest waits, twice
      // the limit. But 4 MB are never queued since it last took a byte.
      for (let i = 0; i < 32; i++) {
        await program.log(1);
        await slow.readChunk();
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
  "disconnects a frontend on the socket transport that stops reading",
  async () => {
    // The inspected process dials this transport. It has no close frame.
    const { promise: accepted, resolve: accept } = Promise.withResolvers<net.Socket>();
    const server = net.createServer(accept).listen(0, "127.0.0.1");
    try {
      await new Promise(resolve => server.once("listening", resolve));
      const { port } = server.address() as net.AddressInfo;
      await using program = new Program([`--inspect=tcp://127.0.0.1:${port}`], logger);
      const stalled = RawFrontend.accept(await accepted);
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
        expect(program.running).toBe(true);
      } finally {
        stalled.close();
      }
    } finally {
      server.close();
    }
  },
  timeout,
);
