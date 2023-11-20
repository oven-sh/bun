import { type MessagePort, parentPort } from "node:worker_threads";

class Worker {
  private port!: MessagePort;

  constructor() {
    parentPort?.on("message", message => {
      this.port = message.port as MessagePort;
      this.port.on("message", message => {
        this.port.postMessage(message);
      });
    });
  }
}

export default new Worker();
