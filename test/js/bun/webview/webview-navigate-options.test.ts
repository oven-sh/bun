// navigate({ waitUntil, timeout }) against a MOCK CDP endpoint.
//
// The real-Chrome coverage lives in webview-chrome.test.ts (gated on a
// local Chrome binary, todo'd otherwise). This file exercises the same
// code paths WITHOUT a browser: a Bun.serve WebSocket handler speaks
// just enough CDP to drive the attach chain and emit Page.lifecycleEvent
// / Page.loadEventFired on demand. That makes the waitUntil + timeout
// logic testable on any CI lane, and makes the assertions exact (no
// Chrome timing variance).
//
// Separate file because CDP::Transport is a process singleton — the
// first `new Bun.WebView()` locks the backend mode (pipe vs. WebSocket)
// and the endpoint. Mixing a mock WS here with the spawned-Chrome tests
// in the same process would poison the other file.
//
// Each test runs in a SUBPROCESS for the same reason: one mock server
// per test, one fresh Transport singleton per test.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// --- Mock CDP server --------------------------------------------------------
// Inlined into the -e script so no fixture file is needed. The mock
// understands exactly the attach-chain methods (Target.createTarget →
// Target.attachToTarget → Page.enable → Page.setLifecycleEventsEnabled →
// Runtime.enable → Page.navigate) plus the post-navigate Runtime.evaluate
// for document.title. Everything else gets an empty {} result.
//
// `behavior` controls what lifecycle events the mock emits after
// Page.navigate — this is what distinguishes the test cases:
//   - "dcl-only": frameNavigated + lifecycleEvent(DOMContentLoaded).
//     NEVER sends loadEventFired. navigate({waitUntil:'domcontentloaded'})
//     should resolve; default navigate() should time out.
//   - "load": frameNavigated + loadEventFired. Default navigate resolves.
//   - "silent": nothing. navigate() hangs until timeout.
//   - "stale-load": first navigate → DCL only (settles). Second
//     navigate → emit the FIRST nav's trailing lifecycleEvent(load) +
//     loadEventFired BEFORE the second nav commits, then never emit
//     anything for the second nav. Proves beginChromeNavigation()'s
//     m_loaderId clear stops stale events from settling a later
//     navigate.
//
// frameId "F" / loaderId "L<n>" are the main frame; the mock ALSO emits
// a subframe lifecycleEvent (frameId "SUB") to prove the frameId/
// loaderId gate filters it out.
const mockCDP = `
function startMockCDP(behavior) {
  const sid = "SESS";
  let navN = 0;
  const send = (ws, obj) => ws.send(JSON.stringify(obj));
  const ev = (ws, method, params) => send(ws, { method, params, sessionId: sid });
  const frameNavigated = (ws, loaderId, url) =>
    ev(ws, "Page.frameNavigated", {
      frame: { id: "F", loaderId, url,
               domainAndRegistry: "", securityOrigin: "null", mimeType: "text/html",
               adFrameStatus: { adFrameType: "none" }, secureContextType: "Secure",
               crossOriginIsolatedContextType: "NotIsolated", gatedAPIFeatures: [] },
      type: "Navigation",
    });

  return Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("not ws", { status: 400 });
    },
    websocket: {
      open() {},
      message(ws, raw) {
        const msg = JSON.parse(String(raw));
        const reply = (result) =>
          send(ws, msg.sessionId
            ? { id: msg.id, result, sessionId: msg.sessionId }
            : { id: msg.id, result });

        switch (msg.method) {
          case "Target.createTarget":
            return reply({ targetId: "T" });
          case "Target.attachToTarget":
            return reply({ sessionId: sid });
          case "Page.enable":
          case "Page.setLifecycleEventsEnabled":
          case "Runtime.enable":
          case "Target.closeTarget":
            return reply({});
          case "Page.reload":
          case "Page.navigate": {
            const n = ++navN;
            const L = "L" + n;
            const url = msg.params?.url ?? "about:blank";
            reply({ frameId: "F", loaderId: L });
            // Subframe DCL FIRST — must be ignored by the frameId gate.
            // If the handler matched on name alone, this would settle
            // the navigate before the main document committed.
            ev(ws, "Page.lifecycleEvent", {
              frameId: "SUB", loaderId: "SL", name: "DOMContentLoaded", timestamp: 1,
            });

            if (behavior === "stale-load") {
              if (n === 1) {
                // First nav: DCL-only so the user settles and can
                // start a second navigate.
                frameNavigated(ws, L, url);
                ev(ws, "Page.lifecycleEvent", {
                  frameId: "F", loaderId: L, name: "DOMContentLoaded", timestamp: 2,
                });
              } else {
                // Second nav: emit the FIRST nav's trailing load
                // events (loaderId L1) BEFORE this nav commits. With
                // the stale-gate, m_loaderId is empty here so both
                // the lifecycleEvent loaderId check and
                // loadEventFired's isEmpty() guard drop them.
                ev(ws, "Page.lifecycleEvent", {
                  frameId: "F", loaderId: "L1", name: "load", timestamp: 3,
                });
                ev(ws, "Page.loadEventFired", { timestamp: 3 });
                // Never commit url2 — the test asserts it stays pending.
              }
              return;
            }

            // Main-frame commit: sets m_frameId/m_loaderId.
            frameNavigated(ws, L, url);
            if (behavior === "dcl-only") {
              ev(ws, "Page.lifecycleEvent", {
                frameId: "F", loaderId: L, name: "DOMContentLoaded", timestamp: 2,
              });
              // No loadEventFired — the page "never finishes loading".
            } else if (behavior === "load") {
              ev(ws, "Page.lifecycleEvent", {
                frameId: "F", loaderId: L, name: "DOMContentLoaded", timestamp: 2,
              });
              ev(ws, "Page.lifecycleEvent", {
                frameId: "F", loaderId: L, name: "load", timestamp: 3,
              });
              ev(ws, "Page.loadEventFired", { timestamp: 3 });
            }
            // "silent": nothing — navigate() has only the timeout to save it.
            return;
          }
          case "Runtime.evaluate":
            // document.title → PageTitle chain. The handler reads
            // result.result.value.
            return reply({ result: { type: "string", value: "mock-title" } });
          default:
            return reply({});
        }
      },
    },
  });
}
`;

