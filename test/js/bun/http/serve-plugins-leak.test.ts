import { expect, test } from "bun:test";
import { bunRun } from "harness";
import { join } from "node:path";

// Each Bun.serve() that loads `[serve.static]` plugins creates one native
// BundlerPlugin cell (a protected JSCell) for them. ServePlugins used to drop
// its handle to that cell without ever unprotecting it, so every server that
// had served an HTML route left its plugin cell, and everything the plugin
// callbacks captured, rooted for the rest of the process. The fixture also
// covers Bun.build(), whose per-build cell must be released once the build is
// done, since both now share the same owning handle.
test("[serve.static] plugins and Bun.build() plugins release their BundlerPlugin cell", async () => {
  // bunRun() runs the fixture with its own directory as cwd, which is where its bunfig.toml lives.
  const result = await bunRun(join(import.meta.dir, "serve-plugins-leak-fixture", "serve-plugins-leak-fixture.ts"));
  expect(result).toSpawn();
  expect(JSON.parse(result.stdout)).toEqual({
    // One setup() for the build, one per server.
    setups: 3,
    buildUsedPlugin: true,
    buildCellsAfter: 0,
    serveUsedPlugin: 2,
    cellsWhileServing: 2,
    serveCellsAfter: 0,
  });
});
