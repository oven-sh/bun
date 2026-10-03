import { getDevServerDeinitCount } from "bun:internal-for-testing";
import html from "./index.html";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { fullGC, generateHeapSnapshotForDebugging, heapStats } from "bun:jsc";

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

const serverClassNames = ["HTTPServer", "DebugHTTPServer", "HTTPSServer", "DebugHTTPSServer"];

function liveServerWrappers() {
  const counts = heapStats().objectTypeCounts;
  return serverClassNames.reduce((sum, name) => sum + (counts[name] ?? 0), 0);
}

async function drainServerWrappers(target: number) {
  for (let i = 0; i < 30 && liveServerWrappers() > target; i++) {
    Bun.gc(true);
    fullGC();
    await new Promise(resolve => setImmediate(resolve));
  }
}

// For each live Server wrapper that a GC root reaches: the shortest chain from that root. A wrapper
// that no root reaches is not a leak: a collection does not promise to free what nothing refers to,
// because its scan of the machine stack may still see it (#43443).
function retainedServerWrappers(): string[] {
  const { nodes, nodeClassNames, edges, edgeTypes, edgeNames, roots, labels } =
    generateHeapSnapshotForDebugging() as any;
  // nodes: id, size, class name, flags, label, cell address, address of the wrapped native object.
  const nodeOffsets = new Map<number, number>();
  for (let i = 0; i < nodes.length; i += 7) nodeOffsets.set(nodes[i], i);
  const className = (id: number) => nodeClassNames[nodes[nodeOffsets.get(id)! + 2]];
  // edges: from, to, type, property name or array index.
  const incomingEdges = new Map<number, number[]>();
  for (let edge = 0; edge < edges.length; edge += 4) {
    const list = incomingEdges.get(edges[edge + 1]);
    if (list) list.push(edge);
    else incomingEdges.set(edges[edge + 1], [edge]);
  }
  // roots: id, why it is a root, why an opaque root keeps it. An output constraint lists the
  // listeners of every marked emitter (DOMGCOutput). Those follow from whatever marked the emitter.
  const rootReasons = new Map<number, string>();
  for (let i = 0; i < roots.length; i += 3) {
    if (labels[roots[i + 1]] === "DOMGCOutput") continue;
    rootReasons.set(roots[i], labels[roots[i + 2]] || labels[roots[i + 1]] || "root");
  }

  const chainFromRoot = (target: number) => {
    // Breadth-first towards the roots: `next` holds, per cell, the edge that leads on to `target`.
    const next = new Map<number, number>([[target, -1]]);
    const queue = [target];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (rootReasons.has(id)) {
        let chain = `${className(id)} (${rootReasons.get(id)})`;
        for (let edge = next.get(id)!; edge !== -1; edge = next.get(edges[edge + 1])!) {
          const type = edgeTypes[edges[edge + 2]];
          const name =
            type === "Internal" ? "" : type === "Index" ? ` [${edges[edge + 3]}]` : ` .${edgeNames[edges[edge + 3]]}`;
          chain += `${name} -> ${className(edges[edge + 1])}`;
        }
        return chain;
      }
      for (const edge of incomingEdges.get(id) ?? []) {
        if (next.has(edges[edge])) continue;
        next.set(edges[edge], edge);
        queue.push(edges[edge]);
      }
    }
  };

  const retained: string[] = [];
  let sawRootedPrototype = false;
  for (let i = 0; i < nodes.length; i += 7) {
    if (!serverClassNames.includes(nodeClassNames[nodes[i + 2]])) continue;
    const chain = chainFromRoot(nodes[i]);
    // Only an instance wraps a native server. The prototype shares the class name.
    if (nodes[i + 6] !== "0x0") {
      if (chain) retained.push(chain);
    } else if (chain) {
      sawRootedPrototype = true;
    }
  }
  // The prototype is always alive and always rooted. If the walk cannot see that, it cannot clear
  // a wrapper either.
  if (!sawRootedPrototype) throw new Error("the heap snapshot has no rooted Server prototype");
  return retained;
}

// `objectTypeCounts` includes the (lazily created) prototype object once the
// first server has been constructed. Create-and-stop one trivial server here
// so the prototype is materialized but the instance is freed. Captured in
// beforeAll so the baseline exists even when a name filter skips the baseline
// test.
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
  // Collect until only the prototype is left. The turn after each collection
  // runs the deferred deinit tasks of what it finalized. Then assert nothing
  // still holds a JS Server wrapper, so the native NewServer boxes are freed,
  // not just the embedded dev servers.
  await drainServerWrappers(1);
  // One live cell is the prototype alone. More is a wrapper or, on libuv
  // platforms, a second prototype: the snapshot tells which.
  expect(liveServerWrappers() <= 1 ? [] : retainedServerWrappers()).toEqual([]);
  // A wrapper that stays costs all 30 rounds and one snapshot. That is 6 to 12 s
  // on a debug ASAN build, and the default is 5 s.
}, 30_000);

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
