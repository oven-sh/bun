import { forMain, forBoth } from "shared-barrel";

console.log(forMain() + ", " + forBoth());
const worker = new Worker(new URL("./main.js", import.meta.url));
worker.onmessage = event => {
  console.log("the worker says: " + event.data);
  worker.terminate();
};
worker.postMessage("go");
