import { shared } from "./shared";

const worker = new Worker(new URL("./main.ts", import.meta.url));
worker.onmessage = event => {
  console.log(shared("main"), "/", event.data);
  worker.terminate();
};
worker.postMessage(20);
