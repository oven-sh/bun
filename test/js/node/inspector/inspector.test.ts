import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, nodeExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import inspector from "node:inspector";
import { join } from "node:path";

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

// inspector.open() starts a WebSocket server speaking the V8 Chrome DevTools
// Protocol (translated to JSC's inspector protocol on the debugger thread).
// The fixture opens the inspector, talks to its own server as a CDP client,
// and prints one JSON summary line for the assertions below.
const openInspectorFixture = `
import inspector from "node:inspector";
import assert from "node:assert";
import http from "node:http";

assert.strictEqual(inspector.url(), undefined);
inspector.open(0, "127.0.0.1", false);
const url = inspector.url();

let alreadyActivatedError = null;
try {
  inspector.open(0, "127.0.0.1", false);
} catch (error) {
  alreadyActivatedError = error.message;
}

const httpBase = "http://" + new URL(url).host;
const version = await (await fetch(httpBase + "/json/version")).json();
const list = await (await fetch(httpBase + "/json/list")).json();

// /json/list reflects a localhost/IP-literal Host header (port-forwards,
// tunnels), like Node; other hostnames are rejected outright (Node's
// IsAllowedHost / DNS-rebinding guard).
function fetchWithHost(path, hostHeader) {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          host: "127.0.0.1",
          port: Number(new URL(url).port),
          path,
          headers: { Host: hostHeader },
        },
        response => {
          let body = "";
          response.on("data", chunk => (body += chunk));
          response.on("end", () =>
            resolve(response.statusCode === 200 ? JSON.parse(body) : { statusCode: response.statusCode }),
          );
          response.on("error", reject);
        },
      )
      .on("error", reject);
  });
}
const listWithIpHost = await fetchWithHost("/json/list", "127.0.0.1:19229");
const listWithMappedIpv6Host = await fetchWithHost("/json/list", "[::ffff:127.0.0.1]:19229");
const listWithDnsHost = await fetchWithHost("/json/list", "tunnel.example:9229");
const versionWithDnsHost = await fetchWithHost("/json/version", "tunnel.example:9229");
// The WS upgrade is gated on the same Host check (Node's HostCheckedForUPGRADE).
const wsBadHostStatus = await new Promise((resolve, reject) => {
  const request = http.get(
    {
      host: "127.0.0.1",
      port: Number(new URL(url).port),
      path: new URL(url).pathname,
      headers: { Host: "tunnel.example:9229", Connection: "Upgrade", Upgrade: "websocket" },
    },
    response => resolve(response.statusCode),
  );
  request.on("upgrade", () => resolve("upgraded"));
  request.on("error", reject);
});

const ws = new WebSocket(url);
const pending = new Map();
const events = [];
let nextId = 1;
let consoleEventResolve;
const consoleEventPromise = new Promise(resolve => (consoleEventResolve = resolve));
const consoleTypeByTag = {};
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  } else {
    events.push(message);
    if (message.method === "Runtime.consoleAPICalled") {
      const first = message.params.args?.[0]?.value;
      if (typeof first === "string" && first.startsWith("console-tag:")) {
        consoleTypeByTag[first.slice("console-tag:".length)] = message.params.type;
      }
      if (first === "tagged-console-call") consoleEventResolve(message.params);
    }
  }
};
const send = (method, params) =>
  new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise(resolve => (ws.onopen = resolve));

await send("Runtime.enable", {});
const debuggerEnable = await send("Debugger.enable", {});
// Chrome DevTools' Console echoes contextId on every evaluation; JSC's
// JSGlobalObjectRuntimeAgent rejects it, so the adapter must drop it.
const evaluate = await send("Runtime.evaluate", { expression: "6 * 7", contextId: 1 });
const awaitedResolve = await send("Runtime.evaluate", {
  expression: "Promise.resolve(42)",
  awaitPromise: true,
  returnByValue: true,
});
// awaitPromise on a non-promise result returns it as-is.
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
const consoleEvent = await consoleEventPromise;
const unknown = await send("Totally.bogus", {});
inspector.close();

console.log(
  JSON.stringify({
    url,
    alreadyActivatedError,
    version,
    list,
    listWithIpHostUrl: listWithIpHost[0]?.webSocketDebuggerUrl,
    listWithMappedIpv6HostUrl: listWithMappedIpv6Host[0]?.webSocketDebuggerUrl,
    listWithDnsHost,
    versionWithDnsHost,
    wsBadHostStatus,
    executionContextCreated: events.some(event => event.method === "Runtime.executionContextCreated"),
    scriptParsedCount: events.filter(event => event.method === "Debugger.scriptParsed").length,
    debuggerEnable: debuggerEnable.result,
    evaluateValue: evaluate.result?.result?.value,
    awaitedResolveValue: awaitedResolve.result?.result?.value,
    awaitedNonPromiseValue: awaitedNonPromise.result?.result?.value,
    callOnGlobalValue: callOnGlobal.result?.result?.value,
    consoleEventType: consoleEvent.type,
    consoleTypeByTag,
    debugPort: process.debugPort,
    unknownError: unknown.error,
    urlAfterClose: inspector.url() ?? null,
  }),
);
`;

