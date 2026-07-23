import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import inspector from "node:inspector";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Node prints this and blocks while a CDP frontend is still attached at exit.
const DISCONNECT_NOTICE = "Waiting for the debugger to disconnect...";

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
process.exit(resumedByClient ? 0 : 7);
`;

test("inspector.waitForDebugger() blocks until a client resumes the process", async () => {
  using dir = tempDir("inspector-wait", {
    "fixture.mjs": waitForDebuggerFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    // The client drives Runtime.evaluate in the child, which trips the
    // WebKit-internal evaluateWithScopeExtension validator abort this file
    // is exempted from; children must not re-inherit the validator env.
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: undefined, BUN_JSC_dumpSimulatedThrows: undefined },
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
  const waitingToDisconnect = Promise.withResolvers<void>();
  const drained = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stderrText += decoder.decode(value);
      if (stderrText.includes(DISCONNECT_NOTICE)) waitingToDisconnect.resolve();
    }
    // Resolve on EOF too so a regressed handshake fails on the assertion below
    // rather than hanging until the suite timeout.
    waitingToDisconnect.resolve();
  })();

  // Node's exit handshake: the fixture is done but blocks while this client is
  // still attached, so detach before awaiting exit.
  await waitingToDisconnect.promise;
  expect(stderrText).toContain(DISCONNECT_NOTICE);
  ws.close();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  await drained;

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
process.exit(0);
`;

