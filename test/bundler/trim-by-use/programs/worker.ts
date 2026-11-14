import { isMainThread, threadId } from "node:worker_threads";
declare var self: Worker;
if (isMainThread) {
  console.log(isMainThread, threadId);
  const worker = new Worker(import.meta.url);
  const answer = await new Promise(resolve => {
    worker.onmessage = (event: any) => resolve(event.data);
    worker.onerror = (event: any) => resolve("error: " + event.message);
    worker.postMessage({ n: 21, list: ["main"] });
  });
  console.log(JSON.stringify(answer));
  worker.terminate();
} else {
  self.onmessage = (event: any) => postMessage({ twice: event.data.n * 2, list: [...event.data.list, "worker"] });
}
