// Exits after servers that loaded their plugins were stopped. VM teardown
// destructs every cell, in no order a server can rely on, and frees each
// stopped server from its finalizer. Its plugin cell may already be destructed
// by then, so the server must not touch it.
import type { Server } from "bun";
import { serveHtml } from "./cells.ts";
import html from "./index.html";

// Two servers: one alone is freed after its cell in most runs, not in all.
const servers: Server[] = [];
for (let i = 0; i < 2; i++) {
  const server = serveHtml(html, false);
  servers.push(server);
  // Loads the plugins and bundles the route.
  const page = await fetch(server.url);
  if (page.status !== 200) throw new Error("HTML route responded with " + page.status);
  await page.text();
}
await Promise.all(servers.map(server => server.stop(true)));

console.log("servers stopped, exiting");
process.exit(0);
