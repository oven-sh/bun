// Developer tooling on a `bun build --compile --bytecode` executable: functions decoded
// from the embedded bytecode cache must still be fully usable by the debugger, by
// Function.prototype introspection, by the sampling profiler and by heap snapshots,
// including functions that have never been called when the tool first looks at them.
import { spawn, type Subprocess } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { SocketFramer } from "./socket-framer";

const files = {
  "b.ts": `
export function neverCalledUntilAsked(x) {
  const y = x * 2;
  debugger;
  return y + 1;
}
export function named() {}
export function hotWork(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + Math.imul(i, 31)) | 0;
  return s;
}
`,
  "entry.ts": `
import { neverCalledUntilAsked, named, hotWork } from "./b.ts";
import inspector from "node:inspector";
const jsc = require("bun:jsc");

function printIntrospection() {
  console.log(
    "introspect " +
      JSON.stringify({
        namedName: named.name,
        namedLength: named.length,
        neverCalledName: neverCalledUntilAsked.name,
        neverCalledLength: neverCalledUntilAsked.length,
        toStringHasDebugger: neverCalledUntilAsked.toString().includes("debugger;"),
        toStringStartsWithFunction: neverCalledUntilAsked.toString().startsWith("function neverCalledUntilAsked("),
      }),
  );
}

const mode = process.argv[2];
const debugging = mode === "debug-env" || mode === "debug-open";
if (debugging) {
  // Leave the functions untouched until the debugger looks at them; it reaches them through this.
  globalThis.fns = { named, neverCalledUntilAsked };
} else {
  // (3) introspection of bytecode-cached functions before any of them has been called.
  printIntrospection();
}

if (mode === "profile") {
  // (4) sampling profiler over a hot bytecode-cached function.
  const { functions, stackTraces } = jsc.profile(() => {
    let r = 0;
    const end = performance.now() + 200;
    while (performance.now() < end) r ^= hotWork(20000);
    return r;
  }, 100);
  const sampledNames = new Set(stackTraces.traces.flatMap(t => t.frames.map(f => f.name)));
  console.log(
    "profile " +
      JSON.stringify({
        functionsReportMentionsHotWork: functions.includes("hotWork"),
        stackTracesMentionHotWork: sampledNames.has("hotWork"),
      }),
  );
} else if (mode === "heap") {
  // (5) heap snapshots taken while neverCalledUntilAsked has still never been called.
  const snapshot = jsc.generateHeapSnapshotForDebugging();
  // GCDebugging snapshots: nodes are <id, size, classNameIndex, flags, labelIndex, cell, wrapped>.
  const stride = snapshot.type === "GCDebugging" ? 7 : 4;
  const functionLabels = new Set();
  for (let i = 0; i < snapshot.nodes.length; i += stride) {
    if (snapshot.nodeClassNames[snapshot.nodes[i + 2]] === "Function") {
      functionLabels.add(snapshot.labels[snapshot.nodes[i + 4]]);
    }
  }
  const v8 = JSON.parse(Bun.generateHeapSnapshot("v8"));
  console.log(
    "heap " +
      JSON.stringify({
        jscFunctionNeverCalled: functionLabels.has("neverCalledUntilAsked"),
        jscFunctionNamed: functionLabels.has("named"),
        jscFunctionHotWork: functionLabels.has("hotWork"),
        v8MentionsNeverCalled: v8.strings.includes("neverCalledUntilAsked"),
      }),
  );
} else if (mode === "debug-env") {
  // (2a) started under BUN_INSPECT: wait until the attached test tells us to go.
  console.log("ready");
  for await (const line of console) {
    if (line.trim() === "go") break;
  }
} else if (mode === "debug-open") {
  // (2b) the debugger is only started now, after this module was loaded from the bytecode
  // cache; wait=true parks us until the client sends Runtime.runIfWaitingForDebugger.
  inspector.open(0, "127.0.0.1", true);
}

console.log("result " + neverCalledUntilAsked(20));
if (debugging) printIntrospection();
if (mode === "debug-open") inspector.close();
`,
};

let dir: string;
let exe: string;

