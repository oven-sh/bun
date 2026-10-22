// If port exhaustion occurs, these tests fail.
// These tests fail by timing out.

import { expect, test } from "bun:test";
import { getMaxFD, isCI, isDebug, isMacOS } from "harness";

// Since we bumped MAX_CONNECTIONS to 4, we should halve the threshold on macOS.
// A debug build is too slow to exhaust the ports, so it only checks the close paths and the fd leak.
const PORT_EXHAUSTION_THRESHOLD = isDebug ? 2 * 1024 : isMacOS ? 8 * 1024 : 16 * 1024;

type SocketData = { read?: boolean; written?: boolean };

async function runStressTest({
  onServerWritten,
  onFetchWritten,
}: {
  onServerWritten: (socket) => void;
  onFetchWritten: (socket) => void;
}) {
  const total = PORT_EXHAUSTION_THRESHOLD * 2;
  let sockets: Bun.Socket<SocketData>[] = [];
  const batch = 48;
  let toClose = 0;
  let pendingClose = Promise.withResolvers();
  let serverReceived = 0;
  let bodyMismatches = 0;
  const objects: { method: string; body: string; keepalive: boolean }[] = [];
  for (let i = 0; i < batch; i++) {
    objects.push({
      method: "POST",
      body: "--BYTEMARKER: " + (10 + i) + " ",
      keepalive: false,
    });
  }

  const server = await Bun.listen<SocketData>({
    port: 0,
    socket: {
      open(socket) {},
      data(socket, data) {
        const text = new TextDecoder().decode(data);
        const i = parseInt(text.slice(text.indexOf("--BYTEMARKER: ") + "--BYTEMARKER: ".length).slice(0, 3)) - 10;
        if (text.includes(objects[i].body)) {
          serverReceived++;
          socket.data ??= {};
          socket.data.read = true;
          sockets[i] = socket;
          if (socket.write("200 OK\r\nCo") === "200 OK\r\nCo".length) {
            socket.data.written = true;
            onServerWritten(socket);
          }
          return;
        }

        bodyMismatches++;
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
  let issued = 0;
  for (let remaining = total; remaining > 0; remaining -= batch) {
    pendingClose = Promise.withResolvers();
    {
      const promises: Promise<Response>[] = [];
      toClose = batch;
      for (let i = 0; i < batch; i++) {
        promises.push(
          fetch(`http://127.0.0.1:${server.port}`, objects[i]).finally(() => {
            onFetchWritten(sockets[i]);
          }),
        );
      }
      issued += batch;
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
  expect({ bodyMismatches, serverReceived }).toEqual({ bodyMismatches: 0, serverReceived: issued });
  expect(initialMaxFD).toBeGreaterThanOrEqual(0);
  expect(getMaxFD()).toBeLessThan(initialMaxFD + 10);
}

test.todoIf(isCI && isMacOS)(
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

test.todoIf(isCI && isMacOS)(
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

test.todoIf(isCI && isMacOS)(
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
