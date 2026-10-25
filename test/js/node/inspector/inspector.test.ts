import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, nodeExe, tempDir } from "harness";
import inspector from "node:inspector";
import net from "node:net";
import { rawRequest, requestWithUnusableHosts, unusableHosts, upgradeHeaders } from "../../../cli/inspect/raw-http";

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

/**
 * Starts `runtime` with a script that opens the inspector on `bindHost` and prints its URL. The child lives
 * until its stdin ends, so it cannot outlive a test process that was killed.
 */
function spawnInspector(bindHost: string, runtime = bunExe()) {
  return Bun.spawn({
    cmd: [
      runtime,
      "-e",
      `const inspector = require("node:inspector");
       inspector.open(0, ${JSON.stringify(bindHost)}, false);
       console.log(inspector.url());
       process.stdin.on("data", () => {});
       process.stdin.on("end", () => process.exit(0));`,
    ],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
}

/** The URL that a child of `spawnInspector` printed. */
async function inspectorUrl(proc: ReturnType<typeof spawnInspector>) {
  const decoder = new TextDecoder();
  let line = "";
  for await (const chunk of proc.stdout) {
    line += decoder.decode(chunk);
    if (line.includes("\n")) break;
  }
  const url = line.trim();
  // A failed inspector.open() prints "undefined".
  expect(url).toMatch(/^ws:\/\/\S+:\d+\/[0-9a-f-]{36}$/);
  return new URL(url);
}

// GET /json/version, GET /json/list and the WebSocket upgrade answer a request
// that has no Host header, or an empty one, as Node does (IsAllowedHost):
// https://github.com/nodejs/node/blob/v26.3.0/src/inspector_socket.cc#L642-L646
// A Host that Bun.serve could not build request.url from is answered 400.
test("inspector.open() answers a request without a Host header and refuses an unusable Host", async () => {
  await using proc = spawnInspector("127.0.0.1");
  const { href: url, hostname, host, port, pathname } = await inspectorUrl(proc);
  expect(hostname).toBe("127.0.0.1");
  const address = { port: Number(port), host: "127.0.0.1" };
  const version = {
    status: "HTTP/1.1 200 OK",
    body: { "Browser": expect.stringContaining("Bun/"), "Protocol-Version": "1.1" },
  };
  // Without a Host header, the target list names the local address of the connection.
  // On a 127.0.0.1 bind that is the address the server is bound to.
  const list = {
    status: "HTTP/1.1 200 OK",
    body: [
      expect.objectContaining({
        webSocketDebuggerUrl: url,
        devtoolsFrontendUrl: expect.stringContaining(`ws=${host}${pathname}`),
      }),
    ],
  };
  const switchingProtocols = { status: "HTTP/1.1 101 Switching Protocols", body: "" };
  const badRequest = { status: "HTTP/1.1 400 Bad Request", body: "" };
  const notFound = { status: "HTTP/1.1 404 Not Found", body: "" };
  const methodNotAllowed = { status: "HTTP/1.1 405 Method Not Allowed", body: "" };

  expect({
    version: await rawRequest(address, "GET /json/version HTTP/1.0"),
    list: await rawRequest(address, "GET /json/list HTTP/1.0"),
    emptyHostList: await rawRequest(address, "GET /json/list HTTP/1.1", ["Host: ", "Connection: close"]),
    post: await rawRequest(address, "POST /json/version HTTP/1.0", ["Content-Length: 0"]),
    connectByName: await rawRequest(address, "CONNECT localhost:443 HTTP/1.0"),
    doubleSlash: {
      withoutHost: await rawRequest(address, "GET //x/json/list HTTP/1.0"),
      withHost: await rawRequest(address, "GET //x/json/list HTTP/1.1", ["Host: 127.0.0.1", "Connection: close"]),
    },
    connect: {
      withoutHost: await rawRequest(address, "CONNECT 1.example:443 HTTP/1.0"),
      withHost: await rawRequest(address, "CONNECT 1.example:443 HTTP/1.1", ["Host: 127.0.0.1"]),
    },
  }).toEqual({
    version,
    list,
    emptyHostList: list,
    // Node answers 400 to every method but GET and to every path that it does not serve.
    // Bun answers 405 and 404, with or without a Host header.
    // https://github.com/nodejs/node/blob/v26.3.0/src/inspector_socket.cc#L555-L558
    // https://github.com/nodejs/node/blob/v26.3.0/src/inspector_socket_server.cc#L503-L507
    post: methodNotAllowed,
    // `localhost:443` parses as a URL with the scheme "localhost:", so this CONNECT reaches the method check.
    connectByName: methodNotAllowed,
    // A target that starts with "//" is a path.
    doubleSlash: { withoutHost: notFound, withHost: notFound },
    // `1.example:443` is not a path and not a URL: nothing joins it onto a placeholder Host.
    connect: { withoutHost: badRequest, withHost: badRequest },
  });

  expect(await requestWithUnusableHosts(address, "/json/list", pathname)).toEqual(
    Object.fromEntries(unusableHosts.map(host => [host, { get: badRequest, upgrade: badRequest }])),
  );

  expect(await rawRequest(address, `GET ${pathname} HTTP/1.1`, ["Host: ", ...upgradeHeaders])).toEqual(
    switchingProtocols,
  );
});

// Without a Host header, GET /json and GET /json/list name the local address of the
// connection that carries the request (getsockname), as Node does since nodejs/node#11755:
// https://github.com/nodejs/node/blob/v26.3.0/src/inspector_socket_server.cc#L361-L365
// https://github.com/nodejs/node/blob/v26.3.0/src/inspector_socket.cc#L676-L695
// The same rows run against Node.js when it is installed. The test process is the client of both.
describe.concurrent.each([
  ["bun", bunExe()],
  ["node", nodeExe()],
])("inspector.open() names the local address of the connection when a request has no Host (%s)", (runtime, exe) => {
  const ok = runtime === "bun" ? "HTTP/1.1 200 OK" : "HTTP/1.0 200 OK";

  /** The target list that names `authority` in its three URLs. */
  function listNaming(authority: string, pathname: string) {
    const frontend = `?experiments=true&v8only=true&ws=${authority}${pathname}`;
    return {
      status: ok,
      body: [
        expect.objectContaining({
          webSocketDebuggerUrl: `ws://${authority}${pathname}`,
          devtoolsFrontendUrl: `devtools://devtools/bundled/js_app.html${frontend}`,
          devtoolsFrontendUrlCompat: `devtools://devtools/bundled/inspector.html${frontend}`,
        }),
      ],
    };
  }

  // The one debugger in this file that listens on every interface, for as few requests as show that
  // the list does not name the listener: 0.0.0.0 is no address for a client.
  test.skipIf(!exe)("on a 0.0.0.0 bind", async () => {
    await using proc = spawnInspector("0.0.0.0", exe!);
    const { hostname, port, pathname } = await inspectorUrl(proc);
    expect(hostname).toBe("0.0.0.0");

    // Every address in 127.0.0.0/8 is a local address on Linux, so two connections can have different ones there.
    for (const host of isLinux ? ["127.0.0.1", "127.0.0.2"] : ["127.0.0.1"]) {
      expect(await rawRequest({ host, port: Number(port) }, "GET /json/list HTTP/1.0")).toEqual(
        listNaming(`${host}:${port}`, pathname),
      );
    }
  });

  test.skipIf(!exe)("on a localhost bind", async () => {
    await using proc = spawnInspector("localhost", exe!);
    const { hostname, port, pathname } = await inspectorUrl(proc);
    expect(hostname).toBe("localhost");

    // Not by name: a lookup of `localhost` can leave out the address family that the server listens on (#38818).
    let host = "";
    for (const candidate of ["::1", "127.0.0.1"]) {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      const socket = net.connect({ host: candidate, port: Number(port) }, () => resolve(true));
      socket.on("error", () => resolve(false));
      const connected = await promise;
      socket.destroy();
      if (connected) {
        host = candidate;
        break;
      }
    }
    expect(host).not.toBe("");

    const address = { host, port: Number(port) };
    const authority = `${host.includes(":") ? `[${host}]` : host}:${port}`;
    const named = listNaming(authority, pathname);
    expect({
      list: await rawRequest(address, "GET /json/list HTTP/1.0"),
      json: await rawRequest(address, "GET /json HTTP/1.0"),
      emptyHost: await rawRequest(address, "GET /json/list HTTP/1.1", ["Host: ", "Connection: close"]),
      noHostLine: await rawRequest(address, "GET /json/list HTTP/1.1", ["Connection: close"]),
      withHost: await rawRequest(address, "GET /json/list HTTP/1.1", [`Host: localhost:${port}`, "Connection: close"]),
    }).toEqual({
      list: named,
      json: named,
      emptyHost: named,
      // Node answers an HTTP/1.1 request that has no Host line like the three above. In Bun the
      // HTTP parser answers 400 before the inspector sees the request (RFC 9112 section 3.2).
      noHostLine: runtime === "bun" ? { status: "HTTP/1.1 400 Bad Request", body: "" } : named,
      withHost: listNaming(`localhost:${port}`, pathname),
    });

    // Each request decides for itself: on one connection a Host is reflected, and a request without one is not.
    const withHost = ["GET /json/list HTTP/1.1", `Host: localhost:${port}`, "", ""].join("\r\n");
    const withoutHost = ["GET /json/list HTTP/1.1", "Host: ", "", ""].join("\r\n");
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    let responses = "";
    const urls = () => Array.from(responses.matchAll(/"webSocketDebuggerUrl":\s*"([^"]*)"/g), match => match[1]);
    const socket = net.connect(address, () => socket.write(withHost + withoutHost + withHost));
    socket.on("data", chunk => {
      responses += chunk;
      if (urls().length === 3) socket.destroy();
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(urls()));
    expect(await promise).toEqual([
      `ws://localhost:${port}${pathname}`,
      `ws://${authority}${pathname}`,
      `ws://localhost:${port}${pathname}`,
    ]);
  });

  // Not gated on isIPv6(): an IPv4-mapped bind needs an AF_INET6 socket, not an IPv6 address.
  test.skipIf(!exe)("on a ::ffff:127.0.0.1 bind", async () => {
    await using proc = spawnInspector("::ffff:127.0.0.1", exe!);
    const { port, pathname } = await inspectorUrl(proc);

    // Node prints the IPv4-mapped address of the socket like this. A URL would write [::ffff:7f00:1].
    const address = { host: "127.0.0.1", port: Number(port) };
    const named = listNaming(`[::ffff:127.0.0.1]:${port}`, pathname);
    expect({
      list: await rawRequest(address, "GET /json/list HTTP/1.0"),
      json: await rawRequest(address, "GET /json HTTP/1.0"),
      emptyHost: await rawRequest(address, "GET /json/list HTTP/1.1", ["Host: ", "Connection: close"]),
    }).toEqual({ list: named, json: named, emptyHost: named });
  });
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
