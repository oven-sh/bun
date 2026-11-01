// What happens to a Chrome-backend operation that is still waiting when
// the browser goes away (or, for two of the mock cases, just the view's own
// page). The interesting case is a navigation-shaped op (navigate / reload
// / goBack): once Chrome has answered its command the backend only
// remembers it through the promise slot on the view, waiting for
// Page.loadEventFired. Losing Chrome after that point must still settle
// the promise and clear view.loading.
//
// Most tests here drive the backend from a mock CDP endpoint (a Bun.serve
// WebSocket speaking just enough of the protocol), so they run without a
// browser and can leave a navigation committed-but-never-loaded exactly.
// One test repeats the scenario against a real Chrome in pipe mode.
//
// The tests at the end are about the connection itself: a view that is
// being constructed keeps it while the garbage collector destroys the last
// other view.
//
// Every test runs in a subprocess: the CDP transport is a process-wide
// singleton, so each scenario needs a fresh one, and killing the browser
// would break any other test sharing it.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

const mockCDP = /* js */ `
  function startMockCDP() {
    let sock;
    let targets = 0;
    let loads = 0;
    let lastUrl = "about:blank";
    const mock = {
      // Connections the endpoint accepted, and how many of them have closed.
      connections: 0,
      closes: 0,
      // While true, a committed navigation is followed by Page.loadEventFired
      // so the op resolves. Scenarios turn it off to leave a navigation
      // committed but never loaded.
      completeLoads: true,
      emit(method, params, sessionId) {
        sock.send(JSON.stringify(sessionId ? { method, params, sessionId } : { method, params }));
      },
      // Abrupt connection loss, as if the browser died.
      drop() {
        sock.terminate();
      },
    };
    function commit(sessionId, url, loaderId) {
      lastUrl = url;
      mock.emit("Page.frameNavigated", { frame: { id: "F", loaderId, url, mimeType: "text/html" }, type: "Navigation" }, sessionId);
      if (mock.completeLoads) mock.emit("Page.loadEventFired", { timestamp: loads }, sessionId);
    }
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 400 });
      },
      websocket: {
        open(ws) {
          sock = ws;
          mock.connections++;
        },
        close() {
          mock.closes++;
        },
        message(ws, raw) {
          const { id, method, params = {}, sessionId } = JSON.parse(String(raw));
          const reply = result => ws.send(JSON.stringify(sessionId ? { id, result, sessionId } : { id, result }));
          switch (method) {
            case "Target.createTarget":
              targets++;
              return reply({ targetId: "T" + targets });
            case "Target.attachToTarget":
              return reply({ sessionId: "S" + params.targetId.slice(1) });
            case "Page.navigate": {
              const loaderId = "L" + ++loads;
              reply({ frameId: "F", loaderId });
              return commit(sessionId, params.url, loaderId);
            }
            case "Page.reload":
              reply({});
              return commit(sessionId, lastUrl, "L" + ++loads);
            case "Page.getNavigationHistory":
              return reply({ currentIndex: 1, entries: [{ id: 1, url: "about:blank" }, { id: 2, url: lastUrl }] });
            case "Page.navigateToHistoryEntry":
              reply({});
              return commit(sessionId, "about:blank", "L" + ++loads);
            case "Runtime.evaluate":
              // The backend fetches document.title after every load; answer
              // that. Any evaluate() a scenario sends itself is deliberately
              // left unanswered, so it is still waiting for a reply when the
              // connection goes away.
              if (params.expression === "document.title") return reply({ result: { type: "string", value: "mock" } });
              return;
            default:
              return reply({});
          }
        },
      },
    });
    mock.stop = () => server.stop(true);
    mock.port = server.port;
    mock.url = "ws://127.0.0.1:" + server.port + "/devtools/browser/mock";
    mock.newView = () => new Bun.WebView({ backend: { type: "chrome", url: mock.url }, width: 100, height: 100 });
    return mock;
  }
`;

