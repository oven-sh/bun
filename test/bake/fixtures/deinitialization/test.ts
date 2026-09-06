import { getDevServerDeinitCount } from "bun:internal-for-testing";
import html from "./index.html";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { fullGC, heapStats } from "bun:jsc";

expect(process.cwd()).toBe(import.meta.dir);

let promise;

async function run({ closeActiveConnections = false, sendAnyRequests = true, websocket = 0 }) {
  let lastDevServerDeinitCount = getDevServerDeinitCount();

  async function main() {
    globalThis.pluginLoaded = undefined;

    const server = Bun.serve({
      routes: {
        "/": html,
      },
      fetch(req, server) {
        return new Response("FAIL");
      },
      port: 0,
    });

    expect(globalThis.pluginLoaded).toBeUndefined();

    let sockets: WebSocket[] = [];
    if (websocket > 0) {
      const opens: Promise<void>[] = [];
      for (let i = 0; i < websocket; i++) {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const ws = new WebSocket(server.url.origin + "/_bun/hmr");
        let opened = false;
        ws.onopen = () => {
          opened = true;
          console.log("WebSocket opened");
          resolve();
        };
        ws.onerror = e => {
          e.preventDefault();
          if (!opened) reject(new Error(`websocket ${i} failed before open`));
        };
        ws.onclose = () => {
          console.log("WebSocket closed");
          if (!opened) reject(new Error(`websocket ${i} closed before open`));
        };
        sockets.push(ws);
        opens.push(promise);
      }
      await Promise.all(opens);
    }

    globalThis.callback = async () => {
      server.stop(closeActiveConnections);
      await (promise = new Promise(resolve => setTimeout(resolve, 250)));
    };

    if (sendAnyRequests) {
      if (closeActiveConnections) {
        expect(fetch(server.url.origin, { keepalive: false })).rejects.toThrow("closed unexpectedly");
      } else {
        const response = await fetch(server.url.origin, { keepalive: false });
        expect(response.status).toBe(200);
      }
    } else {
      server.stop(closeActiveConnections);
    }

    // Server is closed
    expect(fetch(server.url.origin, { keepalive: false })).rejects.toThrow("Unable to connect");
  }

  try {
    await main();
  } finally {
    // The closure assigned to `globalThis.callback` inside `main()` captures
    // `server`; left in place it roots the JS Server wrapper through every GC
    // below, so the wrapper never finalizes and the native NewServer box (and
    // everything its config owns) is still live at process exit.
    globalThis.callback = undefined;
  }

  if (closeActiveConnections) {
    await promise;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  const targetCount = lastDevServerDeinitCount + 1;
  let attempts = 0;
  while (getDevServerDeinitCount() === lastDevServerDeinitCount) {
    Bun.gc(true);
    fullGC();
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
    if (attempts > 10) {
      throw new Error("Failed to trigger deinit");
    }
  }
  expect(getDevServerDeinitCount()).toBe(targetCount);
}

// baseline do nothing
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
  test(
    "flags: " +
      Object.entries({ closeActiveConnections, sendAnyRequests, websocket })
        .filter(([key, value]) => value)
        .map(([key, value]) => (key === "websocket" ? `websocket=${value}` : key))
        .join(" "),
    async () => {
      await run({ closeActiveConnections, sendAnyRequests, websocket });
    },
  );
}
