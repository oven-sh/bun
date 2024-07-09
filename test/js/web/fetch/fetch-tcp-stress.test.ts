// If port exhaustion occurs, these tests fail.
// These tests fail by timing out.
const PORT_EXHAUSTION_THRESHOLD = 16 * 1024;
import { test, expect } from "bun:test";
import { getMaxFD } from "harness";

async function runStressTest({
  onServerWritten,
  onFetchWritten,
}: {
  onServerWritten: (socket) => void;
  onFetchWritten: (socket) => void;
}) {
  const total = PORT_EXHAUSTION_THRESHOLD * 2;
  let sockets = [];
  const batch = 48;
  let toClose = 0;
  let pendingClose = Promise.withResolvers();
  const objects = [];
  for (let i = 0; i < total; i++) {
    objects.push({
      method: "POST",
      body: "--BYTEMARKER: " + (10 + i) + " ",
      keepalive: false,
    });
  }

  const server = await Bun.listen({
    port: 0,
    socket: {
      open(socket) {},
      data(socket, data) {
        const text = new TextDecoder().decode(data);
        const i = parseInt(text.slice(text.indexOf("--BYTEMARKER: ") + "--BYTEMARKER: ".length).slice(0, 3)) - 10;
        if (text.includes(objects[i].body)) {
          socket.data ??= {};
          socket.data.read = true;
          sockets[i] = socket;
          if (socket.write("200 OK\r\nCo") === "200 OK\r\nCo".length) {
            socket.data.written = true;
            onServerWritten(socket);
          }
          return;
        }

        console.log("Data is missing!");
      },
      drain(socket) {
        if (!socket.data?.read || socket.data?.written) {
          return;
        }

        if (socket.write("200 OK\r\nCo") === "200 OK\r\nCo".length) {
          socket.data.written = true;
          onServerWritten(socket);
        }
      },
      error(socket, err) {
        console.log(err);
      },
      timeout() {},
      close(socket) {
        toClose--;
        if (toClose === 0) {
          pendingClose.resolve();
        }
      },
    },
    hostname: "127.0.0.1",
  });
  let initialMaxFD = -1;
  for (let remaining = total; remaining > 0; remaining -= batch) {
    pendingClose = Promise.withResolvers();
    {
      const promises = [];
      toClose = batch;
      for (let i = 0; i < batch; i++) {
        promises.push(
          fetch(`http://127.0.0.1:${server.port}`, objects[i]).finally(() => {
            onFetchWritten(sockets[i]);
          }),
        );
      }
      await Promise.allSettled(promises);

      promises.length = 0;
    }

    await pendingClose.promise;
    if (total) sockets = [];

    if (initialMaxFD === -1) {
      initialMaxFD = getMaxFD();
    }
  }
  server.stop(true);
  await Bun.sleep(10);
  expect(getMaxFD()).toBeLessThan(initialMaxFD + 10);
}

test(
  "shutdown after timeout",
  async () => {
    await runStressTest({
      onServerWritten(socket) {
        socket.end();
      },
      onFetchWritten(socket) {},
    });
  },
  30 * 1000,
);

test(
  "close after TCP fin",
  async () => {
    await runStressTest({
      onServerWritten(socket) {
        socket.shutdown();
      },
      onFetchWritten(socket) {
        socket.end();
      },
    });
  },
  30 * 1000,
);

test(
  "shutdown then terminate",
  async () => {
    await runStressTest({
      onServerWritten(socket) {
        socket.shutdown();
      },
      onFetchWritten(socket) {
        socket.terminate();
      },
    });
  },
  30 * 1000,
);

test(
  "gently close",
  async () => {
    await runStressTest({
      onServerWritten(socket) {
        socket.end();
      },
      onFetchWritten(socket) {},
    });
  },
  30 * 1000,
);
