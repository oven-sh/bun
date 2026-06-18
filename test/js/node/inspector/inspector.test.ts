import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import inspector from "node:inspector";

test("inspector.url()", () => {
  expect(inspector.url()).toBeUndefined();
});

test("inspector.console", () => {
  expect(inspector.console).toBeObject();
});

test("inspector.close() is a no-op when the inspector is not open", () => {
  expect(() => inspector.close()).not.toThrow();
});

test("inspector.waitForDebugger() throws when the inspector is not active", () => {
  expect(() => inspector.waitForDebugger()).toThrow("Inspector was not activated");
});

// inspector.open() starts a WebSocket server speaking the V8 Chrome DevTools
// Protocol (translated to JSC's inspector protocol on the debugger thread).
// The fixture opens the inspector, talks to its own server as a CDP client,
// and prints one JSON summary line for the assertions below.
const openInspectorFixture = `
import inspector from "node:inspector";
import assert from "node:assert";

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

const ws = new WebSocket(url);
const pending = new Map();
const events = [];
let nextId = 1;
let consoleEventResolve;
const consoleEventPromise = new Promise(resolve => (consoleEventResolve = resolve));
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  } else {
    events.push(message);
    if (message.method === "Runtime.consoleAPICalled" && message.params.args?.[0]?.value === "tagged-console-call") {
      consoleEventResolve(message.params);
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
const evaluate = await send("Runtime.evaluate", { expression: "6 * 7" });
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
    executionContextCreated: events.some(event => event.method === "Runtime.executionContextCreated"),
    scriptParsedCount: events.filter(event => event.method === "Debugger.scriptParsed").length,
    debuggerEnable: debuggerEnable.result,
    evaluateValue: evaluate.result?.result?.value,
    consoleEventType: consoleEvent.type,
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
  expect(summary.executionContextCreated).toBe(true);
  expect(summary.scriptParsedCount).toBeGreaterThan(0);
  expect(summary.debuggerEnable).toEqual({ debuggerId: expect.any(String) });
  expect(summary.evaluateValue).toBe(42);
  expect(summary.consoleEventType).toBe("log");
  expect(summary.unknownError).toEqual({ code: -32601, message: "'Totally.bogus' wasn't found" });
  expect(summary.urlAfterClose).toBeNull();
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
