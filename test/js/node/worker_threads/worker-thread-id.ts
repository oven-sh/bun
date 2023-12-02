import { parentPort, threadId } from "worker_threads";

parentPort?.on("message", message => {
  if (message.workerId !== threadId) {
    throw new Error("threadId is not consistent");
  }
});