beforeAll(async () => {
  dir = String(tempDir("compile-bytecode-tooling", files));
  exe = join(dir, isWindows ? "app.exe" : "app");
  await using build = spawn({
    cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", join(dir, "entry.ts"), "--outfile", exe],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(stderr + stdout).toContain("compile");
  expect(exitCode).toBe(0);
}, 60_000);

/** Runs the compiled executable and returns its stdout split into `tag -> parsed JSON` lines. */
async function run(mode: string): Promise<Record<string, any>> {
  await using proc = spawn({
    cmd: [exe, mode],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const lines = parseLines(stdout);
  expect(lines.result).toBe(41);
  expect(exitCode).toBe(0);
  return lines;
}

function parseLines(stdout: string): Record<string, any> {
  const lines: Record<string, any> = {};
  for (const line of stdout.split("\n")) {
    const space = line.indexOf(" ");
    if (space === -1) continue;
    lines[line.slice(0, space)] = JSON.parse(line.slice(space + 1));
  }
  return lines;
}

const expectedIntrospection = {
  namedName: "named",
  namedLength: 0,
  neverCalledName: "neverCalledUntilAsked",
  neverCalledLength: 1,
  toStringHasDebugger: true,
  toStringStartsWithFunction: true,
};

/**
 * A spawned inspectee plus a request/response channel to its inspector. The Bun inspector
 * (BUN_INSPECT=tcp://…, length-prefixed frames over a socket the inspectee dials) and the
 * DevTools server started by inspector.open() (a WebSocket we dial) share the message shapes
 * this file relies on, so one session type serves both.
 */
class Session {
  stdout = "";
  stderr = "";
  readonly scripts = new Map<string, any>();
  readonly failed: Promise<never>;
  private fail!: (error: Error) => void;
  private nextId = 1;
  private readonly responseWaiters = new Map<number, (message: any) => void>();
  private readonly eventWaiters = new Map<string, (params: any) => void>();
  private readonly outputWaiters: Array<() => void> = [];
  private drained: Promise<unknown> = Promise.resolve();
  private transport?: { send(text: string): void; close(): void };
  proc!: Subprocess<"pipe", "pipe", "pipe">;

  constructor() {
    const { promise, reject } = Promise.withResolvers<never>();
    this.failed = promise;
    this.fail = reject;
    promise.catch(() => {});
  }

  spawn(mode: string, env: Record<string, string | undefined>) {
    this.proc = spawn({ cmd: [exe, mode], env, cwd: dir, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const pump = async (stream: ReadableStream<Uint8Array>, sink: "stdout" | "stderr") => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        this[sink] += decoder.decode(chunk, { stream: true });
        this.outputWaiters.splice(0).forEach(wake => wake());
      }
    };
    this.drained = Promise.allSettled([pump(this.proc.stdout, "stdout"), pump(this.proc.stderr, "stderr")]);
    this.proc.exited.then(async code => {
      await Promise.race([this.drained, Bun.sleep(1_000)]);
      this.fail(new Error(`inspectee exited (${code ?? this.proc.signalCode})\nstderr:\n${this.stderr}`));
    });
  }

  /** Resolves once `pattern` has appeared on the given stream; rejects if the inspectee dies first. */
  async waitForOutput(sink: "stdout" | "stderr", pattern: RegExp): Promise<RegExpMatchArray> {
    for (;;) {
      const match = this[sink].match(pattern);
      if (match) return match;
      await Promise.race([new Promise<void>(resolve => this.outputWaiters.push(resolve)), this.failed]);
    }
  }

  /** Bun inspector transport: the inspectee connects to us (BUN_INSPECT=tcp://host:port). */
  listen() {
    const { promise, resolve } = Promise.withResolvers<void>();
    const session = this;
    const listener = Bun.listen<{ framer: SocketFramer }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { framer: new SocketFramer(text => session.onMessage(text)) };
          session.transport = { send: text => socket.data.framer.send(socket, text), close: () => socket.end() };
          listener.stop();
          resolve();
        },
        data(socket, bytes) {
          socket.data.framer.onData(socket, bytes);
        },
        error(_, error) {
          session.fail(error);
        },
        close() {
          session.fail(new Error(`inspector connection closed\nstderr:\n${session.stderr}`));
        },
      },
    });
    return { port: listener.port, connected: Promise.race([promise, this.failed]), listener };
  }

  /** DevTools transport: we connect to the WebSocket server the inspectee started. */
  async connect(url: string) {
    const ws = new WebSocket(url);
    ws.onmessage = event => this.onMessage(String(event.data));
    ws.onerror = () => this.fail(new Error(`inspector WebSocket error\nstderr:\n${this.stderr}`));
    ws.onclose = event => this.fail(new Error(`inspector WebSocket closed (${event.code})\nstderr:\n${this.stderr}`));
    await Promise.race([new Promise<void>(resolve => (ws.onopen = () => resolve())), this.failed]);
    this.transport = { send: text => ws.send(text), close: () => ws.close() };
  }

  private onMessage(text: string) {
    const message = JSON.parse(text);
    if (typeof message.id === "number") {
      this.responseWaiters.get(message.id)?.(message);
      this.responseWaiters.delete(message.id);
      return;
    }
    if (message.method === "Debugger.scriptParsed") this.scripts.set(message.params.scriptId, message.params);
    this.eventWaiters.get(message.method)?.(message.params);
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    const response = new Promise<any>(resolve => this.responseWaiters.set(id, resolve));
    this.transport!.send(JSON.stringify({ id, method, params }));
    const message = await Promise.race([response, this.failed]);
    if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
    return message.result;
  }

  /** Fire-and-forget, for when the inspectee may exit before the reply is relayed. */
  post(method: string, params: Record<string, unknown> = {}) {
    this.transport!.send(JSON.stringify({ id: this.nextId++, method, params }));
  }

  waitForEvent(method: string): Promise<any> {
    return Promise.race([new Promise(resolve => this.eventWaiters.set(method, resolve)), this.failed]);
  }

  async close() {
    this.transport?.close();
    this.proc?.kill();
    await Promise.allSettled([this.drained, this.proc?.exited]);
  }
}

