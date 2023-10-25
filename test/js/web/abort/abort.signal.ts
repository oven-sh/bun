import type { Server } from "bun";

const server = Bun.serve({
  port: 0,
  async fetch() {
    const signal = AbortSignal.timeout(1);
    return await fetch("https://bun.sh", { signal });
  },
});

function hostname(server: Server) {
  if (server.hostname.startsWith(":")) return `[${server.hostname}]`;
  return server.hostname;
}

let url = `http://${hostname(server)}:${server.port}/`;

const responses: Response[] = [];
for (let i = 0; i < 10; i++) {
  responses.push(await fetch(url));
}
server.stop(true);
// we fail if any of the requests succeeded
process.exit(responses.every(res => res.status === 500) ? 0 : 1);
