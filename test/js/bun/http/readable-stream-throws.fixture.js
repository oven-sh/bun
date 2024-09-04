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
          // Use a base64-encoded error string to ensure the test printing
          // source code stack traces is not confused with an error message.
          throw new Error(atob("T29w"));
        },
        cancel(reason) {
          console.log("Cancel call");
          console.error(reason);
        },
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
