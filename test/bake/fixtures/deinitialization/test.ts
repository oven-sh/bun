import { getDevServerDeinitCount } from "bun:internal-for-testing";
import html from "./index.html";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { fullGC, heapStats } from "bun:jsc";

expect(process.cwd()).toBe(import.meta.dir);

// plugin.ts (registered in bunfig.toml) awaits `globalThis.callback` from its
// onLoad hook, so a case can stop the server while its bundle is in flight.
let callbackCalls = 0;

// Resolves with the fetch error's `code`. `expect(...).rejects` is not used
// here: it spins a nested event loop synchronously, and most waits in `run`
// start inside a WebSocket callback.
async function fetchErrorCode(request: Promise<Response>): Promise<string> {
  try {
    await request;
    return "fulfilled";
  } catch (e: any) {
    return e.code ?? String(e);
  }
}

async function run({
  closeActiveConnections,
  sendAnyRequests,
  websocket,
}: {
  closeActiveConnections: boolean;
  sendAnyRequests: boolean;
  websocket: number;
}) {
  const deinitsBefore = getDevServerDeinitCount();
  const pluginLoadedBefore = globalThis.pluginLoaded;
  callbackCalls = 0;

  const server = Bun.serve({
    routes: {
      "/": html,
    },
    fetch() {
      return new Response("FAIL");
    },
    port: 0,
  });
  const origin = server.url.origin;

  const closes: Promise<CloseEvent>[] = [];
  let stopped: Promise<void> | undefined;
  // Recorded inside the plugin callback and asserted after the bundle. A throw
  // inside the callback only fails the bundle, and after an abrupt stop there
  // is no client left to report that to.
  let refusedWhileBundling: string | undefined;
  try {
    // Serve plugins load on the first bundle, not when the server starts.
    expect(globalThis.pluginLoaded).toBe(pluginLoadedBefore);

    const opens: Promise<void>[] = [];
    for (let i = 0; i < websocket; i++) {
      const ws = new WebSocket(origin + "/_bun/hmr");
      const open = Promise.withResolvers<void>();
      const close = Promise.withResolvers<CloseEvent>();
      ws.onopen = () => open.resolve();
      ws.onclose = event => {
        open.reject(new Error(`websocket ${i} closed before it opened (code ${event.code})`));
        close.resolve(event);
      };
      opens.push(open.promise);
      closes.push(close.promise);
    }
    await Promise.all(opens);

    if (sendAnyRequests) {
      const request = fetch(origin, { keepalive: false });
      const requestErrorCode = closeActiveConnections ? fetchErrorCode(request) : undefined;

      globalThis.callback = async () => {
        callbackCalls++;
        stopped = server.stop(closeActiveConnections);
        // The bundle that serves `request` stays in flight until this returns.
        refusedWhileBundling = await fetchErrorCode(fetch(origin, { keepalive: false }));
        // An abrupt stop also closed the socket of `request`. Let the client
        // see that before the bundle completes.
        if (requestErrorCode) await requestErrorCode;
      };

      if (requestErrorCode) {
        expect(await requestErrorCode).toBe("ECONNRESET");
      } else {
        const response = await request;
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/html;charset=utf-8");
        expect(await response.text()).toContain('<script type="module" crossorigin src="/_bun/client/index-');
      }
      expect(globalThis.pluginLoaded).toBe(true);
    } else {
      stopped = server.stop(closeActiveConnections);
    }
  } finally {
    // The closure captures `server`. Left in place it would root the JS Server
    // wrapper through every GC below.
    globalThis.callback = undefined;
    // A case that failed before its own stop() must not leave a server behind.
    stopped ??= server.stop(true);
  }
  expect(callbackCalls).toBe(sendAnyRequests ? 1 : 0);

  expect(await fetchErrorCode(fetch(origin, { keepalive: false }))).toBe("ConnectionRefused");

  // `stop()` resolves once the last request, connection and listener are gone.
  // The DevServer is dropped in that same pass, before the promise settles, so
  // the count must be exact here without any GC.
  await stopped;
  expect(getDevServerDeinitCount()).toBe(deinitsBefore + 1);
  // `stop()` closed the listener synchronously, while the bundle was in flight.
  expect(refusedWhileBundling).toBe(sendAnyRequests ? "ConnectionRefused" : undefined);

  // Dropping the DevServer closes every HMR socket it still had (an abrupt
  // stop closed them earlier). The clients see an abnormal closure.
  const closeEvents = await Promise.all(closes);
  expect(closeEvents.map(event => ({ code: event.code, wasClean: event.wasClean }))).toEqual(
    Array.from({ length: websocket }, () => ({ code: 1006, wasClean: false })),
  );
}

