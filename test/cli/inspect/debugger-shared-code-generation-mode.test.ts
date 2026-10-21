// One unlinked function can be linked more than once: a `vm.Script` compiles once and every run
// links that compile (#38040), in the host and in each context, and a module that a ShadowRealm
// imports comes out of the same code cache as the host's. JSC generates the bytecode of a
// function for the code generation mode of the global object that asks for it. A debugger changes
// the mode of the global object it is attached to, which is the host's. The type profiler and
// the control flow profiler change the mode of the whole VM. So two linked copies of one function
// can ask for different bytecode:
//
// - a suspended generator or async function resumes in the registers of the bytecode that
//   suspended it, so bytecode of another mode reads the wrong ones and the process crashes,
// - bytecode generated for a global object without a debugger carries no op_debug, so a
//   breakpoint in the host is never reached,
// - bytecode with a profiler's instructions runs after the profiler is turned off, when the body
//   that started in it resumes, and needs the profiler.
//
// See oven-sh/WebKit#830 and oven-sh/WebKit#836.
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

type Inspector = {
  /** Resolves with the result of the reply. Rejects on an error reply, and when the socket closes first. */
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  pauses: unknown[];
  /** Closes the client's socket. Resolves when it has closed. */
  close: () => Promise<void>;
};

type Child = {
  /** Resolves with the match once the child has written `pattern` to stderr. */
  readUntil: (pattern: RegExp) => Promise<RegExpMatchArray>;
  /** Attaches an inspector client. */
  attachInspector: () => Promise<Inspector>;
  /** Attaches an inspector client and activates breakpoints, which makes JSC generate all code again. */
  attachDebugger: () => Promise<Inspector>;
  /** Lets the child continue past its `await Bun.stdin.stream().getReader().read()`. */
  resume: () => void;
  exited: Promise<number>;
};

