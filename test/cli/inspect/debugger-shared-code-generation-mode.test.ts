// A `vm.Script` compiles once and every context links that one compile (#38040), so the host
// global object and a `vm` context share the unlinked executable of each function in it. JSC
// generates the bytecode of a function for the code generation mode of the global object that
// asks for it first, and a debugger only changes the mode of the global object it is attached
// to, which is the host's. The code of one global object must not be given to the other:
//
// - a suspended async generator resumes in the registers of the code that suspended it, so the
//   other mode's code reads the wrong ones and the process crashes with SIGSEGV,
// - code generated for a global object without a debugger carries no op_debug, so a breakpoint
//   in the host is never reached.
//
// See oven-sh/WebKit#830.
import { spawn, type Subprocess } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

type Client = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  pauses: unknown[];
  close: () => void;
};

// Reads the inspector URL the child prints, then the lines it writes to report its progress.
function readLines(proc: Subprocess<"pipe", "pipe", "pipe">) {
  let text = "";
  let ended = false;
  const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  return async function readUntil(pattern: RegExp): Promise<RegExpMatchArray> {
    for (;;) {
      const match = text.match(pattern);
      if (match) return match;
      if (ended) throw new Error(`${pattern} not found in stderr: ${JSON.stringify(text)}`);
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        continue;
      }
      text += decoder.decode(value, { stream: true });
    }
  };
}

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const opened = Promise.withResolvers<void>();
  ws.addEventListener("open", () => opened.resolve(), { once: true });
  ws.addEventListener("error", event => opened.reject(new Error("WebSocket error", { cause: event })), { once: true });
  await opened.promise;

  let nextId = 0;
  const replies = new Map<number, (value: any) => void>();
  const pauses: unknown[] = [];
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>(resolve => {
      const id = ++nextId;
      replies.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === "number") replies.get(message.id)?.(message);
    else if (message.method === "Debugger.paused") {
      pauses.push(message.params?.callFrames?.[0]?.location);
      send("Debugger.resume");
    }
  });
  await Promise.all([send("Inspector.enable"), send("Debugger.enable"), send("Debugger.setBreakpointsActive", { active: true })]);
  await send("Inspector.initialized");
  return { send, pauses, close: () => ws.close() };
}

test.concurrent("a suspended generator of a vm.Script resumes after a debugger activates", async () => {
  using dir = tempDir("inspect-shared-mode-generator", {
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
process.exit(0);                                      // the inspector connection keeps the loop alive
`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--inspect=ws://127.0.0.1:0/shared-mode-generator", join(String(dir), "child.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const readUntil = readLines(proc);
  const [, url] = await readUntil(/^\s*(ws:\/\/\S+)\s*$/m);
  await readUntil(/<suspended>/);

  const client = await connect(url);
  proc.stdin.write("go\n");
  proc.stdin.flush();

  const [result, exitCode] = await Promise.all([readUntil(/<result [^>]*>/), proc.exited]);
  client.close();
  expect(result[0]).toBe("<result h0 c5>");
  expect(exitCode).toBe(0);
});

test.concurrent("a breakpoint in a function of a vm.Script that a context ran first still pauses the host", async () => {
  using dir = tempDir("inspect-shared-mode-breakpoint", {
    "child.mjs": `import vm from "node:vm";
import { join } from "node:path";
const filename = join(import.meta.dir, "shared.js");
const script = new vm.Script("(function () {\\n  function twice(x) {\\n    const doubled = x * 2;\\n    return doubled;\\n  }\\n  return twice;\\n})()", { filename });
const context = vm.createContext({});
const inContext = script.runInContext(context); // both link the one compile, before any debugger
const inHost = script.runInThisContext();
process.stderr.write("<linked " + filename + ">\\n");
await Bun.stdin.stream().getReader().read();    // the debugger activates and sets a breakpoint
process.stderr.write("<context " + inContext(1) + ">\\n"); // generates the body without debug hooks
process.stderr.write("<host " + inHost(21) + ">\\n");      // must still reach the breakpoint
process.exit(0);                                // the inspector connection keeps the loop alive
`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--inspect=ws://127.0.0.1:0/shared-mode-breakpoint", join(String(dir), "child.mjs")],
    env: bunEnv,
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const readUntil = readLines(proc);
  const [, url] = await readUntil(/^\s*(ws:\/\/\S+)\s*$/m);
  const [, filename] = await readUntil(/<linked ([^>]*)>/);

  const client = await connect(url);
  const breakpoint = await client.send("Debugger.setBreakpointByUrl", { url: filename, lineNumber: 2, columnNumber: 0 });
  expect(breakpoint.result?.breakpointId).toEqual(expect.any(String));
  proc.stdin.write("go\n");
  proc.stdin.flush();

  const [host, exitCode] = await Promise.all([readUntil(/<host [^>]*>/), proc.exited]);
  expect(host[0]).toBe("<host 42>");
  expect(client.pauses).toEqual([{ scriptId: expect.any(String), lineNumber: 2, columnNumber: 4 }]);
  client.close();
  expect(exitCode).toBe(0);
});
