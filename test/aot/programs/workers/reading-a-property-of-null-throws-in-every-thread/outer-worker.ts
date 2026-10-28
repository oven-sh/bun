import { readThroughNothing } from "./reads";
const inner = new Worker(new URL("./inner-worker.ts", import.meta.url));
inner.onmessage = event => {
  postMessage(event.data);
  postMessage("the Worker that started it: " + readThroughNothing());
};
