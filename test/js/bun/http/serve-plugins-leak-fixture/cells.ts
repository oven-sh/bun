// Shared by the fixtures in this directory. "Cells" are the native
// BundlerPlugin objects the `[serve.static]` plugins (or a Bun.build()'s
// plugins) are loaded into; their owner protects them from GC while in use.
import type { HTMLBundle, Server } from "bun";
import { heapStats } from "bun:jsc";

export const MARKER = "text-from-plugin";

export const liveCells = () => heapStats().objectTypeCounts.BundlerPlugin ?? 0;
export const protectedCells = () => heapStats().protectedObjectTypeCounts.BundlerPlugin ?? 0;
const liveServerObjects = () => {
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
export async function collectCells(phase: string) {
  const survivors: { what: string; rounds: number }[] = [];
  for (let i = 0; i < 100 && liveCells() > 0; i++) {
    await turn(i);
    Bun.gc(true);
    await turn(i + 1);
    // The Server object count includes the shared prototype: 1 means no instances are left.
    const what = `${liveCells()} BundlerPlugin cells, ${liveServerObjects()} Server objects`;
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

export function serveHtml(html: HTMLBundle, development: boolean) {
  return Bun.serve({
    port: 0,
    development,
    routes: { "/": html },
    fetch: () => new Response("not found", { status: 404 }),
  });
}

// Starts `count` servers, requests the route of each (which loads the plugins
// and bundles the route), checks the plugin took part in the bundle, counts
// the cells while every server is still alive, then stops them all. Lives in
// its own function so the servers are unreachable once it returns.
export async function serveAndStop(html: HTMLBundle, development: boolean, count: number) {
  const servers: Server[] = [];
  let usedPlugin = 0;
  for (let i = 0; i < count; i++) {
    const server = serveHtml(html, development);
    servers.push(server);
    const page = await fetch(server.url);
    if (page.status !== 200) throw new Error("HTML route responded with " + page.status);
    const script = (await page.text()).match(/src="([^"]+\.js)"/)![1];
    const chunk = await fetch(new URL(script, server.url));
    if ((await chunk.text()).includes(MARKER)) usedPlugin++;
  }
  const cellsWhileServing = liveCells();
  await Promise.all(servers.map(server => server.stop(true)));
  return { usedPlugin, cellsWhileServing };
}
