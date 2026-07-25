// The proxy under test: returns a fetch() Response whose body is the native
// ByteStream from the upstream. RSS is exposed on a second port so the test
// can sample it without disturbing the proxied connection.
const upstream = process.argv[2];

const proxy = Bun.serve({
  port: 0,
  idleTimeout: 255,
  fetch: () => fetch(upstream),
});

const control = Bun.serve({
  port: 0,
  fetch() {
    Bun.gc(true);
    return Response.json({ rss: process.memoryUsage.rss() });
  },
});

console.log(JSON.stringify({ proxyPort: proxy.port, controlPort: control.port }));

setInterval(() => {}, 1e9);
