// Spawned with SERVE_PLUGIN_SETUP_THROWS set, so loading the plugins rejects.
// The server reports that on stderr and answers the route with an error; the
// cell it had created for the load must be unprotected by then (it used to stay
// protected for good). One server only: a second load in the same process
// would hit the module cache and reject synchronously, a separate code path.
import { protectedCells } from "./cells.ts";
import html from "./index.html";

const server = Bun.serve({
  port: 0,
  development: false,
  routes: { "/": html },
  fetch: () => new Response("not found", { status: 404 }),
});
const response = await fetch(server.url);
await response.text();
const protectedCellsAfterReject = protectedCells();
await server.stop(true);

console.log(JSON.stringify({ setups: globalThis.setups, status: response.status, protectedCellsAfterReject }));
