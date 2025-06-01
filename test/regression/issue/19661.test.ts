test("ReadableStream", async () => {
  const { resolve, promise } = Promise.withResolvers();
  let controller: ReadableStreamDefaultController;
  let stream = () =>
    new ReadableStream({
      start(controller1) {
        controller = controller1;
        controller1.close();
        process.nextTick(resolve);
      },
    });

  stream();

  await promise;

  expect(() => controller!.close()).toThrowError(
    expect.objectContaining({
      name: "TypeError",
      message: "Invalid state: Controller is already closed",
      code: "ERR_INVALID_STATE",
    }),
  );
});

test("server version", async () => {
  const { resolve, promise } = Promise.withResolvers();
  let controller: ReadableStreamDefaultController;
  let stream = () =>
    new ReadableStream({
      start(controller1) {
        controller = controller1;

        controller.close();

        process.nextTick(resolve);
      },
    });

  // will start the server on default port 3000
  const server = Bun.serve({
    fetch(req) {
      return new Response(stream());
    },
  });

  await fetch(server.url, {});
  await promise;

  expect(() => controller!.close()).toThrowError(
    expect.objectContaining({
      name: "TypeError",
      message: "Invalid state: Controller is already closed",
      code: "ERR_INVALID_STATE",
    }),
  );
});
