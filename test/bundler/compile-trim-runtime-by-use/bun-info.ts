// a development server answers /bun:info
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
const response = await fetch(`http://127.0.0.1:${server.port}/bun:info`);
const info = (await response.json()) as Record<string, unknown>;
console.log(response.status, response.headers.get("content-type"), Object.keys(info).sort().join(" "));
server.stop(true);
