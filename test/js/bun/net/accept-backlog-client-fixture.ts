// The client thread of accept-backlog-fixture.ts. It has no imports, so that it starts fast.
declare var self: Worker;

let port = 0;
let request = "";
let signal: Int32Array;

const report = (value: number) => {
  Atomics.store(signal, 0, value);
  Atomics.notify(signal, 0);
};

async function connectBatch(batch: number) {
  let ready = 0;
  const sockets = [];
  for (let i = 0; i < batch; i++) {
    sockets.push(
      Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          open(socket) {
            // With TCP_DEFER_ACCEPT the kernel queues the connection when its first bytes arrive.
            if (request) socket.write(request);
            if (++ready === batch) report(1);
          },
          data() {},
          // The server closes every connection it accepts.
          close() {},
          error() {},
        },
      }),
    );
  }
  await Promise.all(sockets);
}

self.onmessage = event => {
  const message = event.data;
  if (typeof message === "number") {
    connectBatch(message).catch(error => {
      console.error(error);
      report(2);
    });
    return;
  }
  ({ port, request, signal } = message);
  postMessage("ready");
};
