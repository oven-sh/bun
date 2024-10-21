import { expect, test } from "bun:test";
import { connect, listen } from "bun";
import { getMaxFD } from "harness";

test("tcp socket doesn't leak", async () => {
  const init = getMaxFD();
  {
    let onClose = () => {};
    const server = listen({
      port: 0,
      hostname: "0.0.0.0",
      socket: {
        data(socket, data) {
          socket.write("hi");
        },
        open(socket) {},
        close(socket) {
          onClose(socket);
        },
      },
    });

    let attempts = 1000;
    while ((attempts -= 50) >= 0) {
      let batch = [];
      let closed = [];
      for (let i = 0; i < 50; i++) {
        const onClose = Promise.withResolvers();
        closed.push(onClose.promise);
        batch.push(
          connect({
            port: server.port,
            hostname: server.hostname,
            socket: {
              close(socket) {
                onClose.resolve(socket);
              },
              data(socket, data) {},
              open(socket) {
                socket.write("hi");
              },
            },
          }),
        );
      }

      const sockets = await Promise.all(batch);
      sockets.forEach(socket => socket.end());
      await Promise.all(closed);
    }
    server.stop(true);
  }
  Bun.gc(true);
  await Bun.sleep(1000);
  Bun.gc(true);
  const end = getMaxFD();
  console.log({ init, end });
  expect(end - init).toBeLessThan(100);
});
