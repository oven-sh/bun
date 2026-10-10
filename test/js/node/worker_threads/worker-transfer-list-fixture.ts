// Shared by worker-transfer-list.test.ts and worker-transfer-list-node.test.ts. The second one also
// runs in Node.js, so this file imports only Node modules.
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";

/** A worker entry: answers on the port it received with what is in the buffer it received, then stays alive. */
export const echoEntry = `
  const { workerData } = require("node:worker_threads");
  workerData.port.postMessage(new Uint8Array(workerData.buf)[0] + ":" + workerData.buf.byteLength);
  setInterval(() => {}, 1 << 30);
`;

/** What `echoEntry` answers for the buffer of `transferable()`. */
export const echoAnswer = "7:4096";

/** What `stillOwned()` returns while the caller owns its buffer and its port. */
export const owned = { bytes: 4096, received: { message: "still entangled" } };

/** A buffer and a port, the options that transfer both, and what the caller still has of them. */
export function transferable() {
  const buf = new ArrayBuffer(4096);
  new Uint8Array(buf).fill(7);
  const { port1, port2 } = new MessageChannel();
  return {
    buf,
    port1,
    port2,
    options: () => ({ workerData: { buf, port: port2 }, transferList: [buf, port2] }),
    stillOwned() {
      port1.postMessage("still entangled");
      return { bytes: buf.byteLength, received: receiveMessageOnPort(port2) };
    },
  };
}
