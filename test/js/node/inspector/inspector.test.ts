import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import inspector from "node:inspector";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("inspector.url()", () => {
  expect(inspector.url()).toBeUndefined();
});

test("inspector.console", () => {
  expect(inspector.console).toBeObject();
});

test("inspector.close() is a no-op when the inspector is not open", () => {
  expect(() => inspector.close()).not.toThrow();
});

test("inspector.waitForDebugger() throws ERR_INSPECTOR_NOT_ACTIVE when the inspector is not active", () => {
  let error: any;
  try {
    inspector.waitForDebugger();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeDefined();
  expect(error.code).toBe("ERR_INSPECTOR_NOT_ACTIVE");
  expect(error.message).toBe("Inspector is not active");
});

// inspector.open() picks an ephemeral port and a random UUID path, like Node.
const inspectorUrl = /^ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Each child-spawning test below gets its own tempDir and ephemeral port, so
// they run concurrently. Under a debug build, starting the child and its
// debugger thread takes 2-3s per test on its own and longer once they overlap,
// which does not reliably fit bun test's 5s local default. CI passes a larger
// --timeout of its own, which this must not lower, hence the condition.
if (isDebug) setDefaultTimeout(30_000);

// Fixtures that block until the test acts as their debugger client
// (waitForDebugger(), a breakpoint) have to be read incrementally, since their
// output only ends once the test has resumed them.
function collectOutput(stream: ReadableStream<Uint8Array>) {
  let text = "";
  let closed = false;
  let nextChunk = Promise.withResolvers<void>();
  const wake = () => {
    const waiters = nextChunk;
    nextChunk = Promise.withResolvers();
    waiters.resolve();
  };
  const finished = (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const bytes of stream) {
        text += decoder.decode(bytes, { stream: true });
        wake();
      }
      return (text += decoder.decode());
    } finally {
      closed = true;
      wake();
    }
  })();
  return {
    /** The whole stream, once the child closes it. */
    finished,
    /** What has arrived so far, for failure messages. */
    get text() {
      return text;
    },
    /** Resolves as soon as the output received so far matches `pattern`. */
    async waitFor(pattern: RegExp): Promise<RegExpMatchArray> {
      for (;;) {
        const match = text.match(pattern);
        if (match) return match;
        if (closed) throw new Error(`stream closed before ${pattern} matched; received: ${JSON.stringify(text)}`);
        await nextChunk.promise;
      }
    },
  };
}

