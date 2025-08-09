using server2 = Bun.serve({
  port: 0,
  async fetch() {
    await Bun.sleep(1000);
    return new Response("test");
  },
});

using server = Bun.serve({
  port: 0,
  error(error) {
    return new Response(error.message, { status: 500 });
  },
  async fetch() {
    const signal = AbortSignal.timeout(1);
    return await fetch(server2.url.href, { signal });
  },
});

let url = server.url.href;

const responses: Response[] = [];
for (let i = 0; i < 10; i++) {
  responses.push(await fetch(url));
}
// we fail if any of the requests succeeded
const anySuccess = responses.some(res => res.status >= 200 && res.status < 500);
process.exit(anySuccess ? 1 : 0);
