// If port exhaustion occurs, these tests fail.
// These tests fail by timing out.

import { expect, test } from "bun:test";
import { getMaxFD, isASAN, isCI, isDebug, isMacOS } from "harness";

// Since we bumped MAX_CONNECTIONS to 4, we should halve the threshold on macOS.
// Debug/ASAN iterate ~30x slower so TIME_WAIT ports clear long before the
// ephemeral range is exhausted; a smaller count still exercises the fd-leak
// check and every socket-close path.
const PORT_EXHAUSTION_THRESHOLD = isASAN || isDebug ? 2 * 1024 : isMacOS ? 8 * 1024 : 16 * 1024;

async function runStressTest({
  onServerWritten,
  onFetchWritten,
}: {
  onServerWritten: (socket) => void;
  onFetchWritten: (socket) => void;
}) {
  const total = PORT_EXHAUSTION_THRESHOLD * 2;
  const batch = 48;
  let sockets = [];
  let toClose = 0;
  let pendingClose = Promise.withResolvers();
  let serverReceived = 0;
  let bodyMismatches = 0;

  // Each outer-loop iteration issues the same `batch` requests (indices 0..batch-1),
  // so only `batch` option objects are needed.
  const objects = [];
  for (let i = 0; i < batch; i++) {
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
      const promises = [];
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
  expect({ bodyMismatches, serverReceived, initialMaxFD }).toEqual({
    bodyMismatches: 0,
    serverReceived: issued,
    initialMaxFD: expect.any(Number),
  });
  expect(initialMaxFD).toBeGreaterThanOrEqual(0);
  expect(getMaxFD()).toBeLessThan(initialMaxFD + 10);
}

const variants: Array<[name: string, onServerWritten: (s: any) => void, onFetchWritten: (s: any) => void]> = [
  ["gently close", s => s.end(), () => {}],
  ["close after TCP fin", s => s.shutdown(), s => s.end()],
  ["shutdown then terminate", s => s.shutdown(), s => s.terminate()],
];

for (const [name, onServerWritten, onFetchWritten] of variants) {
  test.todoIf(isCI && isMacOS)(
    name,
    async () => {
      await runStressTest({ onServerWritten, onFetchWritten });
    },
    30 * 1000,
  );
}
