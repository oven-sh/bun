let completed = 0;
const server = Bun.serve({
  port: 0,
  async fetch(req, res) {
    return new Response(
      new ReadableStream({
        async pull(controller) {
          controller.enqueue("Hello!");
          const { promise, resolve } = Promise.withResolvers();
          setTimeout(() => resolve(), 100).unref();
          await promise;
          controller.close();
        },
      }),
    );
  },
});

process.on("beforeExit", () => {
  console.log("Completed:", completed);
  if (completed !== 10) {
    process.exit(42);
  }
});

server.unref();
Promise.allSettled(
  Array.from({ length: 10 }, () =>
    fetch(server.url).then(() => {
      completed++;
    }),
  ),
);
