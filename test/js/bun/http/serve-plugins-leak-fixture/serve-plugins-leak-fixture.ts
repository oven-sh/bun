// Every Bun.serve() that loads the `[serve.static]` plugins from the bunfig.toml
// next to this file creates one native BundlerPlugin cell and protects it from
// GC; so does a Bun.build() with plugins. The cell (and everything the plugin
// callbacks capture) has to become collectable once the server is gone, or
// once the build is done. Prints one JSON line; serve-plugins-leak.test.ts asserts it.
import type { Server } from "bun";
import { heapStats } from "bun:jsc";
import { join } from "node:path";
import html from "./index.html";
import plugin from "./plugin.ts";

const SERVERS = 2;
const MARKER = "text-from-plugin";

const liveCells = () => heapStats().objectTypeCounts.BundlerPlugin ?? 0;
const liveServerWrappers = () => {
  const counts = heapStats().objectTypeCounts;
  return (counts.HTTPServer ?? 0) + (counts.DebugHTTPServer ?? 0);
};
// A turn of the event loop: a freed server releases its cell from a deferred
// task. The two scheduling paths alternate so that convergence does not hinge
// on what one of them happens to keep reachable for a few turns.
const turn = (i: number) => new Promise<void>(resolve => (i % 2 ? setImmediate(resolve) : setTimeout(resolve, 0)));

// A released cell is only unprotected; it still has to be collected, so
// alternate turns with collections. This converges within a few rounds when
// the cells are released and never when they are not, so the bound only
// decides how long the failing case takes. On failure the per-round survivors
// go to stderr (run-length encoded), which tells whether the Server object
// itself or only its cell is still alive.
async function collectCells(phase: string) {
  const survivors: { what: string; rounds: number }[] = [];
  for (let i = 0; i < 100 && liveCells() > 0; i++) {
    await turn(i);
    Bun.gc(true);
    await turn(i + 1);
    // The Server object count includes the shared prototype: 1 means no instances are left.
    const what = `${liveCells()} BundlerPlugin cells, ${liveServerWrappers()} Server objects`;
    const last = survivors.at(-1);
    if (last?.what === what) last.rounds++;
    else survivors.push({ what, rounds: 1 });
  }
  const remaining = liveCells();
  if (remaining > 0) {
    const trace = survivors.map(({ what, rounds }) => `${what} x${rounds}`).join("\n");
    console.error(`${phase}: still alive after each collection round:\n${trace}`);
  }
  return remaining;
}

async function build() {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "app.ts")],
    target: "browser",
    plugins: [plugin],
  });
  return result.success && (await result.outputs[0].text()).includes(MARKER);
}

// Separate functions so the servers are unreachable by the time collectCells() runs.
async function serve() {
  const servers: Server[] = [];
  let usedPlugin = 0;
  for (let i = 0; i < SERVERS; i++) {
    const server = Bun.serve({
      port: 0,
      development: false,
      routes: { "/": html },
      fetch: () => new Response("not found", { status: 404 }),
    });
    servers.push(server);
    // The first request loads the plugins and bundles the route.
    const page = await fetch(server.url);
    if (page.status !== 200) throw new Error("HTML route responded with " + page.status);
    const script = (await page.text()).match(/src="([^"]+\.js)"/)![1];
    const chunk = await fetch(new URL(script, server.url));
    if ((await chunk.text()).includes(MARKER)) usedPlugin++;
  }
  // Every server is still alive here, so every one of their cells must be too.
  const cellsWhileServing = liveCells();
  await Promise.all(servers.map(server => server.stop(true)));
  return { usedPlugin, cellsWhileServing };
}

// The server is stopped while its route is still being bundled with the
// shared plugin; the build then finishes against the stopped server, which
// still has to give the cell up once it is gone.
async function stopMidBuild() {
  const parked = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  globalThis.holdBuild = () => {
    parked.resolve();
    return released.promise;
  };
  try {
    const server = Bun.serve({
      port: 0,
      development: false,
      routes: { "/": html },
      fetch: () => new Response("not found", { status: 404 }),
    });
    const page = fetch(server.url);
    await parked.promise;
    // Graceful: stops listening but lets the parked request finish.
    const stopped = server.stop();
    released.resolve();
    const response = await page;
    await response.text();
    await server.stop(true);
    await stopped;
    return response.status;
  } finally {
    globalThis.holdBuild = undefined;
  }
}

const buildUsedPlugin = await build();
const buildCellsAfter = await collectCells("after Bun.build()");
const { usedPlugin: serveUsedPlugin, cellsWhileServing } = await serve();
const serveCellsAfter = await collectCells("after the servers were stopped");
const stopMidBuildStatus = await stopMidBuild();
const stopMidBuildCellsAfter = await collectCells("after the server stopped mid-build");

console.log(
  JSON.stringify({
    setups: globalThis.setups,
    buildUsedPlugin,
    buildCellsAfter,
    serveUsedPlugin,
    cellsWhileServing,
    serveCellsAfter,
    stopMidBuildStatus,
    stopMidBuildCellsAfter,
  }),
);
