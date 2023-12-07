import { type MessagePort, parentPort } from "worker_threads";

class Worker {
  private port!: MessagePort;

  constructor() {
    if (parentPort === null) {
      throw new Error("parentPort is null");
    }
    parentPort.on("message", message => {
      this.port = message.port as MessagePort;
      this.port.on("message", message => {
        this.port.postMessage(message);
      });
    });
  }
}

export default new Worker();
