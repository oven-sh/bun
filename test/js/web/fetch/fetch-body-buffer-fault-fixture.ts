// Prints what becomes of a body for a part of which there is no memory.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

if (isMainThread) {
  const [reader, when, rest] = process.argv.slice(2);
  const read = {
    text: (response: Response) => response.text(),
    arrayBuffer: (response: Response) => response.arrayBuffer(),
    blob: (response: Response) => response.blob(),
    body: (response: Response) => Array.fromAsync(response.body!),
    clone: (response: Response) => response.clone().text(),
    tee: (response: Response) => Array.fromAsync(response.body!.tee()[1]),
    write: (response: Response) => Bun.write(process.env.OUT!, response),
  }[reader]!;
  const isClosed = new Int32Array(new SharedArrayBuffer(4));
  const server = new Worker(import.meta.path, { workerData: isClosed });
  const port = await new Promise(resolve => server.once("message", resolve));
  server.unref();

  const response = await fetch(`http://127.0.0.1:${port}`);
  const early = when === "before" ? read(response) : undefined;
  fault.set({ syscall: "fetch_body_buffer", action: "errno", errno: "ENOMEM" });
  server.postMessage(rest);
  // The client has given up, and this thread has not been told yet.
  if (!early && Atomics.wait(isClosed, 0, 0, 30_000) === "timed-out") throw new Error("The socket is still open");
  console.log(
    await (early ?? read(response)).then(
      () => "resolved",
      error => error.code,
    ),
  );
} else {
  const { port } = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n");
        parentPort!.once("message", rest => socket.write(`4\r\nmore\r\n${rest === "end" ? "0\r\n\r\n" : ""}`));
      },
      close() {
        Atomics.store(workerData, 0, 1);
        Atomics.notify(workerData, 0);
      },
    },
  });
  parentPort!.postMessage(port);
}
