import { spawn, type Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { WebSocket } from "ws";

// Runtime.evaluate goes through JSC's InjectedScript, which has missing
// RELEASE_AND_RETURN wraps in the prebuilt WebKit that abort the inspectee
// under validateExceptionChecks.
const { BUN_JSC_validateExceptionChecks, BUN_JSC_dumpSimulatedThrows, ...inspecteeEnv } = bunEnv;

// `tick()` logs one line. The breakpoint of the tests goes on its `console.log`.
const fixture = `function tick(tag) {
  console.log("tick " + tag);
}
globalThis.tick = tick;
setInterval(() => {}, 1e9);
console.log("ready");
`;
const breakpoint = { lineNumber: 1, urlRegex: "fixture\\.js$" };

/** A frontend that speaks the JSC inspector protocol over the `--inspect` WebSocket. */
class Client {
  /** The text of each `Console.messageAdded` event. */
  readonly consoleTexts: string[] = [];

  #ws: WebSocket;
  #nextId: number;
  #pending = new Map<number, { resolve: (message: any) => void; reject: (error: Error) => void }>();
  #waiters: (() => void)[] = [];
  #events: string[] = [];
  #closed = Promise.withResolvers<void>();
  #isClosed = false;

  private constructor(ws: WebSocket, firstId: number) {
    this.#ws = ws;
    this.#nextId = firstId;
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method) {
        this.#events.push(message.method);
        if (message.method === "Console.messageAdded") this.consoleTexts.push(message.params?.message?.text ?? "");
        this.#wake();
        return;
      }
      // Every frontend gets every response, so an id this client did not send is not an error.
      this.#pending.get(message.id)?.resolve(message);
      this.#pending.delete(message.id);
    });
    ws.addEventListener("close", () => {
      this.#isClosed = true;
      const error = new Error("the inspector socket closed before the response");
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
      this.#closed.resolve();
      this.#wake();
    });
  }

  /** `firstId`: each client of a test counts its command ids in a range of its own. */
  static async connect(url: URL, firstId: number): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
    });
    return new Client(ws, firstId);
  }

  /** Resolves with the response, also when it is an error response. */
  send(method: string, params?: object): Promise<any> {
    const id = this.#nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    this.#pending.set(id, { resolve, reject });
    this.#ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  /** Resolves when `condition()` holds. It is checked again after each event. Rejects if the socket closes first. */
  async until(condition: () => boolean): Promise<void> {
    while (!condition()) {
      if (this.#isClosed) throw new Error("the inspector socket closed before the event");
      await new Promise<void>(resolve => this.#waiters.push(resolve));
    }
  }

  /** How many events with this method arrived. */
  count(method: string): number {
    return this.#events.filter(event => event === method).length;
  }

  close(): Promise<void> {
    this.#ws.close();
    return this.#closed.promise;
  }

  #wake(): void {
    for (const waiter of this.#waiters.splice(0)) waiter();
  }
}

/** Starts the fixture. It waits for a frontend before it runs. */
function startFixture(dir: string): Subprocess<"ignore", "ignore", "pipe"> {
  return spawn({
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", join(dir, "fixture.js")],
    env: inspecteeEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
}

/** Attaches the first client and lets the program run to its end. */
async function attach(proc: Subprocess<"ignore", "ignore", "pipe">): Promise<{ url: URL; a: Client }> {
  let url: URL | undefined;
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    stderr += decoder.decode(chunk);
    for (const line of stderr.split("\n")) {
      try {
        const candidate = new URL(line);
        if (candidate.protocol.includes("ws")) url = candidate;
      } catch {}
    }
    if (url || stderr.includes("Listening:")) break;
  }
  if (!url) throw new Error("Unable to find inspector URL:\n" + stderr);

  const a = await Client.connect(url, 1);
  await a.send("Inspector.enable");
  await a.send("Console.enable");
  await a.send("Runtime.enable");
  await a.send("Inspector.initialized");
  // The program runs from here. Its last statement logs "ready".
  await a.until(() => a.consoleTexts.includes("ready"));
  return { url, a };
}

const ok = { id: expect.any(Number), result: {} };

/** Turns the debugger on for this client. */
async function enableDebugger(client: Client): Promise<void> {
  // JSC answers the second `Debugger.enable` with an error. The debugger is on for both clients.
  await client.send("Debugger.enable");
  expect(await client.send("Debugger.setBreakpointsActive", { active: true })).toEqual(ok);
}

/** Sets the breakpoint in `tick()`. */
async function setBreakpoint(client: Client): Promise<void> {
  const { result } = await client.send("Debugger.setBreakpointByUrl", breakpoint);
  expect(result?.locations).toHaveLength(1);
}

// A debug build takes seconds to start, which the default 5 s does not cover.
const timeout = isASAN || isDebug ? 90_000 : undefined;

// JSGlobalObjectInspectorController::disconnectFrontend tears down every agent
// (willDestroyFrontendAndBackend) before its last-frontend check, so without
// Bun's per-connection routing a second client's close would silently disable
// Console/Runtime/Debugger for the still-attached first client.
test(
  "a second --inspect client disconnecting does not disable inspector agents for the first",
  async () => {
    using dir = tempDir("inspect-second-client", { "fixture.js": fixture });
    await using proc = startFixture(String(dir));
    const { url, a } = await attach(proc);

    // The Console.messageAdded event for a console.log inside Runtime.evaluate is
    // emitted synchronously during dispatch, so it arrives on this socket before
    // the evaluate response does.
    await a.send("Runtime.evaluate", { expression: "tick('before')" });
    expect(a.consoleTexts).toContain("tick before");

    // B enables the domains that A has, and one that only B has. The round trips register B as a
    // FrontendChannel on the inspected thread before it closes: a socket that never reached
    // connectFrontend would not exercise the disconnect path.
    const b = await Client.connect(url, 1000);
    expect(await b.send("Console.enable")).toEqual(ok);
    expect(await b.send("Runtime.enable")).toEqual(ok);
    expect(await b.send("Heap.enable")).toEqual(ok);
    await b.close();

    // One round-trip so B's disconnect task (posted to the inspected thread before
    // this message was) has run before the probe below.
    await a.send("Runtime.evaluate", { expression: "0" });

    // What both clients had enabled stays on for A.
    await a.send("Runtime.evaluate", { expression: "tick('after')" });
    expect(a.consoleTexts).toContain("tick after");
    // What only B had enabled went with B: JSC refuses to disable it a second time.
    expect(await a.send("Heap.disable")).toEqual({
      id: expect.any(Number),
      error: expect.objectContaining({ message: expect.stringContaining("Heap domain already disabled") }),
    });

    expect(proc.exitCode).toBeNull();
    await a.close();
  },
  timeout,
);

// JSC has one debugger state for every frontend. What a client that left had turned on
// must not stop the program when the client that stays never turned the debugger on.
test(
  "a debugger client that leaves takes its breakpoints with it, and the other client keeps its events",
  async () => {
    using dir = tempDir("inspect-debugger-leaves", { "fixture.js": fixture });
    await using proc = startFixture(String(dir));
    const { url, a } = await attach(proc);
    const b = await Client.connect(url, 1000);
    await enableDebugger(b);
    await setBreakpoint(b);

    // The breakpoint works: the program stops in tick() until B resumes it.
    const first = a.send("Runtime.evaluate", { expression: "tick('one')" });
    await b.until(() => b.count("Debugger.paused") === 1);
    expect(await b.send("Debugger.resume")).toEqual(ok);
    await first;
    expect(a.consoleTexts).toEqual(["ready", "tick one"]);

    await b.close();
    // One round-trip so that B's disconnect task has run.
    await a.send("Runtime.evaluate", { expression: "0" });

    // Nobody is left to resume the program, so it must not stop in tick() again.
    const second = a.send("Runtime.evaluate", { expression: "tick('two')" });
    await Promise.race([second, a.until(() => a.count("Debugger.paused") > 1).catch(() => {})]);
    expect({ pausedAgain: a.count("Debugger.paused") > 1, consoleTexts: a.consoleTexts }).toEqual({
      pausedAgain: false,
      consoleTexts: ["ready", "tick one", "tick two"],
    });

    expect(proc.exitCode).toBeNull();
    await a.close();
  },
  timeout,
);

test(
  "the program continues when its debugger client leaves during a pause and another client stays",
  async () => {
    using dir = tempDir("inspect-debugger-leaves-paused", { "fixture.js": fixture });
    await using proc = startFixture(String(dir));
    const { url, a } = await attach(proc);
    const b = await Client.connect(url, 1000);
    await enableDebugger(b);
    await setBreakpoint(b);
    // Only a command turns the debugger off. This text in an expression does not.
    await b.send("Runtime.evaluate", { expression: "Debugger.disable" });

    const evaluated = a.send("Runtime.evaluate", { expression: "tick('one')" });
    await b.until(() => b.count("Debugger.paused") === 1);
    // The program waits for B: it answers B, and the line after the breakpoint is not logged.
    expect(await b.send("Runtime.evaluate", { expression: "1 + 1" })).toEqual({
      id: expect.any(Number),
      result: expect.objectContaining({ result: expect.objectContaining({ value: 2 }) }),
    });
    expect(a.consoleTexts).toEqual(["ready"]);

    // A did not turn the debugger on, so it does not resume the program. B leaves without a resume.
    await b.close();
    await evaluated;
    expect(a.consoleTexts).toEqual(["ready", "tick one"]);

    // The debugger went with B: after B's disconnect task, tick() does not stop again.
    await a.send("Runtime.evaluate", { expression: "0" });
    const second = a.send("Runtime.evaluate", { expression: "tick('two')" });
    await Promise.race([second, a.until(() => a.count("Debugger.paused") > 1).catch(() => {})]);
    expect({ pausedAgain: a.count("Debugger.paused") > 1, consoleTexts: a.consoleTexts }).toEqual({
      pausedAgain: false,
      consoleTexts: ["ready", "tick one", "tick two"],
    });

    expect(proc.exitCode).toBeNull();
    await a.close();
  },
  timeout,
);

test(
  "a debugger client keeps the debugger and its breakpoint when another debugger client leaves",
  async () => {
    using dir = tempDir("inspect-two-debuggers", { "fixture.js": fixture });
    await using proc = startFixture(String(dir));
    const { url, a } = await attach(proc);
    await enableDebugger(a);
    await setBreakpoint(a);
    const b = await Client.connect(url, 1000);
    await enableDebugger(b);
    await b.close();
    // One round-trip so that B's disconnect task has run.
    await a.send("Runtime.evaluate", { expression: "0" });

    // A's breakpoint still stops the program, and A resumes it.
    const evaluated = a.send("Runtime.evaluate", { expression: "tick('one')" });
    await Promise.race([evaluated, a.until(() => a.count("Debugger.paused") === 1).catch(() => {})]);
    expect({ paused: a.count("Debugger.paused"), consoleTexts: a.consoleTexts }).toEqual({
      paused: 1,
      consoleTexts: ["ready"],
    });
    expect(await a.send("Debugger.resume")).toEqual(ok);
    await evaluated;
    expect(a.consoleTexts).toEqual(["ready", "tick one"]);

    expect(proc.exitCode).toBeNull();
    await a.close();
  },
  timeout,
);
