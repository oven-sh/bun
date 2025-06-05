import { getDevServerDeinitCount } from "bun:internal-for-testing";
import html from "./index.html";
import { expect, test } from "bun:test";
import { fullGC } from "bun:jsc";

expect(process.cwd()).toBe(import.meta.dir);

let promise;

async function run({ closeActiveConnections = false, sendAnyRequests = true, websocket = false }) {
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

    let ws;
    if (websocket) {
      const { promise, resolve } = Promise.withResolvers();
      ws = new WebSocket(server.url.origin + "/_bun/hmr");
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
      await promise;
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
  { closeActiveConnections: false, sendAnyRequests: false, websocket: false },
  { closeActiveConnections: false, sendAnyRequests: false, websocket: true },
  { closeActiveConnections: true, sendAnyRequests: false, websocket: true },
  { closeActiveConnections: false, sendAnyRequests: true, websocket: false },
  { closeActiveConnections: false, sendAnyRequests: true, websocket: true },
  { closeActiveConnections: true, sendAnyRequests: true, websocket: false },
  { closeActiveConnections: true, sendAnyRequests: true, websocket: true },
];

for (const { closeActiveConnections, sendAnyRequests, websocket } of cases) {
  test(
    "flags: " +
      Object.entries({ closeActiveConnections, sendAnyRequests, websocket })
        .filter(([key, value]) => value)
        .map(([key]) => key)
        .join(" "),
    async () => {
      await run({ closeActiveConnections, sendAnyRequests, websocket });
    },
  );
}
