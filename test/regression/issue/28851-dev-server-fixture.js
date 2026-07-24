// Dev server (Bake/HMR) fixture for the bunfig `[resolve] conditions` test.
// Imports the HTML route and starts Bun.serve with development: true so the
// Bake bundler runs; conditions must come from the cwd's bunfig.toml.
import index from "./index.html";

const server = Bun.serve({
  port: 0,
  development: true,
  routes: {
    "/": index,
  },
});

process.send({ port: server.port, hostname: server.hostname });
