// What happens to a Chrome-backend operation that is still waiting when
// the browser goes away (or, for the last mock cases, just the view's own
// page). The interesting case is a navigation-shaped op (navigate / reload
// / goBack): once Chrome has answered its command the backend only
// remembers it through the promise slot on the view, waiting for
// Page.loadEventFired. Losing Chrome after that point must still settle
// the promise and clear view.loading.
//
// Most tests here drive the backend from a mock CDP endpoint (a Bun.serve
// WebSocket speaking just enough of the protocol), so they run without a
// browser and can leave a navigation committed-but-never-loaded exactly.
// The last test repeats the scenario against a real Chrome in pipe mode
// (chrome-closeall-fixture.ts).
//
// Every test runs in a subprocess: the CDP transport is a process-wide
// singleton, so each scenario needs a fresh one, and killing the browser
// would break any other test sharing it. A scenario prints one JSON line;
// watch() records how a promise settled and thrown() how a call returned.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, libcPathForDlopen } from "harness";
import { join } from "node:path";

const mockCDP = /* js */ `
  const shape = e => ({ name: e.name, code: e.code ?? null, message: e.message });
  // Records how a promise settles. Reads as { pending: true } until it does.
  function watch(promise) {
    const result = { pending: true };
    promise.then(
      resolved => {
        delete result.pending;
        result.resolved = resolved ?? null;
      },
      e => {
        delete result.pending;
        result.rejected = shape(e);
      },
    );
    return result;
  }
  function thrown(fn) {
    try {
      return { returned: fn() ?? null };
    } catch (e) {
      return { threw: shape(e) };
    }
  }
  const print = value => console.log(JSON.stringify(value));

  function startMockCDP() {
    let sock;
    let targets = 0;
    let loads = 0;
    let lastUrl = "about:blank";
    const mock = {
      // While true, a committed navigation is followed by Page.loadEventFired
      // so the op resolves. Scenarios turn it off to leave a navigation
      // committed but never loaded.
      completeLoads: true,
      // WebSocket connections accepted so far.
      connections: 0,
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
    mock.newView = () =>
      new Bun.WebView({
        backend: { type: "chrome", url: "ws://127.0.0.1:" + server.port + "/devtools/browser/mock" },
        width: 100,
        height: 100,
      });
    return mock;
  }
`;

// Runs a scenario after the mock definitions in a fresh bun process and
// returns the JSON it printed.
async function runScenario(body: string): Promise<unknown> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", mockCDP + body],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  return await printedJSON(proc);
}

// The child printed exactly one JSON line, nothing on stderr, and exited 0.
async function printedJSON(proc: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<unknown> {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^\{.*\}\n$/);
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

// sock.terminate() closes the TCP connection without a close frame, which
// the client reports as close code 1006.
const wsClosed = { name: "Error", code: null, message: "Chrome WebSocket closed (code 1006)" };
// A view whose page or browser is gone refuses further calls synchronously.
const viewClosed = (method: string) => ({
  name: "Error",
  code: "ERR_INVALID_STATE",
  message: `Invalid state: WebView.${method}: view is closed`,
});

// Only navigate() raises view.loading; reload() and goBack() leave it false
// while their navigation is in flight (the third column).
test.concurrent.each([
  ["navigate", `view.navigate("http://mock/2")`, true],
  ["reload", `view.reload()`, false],
  ["goBack", `view.goBack()`, false],
])("%s() rejects when the connection drops after the document committed", async (_, startOp, loadingWhileCommitted) => {
  const result = await runScenario(`
    const mock = startMockCDP();
    const view = mock.newView();
    await view.navigate("http://mock/1");

    mock.completeLoads = false;
    const committed = Promise.withResolvers();
    view.onNavigated = () => committed.resolve();
    const op = watch(${startOp});
    // onNavigated fires on Page.frameNavigated, which the mock sends after
    // the op's own reply, so by now the backend has consumed that reply and
    // only the promise slot is waiting (for a load event that never comes).
    await committed.promise;
    const loadingBefore = view.loading;

    // A request that is still waiting for its reply. It rejects as soon as
    // the disconnect has been processed, which is how we know when to look
    // at the op's promise.
    const evaluate = view.evaluate("1");
    const unanswered = watch(evaluate);
    mock.drop();
    await evaluate.catch(() => {});
    print({
      loadingBefore,
      unanswered,
      op,
      loadingAfter: view.loading,
      afterDrop: {
        evaluate: thrown(() => view.evaluate("1")),
        closeAll: thrown(() => Bun.WebView.closeAll()),
      },
    });
    mock.stop();
  `);
  expect(result).toEqual({
    loadingBefore: loadingWhileCommitted,
    unanswered: { rejected: wsClosed },
    op: { rejected: wsClosed },
    loadingAfter: false,
    afterDrop: {
      evaluate: { threw: viewClosed("evaluate") },
      closeAll: { returned: null },
    },
  });
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
    const nav = { a: watch(a.navigate("http://mock/a2")), b: watch(b.navigate("http://mock/b2")) };
    await Promise.all([committedA.promise, committedB.promise]);
    const loadingBefore = [a.loading, b.loading];

    // Only view a has a request waiting for a reply; view b has nothing in
    // flight except its committed navigation.
    const evaluate = a.evaluate("1");
    mock.drop();
    await evaluate.catch(() => {});
    const loadingAfter = [a.loading, b.loading];
    const afterDrop = [a, b].map(view => thrown(() => view.evaluate("1")));

    // The views are gone for good, the process is not: the next view opens
    // a new connection (the mock still listens) and works.
    mock.completeLoads = true;
    const c = mock.newView();
    await c.navigate("http://mock/c1");
    print({
      loadingBefore,
      nav,
      loadingAfter,
      afterDrop,
      reconnected: { url: c.url, title: c.title, connections: mock.connections },
    });
    mock.stop();
  `);
  expect(result).toEqual({
    loadingBefore: [true, true],
    nav: { a: { rejected: wsClosed }, b: { rejected: wsClosed } },
    loadingAfter: [false, false],
    afterDrop: [{ threw: viewClosed("evaluate") }, { threw: viewClosed("evaluate") }],
    reconnected: { url: "http://mock/c1", title: "mock", connections: 2 },
  });
});

// The connection stays up but the view's own page goes away. The promise
// was already rejected on these paths; they also have to clear loading. A
// second view keeps the connection open (WebSocket mode releases it once
// the last view is gone) and shows that the other page is untouched.
test.concurrent.each([
  ["view.close()", `view.close()`, "WebView closed"],
  // Browser-level event (no sessionId on the envelope) for the first
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
    const other = mock.newView();
    await other.navigate("http://mock/other");

    mock.completeLoads = false;
    const committed = Promise.withResolvers();
    view.onNavigated = () => committed.resolve();
    const navigation = view.navigate("http://mock/2");
    const nav = watch(navigation);
    await committed.promise;
    const loadingBefore = view.loading;

    ${takePageAway};
    await navigation.catch(() => {});
    const loadingAfter = view.loading;
    const afterPageGone = thrown(() => view.evaluate("1"));

    mock.completeLoads = true;
    await other.navigate("http://mock/3");
    print({
      loadingBefore,
      nav,
      loadingAfter,
      afterPageGone,
      other: { url: other.url, title: other.title, connections: mock.connections },
    });
    mock.stop();
  `);
  expect(result).toEqual({
    loadingBefore: true,
    nav: { rejected: { name: "Error", code: null, message: reason } },
    loadingAfter: false,
    afterPageGone: { threw: viewClosed("evaluate") },
    other: { url: "http://mock/3", title: "mock", connections: 1 },
  });
});