test("inspector.open() serves the DevTools protocol and /json discovery endpoints", async () => {
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
  expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });

  // Node prints this exact line so debugger frontends can discover the server.
  expect(stderr).toMatch(/Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}/);

  const lastLine = stdout.trim().split("\n").at(-1)!;
  const summary = JSON.parse(lastLine);

  expect(summary.url).toStartWith("ws://127.0.0.1:");
  expect(summary.alreadyActivatedError).toContain("already activated");
  expect(summary.version).toEqual({ "Browser": expect.stringContaining("Bun/"), "Protocol-Version": "1.1" });
  expect(summary.list).toEqual([
    expect.objectContaining({
      type: "node",
      webSocketDebuggerUrl: summary.url,
      devtoolsFrontendUrl: expect.stringContaining("devtools://"),
    }),
  ]);
  // Node reflects localhost/IP-literal Host headers into /json/list; other
  // hostnames are rejected (Node's IsAllowedHost / DNS-rebinding guard) for
  // both discovery and the WebSocket upgrade.
  expect(summary.listWithIpHostUrl).toBe(`ws://127.0.0.1:19229${new URL(summary.url).pathname}`);
  expect(summary.listWithMappedIpv6HostUrl).toBe(`ws://[::ffff:127.0.0.1]:19229${new URL(summary.url).pathname}`);
  expect(summary.listWithDnsHost).toEqual({ statusCode: 400 });
  expect(summary.versionWithDnsHost).toEqual({ statusCode: 400 });
  expect(summary.wsBadHostStatus).toBe(400);
  expect(summary.executionContextCreated).toBe(true);
  expect(summary.scriptParsedCount).toBeGreaterThan(0);
  expect(summary.debuggerEnable).toEqual({ debuggerId: expect.any(String) });
  expect(summary.evaluateValue).toBe(42);
  // JSC has no awaitPromise on Runtime.evaluate; the adapter chains
  // Runtime.awaitPromise so DevTools top-level-await works.
  expect(summary.awaitedResolveValue).toBe(42);
  expect(summary.awaitedNonPromiseValue).toBe(42);
  expect(summary.callOnGlobalValue).toBe("number");
  expect(summary.consoleEventType).toBe("log");
  // JSC reports warn/error/info/debug as {type:"log", level:...}; the adapter
  // must emit CDP's type, not flatten them all to "log".
  expect(summary.consoleTypeByTag).toEqual({ warn: "warning", error: "error", info: "info", debug: "debug" });
  // Node writes the resolved port back so it's observable after open(0).
  expect(summary.debugPort).toBe(Number(new URL(summary.url).port));
  expect(summary.unknownError).toEqual({ code: -32601, message: "'Totally.bogus' wasn't found" });
  expect(summary.urlAfterClose).toBeNull();
}, 30_000);

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

console.log(
  JSON.stringify({
    firstUrl,
    alreadyActiveCode,
    closedUrl,
    secondUrl,
    protocolVersion: version["Protocol-Version"],
    finalUrl: inspector.url() ?? null,
  }),
);
`;

test("inspector.close() followed by inspector.open() starts a new server", async () => {
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
  expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });

  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!);
  expect(summary.firstUrl).toStartWith("ws://127.0.0.1:");
  expect(summary.alreadyActiveCode).toBe("ERR_INSPECTOR_ALREADY_ACTIVATED");
  expect(summary.closedUrl).toBeNull();
  expect(summary.secondUrl).toStartWith("ws://127.0.0.1:");
  expect(summary.secondUrl).not.toBe(summary.firstUrl);
  expect(summary.protocolVersion).toBe("1.1");
  expect(summary.finalUrl).toBeNull();
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

console.log(
  JSON.stringify({
    threw,
    blockedPort,
    urlAfterFailure,
    url,
    protocolVersion: version["Protocol-Version"],
    finalUrl: inspector.url() ?? null,
  }),
);
`;

test("inspector.open() can be retried after a failed start", async () => {
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
  expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });

  const summary = JSON.parse(stdout.trim().split("\n").at(-1)!);
  // Node: prints one stderr line, does not throw, url() stays undefined.
  expect(summary.threw).toBe(false);
  expect(stderr).toContain(`Starting inspector on 127.0.0.1:${summary.blockedPort} failed: address already in use`);
  expect(summary.urlAfterFailure).toBeNull();
  expect(summary.url).toStartWith("ws://127.0.0.1:");
  expect(summary.protocolVersion).toBe("1.1");
  expect(summary.finalUrl).toBeNull();
});

// wait=true refs the event loop before the debugger thread attempts to bind;
// on bind failure the ref must be released so the process can exit.
const failedOpenWaitFixture = `
import inspector from "node:inspector";

const blocker = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
process.stdout.write(blocker.port + "\\n");
inspector.open(blocker.port, "127.0.0.1", true);
blocker.stop(true);
`;