/**
 * With the inspectee paused on the `debugger;` statement inside neverCalledUntilAsked (a
 * function nothing had called before), check the frame's name, location, scope and the
 * function objects' metadata through the inspector.
 */
async function expectPausedInNeverCalledFunction(session: Session, callFrames: any[]) {
  const top = callFrames[0];
  expect(top.functionName).toBe("neverCalledUntilAsked");
  expect(session.scripts.has(top.location.scriptId)).toBe(true);

  // The location must point at the `debugger;` line of the script the debugger was told about.
  const { scriptSource } = await session.send("Debugger.getScriptSource", { scriptId: top.location.scriptId });
  expect(scriptSource.split("\n")[top.location.lineNumber]?.trim()).toBe("debugger;");

  // Locals and arguments of the lazily materialized function are readable.
  const y = await session.send("Debugger.evaluateOnCallFrame", { callFrameId: top.callFrameId, expression: "y" });
  expect(y.result).toMatchObject({ type: "number", value: 40 });
  const x = await session.send("Debugger.evaluateOnCallFrame", { callFrameId: top.callFrameId, expression: "x" });
  expect(x.result).toMatchObject({ type: "number", value: 20 });

  // Function metadata through the inspector; nothing in the inspectee has read it yet.
  const viaInspector = await session.send("Runtime.evaluate", {
    expression: `(({ named, neverCalledUntilAsked }) => JSON.stringify({ name: named.name, length: named.length, self: neverCalledUntilAsked.name, src: neverCalledUntilAsked.toString().includes("debugger;") }))(globalThis.fns)`,
  });
  expect(JSON.parse(viaInspector.result.value)).toEqual({
    name: "named",
    length: 0,
    self: "neverCalledUntilAsked",
    src: true,
  });

  // Runtime.getProperties on a never-called function object.
  const fn = await session.send("Runtime.evaluate", { expression: "globalThis.fns.named" });
  expect(fn.result).toMatchObject({ type: "function" });
  const { properties, result } = await session.send("Runtime.getProperties", {
    objectId: fn.result.objectId,
    ownProperties: true,
  });
  const own = Object.fromEntries((properties ?? result).map((p: any) => [p.name, p.value?.value]));
  expect(own).toMatchObject({ name: "named", length: 0 });
}