test("inspector.waitForDebugger() blocks again on the second call after a frontend disconnects", async () => {
  using dir = tempDir("inspector-wait-twice", {
    "fixture.mjs": waitForDebuggerTwiceFixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    // Same validator-env strip as the single-wait test above.
    env: { ...bunEnv, BUN_JSC_validateExceptionChecks: undefined, BUN_JSC_dumpSimulatedThrows: undefined },
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

test("Session errors carry Node's ERR_INSPECTOR_* codes and post() validates its arguments", async () => {
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
  // Like Node, a callback-less post() of an unknown method returns undefined
  // rather than throwing; the ERR_INSPECTOR_COMMAND error goes to the callback.
  expect(() => session.post("Nonexistent.domain")).not.toThrow();
  expect(session.post("Nonexistent.domain")).toBeUndefined();
  // The Network handlers follow the same contract: protocol errors reach the
  // callback and are unobservable without one (node returns undefined here).
  session.post("Network.enable");
  expect(session.post("Network.getResponseBody", { requestId: "nope" })).toBeUndefined();
  expect(session.post("Network.getRequestPostData", { requestId: "nope" })).toBeUndefined();
  expect(session.post("Network.streamResourceContent", { requestId: "nope" })).toBeUndefined();
  {
    const { promise, resolve } = Promise.withResolvers<any>();
    session.post("Network.getResponseBody", { requestId: "nope" }, err => resolve(err));
    const bodyErr = await promise;
    expect(bodyErr).toBeInstanceOf(Error);
    expect(bodyErr.code).toBe("ERR_INSPECTOR_COMMAND");
  }
  session.post("Network.disable");
  const { promise: errPromise, resolve: resolveErr } = Promise.withResolvers<any>();
  session.post("Nonexistent.domain", err => resolveErr(err));
  const unknownErr = await errPromise;
  expect(unknownErr).toBeInstanceOf(Error);
  expect(unknownErr.code).toBe("ERR_INSPECTOR_COMMAND");
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
    // wait=true blocks the inspected thread in waitForDebugger()'s tick loop
    // until Runtime.runIfWaitingForDebugger, so Debugger.enable is guaranteed
    // to have armed setPauseOnDebuggerStatements before mod.mjs evaluates.
    "entry.mjs": `
import inspector from "node:inspector";
let beforeOpen = 1;
inspector.open(0, "127.0.0.1", true);
const mod = await import("./mod.mjs");
console.log(JSON.stringify({ after: mod.after, beforeOpen }));
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
  const waitingToDisconnect = Promise.withResolvers<void>();
  const stderrDrained = (async () => {
    for (;;) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderrText += decoder.decode(value);
      if (stderrText.includes(DISCONNECT_NOTICE)) waitingToDisconnect.resolve();
    }
    // Resolve on EOF too so a regressed handshake fails on the assertion below
    // rather than hanging until the suite timeout.
    waitingToDisconnect.resolve();
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

  // process.exit(0) blocks in Node's exit handshake while this client is
  // attached, so detach once the child announces the wait; stdout only reaches
  // EOF after the child is actually gone.
  awaiting = "the exit handshake";
  await waitingToDisconnect.promise;
  expect(stderrText).toContain(DISCONNECT_NOTICE);
  ws.close();

  const stdoutReader = proc.stdout.getReader();
  let stdoutText = "";
  for (;;) {
    const { value, done } = await stdoutReader.read();
    if (done) break;
    stdoutText += decoder.decode(value);
  }
  await stderrDrained;

  expect(JSON.parse(stdoutText.trim().split("\n").at(-1)!)).toEqual({ after: 1, beforeOpen: 1 });
  expect(await proc.exited).toBe(0);
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

// Line 0 is a comment, 1/3/4/8 are blank, the `if` on line 5 folds away and the
// quotes on line 2 are rewritten: nothing about the transpiler's output lines
// up with this file, which is what makes it a position oracle.
const transpileShiftFixture = `// leading comment

const s = 'single quotes';


if (1 > 0) {
  // folded
}

function f() {
  debugger;
}
setInterval(f, 50);
`;

// Drives one inspector endpoint of a `--inspect-brk` child to its first two
// pauses. `banner` picks the endpoint out of the startup notice.
async function pausesAt(banner: RegExp, enable: [string, unknown?][], resume: string) {
  const dir = tempDir("inspector-positions", { "gnarly.js": transpileShiftFixture });
  const proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-brk=0", "gnarly.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  // Any throw below (banner timeout, rejected send, failed pause wait) must
  // not leak the never-exiting --inspect-brk child or its temp dir.
  const reap = async () => {
    proc.kill();
    // Windows: the child must exit before rm'ing its cwd or rmSync EBUSYs.
    await proc.exited;
    dir[Symbol.dispose]();
  };
  try {
    const decoder = new TextDecoder();
    const stderrReader = proc.stderr.getReader();
    let stderrText = "";
    let wsUrl: string | undefined;
    while (!wsUrl) {
      const { value, done } = await stderrReader.read();
      if (done) throw new Error(`stderr closed before the banner: ${stderrText}`);
      stderrText += decoder.decode(value);
      wsUrl = stderrText.match(banner)?.[1];
    }

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = err => reject(err);
    });
    let nextId = 1;
    let awaiting = "";
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const scripts = new Map<string, any>();
    const pauses: any[] = [];
    let wantPauses = 1;
    let sawPauses = Promise.withResolvers<void>();
    ws.onmessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      } else if (msg.method === "Debugger.scriptParsed") {
        scripts.set(msg.params.scriptId, msg.params);
      } else if (msg.method === "Debugger.paused") {
        pauses.push(msg.params);
        if (pauses.length >= wantPauses) sawPauses.resolve();
      }
    };
    const abandon = (why: string) => {
      const err = new Error(`${why} while awaiting ${awaiting}; stderr: ${stderrText}`);
      sawPauses.reject(err);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
    ws.onerror = () => abandon("inspector websocket errored");
    ws.onclose = () => abandon("inspector websocket closed");
    proc.exited.then(code => abandon(`child exited (code ${code})`));
    function send(method: string, params?: unknown): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        awaiting = method;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    for (const [method, params] of enable) await send(method, params ?? {});
    await send(resume, {});

    awaiting = "the break-on-start pause";
    await sawPauses.promise;
    const userScript = [...scripts.values()].find(script =>
      String(script.url ?? script.sourceURL ?? "").endsWith("gnarly.js"),
    );

    // Resume into the interval callback's `debugger`.
    wantPauses = 2;
    sawPauses = Promise.withResolvers<void>();
    ws.send(JSON.stringify({ id: nextId++, method: "Debugger.resume", params: {} }));
    awaiting = "the debugger-statement pause";
    await sawPauses.promise;

    const done = async () => {
      ws.close();
      await reap();
    };
    return { send, done, userScript, pauses, line: (n: number) => pauses[n].callFrames[0].location.lineNumber };
  } catch (err) {
    await reap().catch(() => {});
    throw err;
  }
}

test("CDP clients see positions and source from the file the user wrote", async () => {
  const { send, done, userScript, line } = await pausesAt(
    /Debugger listening on (ws:\S+)/,
    [["Runtime.enable"], ["Debugger.enable"]],
    "Runtime.runIfWaitingForDebugger",
  );

  try {
    // Node reports both of these against the original file. Bun prepends the
    // break-on-start `debugger;` and reflows everything below it, so untranslated
    // these are lines 0 and 4.
    expect(line(0)).toBe(2);
    expect(line(1)).toBe(10);

    const { scriptSource } = await send("Debugger.getScriptSource", { scriptId: userScript.scriptId });
    expect(scriptSource).toBe(transpileShiftFixture);
    // Bun's own map describes text this client never sees; forwarding it would
    // make a client that applies source maps translate a second time.
    expect(userScript.sourceMapURL).toBe("");
    expect(userScript.endLine).toBe(13);

    // A breakpoint is named in the same coordinates and comes back in them.
    const resolved = await send("Debugger.setBreakpointByUrl", { lineNumber: 1, url: userScript.url });
    expect(resolved.locations[0].lineNumber).toBe(2);
  } finally {
    await done();
  }
}, 30_000);

test("JSC-protocol clients keep seeing generated positions and Bun's source map", async () => {
  const { send, done, userScript, line } = await pausesAt(
    /Listening:\s*\n\s*(ws:\S+)/,
    [
      ["Inspector.enable"],
      ["Runtime.enable"],
      ["Debugger.enable"],
      ["Debugger.setBreakpointsActive", { active: true }],
      ["Debugger.setPauseOnDebuggerStatements", { enabled: true }],
    ],
    "Inspector.initialized",
  );

  try {
    // debug.bun.sh and the VS Code extension apply the map themselves, so this
    // endpoint must keep reporting the transpiler's own coordinates.
    expect(line(0)).toBe(0);
    expect(line(1)).toBe(4);

    const { scriptSource } = await send("Debugger.getScriptSource", { scriptId: userScript.scriptId });
    expect(scriptSource).toContain("//# sourceMappingURL=data:application/json;base64,");
    expect(scriptSource.split("\n")[0]).toBe("debugger;");
    expect(userScript.sourceMapURL).toStartWith("data:application/json");
  } finally {
    await done();
  }
}, 30_000);
// The lazy module reuses the fixture's shift-inducing shape (quote rewrite,
// blank-line collapse) so its original coordinates differ from the
// transpiler's output; `poke` runs on a timer so the parse-time breakpoint
// re-resolution has completed before the line executes.
const lazyShiftFixture = `// leading comment

const value = 'single quotes';


if (1 > 0) {
  // folded
}

export function poke() {
  return value.length;
}
setTimeout(poke, 500);
`;

test("a by-URL breakpoint set before its script parses is re-resolved through the map", async () => {
  const dir = tempDir("inspector-preparse-bp", {
    "main.js": `await import("./lazy.js");\n`,
    "lazy.js": lazyShiftFixture,
  });
  const proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-brk=0", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    const decoder = new TextDecoder();
    const stderrReader = proc.stderr.getReader();
    let stderrText = "";
    let wsUrl: string | undefined;
    while (!wsUrl) {
      const { value, done } = await stderrReader.read();
      if (done) throw new Error(`stderr closed before the banner: ${stderrText}`);
      stderrText += decoder.decode(value);
      wsUrl = stderrText.match(/Debugger listening on (ws:\S+)/)?.[1];
    }

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = err => reject(err);
    });
    let nextId = 1;
    let awaiting = "";
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const pauses: any[] = [];
    let wantPauses = 1;
    let sawPauses = Promise.withResolvers<void>();
    ws.onmessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      } else if (msg.method === "Debugger.paused") {
        pauses.push(msg.params);
        if (pauses.length >= wantPauses) sawPauses.resolve();
      }
    };
    const abandon = (why: string) => {
      const err = new Error(`${why} while awaiting ${awaiting}; stderr: ${stderrText}`);
      sawPauses.reject(err);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
    ws.onerror = () => abandon("inspector websocket errored");
    ws.onclose = () => abandon("inspector websocket closed");
    proc.exited.then(code => abandon(`child exited (code ${code})`));
    function send(method: string, params?: unknown): Promise<any> {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        awaiting = method;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send("Runtime.enable", {});
    await send("Debugger.enable", {});

    // lazy.js has not parsed yet: the breakpoint names original line 10
    // (\`return value.length;\`), which only lands there if the adapter
    // re-translates once the script's map exists.
    const fileUrl = pathToFileURL(join(String(dir), "lazy.js")).href;
    const set = await send("Debugger.setBreakpointByUrl", { lineNumber: 10, url: fileUrl });
    expect(typeof set.breakpointId).toBe("string");

    await send("Runtime.runIfWaitingForDebugger", {});
    awaiting = "the break-on-start pause";
    await sawPauses.promise;

    wantPauses = 2;
    sawPauses = Promise.withResolvers<void>();
    ws.send(JSON.stringify({ id: nextId++, method: "Debugger.resume", params: {} }));
    awaiting = "the pre-parse breakpoint pause";
    await sawPauses.promise;

    const hit = pauses[1];
    // The pause reports the line the user named, in original coordinates,
    // and credits the breakpointId the client was originally given.
    expect(hit.callFrames[0].location.lineNumber).toBe(10);
    expect(hit.hitBreakpoints).toEqual([set.breakpointId]);
    ws.close();
  } finally {
    proc.kill();
    // Windows: the child must exit before rm'ing its cwd or rmSync EBUSYs.
    await proc.exited;
    dir[Symbol.dispose]();
  }
}, 30_000);

test("Debugger.paused from a pause nested inside a post() dispatch reaches listeners before execution continues", async () => {
  // A debugger statement evaluated via session.post pauses inside the
  // dispatch; the event must deliver synchronously so the listener can use
  // the pause (evaluateOnCallFrame) before resuming.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const inspector = require("node:inspector");
const session = new inspector.Session();
session.connect();
session.post("Debugger.enable");
let sawPausedDuringDispatch = false;
let evalOnFrame;
session.on("Debugger.paused", function onPaused(msg) {
  sawPausedDuringDispatch = true;
  session.post(
    "Debugger.evaluateOnCallFrame",
    { callFrameId: msg.params.callFrames[0].callFrameId, expression: "1+1" },
    function onEval(err, res) {
      evalOnFrame = err ? String(err.message) : res?.result?.value;
    },
  );
  session.post("Debugger.resume");
});
session.post("Runtime.evaluate", { expression: "debugger; 42" }, function onDone(err, res) {
  console.log(JSON.stringify({ sawPausedDuringDispatch, evalOnFrame, result: res?.result?.value }));
});`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({ sawPausedDuringDispatch: true, evalOnFrame: 2, result: 42 });
  expect(exitCode).toBe(0);
});
