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
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

// A released cell is only unprotected; it still has to be collected, and a
// freed server releases its cell from a deferred task, so alternate turns of
// the event loop with collections.
async function collectCells() {
  for (let i = 0; i < 20 && liveCells() > 0; i++) {
    await turn();
    Bun.gc(true);
    await turn();
  }
  return liveCells();
}

async function build() {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "app.ts")],
    target: "browser",
    plugins: [plugin],
  });
  return result.success && (await result.outputs[0].text()).includes(MARKER);
}

// Separate function so the servers are unreachable by the time collectCells() runs.
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

const buildUsedPlugin = await build();
const buildCellsAfter = await collectCells();
const { usedPlugin: serveUsedPlugin, cellsWhileServing } = await serve();
const serveCellsAfter = await collectCells();

console.log(
  JSON.stringify({
    setups: globalThis.setups,
    buildUsedPlugin,
    buildCellsAfter,
    serveUsedPlugin,
    cellsWhileServing,
    serveCellsAfter,
  }),
);
