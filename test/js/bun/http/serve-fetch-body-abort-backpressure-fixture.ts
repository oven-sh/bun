// Proxy under test: returns a fetch() Response whose body is the native
// ByteStream from the upstream.
const upstream = process.argv[2];

const proxy = Bun.serve({
  port: 0,
  idleTimeout: 255,
  fetch: () => fetch(upstream),
});

console.log(JSON.stringify({ proxyPort: proxy.port }));