// inspector.open() starts a WebSocket server speaking the V8 Chrome DevTools
// Protocol (translated to JSC's inspector protocol on the debugger thread).
// The fixture opens the inspector, talks to its own server as a CDP client,
// and prints one JSON summary line for the assertions below. It imports nothing
// but node:inspector on purpose: Bun's fetch() sends an explicit Host header as
// given, and loading node:http for that alone used to cost more under
// debug/ASAN builds than everything the fixture does with the inspector.
const openInspectorFixture = `
import inspector from "node:inspector";

const urlBeforeOpen = inspector.url() ?? null;
inspector.open(0, "127.0.0.1", false);
const url = inspector.url();

let alreadyActivated = null;
try {
  inspector.open(0, "127.0.0.1", false);
} catch (error) {
  alreadyActivated = { code: error.code, message: error.message };
}

const { host, pathname } = new URL(url);
const get = (path, hostHeader) => fetch("http://" + host + path, { headers: hostHeader ? { Host: hostHeader } : {} });
const json = async (path, hostHeader) => (await get(path, hostHeader)).json();
const status = async (path, hostHeader) => (await get(path, hostHeader)).status;

const version = await json("/json/version");
const list = await json("/json/list");
// /json/list reflects a localhost/IP-literal Host header (port-forwards,
// tunnels), like Node; other hostnames are rejected outright (Node's
// IsAllowedHost / DNS-rebinding guard), and the WebSocket endpoint is gated on
// the same check (Node's HostCheckedForUPGRADE). A plain GET of the WebSocket
// path with an acceptable Host gets past that check to the upgrade itself.
const listWithIpHost = await json("/json/list", "127.0.0.1:19229");
const listWithMappedIpv6Host = await json("/json/list", "[::ffff:127.0.0.1]:19229");
const listWithDnsHostStatus = await status("/json/list", "tunnel.example:9229");
const versionWithDnsHostStatus = await status("/json/version", "tunnel.example:9229");
const websocketPathWithDnsHostStatus = await status(pathname, "tunnel.example:9229");
const websocketPathWithoutUpgradeStatus = await status(pathname);

const ws = new WebSocket(url);
const pending = new Map();
const events = [];
let nextId = 1;
const taggedConsoleEvent = Promise.withResolvers();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  events.push(message);
  if (message.method === "Runtime.consoleAPICalled" && message.params.args[0]?.value === "tagged-console-call") {
    taggedConsoleEvent.resolve(message.params);
  }
};
const send = (method, params = {}) =>
  new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise(resolve => (ws.onopen = resolve));

const runtimeEnable = await send("Runtime.enable");
const debuggerEnable = await send("Debugger.enable");
// Chrome DevTools' Console echoes contextId on every evaluation; JSC's
// JSGlobalObjectRuntimeAgent rejects it, so the adapter must drop it.
const evaluate = await send("Runtime.evaluate", { expression: "6 * 7", contextId: 1 });
// JSC has no awaitPromise on Runtime.evaluate; the adapter chains
// Runtime.awaitPromise so DevTools top-level-await works, and a non-promise
// result is returned as-is.
const awaitedPromise = await send("Runtime.evaluate", {
  expression: "Promise.resolve(42)",
  awaitPromise: true,
  returnByValue: true,
});
const awaitedNonPromise = await send("Runtime.evaluate", {
  expression: "6 * 7",
  awaitPromise: true,
  returnByValue: true,
});
// CDP allows executionContextId-only (this === globalThis); JSC needs an
// objectId, so the adapter fetches the global's first.
const callOnGlobal = await send("Runtime.callFunctionOn", {
  executionContextId: 1,
  functionDeclaration: "function(){ return typeof this.process.pid }",
  returnByValue: true,
});
console.warn("console-tag:warn");
console.error("console-tag:error");
console.info("console-tag:info");
console.debug("console-tag:debug");
console.log("tagged-console-call", { tagged: true });
const consoleEvent = await taggedConsoleEvent.promise;
const unknownMethod = await send("Totally.bogus");
const debugPort = process.debugPort;
inspector.close();

const consoleTypeByTag = {};
for (const { method, params } of events) {
  const first = method === "Runtime.consoleAPICalled" ? params.args[0]?.value : undefined;
  if (typeof first === "string" && first.startsWith("console-tag:")) {
    consoleTypeByTag[first.slice("console-tag:".length)] = params.type;
  }
}

console.log(
  JSON.stringify({
    pid: process.pid,
    urlBeforeOpen,
    url,
    alreadyActivated,
    version,
    list,
    listWithIpHost,
    listWithMappedIpv6Host,
    listWithDnsHostStatus,
    versionWithDnsHostStatus,
    websocketPathWithDnsHostStatus,
    websocketPathWithoutUpgradeStatus,
    executionContextCreated: events
      .filter(event => event.method === "Runtime.executionContextCreated")
      .map(event => event.params),
    // Debugger.enable reports the scripts that were already loaded, this
    // module included, by file URL.
    thisScriptParsed: events.some(event => event.method === "Debugger.scriptParsed" && event.params.url === import.meta.url),
    runtimeEnable,
    debuggerEnable,
    evaluate,
    awaitedPromise,
    awaitedNonPromise,
    callOnGlobal,
    consoleEvent,
    consoleTypeByTag,
    unknownMethod,
    debugPort,
    urlAfterClose: inspector.url() ?? null,
  }),
);
`;