// Runs a scenario after the mock definitions in a fresh bun process and
// returns the JSON it printed.
async function runScenario(body: string, env: Record<string, string> = {}): Promise<unknown> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", mockCDP + body],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout, stderr).toEndWith("}\n");
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

const wsClosed = expect.stringMatching(/^rejected: Chrome WebSocket closed \(code \d+\)$/);

test.concurrent.each([
  ["navigate", `view.navigate("http://mock/2")`],
  ["reload", `view.reload()`],
  ["goBack", `view.goBack()`],
])("%s() rejects when the connection drops after the document committed", async (_, startOp) => {
  const result = await runScenario(`
    const mock = startMockCDP();
    const view = mock.newView();
    await view.navigate("http://mock/1");

    mock.completeLoads = false;
    const committed = Promise.withResolvers();
    view.onNavigated = () => committed.resolve();
    let outcome = "pending";
    ${startOp}.then(() => (outcome = "resolved"), e => (outcome = "rejected: " + e.message));
    // onNavigated fires on Page.frameNavigated, which the mock sends after
    // the op's own reply, so by now the backend has consumed that reply and
    // only the promise slot is waiting (for a load event that never comes).
    await committed.promise;

    // A request that is still waiting for its reply. It rejects as soon as
    // the disconnect has been processed, which is how we know when to look
    // at the op's promise.
    let unanswered = "pending";
    const unansweredDone = view.evaluate("1").then(
      () => (unanswered = "resolved"),
      e => (unanswered = "rejected: " + e.message),
    );

    mock.drop();
    await unansweredDone;
    console.log(JSON.stringify({ unanswered, outcome, loading: view.loading }));
    mock.stop();
  `);
  expect(result).toEqual({ unanswered: wsClosed, outcome: wsClosed, loading: false });
});

test.concurrent("a dropped connection rejects the committed navigation of every view", async () => {
  const result = await runScenario(`
    const mock = startMockCDP();
    const a = mock.newView();
    const b = mock.newView();
    await Promise.all([a.navigate("http://mock/a1"), b.navigate("http://mock/b1")]);

    mock.completeLoads = false;
    const committedA = Promise.withResolvers();
    const committedB = Promise.withResolvers();
    a.onNavigated = () => committedA.resolve();
    b.onNavigated = () => committedB.resolve();
    const nav = { a: "pending", b: "pending" };
    a.navigate("http://mock/a2").then(() => (nav.a = "resolved"), e => (nav.a = "rejected: " + e.message));
    b.navigate("http://mock/b2").then(() => (nav.b = "resolved"), e => (nav.b = "rejected: " + e.message));
    await Promise.all([committedA.promise, committedB.promise]);
    const loadingBefore = [a.loading, b.loading];

    // Only view a has a request waiting for a reply; view b has nothing in
    // flight except its committed navigation.
    const unanswered = a.evaluate("1").catch(() => {});
    mock.drop();
    await unanswered;
    console.log(JSON.stringify({ loadingBefore, nav, loadingAfter: [a.loading, b.loading] }));
    mock.stop();
  `);
  expect(result).toEqual({
    loadingBefore: [true, true],
    nav: { a: wsClosed, b: wsClosed },
    loadingAfter: [false, false],
  });
});

// The connection stays up but the view's own page goes away. The promise
// was already rejected on these paths; they also have to clear loading.
test.concurrent.each([
  ["view.close()", `view.close()`, "WebView closed"],
  // Browser-level event (no sessionId on the envelope) for the only
  // view's target, which is the first one the mock handed out.
  [
    "Target.detachedFromTarget",
    `mock.emit("Target.detachedFromTarget", { sessionId: "S1", targetId: "T1" })`,
    "page detached (crashed or closed)",
  ],
])("%s during a load rejects navigate() and clears loading", async (_, takePageAway, reason) => {
  const result = await runScenario(`
    const mock = startMockCDP();
    const view = mock.newView();
    await view.navigate("http://mock/1");

    mock.completeLoads = false;
    const committed = Promise.withResolvers();
    view.onNavigated = () => committed.resolve();
    const nav = view.navigate("http://mock/2").then(() => "resolved", e => "rejected: " + e.message);
    await committed.promise;
    const loadingBefore = view.loading;

    ${takePageAway};
    const navigate = await nav;
    console.log(JSON.stringify({ loadingBefore, navigate, loadingAfter: view.loading }));
    mock.stop();
  `);
  expect(result).toEqual({ loadingBefore: true, navigate: `rejected: ${reason}`, loadingAfter: false });
});

