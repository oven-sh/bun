import { isMainThread, threadId } from "node:worker_threads";
console.log(isMainThread, threadId);
const source = `self.onmessage = event => postMessage({ twice: event.data.n * 2, list: [...event.data.list, "worker"] });`;
const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" })));
const answer = await new Promise(resolve => {
  worker.onmessage = (event: any) => resolve(event.data);
  worker.onerror = (event: any) => resolve("error: " + event.message);
  worker.postMessage({ n: 21, list: ["main"] });
});
console.log(JSON.stringify(answer));
worker.terminate();
