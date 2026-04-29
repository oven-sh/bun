import { getDevServerDeinitCount } from "bun:internal-for-testing";
import html from "./index.html";
import { expect, test } from "bun:test";
import { fullGC } from "bun:jsc";

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
        const { promise, resolve } = Promise.withResolvers<void>();
        const ws = new WebSocket(server.url.origin + "/_bun/hmr");
        ws.onopen = () => {
          console.log("WebSocket opened");
          resolve();
        };
        ws.onerror = e => {
          e.preventDefault();
        };
        ws.onclose = () => {
          console.log("WebSocket closed");
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

  await main();

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
