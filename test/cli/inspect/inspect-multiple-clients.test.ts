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
  #nextId = 1;
  #pending = new Map<number, { resolve: (message: any) => void; reject: (error: Error) => void }>();
  #waiters: (() => void)[] = [];
  #events: string[] = [];
  #closed = Promise.withResolvers<void>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method) {
        this.#events.push(message.method);
        if (message.method === "Console.messageAdded") this.consoleTexts.push(message.params?.message?.text ?? "");
        for (const waiter of this.#waiters.splice(0)) waiter();
        return;
      }
      // Every frontend gets every response, so an id this client did not send is not an error.
      this.#pending.get(message.id)?.resolve(message);
      this.#pending.delete(message.id);
    });
    ws.addEventListener("close", () => {
      const error = new Error("the inspector socket closed before the response");
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
      this.#closed.resolve();
    });
  }

  static async connect(url: URL): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
    });
    return new Client(ws);
  }

  send(method: string, params?: object): Promise<any> {
    const id = this.#nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    this.#pending.set(id, { resolve, reject });
    this.#ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  /** Resolves when `condition()` holds. It is checked again after each event. */
  async until(condition: () => boolean): Promise<void> {
    while (!condition()) await new Promise<void>(resolve => this.#waiters.push(resolve));
  }

  /** How many events with this method arrived. */
  count(method: string): number {
    return this.#events.filter(event => event === method).length;
  }

  close(): Promise<void> {
    this.#ws.close();
    return this.#closed.promise;
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

  const a = await Client.connect(url);
  await a.send("Inspector.enable");
  await a.send("Console.enable");
  await a.send("Runtime.enable");
  await a.send("Inspector.initialized");
  // The program runs from here. Its last statement logs "ready".
  await a.until(() => a.consoleTexts.includes("ready"));
  return { url, a };
}

// A debug build takes seconds to start, which the default 5 s does not cover.
const timeout = isASAN || isDebug ? 30_000 : undefined;

/** Attaches a second client that turns the debugger on and sets the breakpoint in `tick()`. */
async function attachDebugger(url: URL): Promise<Client> {
  const b = await Client.connect(url);
  await b.send("Debugger.enable");
  await b.send("Debugger.setBreakpointsActive", { active: true });
  const { result } = await b.send("Debugger.setBreakpointByUrl", breakpoint);
  expect(result?.locations).toHaveLength(1);
  return b;
}

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

    // One round-trip so B is registered as a FrontendChannel on the inspected
    // thread before it closes; a socket that never reached connectFrontend
    // wouldn't exercise the agent-teardown path on disconnect. B never enables
    // any domain, so this can't be the source of a later disable.
    const b = await Client.connect(url);
    await b.send("Runtime.evaluate", { expression: "0" });
    await b.close();

    // One round-trip so B's disconnect task (posted to the inspected thread before
    // this message was) has run before the probe below.
    await a.send("Runtime.evaluate", { expression: "0" });

    await a.send("Runtime.evaluate", { expression: "tick('after')" });
    expect(a.consoleTexts).toContain("tick after");

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
    const b = await attachDebugger(url);

    // The breakpoint works: the program stops in tick() until B resumes it.
    const first = a.send("Runtime.evaluate", { expression: "tick('one')" });
    await b.until(() => b.count("Debugger.paused") === 1);
    await b.send("Debugger.resume");
    await first;
    expect(a.consoleTexts).toContain("tick one");

    await b.close();
    // One round-trip so that B's disconnect task has run.
    await a.send("Runtime.evaluate", { expression: "0" });

    // Nobody is left to resume the program, so it must not stop in tick() again.
    const second = a.send("Runtime.evaluate", { expression: "tick('two')" });
    await Promise.race([second, a.until(() => a.count("Debugger.paused") > 1)]);
    expect({ pausedAgain: a.count("Debugger.paused") > 1, consoleTexts: a.consoleTexts }).toEqual({
      pausedAgain: false,
      consoleTexts: ["ready", "tick one", "tick two"],
    });

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
    const b = await attachDebugger(url);

    const evaluated = a.send("Runtime.evaluate", { expression: "tick('one')" });
    await b.until(() => b.count("Debugger.paused") === 1);
    // A did not turn the debugger on, so it does not resume the program. B leaves without a resume.
    await b.close();

    await evaluated;
    expect(a.consoleTexts).toEqual(["ready", "tick one"]);

    await a.close();
  },
  timeout,
);