// Same scenario against a real Chrome over the debugging pipe: closeAll()
// SIGKILLs it while a page is committed but still loading. Spawning Chrome
// is not implemented on Windows; elsewhere this needs a Chrome the runtime
// finds on its own (BUN_CHROME_PATH or one of the $PATH names it probes),
// otherwise todo.
const chromeInstalled =
  !isWindows &&
  (!!process.env.BUN_CHROME_PATH ||
    [
      "google-chrome-stable",
      "google-chrome",
      "chromium-browser",
      "chromium",
      "brave-browser",
      "microsoft-edge",
      "chrome",
    ].some(n => Bun.which(n)));

(chromeInstalled ? test.concurrent : test.todo)(
  "closeAll() rejects a navigate() whose page committed but never finished loading",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // --no-sandbox: Chrome refuses to start as root otherwise (containers).
        const view = new Bun.WebView({ backend: { type: "chrome", url: false, argv: ["--no-sandbox"] }, width: 100, height: 100 });
        await view.navigate("data:text/html,<body></body>");

        // The document commits, but its <img> request is never answered, so
        // the load event never fires and navigate() stays pending.
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(req) {
            if (new URL(req.url).pathname === "/hang") return new Promise(() => {});
            return new Response("<img src='/hang'>", { headers: { "content-type": "text/html" } });
          },
        });
        const committed = Promise.withResolvers();
        view.onNavigated = () => committed.resolve();
        let navigate = "pending";
        view.navigate(server.url.href).then(() => (navigate = "resolved"), e => (navigate = "rejected: " + e.message));
        await committed.promise;
        const loadingBefore = view.loading;

        // Still waiting for Chrome's reply when it dies; rejects once the
        // death has been processed.
        let unanswered = "pending";
        const unansweredDone = view.evaluate("new Promise(() => {})").then(
          () => (unanswered = "resolved"),
          e => (unanswered = "rejected: " + e.message),
        );

        Bun.WebView.closeAll();
        await unansweredDone;
        console.log(JSON.stringify({ loadingBefore, unanswered, navigate, loadingAfter: view.loading }));
        server.stop(true);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout, stderr).toEndWith("}\n");
    // Whichever the event loop sees first, the pipe closing or the process
    // exit, decides the wording; both must settle everything.
    const died = expect.stringMatching(/^rejected: Chrome (killed by signal \d+|process closed the pipe|exited)$/);
    expect(JSON.parse(stdout)).toEqual({ loadingBefore: true, unanswered: died, navigate: died, loadingAfter: false });
    expect(exitCode, stderr).toBe(0);
  },
);

