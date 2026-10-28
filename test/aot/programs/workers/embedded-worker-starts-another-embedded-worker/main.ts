// A Worker started from an embedded file starts a Worker from an embedded file of its own.
import w1 from "./w1.ts" with { type: "file" };
function ask(w: Worker, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    w.onmessage = e => {
      resolve(String(e.data));
      w.terminate();
    };
    w.onerror = e => {
      reject(new Error("worker error: " + e.message));
    };
    w.postMessage(text);
  });
}
console.log(await ask(new Worker(w1), "a"));