// Same scenario against a real Chrome over the debugging pipe: closeAll()
// SIGKILLs it while a page is committed but still loading. Spawning Chrome
// is not implemented on Windows; elsewhere this needs a Chrome the runtime
// finds on its own (BUN_CHROME_PATH or one of the $PATH names it probes),
// otherwise todo.
function findChrome(): string | undefined {
  if (isWindows) return undefined;
  if (process.env.BUN_CHROME_PATH) return process.env.BUN_CHROME_PATH;
  const names = [
    "google-chrome-stable",
    "google-chrome",
    "chromium-browser",
    "chromium",
    "brave-browser",
    "microsoft-edge",
    "chrome",
  ];
  for (const name of names) {
    const found = Bun.which(name);
    if (found) return found;
  }
  return undefined;
}
const chromePath = findChrome();

(chromePath ? test.concurrent : test.todo)(
  "closeAll() rejects a navigate() whose page committed but never finished loading",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "chrome-closeall-fixture.ts")],
      env: { ...bunEnv, CHROME_EXECUTABLE: chromePath, LIBC_PATH: libcPathForDlopen() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const result = (await printedJSON(proc)) as {
      warmUp: { files: number; bytes: number; ms: number };
      launchMs: number;
      chrome: { browser: number; helpers: number };
      [key: string]: unknown;
    };
    // This file is on the slow-test list because of the first Chrome launch
    // on a fresh agent. Keep its cost visible in the CI log.
    console.log(
      `chrome warm-up: ${result.warmUp.files} files, ${(result.warmUp.bytes / 1e6).toFixed(0)} MB in ${result.warmUp.ms} ms; launch: ${result.launchMs} ms`,
    );
    // Whichever the event loop sees first, the process exit or the pipe
    // closing, decides the wording; both must settle everything.
    const died = {
      name: "Error",
      code: null,
      message: expect.stringMatching(/^Chrome (killed by signal 9|process closed the pipe)$/),
    };
    expect(result).toEqual({
      warmUp: { files: expect.any(Number), bytes: expect.any(Number), ms: expect.any(Number) },
      launchMs: expect.any(Number),
      // The fixture counts processes through /proc, so only on Linux.
      chrome: { browser: isLinux ? 1 : 0, helpers: expect.any(Number) },
      loadingBefore: true,
      closeAll: { returned: null },
      unanswered: { rejected: died },
      navigate: { rejected: died },
      loadingAfter: false,
      afterDeath: {
        evaluate: { threw: viewClosed("evaluate") },
        closeAll: { returned: null },
        close: { returned: null },
      },
      // The browser process is dead and reaped (the fixture polls for it).
      browserLeft: [],
    });
    if (isLinux) expect(result.chrome.helpers).toBeGreaterThan(0);
  },
);
