import { parentPort, threadId } from "worker_threads";

if (parentPort === null) {
  throw new Error("parentPort is null");
}

parentPort.on("message", message => {
  if (message.workerId !== threadId) {
    throw new Error("threadId is not consistent");
  }
});
