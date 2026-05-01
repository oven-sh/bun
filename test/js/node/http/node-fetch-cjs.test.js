const fetch = require("node-fetch");

test("require('node-fetch') fetches", async () => {
  // can't use `using`. see https://github.com/oven-sh/bun/issues/11100
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
