// Exits while an HTML route is still being bundled with the server's shared
// plugin cell. VM teardown then cancels that build, which must not release the
// cell it only borrows from the server (nor crash under ASAN while giving it up).
import html from "./index.html";

const parked = Promise.withResolvers<void>();
globalThis.holdBuild = () => {
  parked.resolve();
  return new Promise(() => {});
};

const server = Bun.serve({
  port: 0,
  development: false,
  routes: { "/": html },
  fetch: () => new Response("not found", { status: 404 }),
});
// Never answered: the process exits while this request's build is parked in the plugin.
fetch(server.url).catch(() => {});
await parked.promise;

console.log("build parked in the plugin, exiting");
process.exit(0);
