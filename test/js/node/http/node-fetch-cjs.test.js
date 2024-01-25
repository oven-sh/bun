const fetch = require("node-fetch");

test("require('node-fetch') fetches", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      server.stop();
      return new Response();
    },
  });
  expect(await fetch("http://" + server.hostname + ":" + server.port)).toBeInstanceOf(Response);
  server.stop(true);
});
