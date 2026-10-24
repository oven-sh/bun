const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
const answer = await fetch(`http://127.0.0.1:${server.port}/bun:info`);
console.log(answer.status, (await answer.text()).length > 0);
server.stop(true);
