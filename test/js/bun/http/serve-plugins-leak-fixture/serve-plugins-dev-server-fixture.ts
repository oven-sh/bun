// Same as the serve part of serve-plugins-leak-fixture.ts, but with the
// DevServer (`development: true`), the other consumer of a server's plugins.
import { collectCells, serveAndStop } from "./cells.ts";
import html from "./index.html";

const { usedPlugin, cellsWhileServing } = await serveAndStop(html, true, 2);
const cellsAfter = await collectCells("after the dev servers were stopped");

console.log(JSON.stringify({ setups: globalThis.setups, usedPlugin, cellsWhileServing, cellsAfter }));
