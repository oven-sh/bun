for (let beforeHeaders of [true, false]) {
  for (let abortTimeout of [1, 2, 0]) {
    const count = 100;
    let defer = Promise.withResolvers();
    const log = `[${beforeHeaders ? "beforeHeaders" : "afterHeaders"}] ${abortTimeout} timeout`;
    console.time(log);
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      development: false,

      async fetch() {
        if (beforeHeaders) {
          await defer.promise;
          throw new Error("Never going to happen");
        } else {
          return new Response(
            new ReadableStream({
              async pull(controller) {
                controller.enqueue("a");
                await defer.promise;
              },
            }),
          );
        }
      },
    });

    let responses = new Array(count);

    for (let i = 0; i < count; i++) {
      const defer2 = Promise.withResolvers();
      fetch(server.url, { signal: AbortSignal.timeout(abortTimeout) })
        .then(response => {
          if (beforeHeaders) {
            defer2.reject(new Error("One of the requests succeeded"));
          } else {
            return response.arrayBuffer();
          }
        })
        .catch(err => {
          if (err.name !== "TimeoutError") {
            defer2.reject(err);
          } else {
            defer2.resolve();
          }
        });
      responses[i] = defer2.promise;
    }
    await Promise.all(responses);
    console.timeEnd(log);
  }
}