async function run(behavior: "dcl-only" | "load" | "silent" | "stale-load", body: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      mockCDP +
        `
await using server = startMockCDP(${JSON.stringify(behavior)});
const view = new Bun.WebView({
  backend: { type: "chrome", url: \`ws://127.0.0.1:\${server.port}/devtools/browser/mock\` },
  width: 100, height: 100,
});
try {
${body}
} finally {
  view.close();
}
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// --- waitUntil: 'domcontentloaded' -----------------------------------------

test.concurrent("navigate({waitUntil:'domcontentloaded'}) settles on Page.lifecycleEvent when load never fires", async () => {
  // The mock emits frameNavigated + lifecycleEvent(DOMContentLoaded) for
  // the main frame, and NEVER loadEventFired. Without waitUntil:
  // 'domcontentloaded', navigate() would hang until the 30s timeout.
  // With it, the lifecycleEvent handler matches frameId=="F" &&
  // loaderId=="L" && name=="DOMContentLoaded", chains a document.title
  // fetch, and resolves.
  //
  // The mock ALSO sends a subframe DCL (frameId "SUB") BEFORE the main
  // frame commits — the frameId gate must drop it. A naive name-only
  // match would settle on the subframe event.
  const { stdout, stderr, exitCode } = await run(
    "dcl-only",
    `
    await view.navigate("http://example/dcl", { waitUntil: "domcontentloaded", timeout: 10_000 });
    // PageTitle chain ran — Runtime.evaluate("document.title") → "mock-title".
    console.log("title=" + view.title);
    // m_loading tracks the REAL load state; loadEventFired never came.
    console.log("loading=" + view.loading);
    console.log("url=" + view.url);
    `,
  );
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["title=mock-title", "loading=true", "url=http://example/dcl"]);
  expect(exitCode).toBe(0);
});

test.concurrent("navigate() default waitUntil:'load' settles on Page.loadEventFired", async () => {
  // Backward compat: no options → waitUntil:'load' → loadEventFired
  // settles. The lifecycleEvent(DOMContentLoaded) arrives first but is
  // ignored because m_navWaitUntil == Load.
  const { stdout, stderr, exitCode } = await run(
    "load",
    `
    await view.navigate("http://example/load");
    console.log("title=" + view.title + " loading=" + view.loading);
    `,
  );
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("title=mock-title loading=false");
  expect(exitCode).toBe(0);
});

test.concurrent("reload({waitUntil:'domcontentloaded'}) settles on lifecycleEvent", async () => {
  // reload() shares the Navigate slot and the same lifecycle path as
  // navigate(). "dcl-only" never emits loadEventFired, so both the
  // initial navigate and the reload must settle via
  // Page.lifecycleEvent(DOMContentLoaded). The mock handles
  // Page.reload identically to Page.navigate (same event sequence,
  // fresh loaderId).
  const { stdout, stderr, exitCode } = await run(
    "dcl-only",
    `
    await view.navigate("http://example/a", { waitUntil: "domcontentloaded" });
    await view.reload({ waitUntil: "domcontentloaded", timeout: 10_000 });
    console.log("ok title=" + view.title);
    `,
  );
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok title=mock-title");
  expect(exitCode).toBe(0);
});

test.concurrent("navigate({waitUntil:'domcontentloaded'}) on a fast page doesn't enqueue duplicate title fetches", async () => {
  // "load" mock emits DCL + load + loadEventFired all before the
  // first PageTitle response arrives. Without the m_navTitleChained
  // flag set by chainTitle(), each of the three would enqueue its
  // own PageTitle — and a duplicate response can settle the NEXT
  // navigate's promise early. With the flag, only the first trigger
  // chains; the rest see m_navTitleChained and drop.
  //
  // Two back-to-back DCL navigates: if duplicate PageTitle from
  // nav1 leaked and settled nav2, nav2 would resolve with
  // view.url == nav1's url (nav2's frameNavigated hadn't arrived
  // yet at the time of the stale settle).
  const { stdout, stderr, exitCode } = await run(
    "load",
    `
    await view.navigate("http://example/one", { waitUntil: "domcontentloaded" });
    await view.navigate("http://example/two", { waitUntil: "domcontentloaded" });
    // Each navigate committed — url reflects the LAST one. A leaked
    // duplicate PageTitle from /one would have settled /two with
    // url still /one.
    console.log("url=" + view.url + " title=" + view.title);
    // loadEventFired fired for /two (mock emits it in "load" mode)
    // so m_loading flipped even though we settled on DCL.
    console.log("loading=" + view.loading);
    `,
  );
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["url=http://example/two title=mock-title", "loading=false"]);
  expect(exitCode).toBe(0);
});

test.concurrent("stale loadEventFired from a prior 'domcontentloaded' navigate does not settle the next one", async () => {
  // Regression: navigate(url1, {waitUntil:'domcontentloaded'}) settles
  // before url1's window `load` fires. A second navigate() can then
  // start, and url1's trailing lifecycleEvent(load)+loadEventFired
  // arrive while nav2 is pending. Without the m_loaderId clear in
  // beginChromeNavigation(), those stale events pass the gate (the
  // old loaderId is still cached) and chainTitle() settles nav2's
  // promise before its own document committed.
  //
  // The mock's "stale-load" arm emits exactly that: nav1 → DCL only;
  // nav2 → stale lifecycleEvent(load,L1) + loadEventFired, then
  // nothing for nav2. With the fix, nav2 stays pending.
  const { stdout, stderr, exitCode } = await run(
    "stale-load",
    `
    await view.navigate("http://example/one", { waitUntil: "domcontentloaded" });
    // nav1 settled on DCL; its load hasn't fired. nav2 starts and
    // clears m_loaderId. The mock then sends nav1's trailing load
    // events — they must NOT settle nav2.
    const nav2 = view.navigate("http://example/two", { waitUntil: "load", timeout: 0 });
    let settled = "pending";
    nav2.then(() => settled = "resolved", e => settled = "rejected:" + e.message);
    await Bun.sleep(300);
    // url should still be nav1's — nav2 never committed in the mock.
    // loading should still be TRUE — nav2 set it and nav1's stale
    // loadEventFired (m_loaderId empty) must not clear it.
    console.log("nav2=" + settled + " url=" + view.url + " loading=" + view.loading);
    // And with waitUntil:'domcontentloaded' on nav2 the stale
    // lifecycleEvent(load, L1) must ALSO be rejected by the loaderId
    // check (m_loaderId empty). Close the view to reject nav2 so the
    // process exits; the test only cares it was still pending.
    `,
  );
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("nav2=pending url=http://example/one loading=true");
  expect(exitCode).toBe(0);
});

// --- timeout ---------------------------------------------------------------

test.concurrent("navigate({timeout}) rejects when no lifecycle event arrives", async () => {
  // "silent" mock: Page.navigate reply + frameNavigated, but no
  // DCL/load/loadEventFired — navigate() has only the parent-side
  // dispatchAfter timer to save it.
  const { stdout, stderr, exitCode } = await run(
    "silent",
    `
    const t0 = performance.now();
    try {
      await view.navigate("http://example/hang", { timeout: 300 });
      console.log("FAIL: resolved");
    } catch (e) {
      const elapsed = performance.now() - t0;
      // Fired after ~300ms (WTFTimer via Bun's event loop). Loose
      // lower bound; upper bound generous for slow CI.
      console.log("rejected=" + /Navigation timeout of 300ms exceeded/.test(e.message)
        + " elapsed>=250=" + (elapsed >= 250));
    }
    // Slot is clear — a second navigate with timeout:0 would hang
    // forever on this mock, so give it a short one and assert it
    // rejects with ITS OWN message (generation-counter isolated the
    // previous timer).
    try {
      await view.navigate("http://example/hang2", { timeout: 200 });
      console.log("FAIL: second resolved");
    } catch (e) {
      console.log("second=" + /Navigation timeout of 200ms exceeded/.test(e.message));
    }
    `,
  );
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["rejected=true elapsed>=250=true", "second=true"]);
  expect(exitCode).toBe(0);
});

test.concurrent("navigate({timeout}): stale timer does not reject a later navigation", async () => {
  // First navigate settles on DCL at ~0ms with a 400ms timeout armed.
  // Second navigate (silent mock would hang) starts immediately with
  // timeout:0 (disabled). The first navigate's 400ms timer FIRES while
  // the second navigate is pending — the generation-counter check must
  // make it no-op instead of rejecting the second navigate's promise.
  const { stdout, stderr, exitCode } = await run(
    "dcl-only",
    `
    await view.navigate("http://example/a", { waitUntil: "domcontentloaded", timeout: 400 });
    // Second navigate: never settles on this mock (no loadEventFired),
    // no timeout. Race it against a 700ms sleep — if the stale 400ms
    // timer from the first navigate wrongly rejected it, the promise
    // would settle before 700ms.
    const nav2 = view.navigate("http://example/b", { waitUntil: "load", timeout: 0 });
    let settled = "pending";
    nav2.then(() => settled = "resolved", e => settled = "rejected:" + e.message);
    await Bun.sleep(700);
    console.log("after-stale=" + settled);
    `,
  );
  expect(stderr).toBe("");
  // Still pending after the first navigate's stale 400ms timer fired.
  expect(stdout.trim()).toBe("after-stale=pending");
  expect(exitCode).toBe(0);
});

// --- validation ------------------------------------------------------------

test.concurrent("navigate() option validation throws before I/O", async () => {
  // No CDP traffic needed — the throws happen in parseNavOptions
  // before the slot check. Use the silent mock just to get a view.
  const { stdout, stderr, exitCode } = await run(
    "silent",
    `
    const cases = [
      ["waitUntil networkidle", () => view.navigate("about:blank", { waitUntil: "networkidle" })],
      ["waitUntil number",      () => view.navigate("about:blank", { waitUntil: 42 })],
      ["timeout negative",      () => view.navigate("about:blank", { timeout: -1 })],
      ["timeout Infinity",      () => view.navigate("about:blank", { timeout: Infinity })],
      ["reload waitUntil",      () => view.reload({ waitUntil: "nope" })],
    ];
    for (const [name, fn] of cases) {
      try { fn(); console.log("FAIL", name); }
      catch (e) { console.log(name + ": " + e.code); }
    }
    `,
  );
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([
    "waitUntil networkidle: ERR_INVALID_ARG_VALUE",
    "waitUntil number: ERR_INVALID_ARG_TYPE",
    "timeout negative: ERR_INVALID_ARG_VALUE",
    "timeout Infinity: ERR_INVALID_ARG_VALUE",
    "reload waitUntil: ERR_INVALID_ARG_VALUE",
  ]);
  expect(exitCode).toBe(0);
});
