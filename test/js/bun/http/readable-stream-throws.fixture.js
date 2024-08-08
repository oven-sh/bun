const server = Bun.serve({
  port: 0,

  error(err) {
    return new Response("Failed", { status: 555 });
  },

  async fetch(request) {
    const { pathname } = new URL(request.url);
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (pathname === "/write") {
            controller.enqueue("Hello, ");
            controller.enqueue("world!");
            controller.close();
          }
          throw new Error("Oops");
        },
        cancel(reason) {},
      }),
      {
        status: 402,
        headers: {
          "X-Hey": "123",
        },
      },
    );
  },
});

process.send(`${server.url}`);