const cases = [
  { closeActiveConnections: false, sendAnyRequests: false, websocket: 0 },
  { closeActiveConnections: false, sendAnyRequests: false, websocket: 1 },
  { closeActiveConnections: true, sendAnyRequests: false, websocket: 1 },
  { closeActiveConnections: false, sendAnyRequests: true, websocket: 0 },
  { closeActiveConnections: false, sendAnyRequests: true, websocket: 1 },
  { closeActiveConnections: true, sendAnyRequests: true, websocket: 0 },
  { closeActiveConnections: true, sendAnyRequests: true, websocket: 1 },
  // Multiple HMR sockets still open when DevServer.deinit runs. This exercises
  // the path where deinit iterates active_websocket_connections and calls
  // websocket.close() on each, which synchronously re-enters HmrSocket.onClose
  // (removing from the map + destroying the HmrSocket).
  { closeActiveConnections: false, sendAnyRequests: false, websocket: 8 },
  { closeActiveConnections: true, sendAnyRequests: false, websocket: 8 },
];

function liveServerWrappers() {
  const c = heapStats().objectTypeCounts;
  return (c.HTTPServer ?? 0) + (c.DebugHTTPServer ?? 0) + (c.HTTPSServer ?? 0) + (c.DebugHTTPSServer ?? 0);
}

async function drainServerWrappers(target: number) {
  for (let i = 0; i < 30 && liveServerWrappers() > target; i++) {
    Bun.gc(true);
    fullGC();
    await new Promise(resolve => setImmediate(resolve));
  }
}

// `objectTypeCounts` includes the (lazily created) prototype object once the
// first server has been constructed. Create-and-stop one trivial server here
// so the prototype is materialized but the instance is freed; the afterAll
// check then asserts every dev-server case returns to this baseline (i.e. zero
// live wrapper instances and the native boxes were actually freed). Captured
// in beforeAll so the baseline exists even when a name filter skips the
// baseline test.
let serverWrapperBaseline = 0;
beforeAll(async () => {
  await (async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    server.stop(true);
  })();
  await drainServerWrappers(1);
  serverWrapperBaseline = liveServerWrappers();
});

test("baseline: stopped server wrapper collects", () => {
  // libuv platforms may materialize both Debug and non-Debug prototypes.
  expect(serverWrapperBaseline).toBeLessThanOrEqual(2);
});

afterAll(async () => {
  // Drain any deferred deinit task scheduled during the final case's GC, then
  // assert every JS Server wrapper has actually been collected — i.e. the
  // native NewServer boxes are freed, not just the embedded dev servers.
  await drainServerWrappers(serverWrapperBaseline);
  expect(liveServerWrappers()).toBe(serverWrapperBaseline);
});

for (const { closeActiveConnections, sendAnyRequests, websocket } of cases) {
  const flags = Object.entries({ closeActiveConnections, sendAnyRequests, websocket })
    .filter(([, value]) => value)
    .map(([key, value]) => (key === "websocket" ? `websocket=${value}` : key));
  test("flags: " + (flags.join(" ") || "none"), async () => {
    await run({ closeActiveConnections, sendAnyRequests, websocket });
  });
}
