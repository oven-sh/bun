const server = Bun.serve({
  port: 0,
  fetch(request) {
    return new Response("first " + new URL(request.url).pathname);
  },
});
const ask = async (path: string) => {
  const response = await fetch(new URL(path, server.url));
  return `${response.status} ${await response.text()}`;
};
console.log(await ask("/a"));
const later: Record<string, unknown> = {
  http2: true,
  onNodeHTTPRequest() {
    throw new Error("a server that was not started for node:http never calls this");
  },
  fetch() {
    return new Response("second");
  },
};
server.reload(later as never);
console.log(await ask("/b"));
try {
  server.reload({ ...later, http3: true } as never);
  console.log("reloaded");
} catch (error) {
  console.log((error as Error).message);
}
console.log(await ask("/c"));
console.log(server.protocol);
await server.stop(true);