test("inspector.open() with wait=true does not hang the process after a bind failure", async () => {
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
  const port = stdout.trim();
  expect(stderr).toContain(`Starting inspector on 127.0.0.1:${port} failed: address already in use`);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
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

test("inspector.waitForDebugger() blocks until a client resumes the process", async () => {
  using dir = tempDir("inspector-wait", {
    "fixture.mjs": waitForDebuggerFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  // Read stderr incrementally: the fixture blocks in waitForDebugger(), so the
  // stream cannot be awaited to completion before acting as the client.
  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let stderrText = "";
  let wsUrl: string | undefined;
  while (!wsUrl || !stderrText.includes("WAITING_FOR_DEBUGGER")) {
    const { value, done } = await reader.read();
    if (done) break;
    stderrText += decoder.decode(value);
    wsUrl ??= stderrText.match(/Debugger listening on (ws:\S+)/)?.[1];
  }
  expect(wsUrl).toBeDefined();

  const ws = new WebSocket(wsUrl!);
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

  // Keep draining stderr so the pipe cannot fill while the fixture finishes.
  const drained = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stderrText += decoder.decode(value);
    }
  })();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  await drained;
  ws.close();

  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual({ resumedByClient: true });
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

test("inspector.waitForDebugger() blocks again on the second call after a frontend disconnects", async () => {
  using dir = tempDir("inspector-wait-twice", {
    "fixture.mjs": waitForDebuggerTwiceFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let stderrText = "";
  const readUntil = async (needle: string) => {
    while (!stderrText.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stderr closed before ${JSON.stringify(needle)}; got: ${stderrText}`);
      stderrText += decoder.decode(value);
    }
  };

  await readUntil("READY");
  const wsUrl = stderrText.match(/Debugger listening on (ws:\S+)/)?.[1];
  expect(wsUrl).toBeDefined();

  // Close only once the fixture has observably resumed: closing the socket
  // immediately after send() can race the cross-thread dispatch so
  // Inspector.initialized lands but Runtime.evaluate is still queued,
  // leaving __mark undefined.
  const connectAndResume = async (expression: string, resumedNeedle: string) => {
    const ws = new WebSocket(wsUrl!);
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
    await readUntil(resumedNeedle);
    ws.close();
    await closed.promise;
  };

  // The fixture resumes, prints FIRST_RESUMED, then blocks again in the second
  // waitForDebugger(). Seeing FIRST_RESUMED proves the first wait blocked; the
  // fixture would already have exited if the second call returned immediately.
  // Runtime.evaluate may dispatch after the wait resolves (separate batch), so
  // the mark values are asserted only in the final JSON, not here.
  await connectAndResume("globalThis.__mark = 1", "FIRST_RESUMED");
  await connectAndResume("globalThis.__mark2 = 2", "SECOND_RESUMED");

  const drained = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stderrText += decoder.decode(value);
    }
  })();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  await drained;

  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual({ first: 1, second: 2 });
  expect(exitCode).toBe(0);
});

// inspector.waitForDebugger() and inspector.open(port, host, true) block the
// thread: the event loop does not run while they wait, so nothing that the
// program scheduled runs before they return. The only JavaScript that runs
// inside them is what a client evaluates. Node waits on a condition variable:
// https://github.com/nodejs/node/blob/v26.3.0/src/inspector_agent.cc#L787-L803
// https://github.com/nodejs/node/blob/v26.3.0/src/inspector/main_thread_interface.cc#L221-L234
// The fixtures run on both runtimes, so the expected reports are pinned to Node.
//
// Every fixture arms one callback of each kind before the call. The microtask
// and the nextTick make a loop that does run show up every time: one turn of
// it drains them, however early the client resumes the process.
const waitFixturePreamble = `
import inspector from "node:inspector";
import { existsSync, promises, writeSync } from "node:fs";
import { connect, createServer } from "node:net";

// On the global object, for the expressions that the client evaluates.
globalThis.inspectorOfTheProgram = inspector;
globalThis.existsSync = existsSync;
globalThis.insideTheCall = false;
const ranInsideTheCall = [];
const record = what => {
  if (globalThis.insideTheCall) ranInsideTheCall.push(what);
};

// One byte of the program's own socket traffic, readable when the call starts.
const listening = Promise.withResolvers();
const ownServer = createServer(socket => socket.on("data", () => record("socket data")));
ownServer.listen(0, "127.0.0.1", listening.resolve);
await listening.promise;
const connected = Promise.withResolvers();
const ownClient = connect(ownServer.address().port, "127.0.0.1", connected.resolve);
await connected.promise;

function insideTheCall(call) {
  ownClient.write("x");
  setTimeout(() => record("timer"), 0);
  setImmediate(() => record("setImmediate"));
  process.nextTick(() => record("nextTick"));
  queueMicrotask(() => record("microtask"));
  promises.readFile(import.meta.filename).then(() => record("file read"));

  writeSync(2, "BEFORE_THE_CALL\\n");
  globalThis.insideTheCall = true;
  call();
  globalThis.insideTheCall = false;
}

// close() comes first: the debugger thread then frees the sockets of the
// frontends that left. Node waits in it for the frontends to leave, so the
// test closes them when it has read the report.
function finish(more = {}) {
  writeSync(1, JSON.stringify({ ranInsideTheCall: ranInsideTheCall.sort(), ...more }) + "\\n");
  inspector.close();
  process.exit(0);
}
`;

const nothingRan = { ranInsideTheCall: [] };

// A case that times out does not reach its dispose, and a child that waits
// for a debugger does not exit by itself.
const inspectedChildren = new Set<ReturnType<typeof Bun.spawn>>();
afterAll(() => {
  for (const child of inspectedChildren) child.kill();
});

type Inspected = Awaited<ReturnType<typeof spawnInspected>>;
interface Frontend {
  /** Sends a command. The promise is its reply. */
  send(method: string, params?: unknown): Promise<any>;
  notified(method: string): Promise<any>;
  close(): Promise<void>;
}

/**
 * Spawns the fixture and reads its stderr until it has printed `until`. The
 * URL to attach to is the last one that the child printed: before the marker
 * for waitForDebugger(), after it for open(port, host, true).
 */
async function spawnInspected(
  exe: string,
  fixture: string,
  {
    urlIsPrintedInsideTheCall = false,
    until = "BEFORE_THE_CALL\n",
    files = {},
  }: { urlIsPrintedInsideTheCall?: boolean; until?: string; files?: Record<string, string> } = {},
) {
  const dir = tempDir("inspector-wait", { "fixture.mjs": waitFixturePreamble + fixture, ...files });
  const proc = Bun.spawn({
    cmd: [exe, "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  inspectedChildren.add(proc);

  let stderrText = "";
  let stderrClosed = false;
  let stderrChanged = Promise.withResolvers<void>();
  const drained = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderrText += decoder.decode(chunk, { stream: true });
      stderrChanged.resolve();
      stderrChanged = Promise.withResolvers();
    }
    stderrClosed = true;
    stderrChanged.resolve();
  })();
  const fromStderr = async <T>(read: () => T | undefined, what: string) => {
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      if (stderrClosed) throw new Error(`stderr closed before ${what}: ${stderrText}`);
      await stderrChanged.promise;
    }
  };
  // Node ends the line with \r\n on Windows.
  const urlsIn = (text: string) => [...text.matchAll(/Debugger listening on (ws:\S+)\r?\n/g)].map(match => match[1]);

  const wsUrl = await fromStderr(
    () => {
      const marker = stderrText.indexOf(until);
      if (marker === -1) return undefined;
      const url = urlsIn(urlIsPrintedInsideTheCall ? stderrText.slice(marker) : stderrText.slice(0, marker)).at(-1);
      if (!url && !urlIsPrintedInsideTheCall) throw new Error(`no inspector URL before ${until}: ${stderrText}`);
      return url;
    },
    `${JSON.stringify(until)} and the URL`,
  );

  // The report is the last line. What a client logs with console.log comes
  // before it on the same stream.
  const reported = (async () => {
    const decoder = new TextDecoder();
    let stdoutText = "";
    for await (const chunk of proc.stdout) {
      stdoutText += decoder.decode(chunk, { stream: true });
      const line = stdoutText.split("\n").find(line => line.startsWith(`{"ranInsideTheCall"`));
      if (line !== undefined && stdoutText.includes(line + "\n")) return JSON.parse(line);
    }
    return stdoutText;
  })();

  const frontends: Frontend[] = [];
  return {
    proc,
    dir: String(dir),
    wsUrl,
    frontends,
    stderr: () => stderrText,
    /** The URL that the child prints after `previous`. */
    urlAfter: (previous: string) =>
      fromStderr(() => {
        const urls = urlsIn(stderrText);
        return urls[urls.lastIndexOf(previous) + 1];
      }, `a URL after ${previous}`),
    /** What the program reported after the call returned, and its exit code. */
    async finished() {
      const report = await reported;
      for (const frontend of frontends) frontend.close();
      const exitCode = await proc.exited;
      await drained;
      return { reported: report, exitCode };
    },
    async [Symbol.asyncDispose]() {
      proc.kill();
      await proc.exited;
      inspectedChildren.delete(proc);
      dir[Symbol.dispose]();
    },
  };
}

/** A DevTools client. Every wait on it rejects when the socket or the child is lost. */
async function attachFrontend(inspected: Inspected, url: string = inspected.wsUrl): Promise<Frontend> {
  const ws = new WebSocket(url);
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const replies = new Map<number, PromiseWithResolvers<any>>();
  const notifications = new Map<string, PromiseWithResolvers<any>>();
  let nextId = 1;

  // A wait that nobody is in when the socket is lost must not fail the test.
  const watched = <T>(resolvers: PromiseWithResolvers<T>) => {
    resolvers.promise.catch(() => {});
    return resolvers;
  };
  const notification = (method: string) => {
    let entry = notifications.get(method);
    if (!entry) notifications.set(method, (entry = watched(Promise.withResolvers())));
    return entry;
  };
  const lost = (why: string) => {
    const error = new Error(`${why}; stderr: ${inspected.stderr()}`);
    opened.reject(error);
    for (const reply of replies.values()) reply.reject(error);
    for (const entry of notifications.values()) entry.reject(error);
  };

  watched(opened);
  ws.onopen = () => opened.resolve();
  ws.onerror = () => lost("the inspector websocket errored");
  ws.onclose = () => {
    closed.resolve();
    lost("the inspector websocket closed");
  };
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id != null) replies.get(message.id)?.resolve(message);
    else notification(message.method).resolve(message.params);
  };
  inspected.proc.exited.then(code => lost(`the child exited with code ${code}`));
  await opened.promise;

  const frontend: Frontend = {
    send(method: string, params: unknown = {}) {
      const id = nextId++;
      const reply = watched(Promise.withResolvers<any>());
      replies.set(id, reply);
      ws.send(JSON.stringify({ id, method, params }));
      return reply.promise;
    },
    notified: (method: string) => notification(method).promise,
    async close() {
      ws.close();
      await closed.promise;
    },
  };
  inspected.frontends.push(frontend);
  return frontend;
}

const evaluate = (expression: string) => ["Runtime.evaluate", { expression }] as const;

// Linux: "S" is a thread that sleeps. A wait that spins never shows it.
async function sleeps(pid: number) {
  for (;;) {
    const stat = await Bun.file(`/proc/${pid}/task/${pid}/stat`).text();
    if (stat.charAt(stat.lastIndexOf(")") + 2) === "S") return;
    await new Promise(resolve => setImmediate(resolve));
  }
}

describe.each([
  ["bun", bunExe()],
  ["node", nodeExe()],
])("the wait for a debugger (%s)", (runtime, exe) => {
  const inspectedTest = test.concurrent.skipIf(!exe);
  // Node v26.3.0 can end with a segmentation fault after it has reported, so
  // its exit code is not a part of what the cases pin.
  const exitCode = runtime === "node" ? expect.any(Number) : 0;
  const spawn = (fixture: string, options?: Parameters<typeof spawnInspected>[2]) =>
    spawnInspected(exe!, fixture, options);

  describe.each([
    ["inspector.waitForDebugger()", `inspector.open(0, "127.0.0.1");`, `inspector.waitForDebugger()`, false],
    ["inspector.open(port, host, true)", ``, `inspector.open(0, "127.0.0.1", true)`, true],
    [
      "inspector.open(port, host, true) after a close()",
      `inspector.open(0, "127.0.0.1"); inspector.close();`,
      `inspector.open(0, "127.0.0.1", true)`,
      true,
    ],
  ])("%s", (_name, setup, call, urlIsPrintedInsideTheCall) => {
    inspectedTest("does not run the event loop while it waits", async () => {
      await using inspected = await spawn(
        `
${setup}
insideTheCall(() => ${call});
finish({ evaluatedByClient: globalThis.evaluatedByClient });
`,
        { urlIsPrintedInsideTheCall },
      );

      const frontend = await attachFrontend(inspected);
      // The reply can only come from inside the call: the program is still in
      // it, and it stays there until the client resumes it below.
      await frontend.send(...evaluate("globalThis.evaluatedByClient = 'inside the call: ' + globalThis.insideTheCall"));
      frontend.send("Runtime.runIfWaitingForDebugger");

      expect(await inspected.finished()).toEqual({
        reported: { ...nothingRan, evaluatedByClient: "inside the call: true" },
        exitCode,
      });
    });
  });

  // The call is made from an I/O callback while a second socket is readable. A
  // wait that polls the loop would run the second callback inside the first.
  inspectedTest("from a socket callback does not run the callback of another socket", async () => {
    await using inspected = await spawn(`
inspector.open(0, "127.0.0.1");

const order = [];
const done = Promise.withResolvers();
const log = what => {
  order.push(what);
  if (order.length === 5) done.resolve();
};

let sockets = 0;
const pairListening = Promise.withResolvers();
const pair = createServer(socket =>
  socket.on("data", () => {
    if (++sockets === 2) return log("second data");
    log("first data");
    queueMicrotask(() => log("microtask"));
    setTimeout(() => log("timer"), 0);
    insideTheCall(() => inspector.waitForDebugger());
    log("returned");
  }),
);
pair.listen(0, "127.0.0.1", pairListening.resolve);
await pairListening.promise;

const clients = [];
for (let i = 0; i < 2; i++) {
  const open = Promise.withResolvers();
  clients.push(connect(pair.address().port, "127.0.0.1", open.resolve));
  await open.promise;
}
for (const client of clients) client.write("x");

await done.promise;
const returned = order.indexOf("returned");
finish({ beforeItReturned: order.slice(0, returned), afterItReturned: order.slice(returned + 1).sort() });
`);

    const frontend = await attachFrontend(inspected);
    frontend.send("Runtime.runIfWaitingForDebugger");

    expect(await inspected.finished()).toEqual({
      reported: {
        ...nothingRan,
        beforeItReturned: ["first data"],
        afterItReturned: ["microtask", "second data", "timer"],
      },
      exitCode,
    });
  });

  // The first frontend leaves without resuming the program. Its disconnect is
  // finished inside the wait, before the second frontend attaches. Finished
  // after the wait, it would reset the Debugger domain that the second
  // frontend enabled, and the program would run past the debugger statement.
  inspectedTest("keeps waiting when a frontend leaves, and the next one can pause the program", async () => {
    await using inspected = await spawn(
      `
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
const { afterTheStatement } = await import("./paused.mjs");
finish({ afterTheStatement });
`,
      { files: { "paused.mjs": `debugger;\nexport const afterTheStatement = true;\n` } },
    );

    const first = await attachFrontend(inspected);
    await first.send("Debugger.enable");
    if (isLinux) await sleeps(inspected.proc.pid);
    await first.close();
    if (isLinux) await sleeps(inspected.proc.pid);

    const second = await attachFrontend(inspected);
    await second.send("Runtime.enable");
    await second.send("Debugger.enable");
    const paused = second.notified("Debugger.paused");
    await second.send("Runtime.runIfWaitingForDebugger");
    expect((await paused).reason).toBe("other");
    second.send("Debugger.resume");

    expect(await inspected.finished()).toEqual({
      reported: { ...nothingRan, afterTheStatement: true },
      exitCode,
    });
  });

  inspectedTest("with two frontends attached, each one gets the pause", async () => {
    await using inspected = await spawn(
      `
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
const { afterTheStatement } = await import("./paused.mjs");
finish({ afterTheStatement });
`,
      { files: { "paused.mjs": `debugger;\nexport const afterTheStatement = true;\n` } },
    );

    // One command at a time: the replies to commands that two frontends send
    // at the same moment are not told apart.
    const first = await attachFrontend(inspected);
    await first.send("Debugger.enable");
    const second = await attachFrontend(inspected);
    await second.send("Runtime.enable");
    await second.send("Debugger.enable");
    const pauses = [first.notified("Debugger.paused"), second.notified("Debugger.paused")];
    await second.send("Runtime.runIfWaitingForDebugger");
    expect((await Promise.all(pauses)).map(pause => pause.reason)).toEqual(["other", "other"]);
    second.send("Debugger.resume");

    expect(await inspected.finished()).toEqual({
      reported: { ...nothingRan, afterTheStatement: true },
      exitCode,
    });
  });

  inspectedTest("returns when the client resumes the program and closes its socket at once", async () => {
    await using inspected = await spawn(`
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
finish();
`);

    const frontend = await attachFrontend(inspected);
    frontend.send("Runtime.runIfWaitingForDebugger");
    await frontend.close();

    expect(await inspected.finished()).toEqual({ reported: nothingRan, exitCode });
  });

  // The resume arrives while an expression of the same client runs, and the
  // client is gone when the expression ends. The resume is delivered before
  // the disconnect of that client is finished. The second client is attached
  // when the debugger thread has handled the close of the first.
  inspectedTest("returns when the client resumes and leaves while one of its expressions runs", async () => {
    await using inspected = await spawn(`
globalThis.evaluated = [];
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
finish({ evaluated: globalThis.evaluated });
`);
    const gate = join(inspected.dir, "gate");

    const first = await attachFrontend(inspected);
    await first.send("Runtime.enable");
    const began = first.notified("Runtime.consoleAPICalled");
    first.send(
      ...evaluate(
        `console.log('began'); while (!globalThis.existsSync(${JSON.stringify(gate)})); globalThis.evaluated.push('slow expression')`,
      ),
    );
    await began;
    first.send("Runtime.runIfWaitingForDebugger");
    await first.close();
    await attachFrontend(inspected);
    writeFileSync(gate, "");

    expect(await inspected.finished()).toEqual({
      reported: { ...nothingRan, evaluated: ["slow expression"] },
      exitCode,
    });
  });

  // A program starts its own frontend, as a debugger extension does with its
  // bootloader. The helper is a process, so it runs while the program waits.
  inspectedTest("returns when a helper that the program started resumes it", async () => {
    await using inspected = await spawn(
      `
import { spawn } from "node:child_process";
import { join } from "node:path";
inspector.open(0, "127.0.0.1");
spawn(process.execPath, [join(import.meta.dirname, "helper.mjs"), inspector.url()], { stdio: "inherit" });
insideTheCall(() => inspector.waitForDebugger());
finish();
`,
      {
        files: {
          "helper.mjs": `
const ws = new WebSocket(process.argv[2]);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.runIfWaitingForDebugger", params: {} }));
ws.onclose = () => process.exit(0);
ws.onerror = () => process.exit(1);
`,
        },
      },
    );

    expect(await inspected.finished()).toEqual({ reported: nothingRan, exitCode });
  });

  // A call inside the wait returns at once, and the second expression runs
  // after it. The client sends that expression when the first one has begun,
  // so the two are never delivered in one batch. The nested call arms the wait
  // before it returns:
  // https://github.com/nodejs/node/blob/v26.3.0/src/inspector_agent.cc#L535-L541
  inspectedTest("a call that the client evaluates inside the wait returns at once", async () => {
    await using inspected = await spawn(`
globalThis.evaluated = [];
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
finish({ evaluated: globalThis.evaluated });
`);

    const frontend = await attachFrontend(inspected);
    await frontend.send("Runtime.enable");
    const began = frontend.notified("Runtime.consoleAPICalled");
    frontend.send(
      ...evaluate(
        "console.log('began'); globalThis.inspectorOfTheProgram.waitForDebugger(); globalThis.evaluated.push('the nested call')",
      ),
    );
    await began;
    await frontend.send(...evaluate("globalThis.evaluated.push('the next expression')"));
    frontend.send("Runtime.runIfWaitingForDebugger");

    expect(await inspected.finished()).toEqual({
      reported: { ...nothingRan, evaluated: ["the nested call", "the next expression"] },
      exitCode,
    });
  });

  // close() ends the wait of Bun, and the open(port, host, true) after it arms
  // the wait again: the program stays in the call until a client of the new
  // server resumes it.
  inspectedTest(
    "open(port, host, true) that the client evaluates after close() keeps the program in the wait",
    async () => {
      await using inspected = await spawn(`
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
finish({ evaluatedByClient: globalThis.evaluatedByClient });
`);

      const first = await attachFrontend(inspected);
      first.send(
        ...evaluate(
          "globalThis.inspectorOfTheProgram.close(); globalThis.inspectorOfTheProgram.open(0, '127.0.0.1', true)",
        ),
      );

      const second = await attachFrontend(inspected, await inspected.urlAfter(inspected.wsUrl));
      await second.send(...evaluate("globalThis.evaluatedByClient = 'inside the call: ' + globalThis.insideTheCall"));
      second.send("Runtime.runIfWaitingForDebugger");

      expect(await inspected.finished()).toEqual({
        reported: { ...nothingRan, evaluatedByClient: "inside the call: true" },
        exitCode,
      });
    },
  );

  // At a breakpoint the call returns at once on both runtimes. Node keeps the
  // request: the program stays stopped after Debugger.resume until a client
  // sends Runtime.runIfWaitingForDebugger. Bun drops it, because the pause ends
  // on Debugger.resume and nothing would run a wait that was armed inside it.
  // https://github.com/nodejs/node/blob/v26.3.0/src/inspector_agent.cc#L778-L803
  inspectedTest("a call that the client evaluates at a breakpoint returns at once", async () => {
    await using inspected = await spawn(
      `
globalThis.evaluated = [];
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
await import("./paused.mjs");
finish({ evaluated: globalThis.evaluated });
`,
      { files: { "paused.mjs": `debugger;\n` } },
    );

    const frontend = await attachFrontend(inspected);
    await frontend.send("Runtime.enable");
    await frontend.send("Debugger.enable");
    const paused = frontend.notified("Debugger.paused");
    await frontend.send("Runtime.runIfWaitingForDebugger");
    await paused;

    const began = frontend.notified("Runtime.consoleAPICalled");
    frontend.send(
      ...evaluate(
        "console.log('began'); globalThis.inspectorOfTheProgram.waitForDebugger(); globalThis.evaluated.push('the nested call')",
      ),
    );
    await began;
    await frontend.send(...evaluate("globalThis.evaluated.push('the next expression')"));
    const evaluated = await frontend.send(...evaluate("globalThis.evaluated.join()"));
    expect(evaluated.result.result.value).toBe("the nested call,the next expression");

    frontend.send("Debugger.resume");
    if (runtime === "node") frontend.send("Runtime.runIfWaitingForDebugger");

    expect(await inspected.finished()).toEqual({
      reported: { ...nothingRan, evaluated: ["the nested call", "the next expression"] },
      exitCode,
    });
  });
});

// A client attaches, resumes and leaves while the program is busy, before the
// call. Bun keeps what the client sent, so the call returns. Node handles the
// message in an interrupt before the call, and the call then waits for a new
// one.
test.concurrent("inspector.waitForDebugger() returns on the resume of a client that left before the call", async () => {
  await using inspected = await spawnInspected(
    bunExe(),
    `
inspector.open(0, "127.0.0.1");
writeSync(2, "BUSY\\n");
while (!existsSync("gate"));
insideTheCall(() => inspector.waitForDebugger());
finish();
`,
    { until: "BUSY\n" },
  );

  const first = await attachFrontend(inspected);
  first.send("Runtime.runIfWaitingForDebugger");
  await first.close();
  await attachFrontend(inspected);
  writeFileSync(join(inspected.dir, "gate"), "");

  expect(await inspected.finished()).toEqual({ reported: nothingRan, exitCode: 0 });
});

// No frontend can reach a stopped server to resume the program, so the wait
// of Bun ends with it. Node closes the socket and stays in the wait:
// https://github.com/nodejs/node/blob/v26.3.0/src/inspector_agent.cc#L923-L925
test.concurrent("inspector.waitForDebugger() returns when the client evaluates inspector.close()", async () => {
  await using inspected = await spawnInspected(
    bunExe(),
    `
inspector.open(0, "127.0.0.1");
insideTheCall(() => inspector.waitForDebugger());
finish({ url: String(inspector.url()) });
`,
  );

  const frontend = await attachFrontend(inspected);
  frontend.send(...evaluate("globalThis.inspectorOfTheProgram.close()"));

  expect(await inspected.finished()).toEqual({
    reported: { ...nothingRan, url: "undefined" },
    exitCode: 0,
  });
});

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

// Activating breakpoints on a debugger that was attached at runtime (after the
// entry module has already been linked) used to crash the inspected process:
// JSC's clearCode discarded the module's UnlinkedModuleProgramCodeBlock, and
// the next executeModuleProgram regenerated it under CodeGenerationMode::
// Debugger with a different module-environment / generator-frame layout, so the
// resumed top-level-await body wrote past the live JSModuleEnvironment.
test("activating breakpoints with a runtime-attached debugger does not crash module evaluation", async () => {
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

  const decoder = new TextDecoder();
  const stderrReader = proc.stderr.getReader();
  let stderrText = "";
  let wsUrl: string | undefined;
  while (!wsUrl) {
    const { value, done } = await stderrReader.read();
    if (done) throw new Error(`stderr closed before listening line: ${stderrText}`);
    stderrText += decoder.decode(value);
    wsUrl = stderrText.match(/ws:\/\/[\w.:-]+\/runtime-attach/)?.[0];
  }
  const stderrDrained = (async () => {
    for (;;) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderrText += decoder.decode(value);
    }
  })();

  const stdoutReader = proc.stdout.getReader();
  let stdoutText = "";
  async function waitForStdout(marker: string) {
    while (!stdoutText.includes(marker)) {
      const { value, done } = await stdoutReader.read();
      if (done) throw new Error(`stdout closed before "${marker}": ${stdoutText}\n${stderrText}`);
      stdoutText += decoder.decode(value);
    }
  }
  await waitForStdout("ready");

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
  await waitForStdout("importing");
  await waitForStdout("}\n");
  ws.close();

  expect(JSON.parse(stdoutText.trim().split("\n").at(-1)!)).toEqual({ after: 1, bump: 1, warm: 10 });
  expect(await proc.exited).toBe(0);
  await stderrDrained;
});

// End-to-end pause/resume over the DevTools-protocol server started by
// inspector.open(): the entry module is a top-level-await module that calls
// open() at runtime, the client attaches and enables the Debugger domain
// (which the adapter activates breakpoints for), the entry module then imports
// a module containing `debugger;`, and the client resumes the pause.
test("breakpoints pause and resume over the inspector.open() DevTools server", async () => {
  using dir = tempDir("inspector-breakpoints", {
    // wait=true blocks the inspected thread inside open() until
    // Runtime.runIfWaitingForDebugger, so Debugger.enable is guaranteed to
    // have armed setPauseOnDebuggerStatements before mod.mjs evaluates.
    "entry.mjs": `
import inspector from "node:inspector";
let beforeOpen = 1;
inspector.open(0, "127.0.0.1", true);
const mod = await import("./mod.mjs");
console.log(JSON.stringify({ after: mod.after, beforeOpen }));
inspector.close();
process.exit(0);
`,
    "mod.mjs": `
let counter = 0;
debugger;
let after = counter + 1;
export { after };
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  const stderrReader = proc.stderr.getReader();
  let stderrText = "";
  let wsUrl: string | undefined;
  while (!wsUrl) {
    const { value, done } = await stderrReader.read();
    if (done) throw new Error(`stderr closed before listening line: ${stderrText}`);
    stderrText += decoder.decode(value);
    wsUrl = stderrText.match(/Debugger listening on (ws:\S+)/)?.[1];
  }
  const stderrDrained = (async () => {
    for (;;) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderrText += decoder.decode(value);
    }
  })();

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = err => reject(err);
  });
  let nextId = 1;
  let awaiting = "";
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let pausedReason: string | undefined;
  const paused = Promise.withResolvers<void>();
  ws.onmessage = event => {
    const msg = JSON.parse(String(event.data));
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === "Debugger.paused") {
      pausedReason = msg.params?.reason;
      paused.resolve();
    }
  };
  // Every awaited promise must reject on socket loss or child death so the
  // failure reports where it was stuck instead of silently hitting the suite
  // timeout with no stack.
  const abandon = (why: string) => {
    const err = new Error(`${why} while awaiting ${awaiting}; stderr: ${stderrText}`);
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
  await paused.promise;
  expect(pausedReason).toBe("other");
  // Do not wait for the resume reply: the inspected thread may reach
  // process.exit(0) before the debugger thread has relayed it, which closes
  // the socket first. The JSON on stdout is the real proof the resume landed.
  ws.send(JSON.stringify({ id: nextId++, method: "Debugger.resume" }));

  const stdoutReader = proc.stdout.getReader();
  let stdoutText = "";
  for (;;) {
    const { value, done } = await stdoutReader.read();
    if (done) break;
    stdoutText += decoder.decode(value);
  }
  ws.close();
  await stderrDrained;

  expect(JSON.parse(stdoutText.trim().split("\n").at(-1)!)).toEqual({ after: 1, beforeOpen: 1 });
  expect(await proc.exited).toBe(0);
});

// JSC's Debugger.scriptParsed classifies a script with scriptType ("program",
// "module" or "webassembly"); V8 clients read isModule and scriptLanguage. The
// fixture is its own CDP client: it enables the Debugger domain, then loads one
// script of each kind and prints what the adapter reported for them.
const scriptParsedFixture = `
import inspector from "node:inspector";

inspector.open(0, "127.0.0.1", false);
const ws = new WebSocket(inspector.url());
const pending = new Map();
const scripts = [];
let nextId = 1;
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method === "Debugger.scriptParsed") {
    scripts.push(message.params);
  }
};
const send = (method, params) =>
  new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise(resolve => (ws.onopen = resolve));

await send("Debugger.enable", {});
await import("./esm.mjs");
await import("./lib.cjs");
// The empty module: just the wasm magic and version.
new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
// The backend answers commands through the same ordered queue it emits events
// on, so this reply arriving proves the scriptParsed events for the three
// scripts above have arrived too.
await send("Debugger.setBreakpointsActive", { active: true });
inspector.close();

console.log(
  JSON.stringify(
    scripts
      .filter(({ url }) => /\\/esm\\.mjs$|\\/lib\\.cjs$|\\.wasm$/.test(url))
      .map(({ url, isModule, scriptLanguage }) => ({ url, isModule, scriptLanguage })),
  ),
);
`;

test("Debugger.scriptParsed reports isModule and scriptLanguage from JSC's scriptType", async () => {
  using dir = tempDir("inspector-script-parsed", {
    "fixture.mjs": scriptParsedFixture,
    "esm.mjs": `export const esm = true;\n`,
    "lib.cjs": `module.exports = { cjs: true };\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderrIfFailed: "", exitCode: 0 });

  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual([
    { url: expect.stringMatching(/^file:\/\/.*\/esm\.mjs$/), isModule: true, scriptLanguage: "JavaScript" },
    { url: expect.stringMatching(/^file:\/\/.*\/lib\.cjs$/), isModule: false, scriptLanguage: "JavaScript" },
    // JSC names a WebAssembly.Module compiled from bytes <n>.wasm itself.
    { url: expect.stringMatching(/\.wasm$/), isModule: false, scriptLanguage: "WebAssembly" },
  ]);
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
