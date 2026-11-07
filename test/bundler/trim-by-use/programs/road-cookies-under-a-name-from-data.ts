const name = ["coo", "kies"].join("");
using server = Bun.serve({
  port: 0,
  routes: {
    "/": request => new Response(JSON.stringify(request, [name])),
  },
});
console.log(await (await fetch(server.url)).text());
