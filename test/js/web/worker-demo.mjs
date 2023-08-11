import path from "path";
import { Worker, isMainThread, threadId, workerData } from "worker_threads";

if (isMainThread) {
  for (let i = 0; i < 1000; i++) {
    const w = new Worker("/Users/dave/code/bun/test/js/web/worker-demo.mjs", { ref: false, workerData: i });
    let recieved = false;
    w.on("message", msg => {
      if (msg === "initial message") {
        recieved = true;
      } else {
        console.log("WHAT?", msg);
      }
    });
    setTimeout(() => {
      // w.terminate();
      if (!recieved) console.log("we didn't hear from", i);
    }, 10000 + 500);
  }
  setInterval(() => {
    console.log("main thread");
  }, 1000);
} else {
  self.postMessage("initial message");
  setTimeout(() => {
    console.log("workerid=", workerData);
  }, Math.random() * 5000 + 500);
}
