// Every Bun.serve() that loads the `[serve.static]` plugins from the bunfig.toml
// next to this file creates one BundlerPlugin cell and protects it from GC; so
// does a Bun.build() with plugins. The cell (and everything the plugin
// callbacks capture) has to become collectable once the server is gone, or
// once the build is done. Prints one JSON line; serve-plugins-leak.test.ts asserts it.
import { join } from "node:path";
import { MARKER, collectCells, serveAndStop, serveHtml } from "./cells.ts";
import html from "./index.html";
import plugin from "./plugin.ts";

async function build() {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "app.ts")],
    target: "browser",
    plugins: [plugin],
  });
  return result.success && (await result.outputs[0].text()).includes(MARKER);
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
    const server = serveHtml(html, false);
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
const { usedPlugin: serveUsedPlugin, cellsWhileServing } = await serveAndStop(html, false, 2);
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
