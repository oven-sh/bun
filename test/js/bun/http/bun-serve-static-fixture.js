import { serve } from "bun";

let server = Bun.serve({
  port: 0,
  development: {
    hmr: false,
  },
  async fetch(req) {
    return new Response("Hello World", {
      status: 404,
    });
  },
});

process.on("message", async message => {
  const files = message.files || {};
  const routes = {};
  for (const [key, value] of Object.entries(files)) {
    routes[key] = (await import(value)).default;
  }

  server.reload({
    // omit "fetch" to check we can do server.reload without passing fetch
    static: routes,
    development: {
      hmr: false,
    },
  });
});

process.send({
  port: server.port,
  hostname: server.hostname,
});
