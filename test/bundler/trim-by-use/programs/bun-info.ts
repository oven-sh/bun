// a development server answers /bun:info; a server without that route hands the request to the program's own
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
const response = await fetch(`http://127.0.0.1:${server.port}/bun:info`);
const text = await response.text();
const names = text.startsWith("{")
  ? Object.keys(JSON.parse(text) as Record<string, unknown>)
      .sort()
      .join(" ")
  : text;
console.log(response.status, response.headers.get("content-type"), names);
server.stop(true);