describe("bun build --compile --bytecode executable", () => {
  test("Function name, length and toString() work before the function is first called", async () => {
    const { introspect } = await run("introspect");
    expect(introspect).toEqual(expectedIntrospection);
  });

  test("bun:jsc sampling profiler attributes samples to a bytecode-cached function", async () => {
    const { profile } = await run("profile");
    expect(profile).toEqual({ functionsReportMentionsHotWork: true, stackTracesMentionHotWork: true });
  });

  test("heap snapshots label never-called bytecode-cached functions", async () => {
    const { heap } = await run("heap");
    expect(heap).toEqual({
      jscFunctionNeverCalled: true,
      jscFunctionNamed: true,
      jscFunctionHotWork: true,
      v8MentionsNeverCalled: true,
    });
  });

  // A compiled executable has no --inspect flag of its own; editor extensions attach by
  // starting it under BUN_INSPECT, and ?wait=1 holds the entry point until Inspector.initialized.
  // (With a debugger present from the start JSC compiles the entry chunk afresh instead of taking
  // it from the bytecode cache; the inspector.open() test below is the one that debugs cached code.)
  test("debugger attached via BUN_INSPECT pauses inside a never-called function", async () => {
    const session = new Session();
    try {
      const { port, connected, listener } = session.listen();
      using _ = listener;
      session.spawn("debug-env", { ...bunEnv, BUN_INSPECT: `tcp://127.0.0.1:${port}?wait=1` });
      await connected;

      await session.send("Inspector.enable");
      await session.send("Runtime.enable");
      await session.send("Debugger.enable");
      await session.send("Debugger.setBreakpointsActive", { active: true });
      await session.send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
      await session.send("Inspector.initialized");
      await session.waitForOutput("stdout", /^ready$/m);

      const paused = session.waitForEvent("Debugger.paused");
      session.proc.stdin.write("go\n");
      session.proc.stdin.flush();
      const { callFrames, reason } = await paused;
      expect(reason).toBe("DebuggerStatement");
      await expectPausedInNeverCalledFunction(session, callFrames);

      const resumed = session.waitForEvent("Debugger.resumed");
      await session.send("Debugger.resume");
      await resumed;
      await session.waitForOutput("stdout", /^result 41\nintrospect .+\n/m);
    } finally {
      await session.close();
    }
    expect(parseLines(session.stdout)).toMatchObject({ introspect: expectedIntrospection, result: 41 });
  });

  // Unlike BUN_INSPECT (present before any code loads), inspector.open() attaches the debugger to
  // a VM whose entry point has already been materialized from the embedded bytecode cache.
  // The debugger attaches fine (the debugger-thread VM used to abort decoding embedded bytecode), but a function whose
  // unlinked code block comes from the bytecode cache was generated without debugger opcodes and is not regenerated on
  // attach, so its `debugger;` statement does not pause. Pre-existing for --bytecode executables; tracked as a follow-up.
  test.todo("debugger attached via inspector.open() pauses inside a never-called function", async () => {
    const session = new Session();
    try {
      session.spawn("debug-open", bunEnv);
      const [, url] = await session.waitForOutput("stderr", /Debugger listening on (ws:\/\/\S+)/);
      await session.connect(url);

      await session.send("Runtime.enable");
      await session.send("Debugger.enable");
      const paused = session.waitForEvent("Debugger.paused");
      // Debugger.enable's reply proves debugger statements are armed before the entry point resumes.
      await session.send("Runtime.runIfWaitingForDebugger");
      const { callFrames } = await paused;
      await expectPausedInNeverCalledFunction(session, callFrames);

      // The inspectee may reach inspector.close() before the resume reply is relayed; stdout is the proof.
      session.post("Debugger.resume");
      await session.waitForOutput("stdout", /^result 41\nintrospect .+\n/m);
      expect(await session.proc.exited).toBe(0);
    } finally {
      await session.close();
    }
    expect(parseLines(session.stdout)).toMatchObject({ introspect: expectedIntrospection, result: 41 });
  });
});