test.concurrent("inspector.open() serves the DevTools protocol and /json discovery endpoints", async () => {
  using dir = tempDir("inspector-open", {
    "fixture.mjs": openInspectorFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Node prints this exact line so debugger frontends can discover the server;
  // console output keeps reaching stdio while it is also relayed to the client.
  const url = stderr.match(/^Debugger listening on (\S+)\n/)?.[1]!;
  expect(stderr).toBe(`Debugger listening on ${url}\nconsole-tag:warn\nconsole-tag:error\n`);
  expect(url).toMatch(inspectorUrl);
  const stdoutLines = stdout.trimEnd().split("\n");
  const summary = JSON.parse(stdoutLines.pop()!);
  expect(stdoutLines).toEqual([
    "console-tag:info",
    "console-tag:debug",
    "tagged-console-call {",
    "  tagged: true,",
    "}",
  ]);

  const { port, pathname } = new URL(url);
  const target = (hostHeader: string) => ({
    description: "bun instance",
    devtoolsFrontendUrl: `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${hostHeader}${pathname}`,
    devtoolsFrontendUrlCompat: `devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=${hostHeader}${pathname}`,
    faviconUrl: "https://bun.com/favicon.ico",
    id: pathname.slice(1),
    title: `bun[${proc.pid}]`,
    type: "node",
    url: "file://",
    webSocketDebuggerUrl: `ws://${hostHeader}${pathname}`,
  });
  const fortyTwo = { result: { result: { type: "number", value: 42, description: "42" } } };
  expect(summary).toEqual({
    pid: proc.pid,
    urlBeforeOpen: null,
    url,
    alreadyActivated: {
      code: "ERR_INSPECTOR_ALREADY_ACTIVATED",
      message: "Inspector is already activated. Close it with inspector.close() before activating it again.",
    },
    version: { "Browser": `Bun/${Bun.version}`, "Protocol-Version": "1.1" },
    list: [target(`127.0.0.1:${port}`)],
    listWithIpHost: [target("127.0.0.1:19229")],
    listWithMappedIpv6Host: [target("[::ffff:127.0.0.1]:19229")],
    listWithDnsHostStatus: 400,
    versionWithDnsHostStatus: 400,
    websocketPathWithDnsHostStatus: 400,
    websocketPathWithoutUpgradeStatus: 426,
    executionContextCreated: [{ context: { id: 1, origin: "", name: "Bun", uniqueId: "1" } }],
    thisScriptParsed: true,
    runtimeEnable: { id: 1, result: {} },
    debuggerEnable: { id: 2, result: { debuggerId: "(bun)" } },
    evaluate: { id: 3, ...fortyTwo },
    awaitedPromise: { id: 4, ...fortyTwo },
    awaitedNonPromise: { id: 5, ...fortyTwo },
    callOnGlobal: { id: 6, result: { result: { type: "string", value: "number" } } },
    consoleEvent: {
      type: "log",
      args: [
        { type: "string", value: "tagged-console-call" },
        {
          type: "object",
          className: "Object",
          description: "Object",
          objectId: expect.any(String),
          preview: expect.any(Object),
        },
      ],
      executionContextId: 1,
      timestamp: expect.any(Number),
      stackTrace: {
        callFrames: [
          {
            functionName: "module code",
            scriptId: expect.any(String),
            url: pathToFileURL(join(String(dir), "fixture.mjs")).href,
            lineNumber: expect.any(Number),
            columnNumber: expect.any(Number),
          },
        ],
      },
    },
    // JSC reports warn/error/info/debug as {type:"log", level:...}; the adapter
    // must emit CDP's type, not flatten them all to "log".
    consoleTypeByTag: { warn: "warning", error: "error", info: "info", debug: "debug" },
    unknownMethod: { id: 7, error: { code: -32601, message: "'Totally.bogus' wasn't found" } },
    // Node writes the resolved port back so it's observable after open(0).
    debugPort: Number(port),
    urlAfterClose: null,
  });
  expect(exitCode).toBe(0);
});

// Node supports close() followed by open() again; a second open() while one is
// active throws ERR_INSPECTOR_ALREADY_ACTIVATED.
const reopenInspectorFixture = `
import inspector from "node:inspector";

inspector.open(0, "127.0.0.1", false);
const firstUrl = inspector.url();

let alreadyActiveCode = null;
try {
  inspector.open(0, "127.0.0.1", false);
} catch (error) {
  alreadyActiveCode = error.code;
}

inspector.close();
const closedUrl = inspector.url() ?? null;

inspector.open(0, "127.0.0.1", false);
const secondUrl = inspector.url();
const version = await (await fetch("http://" + new URL(secondUrl).host + "/json/version")).json();
inspector.close();

console.log(JSON.stringify({ firstUrl, alreadyActiveCode, closedUrl, secondUrl, version, finalUrl: inspector.url() ?? null }));
`;

test.concurrent("inspector.close() followed by inspector.open() starts a new server", async () => {
  using dir = tempDir("inspector-reopen", {
    "fixture.mjs": reopenInspectorFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const [firstUrl, secondUrl] = [...stderr.matchAll(/^Debugger listening on (\S+)$/gm)].map(match => match[1]);
  expect(stderr).toBe(`Debugger listening on ${firstUrl}\nDebugger listening on ${secondUrl}\n`);
  expect(firstUrl).toMatch(inspectorUrl);
  expect(secondUrl).toMatch(inspectorUrl);
  expect(secondUrl).not.toBe(firstUrl);
  expect(JSON.parse(stdout)).toEqual({
    firstUrl,
    alreadyActiveCode: "ERR_INSPECTOR_ALREADY_ACTIVATED",
    closedUrl: null,
    secondUrl,
    version: { "Browser": `Bun/${Bun.version}`, "Protocol-Version": "1.1" },
    finalUrl: null,
  });
  expect(exitCode).toBe(0);
});

// A failed inspector.open() (port already in use) must print Node's diagnostic
// line and RETURN so a later open() can retry on the same debugger thread.
const failedOpenRetryFixture = `
import inspector from "node:inspector";

const blocker = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
const blockedPort = blocker.port;

let threw = false;
try {
  inspector.open(blockedPort, "127.0.0.1", false);
} catch {
  threw = true;
}
const urlAfterFailure = inspector.url() ?? null;

inspector.open(0, "127.0.0.1", false);
const url = inspector.url();
const version = await (await fetch("http://" + new URL(url).host + "/json/version")).json();
inspector.close();
blocker.stop(true);

console.log(JSON.stringify({ threw, blockedPort, urlAfterFailure, url, version, finalUrl: inspector.url() ?? null }));
`;

test.concurrent("inspector.open() can be retried after a failed start", async () => {
  using dir = tempDir("inspector-failed-open", {
    "fixture.mjs": failedOpenRetryFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Node: the failed open() prints one stderr line, does not throw, and
  // leaves url() undefined; the retry then announces its server as usual.
  const blockedPort = Number(stderr.match(/^Starting inspector on 127\.0\.0\.1:(\d+) failed/)?.[1]);
  const url = stderr.match(/^Debugger listening on (\S+)$/m)?.[1]!;
  expect(stderr).toBe(
    `Starting inspector on 127.0.0.1:${blockedPort} failed: address already in use\nDebugger listening on ${url}\n`,
  );
  expect(url).toMatch(inspectorUrl);
  expect(JSON.parse(stdout)).toEqual({
    threw: false,
    blockedPort,
    urlAfterFailure: null,
    url,
    version: { "Browser": `Bun/${Bun.version}`, "Protocol-Version": "1.1" },
    finalUrl: null,
  });
  expect(exitCode).toBe(0);
});

// wait=true refs the event loop before the debugger thread attempts to bind;
// on bind failure the ref must be released so the process can exit.
const failedOpenWaitFixture = `
import inspector from "node:inspector";

const blocker = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
const blockedPort = blocker.port;
inspector.open(blockedPort, "127.0.0.1", true);
blocker.stop(true);
console.log(JSON.stringify({ blockedPort, urlAfterFailure: inspector.url() ?? null }));
`;

test.concurrent("inspector.open() with wait=true does not hang the process after a bind failure", async () => {
  using dir = tempDir("inspector-failed-open-wait", {
    "fixture.mjs": failedOpenWaitFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const blockedPort = Number(stderr.match(/^Starting inspector on 127\.0\.0\.1:(\d+) failed/)?.[1]);
  expect(stderr).toBe(`Starting inspector on 127.0.0.1:${blockedPort} failed: address already in use\n`);
  expect(JSON.parse(stdout)).toEqual({ blockedPort, urlAfterFailure: null });
  expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
});

// waitForDebugger() must block until a client sends Runtime.runIfWaitingForDebugger,
// even when open() was called without `wait`. The client marks a global before
// resuming, so the fixture can tell whether it actually waited.
const waitForDebuggerFixture = `
import inspector from "node:inspector";

inspector.open(0, "127.0.0.1", false);
process.stderr.write("WAITING_FOR_DEBUGGER\\n");
inspector.waitForDebugger();
const resumedByClient = globalThis.__resumed_by_client === true;
console.log(JSON.stringify({ resumedByClient }));
inspector.close();
process.exit(resumedByClient ? 0 : 7);
`;

test.concurrent("inspector.waitForDebugger() blocks until a client resumes the process", async () => {
  using dir = tempDir("inspector-wait", {
    "fixture.mjs": waitForDebuggerFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const stderr = collectOutput(proc.stderr);
  const [, wsUrl] = await stderr.waitFor(/^Debugger listening on (\S+)\nWAITING_FOR_DEBUGGER\n/);

  const ws = new WebSocket(wsUrl);
  const opened = Promise.withResolvers<void>();
  ws.onopen = () => opened.resolve();
  ws.onerror = error => opened.reject(error);
  await opened.promise;
  // Mark the process before resuming it so the fixture can verify it really
  // waited for this client.
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression: "globalThis.__resumed_by_client = true" },
    }),
  );
  ws.send(JSON.stringify({ id: 2, method: "Runtime.runIfWaitingForDebugger", params: {} }));

  const [stdout, stderrText, exitCode] = await Promise.all([proc.stdout.text(), stderr.finished, proc.exited]);
  ws.close();

  expect(stderrText).toBe(`Debugger listening on ${wsUrl}\nWAITING_FOR_DEBUGGER\n`);
  expect(JSON.parse(stdout)).toEqual({ resumedByClient: true });
  expect(exitCode).toBe(0);
});

// A second waitForDebugger() must block again for a fresh
// Runtime.runIfWaitingForDebugger — Node blocks on every call, and it must be
// safe to reach after the previous frontend disconnected (once-connected
// controller must not be recreated).
const waitForDebuggerTwiceFixture = `
import inspector from "node:inspector";

inspector.open(0, "127.0.0.1", false);
process.stderr.write("READY\\n");
inspector.waitForDebugger();
process.stderr.write("FIRST_RESUMED\\n");
inspector.waitForDebugger();
process.stderr.write("SECOND_RESUMED\\n");
console.log(JSON.stringify({ first: globalThis.__mark, second: globalThis.__mark2 }));
inspector.close();
process.exit(0);
`;

test.concurrent("inspector.waitForDebugger() blocks again on the second call after a client disconnects", async () => {
  using dir = tempDir("inspector-wait-twice", {
    "fixture.mjs": waitForDebuggerTwiceFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const stderr = collectOutput(proc.stderr);
  const [, wsUrl] = await stderr.waitFor(/^Debugger listening on (\S+)\nREADY\n/);

  // Close only once the fixture has observably resumed: closing the socket
  // immediately after send() can race the cross-thread dispatch so
  // Inspector.initialized lands but Runtime.evaluate is still queued,
  // leaving __mark undefined.
  const connectAndResume = async (expression: string, resumed: RegExp) => {
    const ws = new WebSocket(wsUrl);
    const closed = Promise.withResolvers<void>();
    const opened = Promise.withResolvers<void>();
    ws.onopen = () => opened.resolve();
    ws.onerror = e => {
      opened.reject(e);
      closed.reject(e);
    };
    ws.onclose = () => closed.resolve();
    await opened.promise;
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
    ws.send(JSON.stringify({ id: 2, method: "Runtime.runIfWaitingForDebugger", params: {} }));
    await stderr.waitFor(resumed);
    ws.close();
    await closed.promise;
  };

  // The fixture resumes, prints FIRST_RESUMED, then blocks again in the second
  // waitForDebugger(). Seeing FIRST_RESUMED proves the first wait blocked; the
  // fixture would already have exited if the second call returned immediately.
  // Runtime.evaluate may dispatch after the wait resolves (separate batch), so
  // the mark values are asserted only in the final JSON, not here.
  await connectAndResume("globalThis.__mark = 1", /FIRST_RESUMED\n/);
  await connectAndResume("globalThis.__mark2 = 2", /SECOND_RESUMED\n/);

  const [stdout, stderrText, exitCode] = await Promise.all([proc.stdout.text(), stderr.finished, proc.exited]);

  expect(stderrText).toBe(`Debugger listening on ${wsUrl}\nREADY\nFIRST_RESUMED\nSECOND_RESUMED\n`);
  expect(JSON.parse(stdout)).toEqual({ first: 1, second: 2 });
  expect(exitCode).toBe(0);
});

// Activating breakpoints on a debugger that was attached at runtime (after the
// entry module has already been linked) used to crash the inspected process:
// JSC's clearCode discarded the module's UnlinkedModuleProgramCodeBlock, and
// the next executeModuleProgram regenerated it under CodeGenerationMode::
// Debugger with a different module-environment / generator-frame layout, so the
// resumed top-level-await body wrote past the live JSModuleEnvironment.
test.concurrent("activating breakpoints on a runtime-attached debugger does not crash module evaluation", async () => {
  using dir = tempDir("inspector-runtime-attach", {
    "entry.mjs": `
let warm = 0;
for (let i = 0; i < 5; i++) warm += i;
process.stdout.write("ready\\n");
await new Promise(resolve => process.stdin.once("data", resolve));
process.stdout.write("importing\\n");
const mod = await import("./mod.mjs");
process.stdout.write(JSON.stringify({ after: mod.after, bump: mod.bump(), warm }) + "\\n");
process.exit(0);
`,
    "mod.mjs": `
let counter = 0;
export function bump() { counter++; return counter; }
let after = counter + 1;
export { after };
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0/runtime-attach", "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = collectOutput(proc.stderr);
  const stdout = collectOutput(proc.stdout);
  const [, wsUrl] = await stderr.waitFor(/^  (ws:\/\/127\.0\.0\.1:\d+\/runtime-attach)$/m);
  await stdout.waitFor(/^ready\n/);

  // Connect a JSC-protocol client and activate breakpoints — this is what
  // forces the recompileAllJSFunctions() / deleteAllCode() path.
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = err => reject(err);
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.onmessage = event => {
    const msg = JSON.parse(String(event.data));
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  };
  function send(method: string, params?: unknown) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await send("Inspector.enable");
  await send("Debugger.enable");
  await send("Debugger.setBreakpointsActive", { active: true });

  // FileSink buffers: without the flush the child never sees "go" and both
  // sides wait on each other until the test times out.
  proc.stdin.write("go\n");
  proc.stdin.flush();
  await stdout.waitFor(/^\{.*\}\n/m);
  ws.close();
  const [stdoutText, stderrText, exitCode] = await Promise.all([stdout.finished, stderr.finished, proc.exited]);

  const banner = "--------------------- Bun Inspector ---------------------";
  expect(stderrText).toBe(
    `${banner}\nListening:\n  ${wsUrl}\nInspect in browser:\n  https://debug.bun.sh/#${wsUrl.slice("ws://".length)}\n${banner}\n`,
  );
  expect(stdoutText).toBe(`ready\nimporting\n${JSON.stringify({ after: 1, bump: 1, warm: 10 })}\n`);
  expect(exitCode).toBe(0);
});

// End-to-end pause/resume over the DevTools-protocol server started by
// inspector.open(): the entry module is a top-level-await module that calls
// open() at runtime, the client attaches and enables the Debugger domain
// (which the adapter activates breakpoints for), the entry module then imports
// a module containing `debugger;`, and the client resumes the pause.
//
// One statement per line and no blank lines, so the line Debugger.paused
// reports for the transpiled module is the line of `debugger;` in this source.
const debuggerStatementModule = `let counter = 0;
debugger;
let after = counter + 1;
export { after };
`;

test.concurrent("breakpoints pause and resume over the inspector.open() DevTools server", async () => {
  using dir = tempDir("inspector-breakpoints", {
    // wait=true blocks the inspected thread in waitForDebugger()'s tick loop
    // until Runtime.runIfWaitingForDebugger, so Debugger.enable is guaranteed
    // to have armed setPauseOnDebuggerStatements before mod.mjs evaluates.
    "entry.mjs": `
import inspector from "node:inspector";
let beforeOpen = 1;
inspector.open(0, "127.0.0.1", true);
const mod = await import("./mod.mjs");
console.log(JSON.stringify({ after: mod.after, beforeOpen }));
inspector.close();
process.exit(0);
`,
    "mod.mjs": debuggerStatementModule,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = collectOutput(proc.stderr);
  const stdout = collectOutput(proc.stdout);
  const [, wsUrl] = await stderr.waitFor(/^Debugger listening on (\S+)\n/);

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = err => reject(err);
  });
  let nextId = 1;
  let awaiting = "";
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const paused = Promise.withResolvers<unknown>();
  ws.onmessage = event => {
    const msg = JSON.parse(String(event.data));
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === "Debugger.paused") {
      paused.resolve(msg.params);
    }
  };
  // Every awaited promise must reject on socket loss or child death so the
  // failure reports where it was stuck instead of silently hitting the suite
  // timeout with no stack.
  const abandon = (why: string) => {
    const err = new Error(`${why} while awaiting ${awaiting}; stderr: ${stderr.text}`);
    paused.reject(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  ws.onerror = () => abandon("inspector websocket errored");
  ws.onclose = () => abandon("inspector websocket closed");
  proc.exited.then(code => abandon(`child exited (code ${code})`));
  function send(method: string, params?: unknown) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      awaiting = method;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await send("Runtime.enable");
  await send("Debugger.enable");
  // The inspected thread is still parked inside open()'s waitForDebugger at
  // this point; releasing it now is race-free because Debugger.enable's reply
  // proves the backend already armed breakpoints.
  await send("Runtime.runIfWaitingForDebugger");

  awaiting = "Debugger.paused";
  const scope = (type: string) => ({
    type,
    object: expect.objectContaining({ type: "object", objectId: expect.any(String) }),
  });
  expect(await paused.promise).toEqual({
    // V8 also reports a `debugger;` statement as "other" (no hitBreakpoints).
    reason: "other",
    callFrames: [
      {
        callFrameId: expect.any(String),
        functionName: "module code",
        location: {
          scriptId: expect.any(String),
          lineNumber: debuggerStatementModule.split("\n").indexOf("debugger;"),
          columnNumber: 0,
        },
        url: pathToFileURL(join(String(dir), "mod.mjs")).href,
        scopeChain: [scope("closure"), scope("script"), scope("global")],
        this: { type: "undefined" },
        canBeRestarted: false,
      },
    ],
  });
  // Do not wait for the resume reply: the inspected thread may reach
  // process.exit(0) before the debugger thread has relayed it, which closes
  // the socket first. The JSON on stdout is the real proof the resume landed.
  ws.send(JSON.stringify({ id: nextId++, method: "Debugger.resume" }));
  await stdout.waitFor(/^\{.*\}\n/m);
  ws.close();
  const [stdoutText, stderrText, exitCode] = await Promise.all([stdout.finished, stderr.finished, proc.exited]);

  expect(stderrText).toBe(`Debugger listening on ${wsUrl}\n`);
  expect(JSON.parse(stdoutText)).toEqual({ after: 1, beforeOpen: 1 });
  expect(exitCode).toBe(0);
});

// The in-process Session tests below stay serial: a Session with Runtime
// enabled hooks this process's console, and several of them also listen for
// process "warning" events or tamper with shared prototypes, so they would
// observe each other's console.log calls if they overlapped.
test("Runtime.consoleAPICalled is emitted while the Runtime domain is enabled", () => {
  const session = new inspector.Session();
  session.connect();
  try {
    const seen: any[] = [];
    session.on("Runtime.consoleAPICalled", message => seen.push(message));
    session.post("Runtime.enable");
    console.log("hello", 42);
    expect(seen).toHaveLength(1);
    expect(seen[0].params.type).toBe("log");
    expect(seen[0].params.args[0]).toEqual({ type: "string", value: "hello" });
    expect(seen[0].params.args[1]).toEqual({
      type: "number",
      value: 42,
      description: "42",
    });
    session.post("Runtime.disable");
    console.log("after disable");
    expect(seen).toHaveLength(1);
  } finally {
    session.disconnect();
  }
});

test("Runtime.consoleAPICalled encodes -0/NaN/Infinity/bigint as unserializableValue like Node", () => {
  const session = new inspector.Session();
  session.connect();
  try {
    let seen: any;
    session.on("Runtime.consoleAPICalled", message => (seen = message));
    session.post("Runtime.enable");
    console.log(-0, NaN, Infinity, -Infinity, 1n);
    expect(seen.params.args).toEqual([
      { type: "number", unserializableValue: "-0", description: "-0" },
      { type: "number", unserializableValue: "NaN", description: "NaN" },
      { type: "number", unserializableValue: "Infinity", description: "Infinity" },
      { type: "number", unserializableValue: "-Infinity", description: "-Infinity" },
      { type: "bigint", unserializableValue: "1n", description: "1n" },
    ]);
  } finally {
    session.disconnect();
  }
});

test("Session errors carry Node's ERR_INSPECTOR_* codes and post() validates its arguments", () => {
  const session = new inspector.Session();
  expect(() => session.post("Runtime.enable")).toThrow(
    expect.objectContaining({ code: "ERR_INSPECTOR_NOT_CONNECTED", message: "Session is not connected" }),
  );
  session.connect();
  expect(() => session.connect()).toThrow(
    expect.objectContaining({
      code: "ERR_INSPECTOR_ALREADY_CONNECTED",
      message: "The inspector session is already connected",
    }),
  );
  expect(() => session.post(123 as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  expect(() => session.post("Runtime.enable", "not an object" as any)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => session.post("Runtime.enable", {}, "not a function" as any)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  // post(method, fn, fn) must throw ERR_INVALID_ARG_TYPE for `params` — the
  // (method, callback) overload only applies when no third argument is passed.
  expect(() => session.post("Runtime.enable", (() => {}) as any, () => {})).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => session.post("Nonexistent.domain")).toThrow(expect.objectContaining({ code: "ERR_INSPECTOR_COMMAND" }));
  session.disconnect();

  // connectToMainThread() throws ERR_INSPECTOR_NOT_WORKER on the main thread.
  const s2 = new inspector.Session();
  expect(() => s2.connectToMainThread()).toThrow(expect.objectContaining({ code: "ERR_INSPECTOR_NOT_WORKER" }));
});

test("the method-specific event fires before inspectorNotification, like Node", () => {
  const session = new inspector.Session();
  session.connect();
  try {
    const order: string[] = [];
    session.on("Runtime.consoleAPICalled", () => order.push("method"));
    session.on("inspectorNotification", () => order.push("generic"));
    session.post("Runtime.enable");
    console.log("ordered");
    expect(order).toEqual(["method", "generic"]);
  } finally {
    session.disconnect();
  }
});

test("a consoleAPICalled listener that logs does not recurse", () => {
  const session = new inspector.Session();
  session.connect();
  try {
    let emissions = 0;
    session.on("Runtime.consoleAPICalled", () => {
      emissions++;
      console.log("from listener");
    });
    session.post("Runtime.enable");
    console.log("outer");
    expect(emissions).toBe(1);
  } finally {
    session.disconnect();
  }
});

test("a throwing consoleAPICalled listener does not break console.log or other sessions", async () => {
  const s1 = new inspector.Session();
  const s2 = new inspector.Session();
  s1.connect();
  s2.connect();
  const warnings: Error[] = [];
  const onWarning = (w: Error) => warnings.push(w);
  process.on("warning", onWarning);
  try {
    let s2Saw = 0;
    s1.on("Runtime.consoleAPICalled", () => {
      throw new Error("listener boom");
    });
    s2.on("Runtime.consoleAPICalled", () => s2Saw++);
    s1.post("Runtime.enable");
    s2.post("Runtime.enable");
    expect(() => console.log("still works")).not.toThrow();
    expect(s2Saw).toBe(1);
    // process.emitWarning delivers asynchronously
    await new Promise(resolve => setImmediate(resolve));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe("listener boom");
  } finally {
    process.off("warning", onWarning);
    s1.disconnect();
    s2.disconnect();
  }
});

test("a listener that throws a non-stringifiable value does not break console.log", async () => {
  const session = new inspector.Session();
  session.connect();
  const warnings: Error[] = [];
  const onWarning = (w: Error) => warnings.push(w);
  process.on("warning", onWarning);
  try {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    session.on("Runtime.consoleAPICalled", () => {
      throw proxy; // String(proxy) throws TypeError
    });
    session.post("Runtime.enable");
    expect(() => console.log("still works")).not.toThrow();
    await new Promise(resolve => setImmediate(resolve));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("could not be stringified");
  } finally {
    process.off("warning", onWarning);
    session.disconnect();
  }
});

test("a tampered Set.prototype[Symbol.iterator] or Date.now does not break console.log while Runtime is enabled", () => {
  const session = new inspector.Session();
  session.connect();
  const savedIter = Set.prototype[Symbol.iterator];
  const savedNow = Date.now;
  let logged = "";
  session.on("Runtime.consoleAPICalled", msg => (logged = msg.params.args[0].value));
  try {
    session.post("Runtime.enable");
    Set.prototype[Symbol.iterator] = () => {
      throw new Error("tampered iterator");
    };
    Date.now = () => {
      throw new Error("tampered now");
    };
    expect(() => console.log("still works after tamper")).not.toThrow();
    expect(logged).toBe("still works after tamper");
  } finally {
    Set.prototype[Symbol.iterator] = savedIter;
    Date.now = savedNow;
    session.disconnect();
  }
});

test("Object.prototype pollution does not cause Runtime.enable to hook extra console methods", () => {
  const session = new inspector.Session();
  session.connect();
  // @ts-expect-error deliberate prototype pollution
  Object.prototype.count = "log";
  const savedCount = console.count;
  try {
    session.post("Runtime.enable");
    expect(console.count).toBe(savedCount);
  } finally {
    // @ts-expect-error cleanup
    delete Object.prototype.count;
    session.disconnect();
  }
});

test("a console argument whose toString throws does not break console.log", async () => {
  const session = new inspector.Session();
  session.connect();
  const warnings: Error[] = [];
  const onWarning = (w: Error) => warnings.push(w);
  process.on("warning", onWarning);
  try {
    session.post("Runtime.enable");
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => console.log(proxy)).not.toThrow();
    await new Promise(resolve => setImmediate(resolve));
    expect(warnings).toHaveLength(1);
  } finally {
    process.off("warning", onWarning);
    session.disconnect();
  }
});

test("disconnect does not clobber a console method reassigned by user code", () => {
  const session = new inspector.Session();
  session.connect();
  const before = console.log;
  try {
    session.post("Runtime.enable");
    const mine = (..._args: unknown[]) => {};
    console.log = mine;
    session.disconnect();
    expect(console.log).toBe(mine);
  } finally {
    console.log = before;
  }
});
