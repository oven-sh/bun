interface Written {
  write(chunk: string): void;
  close(): void;
}
const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response(
      new ReadableStream({
        type: "direct",
        pull(controller: Written) {
          controller.write("cargo");
          controller.close();
        },
      } as never),
    );
  },
});
console.log(typeof server.port, server.pendingRequests);
await server.stop(true);
console.log("stopped");