// The garbage collector destroys a view that nothing closed, and the last such view takes the
// connection with it. Here that happens inside the constructor of the next view, after the constructor
// found the connection up. The next view has to keep it.
//
// The collection has to run inside the allocation of the new view. The child runs with
// BUN_JSC_useConcurrentGC=0 and BUN_JSC_useGenerationalGC=0, so every collection is a full one that runs
// whole at the allocation that starts it.
// - `width` is the first option the constructor reads. fullGC() there leaves every free list empty, so
//   the allocation of the view takes the slow path, where a requested collection runs.
// - `dataStore` is the last option. Its getter drops the view and requests a collection.
// JSC destroys one of the first 8 cells of a type at the end of the collection, and a later cell when
// its block is next allocated from. Both are inside the allocation of the new view. A view that died
// before the constructor looked at the connection shows as a second connection.
function constructDuringCollection({
  setup = "",
  settle = "",
  backend = `{ type: "chrome", url: mock.url }`,
  options = "",
  use = `const navigate = await view.navigate("http://mock/kept").then(() => "resolved", e => "rejected: " + e.message);`,
}) {
  return `
    import { fullGC } from "bun:jsc";
    const mock = startMockCDP();
    ${setup}
    // Nothing closes this view. It is the only open one when the next view is constructed.
    const holder = { dropped: new Bun.WebView({ backend: ${backend}, width: 100, height: 100 }) };
    // Made before the await: a WeakRef keeps its target alive until the job that made it ends.
    const ref = new WeakRef(holder.dropped);
    await holder.dropped.navigate("http://mock/dropped");
    ${settle}
    // From a task of the event loop, not from the continuation of the await. That one runs under the
    // socket read that delivered the reply, whose unwritten locals can still hold the view's address,
    // and the collector scans the stack conservatively.
    await new Promise(resolve => setImmediate(resolve));

    const view = new Bun.WebView({
      backend: ${backend},
      get width() {
        fullGC();
        return 100;
      },
      height: 100,
      ${options}
      get dataStore() {
        holder.dropped = undefined;
        Bun.gc(false);
      },
    });
    const collected = ref.deref() === undefined;
    ${use}
    console.log(JSON.stringify({ collected, navigate, url: view.url, connections: mock.connections, closes: mock.closes }));
    mock.stop();
  `;
}
const keptConnection = { collected: true, navigate: "resolved", url: "http://mock/kept", connections: 1, closes: 0 };
const wholeCollections = { BUN_JSC_useConcurrentGC: "0", BUN_JSC_useGenerationalGC: "0" };

test.concurrent.each([
  ["a ws:// url", {}],
  [
    "a ws:// url, after 20 other views",
    // The views before it take the cells that are destroyed with their collection, so the dropped view is
    // in a block. They close while the dropped view is open: none of them is the last view to close.
    // On globalThis: a binding that nothing reads after an await is dead across it.
    {
      setup: `globalThis.held = Array.from({ length: 20 }, () => mock.newView());`,
      settle: `for (const view of globalThis.held) view.close();`,
    },
  ],
  [
    "a ws:// url and a url to load",
    {
      options: `url: "http://mock/kept",`,
      // The constructor starts this navigation, and no promise for it reaches the script. loading turns
      // false when the navigation ends, whichever way it ends.
      use: `
        while (view.loading) await new Promise(resolve => setImmediate(resolve));
        const navigate = view.url === "http://mock/kept" ? "resolved" : "not loaded";
      `,
    },
  ],
])(
  "a view constructed with %s keeps the connection when the last other view is collected inside the constructor",
  async (_, parts) => {
    expect(await runScenario(constructDuringCollection(parts), wholeCollections)).toEqual(keptConnection);
  },
);

// backend: "chrome" with no url looks for a running browser: it reads a DevToolsActivePort file under
// the home directory (LOCALAPPDATA on Windows). These tests point that at a directory of their own, and
// the scenario writes the file for its mock. Other platforms have no such lookup.
const devToolsActivePort = isWindows
  ? "Google\\Chrome\\User Data\\DevToolsActivePort"
  : isMacOS
    ? "Library/Application Support/Google/Chrome/DevToolsActivePort"
    : isLinux
      ? ".config/google-chrome/DevToolsActivePort"
      : undefined;
const autoDetectEnv = (home: string) => ({
  HOME: home,
  LOCALAPPDATA: home,
  DEVTOOLS_ACTIVE_PORT: join(home, devToolsActivePort!),
});
const advertiseMock = `await Bun.write(process.env.DEVTOOLS_ACTIVE_PORT, mock.port + "\\n/devtools/browser/mock\\n");`;

test.concurrent.skipIf(!devToolsActivePort)(
  "a view of an auto-detected browser keeps the connection when the last other view is collected inside the constructor",
  async () => {
    using home = tempDir("webview-auto-detect", {});
    const scenario = constructDuringCollection({ setup: advertiseMock, backend: `"chrome"` });
    const env = { ...wholeCollections, ...autoDetectEnv(String(home)) };
    expect(await runScenario(scenario, env)).toEqual(keptConnection);
  },
);
