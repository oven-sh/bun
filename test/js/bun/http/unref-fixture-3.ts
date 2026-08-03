// The server starts ref'd so the process lives until the request arrives.
// Inside the handler we unref the server and await an unref'd timer, so the
// only thing keeping this process alive while the handler is suspended is the
// in-flight request itself. The client lives in the parent process.
const server = Bun.serve({
  port: 0,
  async fetch() {
    server.unref();
    await new Promise<void>(resolve => setTimeout(resolve, 200).unref());
    return new Response("ok");
  },
});
process.stdout.write(String(server.port) + "\n");