// Runs `child.mjs` from `files` under `--inspect`. The child reports its progress on stderr and
// waits on stdin while the test talks to the inspector.
async function withChild(name: string, files: Record<string, string>, run: (child: Child) => Promise<void>) {
  using dir = tempDir(`inspect-shared-mode-${name}`, files);
  await using proc = spawn({
    cmd: [bunExe(), `--inspect=ws://127.0.0.1:0/shared-mode-${name}`, join(String(dir), "child.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let stderr = "";
  let ended = false;
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  const readUntil = async (pattern: RegExp) => {
    for (;;) {
      const match = stderr.match(pattern);
      if (match) return match;
      if (ended) throw new Error(`${pattern} not found in stderr: ${JSON.stringify(stderr)}`);
      const { value, done } = await reader.read();
      if (done) ended = true;
      else stderr += decoder.decode(value, { stream: true });
    }
  };

  const [, url] = await readUntil(/^\s*(ws:\/\/\S+)\s*$/m);
  const sockets: WebSocket[] = [];
  const attachInspector = async (): Promise<Inspector> => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const opened = Promise.withResolvers<void>();
    socket.addEventListener("open", () => opened.resolve(), { once: true });
    socket.addEventListener("error", event => opened.reject(new Error("WebSocket error", { cause: event })), {
      once: true,
    });
    await opened.promise;

    let nextId = 0;
    const replies = new Map<number, { method: string; resolve: (result: any) => void; reject: (e: Error) => void }>();
    const pauses: unknown[] = [];
    let closed: Error | undefined;
    const didClose = Promise.withResolvers<void>();
    const fail = (what: string) => {
      closed ??= new Error(`inspector socket ${what}, stderr: ${JSON.stringify(stderr)}`);
      for (const { reject } of replies.values()) reject(closed);
      replies.clear();
    };
    socket.addEventListener("error", () => fail("failed"));
    socket.addEventListener("close", event => {
      fail(`closed (${event.code})`);
      didClose.resolve();
    });
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolve, reject) => {
        if (closed) return reject(closed);
        const id = ++nextId;
        replies.set(id, { method, resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === "number") {
        const reply = replies.get(message.id);
        replies.delete(message.id);
        if (message.error) reply?.reject(new Error(`${reply.method}: ${JSON.stringify(message.error)}`));
        else reply?.resolve(message.result);
      } else if (message.method === "Debugger.paused") {
        pauses.push(message.params?.callFrames?.[0]?.location);
        // Not awaited: the child may exit before the reply is relayed.
        socket.send(JSON.stringify({ id: ++nextId, method: "Debugger.resume" }));
      }
    });
    await send("Inspector.enable");
    return {
      send,
      pauses,
      close: () => {
        socket.close();
        return didClose.promise;
      },
    };
  };
  try {
    await run({
      readUntil,
      attachInspector,
      attachDebugger: async () => {
        const inspector = await attachInspector();
        await Promise.all([
          inspector.send("Debugger.enable"),
          inspector.send("Debugger.setBreakpointsActive", { active: true }),
        ]);
        await inspector.send("Inspector.initialized");
        return inspector;
      },
      resume: () => {
        proc.stdin.write("go\n");
        proc.stdin.flush();
      },
      exited: proc.exited,
    });
  } finally {
    for (const socket of sockets) socket.close();
  }
}

// The last line of every child: the inspector connection would keep the event loop alive.
const exit = `process.exit(0);`;

test.concurrent("a suspended generator of a vm.Script resumes after a debugger activates", async () => {
  const files = {
    "child.mjs": `import vm from "node:vm";
const script = new vm.Script("(async function* gen(tag) { let n = 0; while (true) { const got = yield tag + n; n += got; } })");
const context = vm.createContext({});
const hostGenerator = script.runInThisContext()("h"); // made, never started
const contextGenerator = script.runInContext(context)("c");
await contextGenerator.next();                        // suspended at its first yield
process.stderr.write("<suspended>\\n");
await Bun.stdin.stream().getReader().read();          // the debugger activates meanwhile
const host = await hostGenerator.next();              // the host runs the body for the first time
const inContext = await contextGenerator.next(5);     // the context resumes
process.stderr.write("<result " + host.value + " " + inContext.value + ">\\n");
${exit}
`,
  };
  await withChild("vm-generator", files, async child => {
    await child.readUntil(/<suspended>/);
    await child.attachDebugger();
    child.resume();
    const [result, exitCode] = await Promise.all([child.readUntil(/<result [^>]*>/), child.exited]);
    expect(result[0]).toBe("<result h0 c5>");
    expect(exitCode).toBe(0);
  });
});

test.concurrent("a generator of a vm.Script resumes after the debugger is turned off again", async () => {
  const files = {
    "child.mjs": `import vm from "node:vm";
const script = new vm.Script("(async function* gen(tag) { let n = 0; while (true) { const got = yield tag + n; n += got; } })");
const context = vm.createContext({});
const hostGenerator = script.runInThisContext()("h"); // made, never started
const contextGenerator = script.runInContext(context)("c");
await contextGenerator.next();                        // suspended at its first yield
const stdin = Bun.stdin.stream().getReader();
process.stderr.write("<suspended>\\n");
await stdin.read();                                   // the debugger activates meanwhile
const inContext = await contextGenerator.next(5);     // the context resumes first, in code of its own kind
const host = await hostGenerator.next();              // the host starts with the debugger on
process.stderr.write("<first " + host.value + " " + inContext.value + ">\\n");
await stdin.read();                                   // breakpoints are turned off meanwhile
const hostAgain = await hostGenerator.next(7);        // the host resumes in code for the debugger
const inContextAgain = await contextGenerator.next(1);
process.stderr.write("<result " + hostAgain.value + " " + inContextAgain.value + ">\\n");
${exit}
`,
  };
  await withChild("vm-generator-off", files, async child => {
    await child.readUntil(/<suspended>/);
    const debug = await child.attachDebugger();
    child.resume();
    const first = await child.readUntil(/<first [^>]*>/);
    await debug.send("Debugger.setBreakpointsActive", { active: false });
    child.resume();
    const [result, exitCode] = await Promise.all([child.readUntil(/<result [^>]*>/), child.exited]);
    expect([first[0], result[0]]).toEqual(["<first h0 c5>", "<result h7 c6>"]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("a suspended generator of a module in a ShadowRealm resumes after a debugger activates", async () => {
  const files = {
    "shared.mjs": `async function* gen(tag) { let n = 0; while (true) { const got = yield tag + n; n += got; } }
let generator;
export function create(tag) { generator = gen(tag); }
export function next(value, done) { generator.next(value).then(result => done(String(result.value))); }
`,
    "child.mjs": `import { join } from "node:path";
import * as host from "./shared.mjs";
const realm = new ShadowRealm();
const shared = join(import.meta.dir, "shared.mjs");
const create = await realm.importValue(shared, "create");
const next = await realm.importValue(shared, "next");
const call = (fn, value) => new Promise(resolve => fn(value, resolve));
host.create("h");                                     // made, never started
create("r");
await call(next, undefined);                          // the realm's generator is suspended at its first yield
process.stderr.write("<suspended>\\n");
await Bun.stdin.stream().getReader().read();          // the debugger activates meanwhile
const inHost = await call(host.next, undefined);      // the host runs the body for the first time
const inRealm = await call(next, 5);                  // the realm resumes
process.stderr.write("<result " + inHost + " " + inRealm + ">\\n");
${exit}
`,
  };
  await withChild("realm-generator", files, async child => {
    await child.readUntil(/<suspended>/);
    await child.attachDebugger();
    child.resume();
    const [result, exitCode] = await Promise.all([child.readUntil(/<result [^>]*>/), child.exited]);
    expect(result[0]).toBe("<result h0 r5>");
    expect(exitCode).toBe(0);
  });
});

test.concurrent(
  "a breakpoint in a function of a vm.Script that a context ran first still pauses the host",
  async () => {
    const files = {
      "child.mjs": `import vm from "node:vm";
import { join } from "node:path";
const filename = join(import.meta.dir, "shared.js");
const script = new vm.Script("(function () {\\n  function twice(x) {\\n    const doubled = x * 2;\\n    return doubled;\\n  }\\n  return twice;\\n})()", { filename });
const context = vm.createContext({});
const inContext = script.runInContext(context);       // both link the one compile, before any debugger
const inHost = script.runInThisContext();
process.stderr.write("<linked " + filename + ">\\n");
await Bun.stdin.stream().getReader().read();          // the debugger activates and sets a breakpoint
process.stderr.write("<context " + inContext(1) + ">\\n"); // generates the body without debug hooks
process.stderr.write("<host " + inHost(21) + ">\\n");      // must still reach the breakpoint
${exit}
`,
    };
    await withChild("vm-breakpoint", files, async child => {
      const [, filename] = await child.readUntil(/<linked ([^>]*)>/);
      const debug = await child.attachDebugger();
      // Line 2 (zero-based) is "const doubled = x * 2;".
      const breakpoint = await debug.send("Debugger.setBreakpointByUrl", { url: filename, lineNumber: 2 });
      expect(breakpoint.breakpointId).toEqual(expect.any(String));
      child.resume();
      const [host, exitCode] = await Promise.all([child.readUntil(/<host [^>]*>/), child.exited]);
      expect(host[0]).toBe("<host 42>");
      expect(debug.pauses).toEqual([{ scriptId: expect.any(String), lineNumber: 2, columnNumber: 4 }]);
      expect(exitCode).toBe(0);
    });
  },
);

// One global object is enough. Two runs of a `vm.Script` link its one compile twice. The first
// copy's generator is suspended when the mode changes, and the second copy runs the body first.
const linkedTwice = [
  {
    change: "a debugger activates",
    // Debugger bytecode keeps every variable in the scope object.
    source: `(function* gen(tag) { let n = 0; while (true) { const got = yield tag + n; n += got; } })`,
    args: `"a", "b"`,
    beforeTheChange: `first.next()`,
    afterTheChange: `second.next(), first.next(5), second.next(3)`,
    turnOn: (child: Child) => child.attachDebugger(),
    expected: "<result a0 b0 a5 b3>",
  },
  {
    change: "the type profiler turns on",
    // The type profiler's instructions use x, y and z where the plain bytecode does not.
    source: `(function* gen(a) { let y = a; let x; x = ++y + (yield 1); let z = x * 2; const w = yield z; return x + y + z + w; })`,
    args: `10, 10`,
    beforeTheChange: `first.next()`,
    afterTheChange: `second.next(), first.next(5), second.next(5), first.next(7), second.next(7)`,
    turnOn: async (child: Child) => (await child.attachInspector()).send("Runtime.enableTypeProfiler"),
    expected: "<result 1 1 32 32 66 66>",
  },
  {
    change: "the control flow profiler turns on",
    // The finally block starts with `break`. The profiler's instruction there changes which registers the body saves.
    source: `(function* gen(tag) { let top = 0; sink(() => top); let keep = tag + 'K'; let tail; for (;;) { let outer = 1; sink(() => outer); try { { let inner = 2; sink(() => inner); } const got = yield keep; keep = keep + got; } finally { break; } } tail = tag + 'T'; const last = yield keep; return keep + '/' + last + '/' + tail; })`,
    args: `"a", "b"`,
    beforeTheChange: `first.next(), first.next(7)`,
    afterTheChange: `second.next(), first.next(9), second.next(5), second.next(6)`,
    turnOn: async (child: Child) => (await child.attachInspector()).send("Runtime.enableControlFlowProfiler"),
    expected: "<result aK aK7 bK aK7/9/aT bK5 bK5/6/bT>",
  },
];

test.concurrent.each(linkedTwice)(
  "a suspended generator of a vm.Script that ran twice resumes after $change",
  async ({ change, source, args, beforeTheChange, afterTheChange, turnOn, expected }) => {
    const files = {
      "child.mjs": `import vm from "node:vm";
globalThis.sink = f => f;
const script = new vm.Script(${JSON.stringify(source)});
const [first, second] = [${args}].map(arg => script.runInThisContext()(arg)); // each run links the one compile
const results = [${beforeTheChange}];               // suspended in bytecode of the first mode
process.stderr.write("<suspended>\\n");
await Bun.stdin.stream().getReader().read();          // the mode changes meanwhile
results.push(${afterTheChange});                      // the second copy runs the body first
process.stderr.write("<result " + results.map(result => result.value).join(" ") + ">\\n");
${exit}
`,
    };
    await withChild(`twice-${change.replaceAll(" ", "-")}`, files, async child => {
      await child.readUntil(/<suspended>/);
      await turnOn(child);
      child.resume();
      const [result, exitCode] = await Promise.all([child.readUntil(/<result [^>]*>/), child.exited]);
      expect(result[0]).toBe(expected);
      expect(exitCode).toBe(0);
    });
  },
);

// A generator and an async function start while a profiler is on. Their bytecode has the
// profiler's instructions, and they resume in it after the profiler is off.
const startsUnderAProfiler = {
  "child.mjs": `function* gen(a) { let y = a; let x; x = ++y + (yield 1); let z = x * 2; const w = yield z; return x + y + z + w; }
async function sum(tag, gate) { let n = 0; for (let i = 0; i < 2; i++) n += await gate.promise; return tag + n; }
const stdin = Bun.stdin.stream().getReader();
process.stderr.write("<ready>\\n");
await stdin.read();                                   // the profiler turns on meanwhile
const gate = Promise.withResolvers();
const generator = gen(10);
const out = [generator.next().value];                 // suspended at its first yield
const pending = sum("s", gate);                       // suspended at its first await
process.stderr.write("<started>\\n");
await stdin.read();                                   // the profiler turns off meanwhile
gate.resolve(3);
out.push(generator.next(5).value, generator.next(7).value, await pending);
process.stderr.write("<result " + out.join(" ") + ">\\n");
${exit}
`,
};

test.concurrent.each([
  ["type profiler", "Runtime.enableTypeProfiler", "Runtime.disableTypeProfiler"],
  ["control flow profiler", "Runtime.enableControlFlowProfiler", "Runtime.disableControlFlowProfiler"],
])("a generator that started under the %s resumes after it is turned off", async (profiler, enable, disable) => {
  await withChild(`off-${profiler.replaceAll(" ", "-")}`, startsUnderAProfiler, async child => {
    await child.readUntil(/<ready>/);
    const inspector = await child.attachInspector();
    await inspector.send(enable);
    child.resume();
    await child.readUntil(/<started>/);
    await inspector.send(disable);
    child.resume();
    const [result, exitCode] = await Promise.all([child.readUntil(/<result [^>]*>/), child.exited]);
    expect(result[0]).toBe("<result 1 32 66 s6>");
    expect(exitCode).toBe(0);
  });
});

test.concurrent(
  "a generator that started under the type profiler resumes after the inspector client is gone",
  async () => {
    await withChild("type-profiler-disconnect", startsUnderAProfiler, async child => {
      await child.readUntil(/<ready>/);
      const inspector = await child.attachInspector();
      await inspector.send("Runtime.enableTypeProfiler");
      child.resume();
      await child.readUntil(/<started>/);
      // JSC turns the type profiler off when its last client disconnects. The child does that on its
      // own thread, so ask until it has: with the profiler off there is no type information.
      await inspector.close();
      for (let isOff = false; !isOff;) {
        const probe = await child.attachInspector();
        isOff = await probe.send("Runtime.getRuntimeTypesForVariablesAtOffsets", { locations: [] }).then(
          () => false,
          () => true,
        );
        await probe.close();
      }
      child.resume();
      const [result, exitCode] = await Promise.all([child.readUntil(/<result [^>]*>/), child.exited]);
      expect(result[0]).toBe("<result 1 32 66 s6>");
      expect(exitCode).toBe(0);
    });
  },
);
