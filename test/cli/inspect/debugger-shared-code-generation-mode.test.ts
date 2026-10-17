// Two global objects of one VM can link the same unlinked function: a `vm.Script` compiles once
// and every context links that compile (#38040), and a module that a ShadowRealm imports comes
// out of the same code cache as the host's. JSC generates the bytecode of a function for the
// code generation mode of the global object that asks for it, and a debugger only changes the
// mode of the global object it is attached to, which is the host's. The code of one global
// object must not be given to the other:
//
// - a suspended async generator resumes in the registers of the code that suspended it, so the
//   other mode's code reads the wrong ones and the process crashes with SIGSEGV,
// - code generated for a global object without a debugger carries no op_debug, so a breakpoint
//   in the host is never reached.
//
// See oven-sh/WebKit#830.
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

type Child = {
  /** Resolves with the match once the child has written `pattern` to stderr. */
  readUntil: (pattern: RegExp) => Promise<RegExpMatchArray>;
  /** Attaches an inspector client and activates breakpoints, which makes JSC generate all code again. */
  attachDebugger: () => Promise<{
    /** Resolves with the result of the reply. Rejects on an error reply, and when the socket closes first. */
    send: (method: string, params?: Record<string, unknown>) => Promise<any>;
    pauses: unknown[];
  }>;
  /** Lets the child continue past its `await Bun.stdin.stream().getReader().read()`. */
  resume: () => void;
  exited: Promise<number>;
};

// Runs `child.mjs` from `files` under `--inspect`. The child reports its progress on stderr and
// waits on stdin while the test attaches the debugger.
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
  let ws: WebSocket | undefined;
  try {
    await run({
      readUntil,
      attachDebugger: async () => {
        const socket = (ws = new WebSocket(url));
        const opened = Promise.withResolvers<void>();
        socket.addEventListener("open", () => opened.resolve(), { once: true });
        socket.addEventListener("error", event => opened.reject(new Error("WebSocket error", { cause: event })), {
          once: true,
        });
        await opened.promise;

        let nextId = 0;
        const replies = new Map<
          number,
          { method: string; resolve: (result: any) => void; reject: (e: Error) => void }
        >();
        const pauses: unknown[] = [];
        let closed: Error | undefined;
        const fail = (what: string) => {
          closed ??= new Error(`inspector socket ${what}, stderr: ${JSON.stringify(stderr)}`);
          for (const { reject } of replies.values()) reject(closed);
          replies.clear();
        };
        socket.addEventListener("error", () => fail("failed"));
        socket.addEventListener("close", event => fail(`closed (${event.code})`));
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
        await Promise.all([
          send("Inspector.enable"),
          send("Debugger.enable"),
          send("Debugger.setBreakpointsActive", { active: true }),
        ]);
        await send("Inspector.initialized");
        return { send, pauses };
      },
      resume: () => {
        proc.stdin.write("go\n");
        proc.stdin.flush();
      },
      exited: proc.exited,
    });
  } finally {
    ws?.close();
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
